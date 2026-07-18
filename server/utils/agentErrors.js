const { classifyAgentError } = require("../sessions/messageParser");

function parseAgentError(agentType, stdout, stderr) {
  const parsed = classifyAgentError(agentType, stdout, stderr);
  if (!parsed || parsed.type === "unknown") {
    return null;
  }

  return {
    type: parsed.type,
    agent: agentType,
    message: parsed.userMessage,
    userGuidance: [parsed.userMessage, ...parsed.fixSteps].join("\n"),
    fixOn: "desktop",
  };
}

module.exports = { parseAgentError };
