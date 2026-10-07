const { AgentEventType: E } = require('../connections/types');

// Report observable milestones only; never expose provider reasoning text.
function describeActivity(event) {
  switch (event.type) {
    case E.REASONING_STATUS: return { label: 'Working', text: 'The agent is processing your request.' };
    case E.TOOL_STARTED: return { label: 'Using tools', text: String(event.tool?.title || event.tool?.name || 'Running a tool for this task.').slice(0, 240) };
    case E.TOOL_COMPLETED: return { label: 'Tool finished', text: 'The tool returned; the agent is continuing.' };
    case E.COMMAND_STARTED: return { label: 'Running command', text: 'Executing a command for this task.' };
    case E.COMMAND_COMPLETED: return { label: 'Command finished', text: 'The command finished; the agent is reviewing the result.' };
    case E.FILE_CHANGED: return { label: 'Updating files', text: 'The agent is applying file changes.' };
    case E.PERMISSION_REQUESTED: return { label: 'Needs approval', text: 'Waiting for your permission to continue.' };
    default: return null;
  }
}

function activityMarker(activity) {
  return `[[agentbridge:progress]]${activity.label}|${activity.text.replace(/[\r\n|]/g, ' ')}\n`;
}

module.exports = { describeActivity, activityMarker };
