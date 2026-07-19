// Rasterize the app icon (rounded square + division sign) to PNG without any
// image dependency: raw RGBA scanlines -> zlib -> hand-assembled PNG chunks.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const GREEN = [0x04, 0x78, 0x57, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

function pixel(x, y, size, opaqueBackground) {
  const u = x / size;
  const v = y / size;
  // Rounded-square mask (radius ~22%).
  const r = 0.22;
  const cx = Math.min(Math.max(u, r), 1 - r);
  const cy = Math.min(Math.max(v, r), 1 - r);
  const inSquare = (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
  if (!inSquare) return opaqueBackground ? GREEN : CLEAR;
  // Division sign: dot, bar, dot.
  const dot = (dx, dy) => (u - dx) ** 2 + (v - dy) ** 2 <= 0.074 ** 2;
  const bar = Math.abs(v - 0.5) <= 0.051 && u >= 0.25 && u <= 0.75;
  if (dot(0.5, 0.293) || dot(0.5, 0.707) || bar) return WHITE;
  return GREEN;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, opaqueBackground) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size, opaqueBackground);
      raw.set([r, g, b, a], row + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, false));
writeFileSync("public/icons/icon-512.png", png(512, false));
// iOS wants an opaque icon that fills the square.
writeFileSync("public/icons/apple-touch-icon.png", png(180, true));
console.log("icons written");
