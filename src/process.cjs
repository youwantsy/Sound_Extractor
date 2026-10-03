"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");
function killTree(child) {
  return new Promise((resolve) => {
    if (!child?.pid || child.exitCode !== null) return resolve();
    if (process.platform === "win32") {
      const killer = spawn(
        path.join(
          process.env.SystemRoot || "C:\\Windows",
          "System32",
          "taskkill.exe",
        ),
        ["/PID", String(child.pid), "/T", "/F"],
        { shell: false, windowsHide: true, stdio: "ignore" },
      );
      killer.once("error", () => {
        child.kill();
        resolve();
      });
      killer.once("close", (code) => {
        if (code !== 0) child.kill();
        resolve();
      });
    } else {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      resolve();
    }
  });
}
function run(
  executable,
  args,
  {
    signal,
    timeout = 30 * 60 * 1000,
    onLine,
    maxOutput = 8 * 1024 * 1024,
    cwd,
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error("CANCELED"));
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.NODE_PATH;
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.PYTHONPATH;
    delete env.PYTHONHOME;
    // Ignore inherited proxies: the provider supplies its own restricted local proxy.
    for (const key of Object.keys(env))
      if (/^(https?|all|no)_proxy$/i.test(key)) delete env[key];
    const child = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "",
      stderr = "",
      buffers = ["", ""],
      reason = "",
      stopping;
    const stop = (code) => {
      reason = reason || code;
      stopping = stopping || killTree(child);
    };
    const abort = () => stop("CANCELED");
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop("TIMEOUT"), timeout);
    function consume(chunk, stream) {
      const s = chunk.toString();
      if (stream === 0) stdout += s;
      else stderr = (stderr + s).slice(-64000);
      if (stdout.length > maxOutput) stop("OUTPUT_LIMIT");
      buffers[stream] += s;
      const lines = buffers[stream].split(/[\r\n]+/);
      buffers[stream] = lines.pop();
      if (buffers[stream].length > maxOutput) stop("OUTPUT_LIMIT");
      for (const line of lines) onLine?.(line, stream);
    }
    child.stdout.on("data", (c) => consume(c, 0));
    child.stderr.on("data", (c) => consume(c, 1));
    child.once("error", (e) => {
      reason = e.code === "ENOENT" ? "TOOLS_MISSING" : "PROCESS_START";
    });
    child.once("close", async (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (stopping) await stopping;
      if (reason) return reject(Error(reason));
      if (code !== 0) {
        const e = Error("PROCESS_FAILED");
        e.detail = stderr;
        return reject(e);
      }
      resolve({ stdout, stderr });
    });
  });
}
module.exports = { run };
