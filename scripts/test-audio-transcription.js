// Covers the fast, deterministic parts of local transcription: input
// validation and the silence/too-short short-circuits. These never load the
// Whisper model, so this stays in the default `npm test` run.
//
// Actually transcribing speech needs the model downloaded and ffmpeg
// decoding a real recording; that is exercised manually (see the audio
// feature's notes), the same way `test:codex` / `test:cursor` stay out of
// the default suite because they need their own external tooling.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const ffmpegPath = require("ffmpeg-static");
const { transcribeAudio } = require("../server/services/transcriptionService");

function silentClipBase64(durationSeconds) {
  const output = execFileSync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `anullsrc=r=16000:cl=mono`,
    "-t", String(durationSeconds),
    "-c:a", "libopus",
    "-f", "webm", "pipe:1",
  ], { maxBuffer: 10 * 1024 * 1024 });
  return output.toString("base64");
}

async function main() {
  await assert.rejects(() => transcribeAudio({}), /Audio data is required/);
  await assert.rejects(() => transcribeAudio({ audioBase64: "" }), /Audio data is required/);

  const tooShort = silentClipBase64(0.05);
  assert.deepEqual(await transcribeAudio({ audioBase64: tooShort }), { text: "" });

  const silence = silentClipBase64(2);
  assert.deepEqual(
    await transcribeAudio({ audioBase64: silence }),
    { text: "" },
    "a clean silent clip must not reach the model (Whisper hallucinates filler words from silence)"
  );

  console.log("audio transcription tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
