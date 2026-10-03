const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { Engine, inspect, commitOutput } = require("../src/engine.cjs");
const { run } = require("../src/process.cjs");
const { restrictedProxy } = require("../src/provider.cjs");
const http = require("node:http");
const tools = {
  ffmpeg: path.resolve("vendor/ffmpeg/bin/ffmpeg.exe"),
  ffprobe: path.resolve("vendor/ffmpeg/bin/ffprobe.exe"),
};
let root, fixture;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sonora-test-"));
  fixture = path.join(root, "Owned synthetic tone.mp4");
  await run(tools.ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x315f4c:s=160x90:r=10",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
    "-t",
    "3",
    "-c:v",
    "mpeg4",
    "-c:a",
    "aac",
    "-y",
    fixture,
  ]);
});
after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
});
async function engine(name) {
  const e = new Engine({
    tools,
    stateDir: path.join(root, name, "state"),
    outputDir: path.join(root, name, "out"),
  });
  await e.init();
  return e;
}
test("real video -> MP3, correct codec and bitrate, source preserved, no partials", async () => {
  const e = await engine("real");
  const source = await fs.readFile(fixture);
  await e.addLocal([fixture]);
  await e.start();
  assert.equal(e.jobs[0].state, "done", e.jobs[0].error);
  const result = await inspect(e.jobs[0].outputPath, tools);
  assert.equal(result.data.streams[0].codec_name, "mp3");
  assert.equal(Number(result.data.streams[0].bit_rate), 192000);
  assert.ok(result.duration >= 3 && result.duration < 3.2);
  assert.deepEqual(await fs.readFile(fixture), source);
  assert.deepEqual(
    (await fs.readdir(e.outputDir)).filter((f) => f.startsWith(".sonora")),
    [],
  );
  await e.shutdown();
});
test("repeat conversion adds suffix; skip never replaces original", async () => {
  const e = await engine("collision");
  await e.addLocal([fixture, fixture]);
  await e.start();
  assert.equal(e.jobs[1].state, "done");
  assert.ok(e.jobs[1].outputPath.endsWith(" (2).mp3"));
  const original = await fs.readFile(e.jobs[0].outputPath);
  e.setOptions({ bitrate: 320, naming: "title", conflict: "skip" });
  await e.addLocal([fixture]);
  await e.start();
  assert.equal(e.jobs[2].state, "skipped");
  assert.deepEqual(await fs.readFile(e.jobs[0].outputPath), original);
  await e.shutdown();
});
test("corrupt input fails safely; repaired source can retry", async () => {
  const bad = path.join(root, "broken.mp4");
  await fs.writeFile(bad, "not a media file");
  const e = await engine("retry");
  await e.addLocal([bad]);
  await e.start();
  assert.equal(e.jobs[0].state, "failed");
  await fs.copyFile(fixture, bad);
  e.retry(e.jobs[0].id);
  await e.start();
  assert.equal(e.jobs[0].state, "done");
  assert.equal(e.jobs[0].attempt, 2);
  await e.shutdown();
});
test("active cancellation is settled and retry works", async () => {
  const e = await engine("cancel");
  await e.addLocal([fixture]);
  let canceled = false;
  e.on("state", (s) => {
    if (!canceled && s.jobs[0]?.state === "converting") {
      canceled = true;
      e.cancel(s.jobs[0].id);
    }
  });
  await e.start();
  assert.equal(e.jobs[0].state, "canceled");
  assert.deepEqual(await fs.readdir(e.outputDir), []);
  e.retry(e.jobs[0].id);
  await e.start();
  assert.equal(e.jobs[0].state, "done");
  await e.shutdown();
});
test("queued reorder, individual removal and cancel-all", async () => {
  const e = await engine("queue");
  await e.addLocal([fixture, fixture, fixture]);
  const first = e.jobs[0].id;
  e.reorder(first, 1);
  assert.equal(e.jobs[1].id, first);
  e.remove(e.jobs[0].id);
  assert.equal(e.jobs.length, 2);
  e.cancelAll();
  assert.ok(e.jobs.every((j) => j.state === "canceled"));
  await e.shutdown();
});
test("restart marks interrupted job and cleans only owned work directory", async () => {
  const e = await engine("restart");
  await e.addLocal([fixture]);
  const j = e.jobs[0];
  j.state = "converting";
  j.outputFolder = e.outputDir;
  j.workDir = path.join(e.outputDir, `.sonora-work-${j.id}`);
  await fs.mkdir(j.workDir);
  await fs.writeFile(path.join(j.workDir, "audio.part"), "partial");
  e.changed();
  await e.write;
  const recovered = await engine("restart");
  assert.equal(recovered.jobs[0].state, "canceled");
  assert.match(recovered.jobs[0].error, /중단/);
  assert.deepEqual(await fs.readdir(e.outputDir), []);
  await recovered.shutdown();
});
test("atomic concurrent finalization cannot overwrite", async () => {
  const out = path.join(root, "atomic");
  await fs.mkdir(out);
  const part = path.join(out, "part");
  await fs.writeFile(part, "123");
  const results = await Promise.all([
    commitOutput(part, out, "name", "number"),
    commitOutput(part, out, "name", "number"),
  ]);
  assert.equal(new Set(results).size, 2);
});
test("child process abort kills a running worker and settles", async () => {
  const c = new AbortController();
  const p = run(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    signal: c.signal,
  });
  setTimeout(() => c.abort(), 100);
  await assert.rejects(p, /CANCELED/);
});
test("provider proxy rejects requests without authorization", async () => {
  const proxy = await restrictedProxy();
  const url = new URL(proxy.url);
  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port: url.port,
        method: "CONNECT",
        path: "127.0.0.1:443",
      });
      req.on("connect", (res, socket) => {
        socket.destroy();
        resolve(res.statusCode);
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 403);
  } finally {
    await proxy.close();
  }
});
test("all four bitrate choices produce independently verified MP3 streams", async () => {
  const e = await engine("bitrates");
  for (const bitrate of [128, 192, 256, 320]) {
    e.setOptions({ bitrate, naming: "title", conflict: "number" });
    await e.addLocal([fixture]);
    await e.start();
    const job = e.jobs.at(-1);
    assert.equal(job.state, "done", job.error);
    const result = await inspect(job.outputPath, tools);
    assert.equal(Number(result.data.streams[0].bit_rate), bitrate * 1000);
  }
  await e.shutdown();
});
test("video without audio produces a useful error and no output", async () => {
  const silent = path.join(root, "silent.mp4");
  await run(tools.ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=s=32x32:d=1",
    "-an",
    "-c:v",
    "mpeg4",
    "-y",
    silent,
  ]);
  const e = await engine("silent");
  await e.addLocal([silent]);
  await e.start();
  assert.equal(e.jobs[0].state, "failed");
  assert.match(e.jobs[0].error, /오디오 트랙/);
  assert.deepEqual(await fs.readdir(e.outputDir), []);
  await e.shutdown();
});
test("mixed invalid selection adds no hidden partial jobs", async () => {
  const e = await engine("atomic-add");
  await assert.rejects(e.addLocal([fixture, path.join(root, "script.exe")]));
  assert.equal(e.jobs.length, 0);
  await e.shutdown();
});
test("cleanup rejects a directory outside the recorded output folder", async () => {
  const e = await engine("cleanup-boundary");
  const id = "00000000-0000-0000-0000-000000000000";
  await assert.rejects(
    e.cleanup({
      id,
      workDir: path.join(root, `.sonora-work-${id}`),
      outputFolder: e.outputDir,
    }),
    /UNSAFE_CLEANUP/,
  );
  await e.shutdown();
});
test("cancel immediately then restart cannot overlap worker attempts", async () => {
  const e = await engine("cancel-restart");
  await e.addLocal([fixture]);
  const first = e.start();
  e.cancelAll();
  e.retry(e.jobs[0].id);
  e.start();
  await first;
  assert.equal(e.jobs[0].state, "canceled");
  e.retry(e.jobs[0].id);
  await e.start();
  assert.equal(e.jobs[0].state, "done");
  assert.equal(e.jobs[0].attempt, 2);
  await e.shutdown();
});
