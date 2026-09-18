const { transcribeAudio } = require("../services/transcriptionService");

async function audioRoutes(fastify) {
  fastify.post("/api/audio/transcriptions", async (request, reply) => {
    const { audio, language } = request.body || {};

    if (!audio) {
      return reply.code(400).send({ error: "Audio data is required." });
    }

    try {
      return await transcribeAudio({ audioBase64: audio, language });
    } catch (error) {
      request.log.error(error, "Audio transcription failed");
      return reply.code(502).send({ error: error.message || "Transcription failed." });
    }
  });
}

module.exports = audioRoutes;
