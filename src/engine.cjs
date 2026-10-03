"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { run } = require("./process.cjs");
const { acquire } = require("./provider.cjs");
const { youtubeURL, safeName, options, supported } = require("./security.cjs");
const FORMATS = "mov,matroska,webm,avi,wav,mp3,flac,ogg,aac,asf";
const MESSAGES = {
  INVALID_URL: "올바른 HTTPS YouTube 단일 영상 주소를 입력하세요.",
  INVALID_OPTIONS: "출력 설정을 확인하세요.",
  TOOLS_MISSING: "변환 도구가 없습니다. tools 설정 또는 앱 설치를 확인하세요.",
  NO_AUDIO: "이 파일에는 오디오 트랙이 없습니다.",
  INVALID_MEDIA: "지원되는 오디오·영상 파일을 확인하세요.",
  TIMEOUT:
    "작업 시간이 초과되었습니다. 네트워크나 파일을 확인하고 재시도하세요.",
  CANCELED: "작업을 취소했습니다.",
  SERVICE_RESTRICTED:
    "로그인·접근 제한 또는 서비스 차단으로 처리할 수 없습니다. 제한을 우회하지 않습니다.",
  FORMAT_UNAVAILABLE: "사용 가능한 직접 오디오 스트림이 없습니다.",
  NETWORK_OR_PROVIDER:
    "YouTube 연결 또는 제공자 오류입니다. 연결을 확인한 후 재시도하세요.",
  OUTPUT_EXISTS: "같은 이름의 파일이 있어 건너뛰었습니다.",
  OUTPUT_UNSUPPORTED:
    "이 저장 장치는 안전한 파일 확정을 지원하지 않습니다. 로컬 NTFS 폴더를 선택하세요.",
  ENOSPC: "저장 공간이 부족합니다.",
  EACCES: "파일이나 폴더에 접근할 수 없습니다.",
  EPERM: "파일 접근이 허용되지 않았습니다.",
  ENOENT: "원본 파일 또는 저장 폴더가 없습니다.",
  TOO_LARGE: "파일 크기 또는 길이 제한을 초과했습니다.",
  INTERRUPTED: "앱 종료로 중단되었습니다. 재시도할 수 있습니다.",
};
function userError(e) {
  return (
    MESSAGES[e.code] ||
    MESSAGES[e.message] ||
    "작업을 완료하지 못했습니다. 파일과 저장 위치를 확인한 후 재시도하세요."
  );
}
async function inspect(file, tools, signal) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 2 * 1024 ** 3) throw Error("TOO_LARGE");
  let r;
  try {
    r = await run(
      tools.ffprobe,
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        FORMATS,
        "-show_entries",
        "format=duration:stream=codec_type,codec_name,bit_rate",
        "-of",
        "json",
        "-i",
        file,
      ],
      { signal, timeout: 30000 },
    );
  } catch (e) {
    if (e.message === "PROCESS_FAILED") throw Error("INVALID_MEDIA", { cause: e });
    throw e;
  }
  const data = JSON.parse(r.stdout);
  if (!data.streams?.some((s) => s.codec_type === "audio"))
    throw Error("NO_AUDIO");
  const duration = Number(data.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw Error("INVALID_MEDIA");
  if (duration > 86400) throw Error("TOO_LARGE");
  return { duration, data };
}
async function commitOutput(part, folder, name, policy) {
  const base = safeName(name);
  for (let i = 1; i < 10000; i++) {
    const final = path.join(folder, `${base}${i === 1 ? "" : ` (${i})`}.mp3`);
    try {
      await fs.link(part, final);
      return final;
    } catch (e) {
      if (e.code === "EEXIST") {
        if (policy === "skip") throw Error("OUTPUT_EXISTS", { cause: e });
        continue;
      }
      if (["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(e.code))
        throw Error("OUTPUT_UNSUPPORTED", { cause: e });
      throw e;
    }
  }
  throw Error("OUTPUT_EXISTS");
}
class Engine extends EventEmitter {
  constructor({ tools, stateDir, outputDir }) {
    super();
    this.tools = tools;
    this.stateDir = stateDir;
    this.outputDir = outputDir;
    this.jobs = [];
    this.running = false;
    this.active = null;
    this.write = Promise.resolve();
    this.settings = { bitrate: 192, naming: "title", conflict: "number" };
    this.cleanupWarning = false;
  }
  async init() {
    await fs.mkdir(this.stateDir, { recursive: true });
    await fs.mkdir(this.outputDir, { recursive: true });
    this.outputDir = await fs.realpath(this.outputDir);
    try {
      const saved = JSON.parse(
        await fs.readFile(path.join(this.stateDir, "state.json"), "utf8"),
      );
      this.settings = options(saved.settings);
      if (path.isAbsolute(saved.outputDir)) {
        const stat = await fs.stat(saved.outputDir);
        if (stat.isDirectory())
          this.outputDir = await fs.realpath(saved.outputDir);
      }
      this.jobs = (saved.jobs || [])
        .filter((j) => typeof j.id === "string" && /^[a-f0-9-]{36}$/.test(j.id))
        .slice(-500);
      for (const j of this.jobs) {
        if (j.workDir) {
          await this.cleanup(j);
        }
        if (
          [
            "queued",
            "validating",
            "acquiring",
            "converting",
            "finalizing",
          ].includes(j.state)
        ) {
          j.state = "canceled";
          j.error = MESSAGES.INTERRUPTED;
        }
        delete j.sourceURL;
      }
    } catch (e) {
      if (e.code !== "ENOENT") {
        this.jobs = [];
        this.cleanupWarning = true;
      }
    }
    this.changed();
    await this.write;
  }
  snapshot() {
    return {
      running: this.running,
      outputDir: this.outputDir,
      settings: this.settings,
      cleanupWarning: this.cleanupWarning,
      jobs: this.jobs.map(
        ({ sourcePath, sourceURL, workDir, outputFolder, ...j }) => j,
      ),
    };
  }
  changed() {
    this.emit("state", this.snapshot());
    const text = JSON.stringify({
      settings: this.settings,
      outputDir: this.outputDir,
      jobs: this.jobs.map((j) => {
        const copy = { ...j };
        delete copy.sourceURL;
        return copy;
      }),
    });
    this.write = this.write
      .catch(() => {})
      .then(async () => {
        const target = path.join(this.stateDir, "state.json");
        await fs.writeFile(target + ".tmp", text, { mode: 0o600 });
        await fs.rename(target + ".tmp", target);
      })
      .catch(() => {
        this.cleanupWarning = true;
      });
  }
  async addLocal(paths) {
    if (
      !Array.isArray(paths) ||
      paths.length > 100 ||
      this.jobs.length + paths.length > 500
    )
      throw Error("QUEUE_LIMIT");
    const additions = [];
    for (const p of paths) {
      if (typeof p !== "string" || !path.isAbsolute(p) || !supported(p))
        throw Error("INVALID_MEDIA");
      const real = await fs.realpath(p);
      const stat = await fs.stat(real);
      if (!stat.isFile() || stat.size > 2 * 1024 ** 3) throw Error("TOO_LARGE");
      additions.push({
        id: crypto.randomUUID(),
        kind: "local",
        sourcePath: real,
        name: path.basename(real),
        size: stat.size,
        state: "queued",
        progress: 0,
        attempt: 0,
      });
    }
    if (this.jobs.length + additions.length > 500) throw Error("QUEUE_LIMIT");
    this.jobs.push(...additions);
    this.changed();
  }
  addURL(value) {
    if (this.jobs.length >= 500) throw Error("QUEUE_LIMIT");
    const { id, url } = youtubeURL(value);
    this.jobs.push({
      id: crypto.randomUUID(),
      kind: "youtube",
      videoId: id,
      sourceURL: url,
      name: `YouTube · ${id}`,
      state: "queued",
      progress: 0,
      attempt: 0,
    });
    this.changed();
  }
  setOptions(value) {
    this.settings = options(value);
    this.changed();
  }
  async setOutput(folder) {
    const real = await fs.realpath(folder);
    if (!(await fs.stat(real)).isDirectory()) throw Error("OUTPUT_INVALID");
    this.outputDir = real;
    this.changed();
  }
  reorder(id, direction) {
    const index = this.jobs.findIndex((j) => j.id === id);
    if (![-1, 1].includes(direction) || this.jobs[index]?.state !== "queued")
      return;
    for (
      let i = index + direction;
      i >= 0 && i < this.jobs.length;
      i += direction
    )
      if (this.jobs[i].state === "queued") {
        [this.jobs[i], this.jobs[index]] = [this.jobs[index], this.jobs[i]];
        break;
      }
    this.changed();
  }
  remove(id) {
    if (this.active?.id === id) return;
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this.changed();
  }
  retry(id) {
    const j = this.jobs.find((j) => j.id === id);
    if (
      !j ||
      !["failed", "canceled", "skipped"].includes(j.state) ||
      this.active?.id === id
    )
      return;
    j.state = "queued";
    j.progress = 0;
    j.error = "";
    j.outputPath = null;
    this.changed();
  }
  cancel(id) {
    const j = this.jobs.find((j) => j.id === id);
    if (!j) return;
    if (this.active?.id === id) {
      j.cancelRequested = true;
      this.active.controller.abort();
    } else if (j.state === "queued") {
      j.state = "canceled";
      j.error = MESSAGES.CANCELED;
    }
    this.changed();
  }
  cancelAll() {
    this.running = false;
    for (const j of this.jobs) this.cancel(j.id);
    this.changed();
  }
  start() {
    if (this.running || this.active) return;
    for (const j of this.jobs.filter((j) => j.state === "queued")) {
      j.options = { ...this.settings };
      j.outputFolder = this.outputDir;
    }
    this.running = true;
    this.loopPromise = this.loop();
    return this.loopPromise;
  }
  async cleanup(j) {
    if (!j.workDir) return;
    const base = path.basename(j.workDir);
    if (
      !j.outputFolder ||
      base !== `.sonora-work-${j.id}` ||
      path.resolve(path.dirname(j.workDir)) !== path.resolve(j.outputFolder)
    )
      throw Error("UNSAFE_CLEANUP");
    const st = await fs.lstat(j.workDir).catch(() => null);
    if (st) {
      if (st.isSymbolicLink()) throw Error("UNSAFE_CLEANUP");
      await fs.rm(j.workDir, { recursive: true, force: true, maxRetries: 3 });
    }
    delete j.workDir;
  }
  async loop() {
    while (this.running) {
      const j = this.jobs.find((x) => x.state === "queued");
      if (!j) break;
      const controller = new AbortController();
      this.active = { id: j.id, controller };
      j.options = j.options || { ...this.settings };
      j.outputFolder = j.outputFolder || this.outputDir;
      j.attempt++;
      j.cancelRequested = false;
      j.error = "";
      j.state = "validating";
      this.changed();
      try {
        const folder = await fs.realpath(j.outputFolder);
        const work = path.join(folder, `.sonora-work-${j.id}`);
        await this.cleanup(j);
        j.outputFolder = folder;
        await fs.mkdir(work);
        j.workDir = work;
        this.changed();
        await this.write;
        let file = j.sourcePath;
        let title = path.parse(j.name).name;
        if (j.kind === "youtube") {
          j.state = "acquiring";
          this.changed();
          const result = await acquire(
            j.sourceURL || `https://www.youtube.com/watch?v=${j.videoId}`,
            work,
            this.tools,
            controller.signal,
            (p, name) => {
              j.progress = Math.round(p * 0.55);
              if (name) j.name = name;
              this.changed();
            },
          );
          file = result.file;
          title = result.title;
        }
        const input = await inspect(file, this.tools, controller.signal);
        j.duration = input.duration;
        j.state = "converting";
        this.changed();
        const part = path.join(work, "audio.part");
        const offset = j.kind === "youtube" ? 55 : 0;
        await run(
          this.tools.ffmpeg,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-n",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            FORMATS,
            "-i",
            file,
            "-map",
            "0:a:0",
            "-vn",
            "-map_metadata",
            "-1",
            "-c:a",
            "libmp3lame",
            "-b:a",
            `${j.options.bitrate}k`,
            "-threads",
            "2",
            "-progress",
            "pipe:1",
            "-f",
            "mp3",
            part,
          ],
          {
            signal: controller.signal,
            cwd: work,
            onLine: (line) => {
              const m = line.match(/^out_time_us=(\d+)/);
              if (m) {
                const progress = Math.min(
                  98,
                  offset +
                    Math.round(
                      (Number(m[1]) / 1e6 / input.duration) * (98 - offset),
                    ),
                );
                if (j.progress !== progress) {
                  j.progress = progress;
                  this.changed();
                }
              }
            },
          },
        );
        await inspect(part, this.tools, controller.signal);
        if (controller.signal.aborted) throw Error("CANCELED");
        j.state = "finalizing";
        this.changed();
        const handle = await fs.open(part, "r+");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (controller.signal.aborted) throw Error("CANCELED");
        const prefix =
          j.options.naming === "number"
            ? String(this.jobs.indexOf(j) + 1).padStart(2, "0") + "_"
            : "";
        j.outputPath = await commitOutput(
          part,
          folder,
          prefix + title,
          j.options.conflict,
        );
        j.state = "done";
        j.progress = 100;
      } catch (e) {
        j.state = controller.signal.aborted
          ? "canceled"
          : e.message === "OUTPUT_EXISTS"
            ? "skipped"
            : "failed";
        j.error = userError(controller.signal.aborted ? Error("CANCELED") : e);
      } finally {
        try {
          await this.cleanup(j);
        } catch {
          this.cleanupWarning = true;
        }
        this.active = null;
        delete j.cancelRequested;
        this.changed();
        await this.write;
      }
    }
    this.running = false;
    this.changed();
    await this.write;
  }
  async shutdown() {
    this.cancelAll();
    await this.loopPromise;
    await this.write;
  }
}
module.exports = { Engine, inspect, commitOutput, userError, FORMATS };
