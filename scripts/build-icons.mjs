/*
 * build-icons.mjs — bakes the four sweater icons (snowman / candy cane / bell / tree) from the
 * publisher art into one transparent sprite (img/icons.png) + a generated SCSS partial.
 *
 * The source PNGs sit each icon on a pale watercolour rectangle (not transparent). We key that
 * background out by colour-distance from the sampled corner colour, feather the edge, trim to the
 * icon, then fit each into a square cell. The icons contain near-white detail (snowman body, candy
 * cane stripes) that keys cleanly on a LIGHT surface but greys on dark — so consumers must show these
 * on a light chip (see .ucs-wild-badge / .ucs-assign-icon).
 *
 * Run: node scripts/build-icons.mjs   (also `npm run build:icons`). Output is committed.
 */
import sharp from 'sharp';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART_DIR = 'C:/Users/Will/Desktop/Programming/BGA/UglyChristmasSweater/ArtFiles/PANDA PDF/Jpeg';

// order = sprite cell order; `key` is the icon name used in Material::icons / card data.
// `boost` darkens the icon's linework by pushing each kept pixel away from white in proportion to how
// far it already is (v' = 255 - (255 - v) * boost). Because it pivots at white, the near-white body
// keeps its light fill while the light-grey outline strokes go dark — so a white-on-white line icon
// (the snowman) reads on the light chips it sits on, which neither a CSS brightness (greys the whole
// body) nor contrast (pivots at mid-grey, so it lightens the above-midpoint strokes) can achieve.
// `thicken` then grows the dark strokes (grayscale erosion, radius in source px): the snowman lines are
// thin, so at the ~7x downscale to the ~18px render size they anti-alias back to light grey no matter
// how dark the tone is — widening them by a couple of source px is what actually makes them read small.
const ICONS = [
    { key: 'snowman', src: 'snowmanicon', boost: 2.6, thicken: 4 },
    { key: 'candycane', src: 'candycaneicon' },
    { key: 'bell', src: 'bellicon' },
    { key: 'tree', src: 'treeicon' },
];
const CELL = 128;       // square sprite cell (retina-crisp at the ~20-40px it renders)
const THRESH = 42;      // colour distance from sampled bg treated as background

async function keyed(src, boost, thicken) {
    const { data, info } = await sharp(join(ART_DIR, `${src}.png`)).ensureAlpha().raw()
        .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const at = (x, y) => { const i = (y * width + x) * channels; return [data[i], data[i + 1], data[i + 2]]; };
    const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
    const bg = [0, 1, 2].map(c => Math.round(corners.reduce((s, p) => s + p[c], 0) / corners.length));
    for (let i = 0; i < data.length; i += channels) {
        const d = Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]);
        if (d < THRESH) data[i + 3] = 0;
        else if (d < THRESH * 1.6) data[i + 3] = Math.round(255 * (d - THRESH) / (THRESH * 0.6));
        // Darken the linework only (pivot at white), on kept pixels — see the `boost` note above. Alpha
        // is left untouched so the keyed/feathered edges are preserved.
        if (boost && data[i + 3] > 0) {
            for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.round(255 - (255 - data[i + c]) * boost));
        }
    }
    // Grayscale erosion: each opaque pixel takes the darkest RGB in its (2r+1)² neighbourhood, so dark
    // strokes bleed outward into the adjacent light body — thickening the lines without touching alpha.
    if (thicken) {
        const src2 = Uint8Array.from(data);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const i = (y * width + x) * channels;
            if (src2[i + 3] === 0) continue; // leave transparent pixels transparent
            let mr = 255, mg = 255, mb = 255;
            for (let dy = -thicken; dy <= thicken; dy++) for (let dx = -thicken; dx <= thicken; dx++) {
                const ny = y + dy, nx = x + dx;
                if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
                const j = (ny * width + nx) * channels;
                if (src2[j + 3] < 128) continue; // only pull colour from opaque-ish neighbours
                if (src2[j] < mr) mr = src2[j];
                if (src2[j + 1] < mg) mg = src2[j + 1];
                if (src2[j + 2] < mb) mb = src2[j + 2];
            }
            data[i] = mr; data[i + 1] = mg; data[i + 2] = mb;
        }
    }
    // trim the now-transparent border, then fit into a centred square cell.
    const trimmed = await sharp(data, { raw: { width, height, channels } }).png().trim({ threshold: 1 }).toBuffer();
    return sharp({ create: { width: CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: await sharp(trimmed).resize(CELL - 12, CELL - 12, { fit: 'inside' }).toBuffer(), gravity: 'center' }])
        .png().toBuffer();
}

async function main() {
    const cells = await Promise.all(ICONS.map(i => keyed(i.src, i.boost, i.thicken)));
    await sharp({ create: { width: ICONS.length * CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(cells.map((input, i) => ({ input, left: i * CELL, top: 0 })))
        .png().toFile(join(REPO, 'img', 'icons.png'));

    let scss = `// GENERATED by scripts/build-icons.mjs — do not edit by hand.\n`
        + `// One class per sweater icon. Consumer sets --ucs-icon-size to size it; show on a LIGHT\n`
        + `// surface (the art has near-white detail that greys on a dark background).\n\n`
        + `.ucs-icon {\n`
        + `    display: inline-block;\n`
        + `    width: var(--ucs-icon-size, 1em);\n`
        + `    height: var(--ucs-icon-size, 1em);\n`
        + `    background-image: url(img/icons.png);\n`
        + `    background-size: calc(var(--ucs-icon-size, 1em) * ${ICONS.length}) var(--ucs-icon-size, 1em);\n`
        + `    background-repeat: no-repeat;\n`
        + `    vertical-align: middle;\n`
        + `}\n`;
    ICONS.forEach((ic, i) => {
        scss += `.ucs-icon-${ic.key} { background-position: calc(var(--ucs-icon-size, 1em) * ${-i}) 0; }\n`;
    });
    writeFileSync(join(REPO, 'src', 'scss', '_icon-sprites.scss'), scss);
    console.log(`built img/icons.png (${ICONS.length}x${CELL}px cells) + _icon-sprites.scss`);
}
main();
