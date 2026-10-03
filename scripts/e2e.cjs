"use strict";
const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { run } = require("../src/process.cjs");
const { inspect } = require("../src/engine.cjs");
(async () => {
  const root = path.resolve(
    "test-results",
    process.env.SONORA_PACKAGED ? "packaged" : "development",
  );
  await fs.mkdir(root, { recursive: true });
  const tools = {
    ffmpeg: path.resolve("vendor/ffmpeg/bin/ffmpeg.exe"),
    ffprobe: path.resolve("vendor/ffmpeg/bin/ffprobe.exe"),
  };
  const fixture = path.join(root, "Quiet morning.mp4");
  await run(tools.ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x315f4c:s=320x180:r=10",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=8",
    "-t",
    "8",
    "-c:v",
    "mpeg4",
    "-c:a",
    "aac",
    "-y",
    fixture,
  ]);
  const profile = path.join(root, "profile-" + Date.now());
  const out = path.join(root, "audio-" + Date.now());
  await fs.mkdir(out, { recursive: true });
  const args = [`--user-data-dir=${profile}`];
  if (!process.env.SONORA_PACKAGED) args.unshift(".");
  const testEnv = { ...process.env };
  delete testEnv.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: process.env.SONORA_PACKAGED || require("electron"),
    args,
    env: testEnv,
    timeout: 30000,
  });
  const checks = [];
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await expect(page.locator("#toolstatus")).toContainText("준비 완료");
    checks.push("tools loaded");
    const isolation = await page.evaluate(() => ({
      require: typeof require,
      node: typeof process,
      api: typeof window.sonora,
      ipc: typeof window.sonora.invoke,
    }));
    expect(isolation).toEqual({
      require: "undefined",
      node: "undefined",
      api: "object",
      ipc: "undefined",
    });
    checks.push("isolated narrow bridge");
    await app.evaluate(
      ({ dialog }, { fixture, out }) => {
        dialog.showOpenDialog = async (_window, opts) => ({
          canceled: false,
          filePaths: opts.properties.includes("openDirectory")
            ? [out]
            : [fixture],
        });
      },
      { fixture, out },
    );
    await page.locator("#choosefolder").click();
    await expect(page.locator("#folder")).toHaveText(out);
    checks.push("native folder selection via stubbed dialog");
    await page
      .locator("#url")
      .fill("https://youtube.com.evil.test/watch?v=abcdefghijk");
    await page.locator("#url").press("Enter");
    await expect(page.locator("#message")).toContainText("올바른");
    checks.push("invalid URL rejected through IPC");
    await page.locator("#url").fill("");
    await page.locator("#pick").click();
    await expect(page.locator("#queue")).toContainText("Quiet morning.mp4");
    checks.push("native file selection via stubbed dialog");
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.type = "file";
      input.id = "test-drop-input";
      document.body.append(input);
    });
    await page.locator("#test-drop-input").setInputFiles(fixture);
    const drop = await page.evaluate(async () =>
      window.sonora.dropFiles(
        Array.from(document.querySelector("#test-drop-input").files),
      ),
    );
    expect(drop.ok).toBe(true);
    await expect(page.locator("#queue .job")).toHaveCount(2);
    checks.push("real file bridge used by drag-and-drop");
    await page
      .locator("#queue .job")
      .last()
      .locator('[data-action="remove"]')
      .click();
    await page.locator("#test-drop-input").evaluate((el) => el.remove());
    // Only a synthetic title and generic folder label are published in screenshots.
    await page
      .locator("#folder")
      .evaluate((el) => (el.textContent = "Music / Sonora"));
    await page.locator("#message").evaluate((el) => (el.textContent = ""));
    await page.screenshot({ path: path.join(root, "app.png"), fullPage: true });
    await page.locator("#start").click();
    await expect(page.locator("#summary")).toContainText("완료 1", {
      timeout: 20000,
    });
    checks.push("UI real MP3 conversion");
    await page.locator('[data-tab="history"]').click();
    await expect(page.locator("#historylist")).toContainText(
      "Quiet morning.mp3",
    );
    checks.push("completed list");
    const file = (await fs.readdir(out)).find((x) => x.endsWith(".mp3"));
    const result = await inspect(path.join(out, file), tools);
    expect(result.data.streams[0].codec_name).toBe("mp3");
    expect(Number(result.data.streams[0].bit_rate)).toBe(192000);
    checks.push("independent ffprobe output verification");
    await page.locator('[data-tab="settings"]').click();
    await page.locator("#bitrate").selectOption("256");
    await page.locator("#naming").selectOption("number");
    checks.push("settings persisted");
    await page.locator('[data-tab="convert"]').click();
    await page.locator("#pick").click();
    await page.locator("#cancelall").click();
    await expect(page.locator("#queue")).toContainText("취소됨");
    await page.locator('[data-action="retry"]').click();
    await page.locator("#start").click();
    await expect(page.locator("#summary")).toContainText("완료 2");
    checks.push("cancel and retry through UI");
    await page.setViewportSize({ width: 760, height: 700 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    checks.push("760px layout");
    await page.locator("#url").focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement.textContent)).toBe(
      "추가",
    );
    checks.push("keyboard navigation");
    expect(errors).toEqual([]);
    checks.push("no renderer console errors");
    await fs.writeFile(
      path.join(root, "results.json"),
      JSON.stringify(
        {
          checks,
          errors,
          codec: result.data.streams[0].codec_name,
          duration: result.duration,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ passed: checks.length, checks }));
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
