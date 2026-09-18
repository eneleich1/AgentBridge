const path = require("path");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const { DATA_DIR } = require("../utils/runtimeConfig");

// Whisper runs fully on this machine: no audio or transcript ever leaves it.
// "base" is the balance point between speed on a CPU and accuracy on the
// technical vocabulary (identifiers, file names) a coding session dictates.
const DEFAULT_MODEL = process.env.AGENTBRIDGE_WHISPER_MODEL || "Xenova/whisper-base";
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 4; // 32-bit float PCM
const MIN_AUDIO_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * 0.15; // ~150ms

const LANGUAGE_NAMES = {
  en: "english",
  es: "spanish",
  fr: "french",
  de: "german",
  it: "italian",
  pt: "portuguese",
  nl: "dutch",
  ru: "russian",
  zh: "chinese",
  ja: "japanese",
  ko: "korean",
  ar: "arabic",
  hi: "hindi",
};

function languageNameFor(languageTag) {
  const code = String(languageTag || "").slice(0, 2).toLowerCase();
  return LANGUAGE_NAMES[code] || null;
}

let transcriberPromise = null;

// Loaded once and reused: constructing the pipeline downloads the model on
// first use (cached under data/models afterwards) and keeps it resident in
// memory, which is what makes later segments transcribe in under a second.
async function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const { pipeline, env } = require("@huggingface/transformers");
      env.cacheDir = path.join(DATA_DIR, "models");
      return pipeline("automatic-speech-recognition", DEFAULT_MODEL);
    })().catch((error) => {
      transcriberPromise = null;
      throw error;
    });
  }
  return transcriberPromise;
}

// The browser can only hand over a compressed container (webm/opus, ogg,
// mp4); Whisper needs raw mono 16kHz samples. ffmpeg does that conversion
// entirely over pipes, so nothing touches disk.
function decodeToPcm(buffer) {
  if (!ffmpegPath) {
    return Promise.reject(new Error("ffmpeg is not available on this system."));
  }

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      "-hide_banner",
      "-loglevel", "error",
      "-i", "pipe:0",
      "-ac", "1",
      "-ar", String(SAMPLE_RATE),
      "-f", "f32le",
      "-acodec", "pcm_f32le",
      "pipe:1",
    ]);

    const chunks = [];
    let stderr = "";

    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Audio conversion failed (ffmpeg exited with code ${code}).`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    // A very short or malformed clip can make ffmpeg close stdin before all
    // of it is written; the close handler above is what decides success or
    // failure, so a stdin error here is not itself fatal.
    ffmpeg.stdin.on("error", () => {});
    ffmpeg.stdin.end(buffer);
  });
}

// Below this RMS, Whisper reliably hallucinates filler words ("you", "thank
// you") from what is actually silence or room noise rather than speech.
const SILENCE_RMS_THRESHOLD = 0.01;

function rootMeanSquare(samples) {
  let sumOfSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sumOfSquares += samples[i] * samples[i];
  }
  return Math.sqrt(sumOfSquares / samples.length);
}

function pcmBufferToFloat32(buffer) {
  const sampleCount = Math.floor(buffer.length / BYTES_PER_SAMPLE);
  // Whisper's feature extractor needs a plain Float32Array view; slicing the
  // buffer keeps it aligned regardless of where Buffer.concat placed it.
  const aligned = Buffer.from(buffer.buffer, buffer.byteOffset, sampleCount * BYTES_PER_SAMPLE);
  return new Float32Array(aligned.buffer, aligned.byteOffset, sampleCount);
}

/**
 * Transcribes one audio segment entirely on this machine.
 *
 * @param {{ audioBase64: string, language?: string }} input
 * @returns {Promise<{ text: string }>}
 */
async function transcribeAudio({ audioBase64, language } = {}) {
  if (!audioBase64) throw new Error("Audio data is required.");

  const inputBuffer = Buffer.from(audioBase64, "base64");
  if (inputBuffer.length === 0) throw new Error("Audio data is empty.");

  const pcmBuffer = await decodeToPcm(inputBuffer);
  if (pcmBuffer.length < MIN_AUDIO_BYTES) {
    // Too little audio to plausibly hold speech; skip the model entirely
    // rather than let Whisper hallucinate text from near-silence.
    return { text: "" };
  }

  const samples = pcmBufferToFloat32(pcmBuffer);
  if (rootMeanSquare(samples) < SILENCE_RMS_THRESHOLD) {
    return { text: "" };
  }

  const transcriber = await getTranscriber();
  const languageName = languageNameFor(language);
  const output = await transcriber(samples, {
    language: languageName || undefined,
    task: "transcribe",
  });

  const text = Array.isArray(output)
    ? output.map((item) => item.text || "").join(" ")
    : output?.text || "";

  return { text: text.trim() };
}

module.exports = { transcribeAudio };
