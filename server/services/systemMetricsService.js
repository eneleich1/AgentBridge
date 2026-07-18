const os = require("os");

const SAMPLE_TTL_MS = 900;

let lastCpuSample = null;
let lastSnapshot = null;

function takeCpuSample() {
  return {
    at: Date.now(),
    cpus: os.cpus().map((cpu, index) => ({
      index,
      times: { ...cpu.times },
    })),
  };
}

function sumTimes(times) {
  return times.user + times.nice + times.sys + times.idle + times.irq;
}

function buildCpuThreads(current, previous) {
  return current.cpus.map((cpu, index) => {
    const prevCpu = previous?.cpus[index];
    if (!prevCpu) {
      return {
        index,
        label: `Thread ${index + 1}`,
        usage: 0,
      };
    }

    const totalDelta = sumTimes(cpu.times) - sumTimes(prevCpu.times);
    const idleDelta = cpu.times.idle - prevCpu.times.idle;
    const usage =
      totalDelta > 0 ? Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100)) : 0;

    return {
      index,
      label: `Thread ${index + 1}`,
      usage: Number(usage.toFixed(1)),
    };
  });
}

function buildMemoryStats() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const usage = total > 0 ? (used / total) * 100 : 0;

  return {
    totalBytes: total,
    usedBytes: used,
    freeBytes: free,
    usage: Number(usage.toFixed(1)),
  };
}

function buildSnapshot(current, previous) {
  const threads = buildCpuThreads(current, previous);
  const averageUsage =
    threads.length > 0
      ? Number((threads.reduce((sum, thread) => sum + thread.usage, 0) / threads.length).toFixed(1))
      : 0;

  return {
    timestamp: new Date(current.at).toISOString(),
    hostname: os.hostname(),
    memory: buildMemoryStats(),
    cpu: {
      logicalThreads: threads.length,
      averageUsage,
      threads,
    },
  };
}

function getSystemMetrics() {
  const now = Date.now();
  if (lastSnapshot && now - Date.parse(lastSnapshot.timestamp) < SAMPLE_TTL_MS) {
    return lastSnapshot;
  }

  const current = takeCpuSample();
  const snapshot = buildSnapshot(current, lastCpuSample);
  lastCpuSample = current;
  lastSnapshot = snapshot;
  return snapshot;
}

module.exports = {
  getSystemMetrics,
};
