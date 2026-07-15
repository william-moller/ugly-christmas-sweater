// One-off: detect the decorative frame inset on sample cards to determine the print bleed to trim.
import sharp from 'sharp';
import { join } from 'node:path';

const ART = 'C:/Users/Will/Desktop/Programming/BGA/UglyChristmasSweater/ArtFiles/PANDA PDF/Jpeg';
const SAMPLES = ['bells9', 'trees10', 'snowman4', 'candycane'];

// Find, scanning inward from each edge, the first strong dark line (the frame). Returns px inset.
async function frameInsets(base) {
    const W = 750, H = 1125;
    const { data } = await sharp(join(ART, `${base}.png`)).greyscale().raw().toBuffer({ resolveWithObject: true });
    const dark = (x, y) => data[y * W + x] < 110 ? 1 : 0;
    const colDark = (x) => { let c = 0; for (let y = 0; y < H; y++) c += dark(x, y); return c; };
    const rowDark = (y) => { let c = 0; for (let x = 0; x < W; x++) c += dark(x, y); return c; };
    // Frame side = the column/row with the most dark pixels within the outer 12% band.
    const bandX = Math.round(W * 0.12), bandY = Math.round(H * 0.12);
    let left = 0, lb = -1; for (let x = 0; x < bandX; x++) { const c = colDark(x); if (c > lb) { lb = c; left = x; } }
    let right = W - 1, rb = -1; for (let x = W - 1; x > W - bandX; x--) { const c = colDark(x); if (c > rb) { rb = c; right = x; } }
    let top = 0, tb = -1; for (let y = 0; y < bandY; y++) { const c = rowDark(y); if (c > tb) { tb = c; top = y; } }
    let bot = H - 1, bb = -1; for (let y = H - 1; y > H - bandY; y--) { const c = rowDark(y); if (c > bb) { bb = c; bot = y; } }
    return { left, right: W - 1 - right, top, bottom: H - 1 - bot };
}

for (const s of SAMPLES) {
    const f = await frameInsets(s);
    console.log(`${s.padEnd(12)} frame inset px  L=${f.left} R=${f.right} T=${f.top} B=${f.bottom}`);
}
console.log('\nIf bleed = 3mm@300dpi (~37.5px), trimming 37-38px/side -> 675x1050 (bridge card, ratio 0.643).');
