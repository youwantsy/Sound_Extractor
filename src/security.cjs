"use strict";
const path = require("node:path");
const net = require("node:net");
const VIDEO_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);
const EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".mkv",
  ".webm",
  ".avi",
  ".m4v",
  ".mp3",
  ".wav",
  ".flac",
  ".ogg",
  ".m4a",
  ".aac",
  ".wma",
]);
function youtubeURL(value) {
  if (typeof value !== "string" || value.length > 2048)
    throw Error("INVALID_URL");
  let u;
  try {
    u = new URL(value.trim());
  } catch {
    throw Error("INVALID_URL");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !VIDEO_HOSTS.has(u.hostname)
  )
    throw Error("INVALID_URL");
  let id;
  if (u.hostname === "youtu.be") id = u.pathname.slice(1);
  else if (u.pathname === "/watch") id = u.searchParams.get("v");
  else
    id = u.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]+)$/)?.[1];
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || "")) throw Error("INVALID_URL");
  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}
function safeName(name) {
  let s = String(name)
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/g, "");
  if (!s) s = "Audio";
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s)) s = "_" + s;
  return s;
}
function options(value) {
  if (
    !value ||
    typeof value !== "object" ||
    ![128, 192, 256, 320].includes(value.bitrate) ||
    !["title", "number"].includes(value.naming) ||
    !["number", "skip"].includes(value.conflict)
  )
    throw Error("INVALID_OPTIONS");
  return {
    bitrate: value.bitrate,
    naming: value.naming,
    conflict: value.conflict,
  };
}
function supported(file) {
  return (
    typeof file === "string" && EXTENSIONS.has(path.extname(file).toLowerCase())
  );
}
function mediaHost(host) {
  return (
    typeof host === "string" &&
    /^[a-z0-9.-]+$/i.test(host) &&
    [
      "youtube.com",
      "googlevideo.com",
      "ytimg.com",
      "youtubei.googleapis.com",
    ].some((base) => host === base || host.endsWith("." + base))
  );
}
function publicIP(ip) {
  // Only globally routable IPv4: IPv6 is intentionally disabled for the provider proxy.
  if (net.isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
module.exports = {
  youtubeURL,
  safeName,
  options,
  supported,
  mediaHost,
  publicIP,
};
