// Opt-in network test against Blender Foundation's CC-licensed Big Buck Bunny.
// Attribution: (c) Blender Foundation | www.bigbuckbunny.org. No media is published.
const fs = require("node:fs/promises");
const path = require("node:path");
const { Engine, inspect } = require("../src/engine.cjs");
(async () => {
  const root = path.resolve("test-results/live");
  await fs.mkdir(root, { recursive: true });
  const tools = {
    ffmpeg: path.resolve("vendor/ffmpeg/bin/ffmpeg.exe"),
    ffprobe: path.resolve("vendor/ffmpeg/bin/ffprobe.exe"),
    ytdlp: path.resolve("vendor/yt-dlp.exe"),
    node: path.resolve("vendor/node.exe"),
  };
  const e = new Engine({
    tools,
    stateDir: path.join(root, "state"),
    outputDir: path.join(root, "audio"),
  });
  await e.init();
  e.jobs = [];
  e.addURL("https://www.youtube.com/watch?v=YE7VzlLtp-4");
  const timer = setTimeout(() => e.cancelAll(), 120000);
  try {
    await e.start();
    const j = e.jobs[0];
    const report = {
      source: "Big Buck Bunny — Blender Foundation; CC licensed",
      state: j.state,
      error: j.error || null,
    };
    if (j.state === "done") {
      const result = await inspect(j.outputPath, tools);
      report.codec = result.data.streams[0].codec_name;
      report.duration = result.duration;
    }
    await fs.writeFile(
      path.join(root, "result.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } finally {
    clearTimeout(timer);
    await e.shutdown();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
