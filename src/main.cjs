"use strict";
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  shell,
  session,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { Engine, userError } = require("./engine.cjs");
const { supported } = require("./security.cjs");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "sonora",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
let window,
  engine,
  quitting = false;
function trusted(event) {
  return (
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url === "sonora://app/index.html"
  );
}
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (!trusted(event))
      return { ok: false, error: "허용되지 않은 요청입니다." };
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      return { ok: false, error: userError(e) };
    }
  });
}
function id(value) {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value))
    throw Error("INVALID_ID");
  return value;
}
app.on("second-instance", () => {
  window?.show();
  window?.focus();
});
app.on("before-quit", (event) => {
  if (quitting || !engine) return;
  event.preventDefault();
  quitting = true;
  engine.shutdown().finally(() => app.quit());
});
app.on("window-all-closed", () => app.quit());
if (hasLock)
  app
    .whenReady()
    .then(async () => {
      const resources = app.isPackaged
        ? path.join(process.resourcesPath, "tools")
        : path.join(__dirname, "..", "vendor");
      const tools = {
        ffmpeg: path.join(resources, "ffmpeg", "bin", "ffmpeg.exe"),
        ffprobe: path.join(resources, "ffmpeg", "bin", "ffprobe.exe"),
        ytdlp: path.join(resources, "yt-dlp.exe"),
        node: path.join(resources, "node.exe"),
      };
      engine = new Engine({
        tools,
        stateDir: app.getPath("userData"),
        outputDir: path.join(app.getPath("music"), "Sonora"),
      });
      await engine.init();
      protocol.handle("sonora", async (request) => {
        const u = new URL(request.url);
        const files = {
          "/index.html": "index.html",
          "/style.css": "style.css",
          "/renderer.js": "renderer.js",
        };
        if (
          u.hostname !== "app" ||
          !files[u.pathname] ||
          request.method !== "GET"
        )
          return new Response("Not found", { status: 404 });
        return new Response(
          await fs.readFile(path.join(__dirname, "ui", files[u.pathname])),
          {
            headers: {
              "Content-Type": {
                "/index.html": "text/html; charset=utf-8",
                "/style.css": "text/css; charset=utf-8",
                "/renderer.js": "text/javascript; charset=utf-8",
              }[u.pathname],
            },
          },
        );
      });
      session.defaultSession.setPermissionRequestHandler(
        (_wc, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: !details.url.startsWith("sonora://app/") }),
      );
      handle("state", () => engine.snapshot());
      handle("add-url", (url) => {
        engine.addURL(url);
      });
      handle("choose-files", async () => {
        const result = await dialog.showOpenDialog(window, {
          title: "오디오를 추출할 파일 선택",
          properties: ["openFile", "multiSelections"],
          filters: [
            {
              name: "Video & Audio",
              extensions: [
                "mp4",
                "mov",
                "mkv",
                "webm",
                "avi",
                "m4v",
                "mp3",
                "wav",
                "flac",
                "ogg",
                "m4a",
                "aac",
                "wma",
              ],
            },
          ],
        });
        if (!result.canceled) await engine.addLocal(result.filePaths);
      });
      handle("drop-files", async (files) => {
        if (
          !Array.isArray(files) ||
          !files.length ||
          files.length > 100 ||
          !files.every((p) => typeof p === "string" && supported(p))
        )
          throw Error("INVALID_MEDIA");
        await engine.addLocal(files);
      });
      handle("choose-output", async () => {
        const result = await dialog.showOpenDialog(window, {
          title: "MP3 저장 폴더",
          defaultPath: engine.outputDir,
          properties: ["openDirectory", "createDirectory"],
        });
        if (!result.canceled) await engine.setOutput(result.filePaths[0]);
      });
      handle("settings", (value) => engine.setOptions(value));
      handle("start", () => {
        void engine.start();
      });
      handle("cancel", (value) => engine.cancel(id(value)));
      handle("cancel-all", () => engine.cancelAll());
      handle("retry", (value) => engine.retry(id(value)));
      handle("remove", (value) => engine.remove(id(value)));
      handle("reorder", (value, direction) =>
        engine.reorder(id(value), direction),
      );
      handle("clear-history", () => {
        engine.jobs = engine.jobs.filter((j) => j.state !== "done");
        engine.changed();
      });
      handle("reveal", async (value) => {
        const job = engine.jobs.find((j) => j.id === id(value));
        if (job?.state === "done" && job.outputPath) {
          await fs.access(job.outputPath);
          shell.showItemInFolder(job.outputPath);
        }
      });
      handle("tools", async () => {
        const missing = [];
        for (const [name, file] of Object.entries(tools))
          try {
            await fs.access(file);
          } catch {
            missing.push(name);
          }
        return { ready: !missing.length, missing, version: app.getVersion() };
      });
      window = new BrowserWindow({
        width: 1260,
        height: 970,
        minWidth: 760,
        minHeight: 640,
        title: "Sonora",
        icon: path.join(__dirname, "icon.png"),
        backgroundColor: "#f5f6f2",
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          spellcheck: false,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.webContents.on("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      engine.on("state", (state) => {
        if (window && !window.isDestroyed())
          window.webContents.send("state-changed", state);
      });
      window.once("ready-to-show", () => window.show());
      window.on("close", (event) => {
        if (engine.active && !quitting) {
          event.preventDefault();
          dialog
            .showMessageBox(window, {
              type: "question",
              buttons: ["계속 변환", "작업 취소 후 종료"],
              defaultId: 0,
              cancelId: 0,
              message: "진행 중인 작업을 취소하고 종료할까요?",
              detail:
                "부분 파일을 정리합니다. 다음 실행에서 재시도할 수 있습니다.",
            })
            .then((r) => {
              if (r.response === 1) app.quit();
            });
        }
      });
      await window.loadURL("sonora://app/index.html");
    })
    .catch(() => {
      dialog.showErrorBox(
        "Sonora",
        "앱을 시작하지 못했습니다. 저장 폴더 권한과 설치 상태를 확인하세요.",
      );
      app.quit();
    });
