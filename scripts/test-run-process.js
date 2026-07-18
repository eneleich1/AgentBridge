const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { runProcess } = require("../server/agents/runProcess");

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    written: "",
    ended: false,
    write(chunk) {
      this.written += chunk;
    },
    end() {
      this.ended = true;
    },
  };
  child.pid = 4242;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

async function testResolvesAfterExitWithoutClose() {
  const child = createFakeChild();

  const resultPromise = runProcess("fake", [], {
    closeGraceMs: 5,
    spawnImpl: () => child,
  });

  child.stdout.emit("data", Buffer.from("done"));
  child.stderr.emit("data", Buffer.from("warn"));
  child.emit("exit", 0);

  const result = await resultPromise;
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "done");
  assert.equal(result.stderr, "warn");
}

async function testCapturesTailOutputAfterExit() {
  const child = createFakeChild();

  const resultPromise = runProcess("fake", [], {
    closeGraceMs: 50,
    spawnImpl: () => child,
  });

  child.stdout.emit("data", Buffer.from("hello"));
  child.emit("exit", 0);
  child.stdout.emit("data", Buffer.from(" world"));
  child.stdout.emit("end");
  child.stderr.emit("end");

  const result = await resultPromise;
  assert.equal(result.stdout, "hello world");
}

async function testAbortCancelsProcess() {
  const child = createFakeChild();
  const controller = new AbortController();
  const killCalls = [];

  const resultPromise = runProcess("fake", [], {
    signal: controller.signal,
    spawnImpl: () => child,
    killImpl: (...args) => {
      killCalls.push(args);
      return new EventEmitter();
    },
  });

  controller.abort();
  const result = await resultPromise;

  assert.equal(result.cancelled, true);
  assert.equal(killCalls.length, process.platform === "win32" ? 1 : 0);
  assert.equal(child.killed, process.platform === "win32" ? false : true);
}

async function main() {
  await testResolvesAfterExitWithoutClose();
  await testCapturesTailOutputAfterExit();
  await testAbortCancelsProcess();
  console.log("runProcess tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
