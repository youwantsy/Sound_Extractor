"use strict";
const http = require("node:http");
const net = require("node:net");
const dns = require("node:dns/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");
const { youtubeURL, mediaHost, publicIP } = require("./security.cjs");
const { run } = require("./process.cjs");
async function restrictedProxy() {
  const sockets = new Set();
  let received = 0;
  const token = crypto.randomBytes(24).toString("hex");
  const authorization =
    "Basic " + Buffer.from(`sonora:${token}`).toString("base64");
  const server = http.createServer((req, res) => {
    res.writeHead(403);
    res.end();
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.once("close", () => sockets.delete(s));
    s.on("error", () => {});
  });
  server.on("connect", async (req, client, head) => {
    let upstream;
    try {
      if (req.headers["proxy-authorization"] !== authorization)
        throw Error("DENIED");
      const m = req.url?.match(/^([a-zA-Z0-9.-]+):443$/);
      const host = m?.[1].toLowerCase();
      if (!mediaHost(host)) throw Error("DENIED");
      const addresses = await dns.lookup(host, { all: true, family: 4 });
      if (!addresses.length || addresses.some((x) => !publicIP(x.address)))
        throw Error("DENIED");
      if (client.destroyed) return;
      upstream = net.connect({ host: addresses[0].address, port: 443 });
      sockets.add(upstream);
      upstream.setTimeout(30000, () => upstream.destroy());
      upstream.on("error", () => client.destroy());
      upstream.once("close", () => {
        sockets.delete(upstream);
        client.destroy();
      });
      client.once("close", () => upstream.destroy());
      upstream.on("data", (c) => {
        received += c.length;
        if (received > 2.2 * 1024 ** 3) {
          upstream.destroy();
          client.destroy();
        }
      });
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
    } catch {
      upstream?.destroy();
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://sonora:${token}@127.0.0.1:${server.address().port}`,
    close: () => {
      for (const s of sockets) s.destroy();
      return new Promise((r) => server.close(r));
    },
  };
}
function providerError(error) {
  if (error.message !== "PROCESS_FAILED") return error;
  const detail = error.detail || "";
  if (
    /sign in|login|private|members.only|age.restrict|not available|unavailable|copyright|geo.restrict|403|429|confirm|DRM|PO Token/i.test(
      detail,
    )
  )
    return Error("SERVICE_RESTRICTED");
  if (/requested format|no video formats/i.test(detail))
    return Error("FORMAT_UNAVAILABLE");
  return Error("NETWORK_OR_PROVIDER");
}
async function acquire(url, dir, tools, signal, progress) {
  const canonical = youtubeURL(url);
  const proxy = await restrictedProxy();
  const base = [
    "--ignore-config",
    "--no-cache-dir",
    "--no-playlist",
    "--no-warnings",
    "--no-colors",
    "--socket-timeout",
    "20",
    "--retries",
    "1",
    "--fragment-retries",
    "1",
    "--extractor-retries",
    "1",
    "--no-remote-components",
    "--no-js-runtimes",
    "--js-runtimes",
    `node:${tools.node}`,
    "--proxy",
    proxy.url,
    "--no-check-formats",
    "--match-filters",
    "!is_live & duration <= 86400",
    "--max-filesize",
    "2G",
    "--format",
    "bestaudio[protocol=https]/best[protocol=https]",
  ];
  try {
    const meta = await run(
      tools.ytdlp,
      [...base, "--skip-download", "--dump-single-json", "--", canonical.url],
      { signal, timeout: 90000, cwd: dir },
    );
    let info;
    try {
      info = JSON.parse(meta.stdout);
    } catch {
      throw Error("PROVIDER_RESPONSE");
    }
    if (
      info.is_live ||
      info.has_drm ||
      !(info.duration > 0) ||
      info.duration > 86400
    )
      throw Error("SERVICE_RESTRICTED");
    progress(0, String(info.title || `YouTube ${canonical.id}`).slice(0, 200));
    await run(
      tools.ytdlp,
      [
        ...base,
        "--newline",
        "--progress",
        "--progress-template",
        "download:SONORA:%(progress._percent_str)s",
        "--no-part",
        "--output",
        path.join(dir, "source.%(ext)s"),
        "--",
        canonical.url,
      ],
      {
        signal,
        timeout: 30 * 60 * 1000,
        cwd: dir,
        onLine: (line) => {
          const m = line.match(/^SONORA:\s*([\d.]+)%/);
          if (m) progress(Math.min(100, Number(m[1])));
        },
      },
    );
    const files = (await fs.readdir(dir)).filter((x) =>
      /^source\.(m4a|webm|mp4|mkv|opus|ogg|aac)$/i.test(x),
    );
    if (files.length !== 1) throw Error("FORMAT_UNAVAILABLE");
    return {
      file: path.join(dir, files[0]),
      title: String(info.title || canonical.id).slice(0, 200),
    };
  } catch (e) {
    throw providerError(e);
  } finally {
    await proxy.close();
  }
}
module.exports = { acquire, restrictedProxy, providerError };
