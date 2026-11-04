// Adds the custom purple accent bar under "T3" in the production app icons.
// Run once per upstream icon change: node custom/apply-icon-accent.mjs
import * as NodeModule from "node:module";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const repo = NodePath.join(import.meta.dirname, "..");
const sharp = NodeModule.createRequire(NodePath.join(repo, "scripts", "package.json"))("sharp");
const ACCENT = "#a855f7";

// Small sizes are hand-drawn with larger letters, so measure each image instead of scaling one layout.
async function measure(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // The tile's lit edge is as bright as the letters; skip it.
  const edge = Math.round(info.width * 0.08);
  let letterLeft = info.width,
    letterRight = 0,
    letterBottom = 0,
    tileBottom = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3] > 200) tileBottom = Math.max(tileBottom, y);
      const inside = x >= edge && x < info.width - edge && y >= edge && y < info.height - edge;
      if (inside && data[i + 3] > 200 && data[i] > 140) {
        letterLeft = Math.min(letterLeft, x);
        letterRight = Math.max(letterRight, x);
        letterBottom = Math.max(letterBottom, y);
      }
    }
  }
  return { size: info.width, letterLeft, letterRight, letterBottom, tileBottom };
}

async function accentPng(input) {
  const { size, letterLeft, letterRight, letterBottom, tileBottom } = await measure(input);
  const gap = tileBottom - letterBottom;
  const height = Math.max(1, Math.round(Math.min(size * 0.06, gap * 0.4)));
  const y = letterBottom + Math.max(1, Math.round((gap - height) / 2.2));
  const x = letterLeft;
  const width = letterRight - letterLeft + 1;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${ACCENT}"/></svg>`;
  return sharp(input)
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();
}

async function accentIco(path) {
  const ico = NodeFS.readFileSync(path);
  const count = ico.readUInt16LE(4);
  const images = [];
  for (let i = 0; i < count; i++) {
    const entry = 6 + 16 * i;
    const size = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    images.push({
      entry: ico.subarray(entry, entry + 16),
      png: await accentPng(ico.subarray(offset, offset + size)),
    });
  }
  const header = Buffer.from(ico.subarray(0, 6));
  const entries = [];
  let offset = 6 + 16 * count;
  for (const image of images) {
    const entry = Buffer.from(image.entry);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.png.length;
    entries.push(entry);
  }
  NodeFS.writeFileSync(
    path,
    Buffer.concat([header, ...entries, ...images.map((image) => image.png)]),
  );
}

const prod = NodePath.join(repo, "assets", "prod");
for (const name of [
  "black-universal-1024.png",
  "t3-black-web-apple-touch-180.png",
  "t3-black-web-favicon-16x16.png",
  "t3-black-web-favicon-32x32.png",
]) {
  const path = NodePath.join(prod, name);
  NodeFS.writeFileSync(path, await accentPng(NodeFS.readFileSync(path)));
}
for (const name of ["t3-black-windows.ico", "t3-black-web-favicon.ico"]) {
  await accentIco(NodePath.join(prod, name));
}
console.log("Applied the custom accent to the production icons.");
