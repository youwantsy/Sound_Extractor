const { chromium, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { Engine, inspect } = require("../src/engine.cjs");

(async () => {
  const root = path.resolve("test-results", "portable-" + Date.now());
  const tools = {
    ffmpeg: path.resolve("vendor/ffmpeg/bin/ffmpeg.exe"),
    ffprobe: path.resolve("vendor/ffmpeg/bin/ffprobe.exe"),
  };
  const engine = new Engine({ tools, stateDir: path.join(root, "profile"), outputDir: path.join(root, "audio") });
  await engine.init();
  await engine.addLocal([path.resolve("test-results/development/Quiet morning.mp4")]);
  engine.cancelAll();
  await engine.write;
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.resolve("dist/Sonora-0.1.0-x64-portable.exe"), [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(root, "profile")}`], { env, windowsHide: true, stdio: "ignore" });
  let browser;
  try {
    for (let i = 0; i < 90; i++) {
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break; }
      catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    if (!browser) throw Error("Portable UI did not start");
    const page = browser.contexts()[0].pages()[0];
    await expect(page.locator("#toolstatus")).toContainText("준비 완료");
    await page.locator('[data-action="retry"]').click();
    await page.locator("#start").click();
    await expect(page.locator("#summary")).toContainText("완료 1", { timeout: 20000 });
    const output = (await fs.readdir(path.join(root, "audio"))).find((f) => f.endsWith(".mp3"));
    const probe = await inspect(path.join(root, "audio", output), tools);
    expect(probe.data.streams[0].codec_name).toBe("mp3");
    const report = { portableLaunch: true, bundledTools: true, realConversion: true, codec: "mp3", duration: probe.duration };
    await fs.writeFile(path.join(root, "result.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send("Browser.close");
  } finally {
    await browser?.close().catch(() => {});
    if (child.exitCode === null) child.kill();
  }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
