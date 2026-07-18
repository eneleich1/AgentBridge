class TerminalBuffer {
  constructor() {
    this.stdout = "";
    this.stderr = "";
  }

  append(stream, text) {
    if (stream === "stderr") {
      this.stderr += text;
      return;
    }
    this.stdout += text;
  }

  toJSON() {
    return {
      stdout: this.stdout,
      stderr: this.stderr,
    };
  }
}

module.exports = {
  TerminalBuffer,
};
