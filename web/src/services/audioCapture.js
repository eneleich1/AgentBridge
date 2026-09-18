const MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function getRecorderMimeType() {
  if (!window.MediaRecorder) return "";
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export function getAudioCaptureUnavailableReason() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return "Audio capture is not supported by this browser";
  }
  if (!window.MediaRecorder) {
    return "Audio recording is not supported by this browser";
  }
  return "";
}

export class ContinuousAudioCapture {
  constructor() {
    this.stream = null;
    this.audioContext = null;
    this.analyser = null;
    this.levelSamples = null;
    this.recorder = null;
    this.chunks = [];
    this.startedAt = 0;
    this.stopPromise = null;
  }

  async open() {
    if (this.stream?.active) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.2;
      source.connect(this.analyser);
      this.levelSamples = new Float32Array(this.analyser.fftSize);
    }
  }

  startSegment() {
    if (!this.stream?.active) throw new Error("The microphone is not open.");
    if (this.recorder?.state === "recording") {
      throw new Error("Audio recording is already active.");
    }

    const mimeType = getRecorderMimeType();
    this.chunks = [];
    this.startedAt = performance.now();
    this.stopPromise = null;
    this.recorder = mimeType
      ? new MediaRecorder(this.stream, { mimeType })
      : new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (event) => {
      if (event.data?.size) this.chunks.push(event.data);
    };
    this.recorder.start(500);
  }

  stopSegment() {
    if (!this.recorder || this.recorder.state === "inactive") {
      return Promise.resolve({ blob: null, durationMs: 0 });
    }
    if (this.stopPromise) return this.stopPromise;

    const recorder = this.recorder;
    const durationMs = performance.now() - this.startedAt;
    this.stopPromise = new Promise((resolve, reject) => {
      recorder.onerror = (event) => {
        this.stopPromise = null;
        reject(event.error || new Error("Audio recording failed."));
      };
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, {
          type: recorder.mimeType || this.chunks[0]?.type || "audio/webm",
        });
        this.chunks = [];
        this.recorder = null;
        this.stopPromise = null;
        resolve({ blob, durationMs });
      };
      recorder.stop();
    });
    return this.stopPromise;
  }

  getLevel() {
    if (!this.analyser || !this.levelSamples) return 0;
    this.analyser.getFloatTimeDomainData(this.levelSamples);
    let sum = 0;
    for (const sample of this.levelSamples) sum += sample * sample;
    return Math.sqrt(sum / this.levelSamples.length);
  }

  async close() {
    if (this.recorder?.state === "recording") {
      try {
        await this.stopSegment();
      } catch {
        // Closing the stream is still required if finalizing a segment fails.
      }
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.analyser = null;
    this.levelSamples = null;
    if (this.audioContext && this.audioContext.state !== "closed") {
      await this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
  }
}

/** Converts a recorded Blob into the base64 string the transcription endpoint expects. */
export async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Watches the microphone's level to find where one spoken turn ends, without
 * ever stopping the underlying stream: each turn is its own MediaRecorder
 * segment, opened right after the previous one closes, so the mic stays live
 * from the moment capture starts until `stop()` is called.
 *
 * `onSegment(blob, meta)` fires once per turn (including the final, partial
 * one if `stop()` is called mid-utterance) with the audio to transcribe.
 */
export function createTurnDetector(capture, {
  onSegment,
  onSpeechStart,
  onLevel,
  speechThreshold = 0.02,
  silenceMs = 900,
  minSpeechMs = 250,
  maxSegmentMs = 30000,
  pollMs = 80,
} = {}) {
  let stopped = false;
  let processing = false;
  let speaking = false;
  let speechStartedAt = 0;
  let silenceStartedAt = 0;
  let segmentStartedAt = 0;
  let timerId = null;

  function beginSegment() {
    capture.startSegment();
    segmentStartedAt = performance.now();
    speaking = false;
    speechStartedAt = 0;
    silenceStartedAt = 0;
  }

  async function finalizeSegment(reason, { resume = true } = {}) {
    processing = true;
    try {
      const hadSpeech = speaking;
      const { blob, durationMs } = await capture.stopSegment();
      if (hadSpeech && blob?.size) {
        await onSegment?.(blob, { durationMs, reason });
      }
    } finally {
      processing = false;
      if (resume && !stopped) beginSegment();
    }
  }

  function tick() {
    if (stopped || processing) return;
    const level = capture.getLevel();
    onLevel?.(level);
    const now = performance.now();

    if (level >= speechThreshold) {
      if (!speaking) {
        speaking = true;
        speechStartedAt = now;
        onSpeechStart?.();
      }
      silenceStartedAt = 0;
      return;
    }

    if (speaking) {
      if (!silenceStartedAt) silenceStartedAt = now;
      const spokeLongEnough = now - speechStartedAt >= minSpeechMs;
      const silentLongEnough = now - silenceStartedAt >= silenceMs;
      if (spokeLongEnough && silentLongEnough) {
        void finalizeSegment("silence");
        return;
      }
    }

    if (now - segmentStartedAt >= maxSegmentMs) {
      void finalizeSegment("max-duration");
    }
  }

  beginSegment();
  timerId = window.setInterval(tick, pollMs);

  return {
    /** Ends the current turn early (e.g. the user started talking over playback). */
    async cutSegment() {
      if (stopped || processing) return;
      await finalizeSegment("cut");
    },
    /**
     * Stops the detector from opening another segment once the one in
     * progress finishes, without waiting for or re-finalizing anything.
     * Safe to call from inside `onSegment` itself (e.g. to hand a live-mode
     * turn off to a "processing/speaking" phase the detector doesn't manage).
     */
    haltAutoResume() {
      stopped = true;
      if (timerId) {
        window.clearInterval(timerId);
        timerId = null;
      }
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      if (timerId) window.clearInterval(timerId);
      timerId = null;
      while (processing) await sleep(20);
      await finalizeSegment("stop", { resume: false });
    },
  };
}
