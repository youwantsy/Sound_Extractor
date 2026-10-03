const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  youtubeURL,
  safeName,
  options,
  mediaHost,
  publicIP,
} = require("../src/security.cjs");
const { providerError } = require("../src/provider.cjs");
test("canonical single-video URLs discard tracking and playlists", () => {
  for (const s of [
    "https://youtu.be/abcdefghijk?t=3",
    "https://www.youtube.com/watch?v=abcdefghijk&list=xyz",
    "https://m.youtube.com/shorts/abcdefghijk",
  ])
    assert.deepEqual(youtubeURL(s), {
      id: "abcdefghijk",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
    });
});
test("reject host spoofing, credentials, local targets, injection and malformed IDs", () => {
  for (const s of [
    "file:///C:/a.mp4",
    "http://youtube.com/watch?v=abcdefghijk",
    "https://youtube.com.evil.test/watch?v=abcdefghijk",
    "https://youtube.com@127.0.0.1/watch?v=abcdefghijk",
    "https://youtube.com:444/watch?v=abcdefghijk",
    "https://youtube.com/playlist?list=123",
    "--exec calc.exe",
    "https://youtu.be/short",
    "https://youtu.be/abcdefghijk/extra",
    "https://localhost/watch?v=abcdefghijk",
  ])
    assert.throws(() => youtubeURL(s));
});
test("Windows file names cannot escape output or use device names", () => {
  for (const s of [
    "../../CON",
    "..\\NUL",
    "CON",
    "nul.mp4",
    "COM1",
    'abc<>:"/\\|?*',
    "a\0b",
    "...",
  ]) {
    const name = safeName(s);
    assert.ok(name.length);
    assert.ok(!/[<>:"/\\|?*\x00-\x1f]/.test(name));
    assert.ok(!/[. ]$/.test(name));
    assert.ok(!/^(con|nul|com1)(\.|$)/i.test(name));
  }
});
test("quality and policy are enumerated, not command arguments", () => {
  assert.equal(
    options({ bitrate: 192, naming: "title", conflict: "number" }).bitrate,
    192,
  );
  for (const bitrate of ["192;calc", 1000, null])
    assert.throws(() =>
      options({ bitrate, naming: "title", conflict: "number" }),
    );
});
test("media allowlist checks suffix boundary", () => {
  assert.ok(mediaHost("rr1---sn-a.googlevideo.com"));
  assert.ok(mediaHost("www.youtube.com"));
  for (const h of [
    "googlevideo.com.evil.test",
    "evilgooglevideo.com",
    "127.0.0.1",
    "localhost",
    undefined,
  ])
    assert.ok(!mediaHost(h));
});
test("proxy rejects private, reserved, metadata and all IPv6 addresses", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "198.18.0.1",
    "192.0.2.1",
    "203.0.113.1",
    "::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicIP(ip), false);
  assert.equal(publicIP("8.8.8.8"), true);
});
test("provider restrictions are explicit and raw diagnostic URLs are not exposed", () => {
  const e = Error("PROCESS_FAILED");
  e.detail = "Sign in to confirm / private https://example.test/token";
  assert.equal(providerError(e).message, "SERVICE_RESTRICTED");
});
