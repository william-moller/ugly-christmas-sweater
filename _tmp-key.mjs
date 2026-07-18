import sharp from 'sharp';
const DIR = 'C:/Users/Will/Desktop/Programming/BGA/UglyChristmasSweater/ArtFiles/PANDA PDF/Jpeg';
const OUT = 'C:/Users/Will/AppData/Local/Temp/claude/C--willdevsrc/37492732-d8fa-416e-88a2-dcce4fe6c7f7/scratchpad/key-preview.png';
const names = ['snowmanicon', 'candycaneicon', 'bellicon', 'treeicon'];
const THRESH = 42; // colour distance from sampled bg to treat as background

async function key(name) {
  const img = sharp(`${DIR}/${name}.png`).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const px = (x, y) => { const i = (y * width + x) * channels; return [data[i], data[i + 1], data[i + 2]]; };
  // sample bg = average of the four corners
  const corners = [px(0, 0), px(width - 1, 0), px(0, height - 1), px(width - 1, height - 1)];
  const bg = [0, 1, 2].map(c => Math.round(corners.reduce((s, p) => s + p[c], 0) / corners.length));
  const dist = (p) => Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]);
  for (let i = 0; i < data.length; i += channels) {
    const d = Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]);
    if (d < THRESH) data[i + 3] = 0;               // clearly bg -> transparent
    else if (d < THRESH * 1.6) data[i + 3] = Math.round(255 * (d - THRESH) / (THRESH * 0.6)); // feather
  }
  return sharp(data, { raw: { width, height, channels } }).png()
    .trim({ threshold: 1 }).toBuffer(); // trim now-transparent border
}

const CELL = 200;
const keyed = await Promise.all(names.map(key));
// preview each keyed icon on dark (top row) and light (bottom row) so transparency is judged both ways.
const rows = [{ bg: '#181818', y: 0 }, { bg: '#f2ede0', y: CELL }];
const composites = [];
for (let r = 0; r < rows.length; r++) {
  for (let i = 0; i < keyed.length; i++) {
    const fit = await sharp(keyed[i]).resize(CELL - 30, CELL - 30, { fit: 'inside' }).toBuffer();
    const m = await sharp(fit).metadata();
    composites.push({ input: fit, left: i * CELL + Math.round((CELL - m.width) / 2), top: rows[r].y + Math.round((CELL - m.height) / 2) });
  }
}
// paint the two background bands first
const bands = [
  { input: await sharp({ create: { width: names.length * CELL, height: CELL, channels: 3, background: '#181818' } }).png().toBuffer(), left: 0, top: 0 },
  { input: await sharp({ create: { width: names.length * CELL, height: CELL, channels: 3, background: '#f2ede0' } }).png().toBuffer(), left: 0, top: CELL },
];
await sharp({ create: { width: names.length * CELL, height: 2 * CELL, channels: 4, background: '#000' } })
  .composite([...bands, ...composites]).png().toFile(OUT);
console.log('wrote', OUT);
