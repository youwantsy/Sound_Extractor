// A small original Sonora waveform mark; no downloaded artwork or font dependency.
const fs = require("node:fs");
const zlib = require("node:zlib");
const size = 256,
  pixels = Buffer.alloc((size * 4 + 1) * size);
function crc(b) {
  let c = 0xffffffff;
  for (const byte of b) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type),
    n = Buffer.alloc(4),
    c = Buffer.alloc(4);
  n.writeUInt32BE(data.length);
  c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([n, t, data, c]);
}
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const i = y * (size * 4 + 1) + 1 + x * 4;
    const dx = Math.max(36 - x, 0, x - 219),
      dy = Math.max(36 - y, 0, y - 219);
    let color = [49, 95, 76, dx * dx + dy * dy < 36 * 36 ? 255 : 0];
    for (const [cx, h] of [
      [64, 44],
      [96, 86],
      [128, 132],
      [160, 86],
      [192, 44],
    ]) {
      const dy2 = Math.max(128 - h / 2 + 7 - y, 0, y - (128 + h / 2 - 7));
      if (Math.abs(x - cx) <= 7 && dy2 * dy2 + (x - cx) ** 2 <= 49)
        color = [234, 241, 224, 255];
      if (Math.abs(x - cx) <= 7 && y >= 128 - h / 2 + 7 && y <= 128 + h / 2 - 7)
        color = [234, 241, 224, 255];
    }
    for (let k = 0; k < 4; k++) pixels[i + k] = color[k];
  }
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", zlib.deflateSync(pixels)),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.mkdirSync("build", { recursive: true });
fs.writeFileSync("src/icon.png", png);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
fs.writeFileSync("build/icon.ico", Buffer.concat([ico, png]));
