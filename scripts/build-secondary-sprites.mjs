/**
 * build-secondary-sprites.mjs — pack the Stage-2 (non-sweater) card faces into one CSS sprite sheet
 * and emit the matching SCSS. Sibling of build-sprites.mjs (which handles the 52 sweater cards).
 *
 *   node scripts/build-secondary-sprites.mjs      (or: npm run build:sprites — runs all three)
 *
 * Inputs : the publisher PNGs (750x1125) in ART_DIR. Every card->file mapping below was transcribed
 *          by reading each printed face and cross-checked against Material.php (fads(), secretSantas(),
 *          PERFECT_FIT, TRENDY_YARN, bonusCards()). NOTE (2026-07-15): the Fad faces are NOT "2x of 5
 *          types" — each colour appears on two cards with a DIFFERENT icon; see Material::fads().
 * Outputs: img/secondary.jpg              — grid of all Stage-2 faces (+ deck backs)
 *          src/scss/_secondary-sprites.scss — GENERATED .ucs-<key> background-position classes
 *
 * Keys match how the client looks each card up:
 *   perfectfit -> card value 1..6            (type_arg = value)
 *   trendyyarn -> colour name                (type_arg = index into Material::COLORS)
 *   fad        -> fad id 1..10               (type_arg = id; ids 9 & 10 share the Clash art)
 *   santa      -> secret-santa id 1..16      (type_arg = id)
 *   bonus      -> bonus id 1..4              (type_arg = id)
 *   draftorder -> turn order 1..4 · scoreref/roundtracker/aid-back are singletons (player aids)
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const ART_DIR = 'C:/Users/Will/Desktop/Programming/BGA/UglyChristmasSweater/ArtFiles/PANDA PDF/Jpeg';

// Same 3mm print bleed as the sweater cards (750x1125 -> 675x1050 trimmed, 0.643 ratio). Trimming the
// bleed gives a clean card edge while keeping the decorative dotted frame intact.
const TRIM = { left: 37, top: 37, width: 675, height: 1050 };

const CELL_W = 240;
const CELL_H = Math.round(CELL_W * TRIM.height / TRIM.width); // 373 — same trimmed 0.643 ratio
const COLS = 8;                                               // grid width; rows derived from count

// Secret Santa HEADSHOT crop — the square portrait detail inside each santa card, in UNTRIMMED source
// (750x1125) pixels. Measured off the art rather than reasoned from the layout, and checked against all
// 16 faces (not a sample): every card places the head at this spot and this rect clears the dotted frame
// on all of them. Emitted as a CSS crop of the SAME sheet rather than a second image — the sheet already
// carries the faces at 240px/cell, which is ~174 source px across the head against the ~40-56px it
// renders at.
const HEAD = { left: 196, top: 580, size: 455 };

// Ordered face list: [cssKey, sourceBasename]. Source art was renamed to systematic names by
// scripts/rename-art.mjs, so key and file now read alike. Grouped by type; layout is row-major.
const FACES = [
    // --- Perfect Fit (values 1..6) + back ("1" corner tag) ---
    ['gp-perfectfit-1', 'perfectfit-1'],
    ['gp-perfectfit-2', 'perfectfit-2'],
    ['gp-perfectfit-3', 'perfectfit-3'],
    ['gp-perfectfit-4', 'perfectfit-4'],
    ['gp-perfectfit-5', 'perfectfit-5'],
    ['gp-perfectfit-6', 'perfectfit-6'],
    ['gp-perfectfit-back', 'perfectfit-back'],
    // --- Trendy Yarn (one sweater per colour) + back ("2" corner tag) ---
    ['gp-trendyyarn-yellow', 'trendyyarn-yellow'],
    ['gp-trendyyarn-green', 'trendyyarn-green'],
    ['gp-trendyyarn-red', 'trendyyarn-red'],
    ['gp-trendyyarn-purple', 'trendyyarn-purple'],
    ['gp-trendyyarn-back', 'trendyyarn-back'],
    // --- Fads (ids 1..10; each is colour-obj + icon-obj). ids 9 & 10 are the two identical Clash cards. ---
    ['gp-fad-1', 'fad-01-yellow-bells'],
    ['gp-fad-2', 'fad-02-yellow-snowmen'],
    ['gp-fad-3', 'fad-03-purple-snowmen'],
    ['gp-fad-4', 'fad-04-purple-bells'],
    ['gp-fad-5', 'fad-05-red-candycane'],
    ['gp-fad-6', 'fad-06-red-trees'],
    ['gp-fad-7', 'fad-07-green-trees'],
    ['gp-fad-8', 'fad-08-green-candycane'],
    ['gp-fad-9', 'fad-09-clash'],
    ['gp-fad-10', 'fad-10-clash'],       // identical art to fad-9
    ['gp-fad-back', 'fad-back'],
    // --- Secret Santa (ids 1..16, matching Material::secretSantas()) + back ---
    ['santa-1', 'santa-01-aunt-jo-ann'],
    ['santa-2', 'santa-02-baby-bro-mads'],
    ['santa-3', 'santa-03-boisterous-barley'],
    ['santa-4', 'santa-04-aunt-bleu'],
    ['santa-5', 'santa-05-indiana-alex'],
    ['santa-6', 'santa-06-cousin-veny'],
    ['santa-7', 'santa-07-spoon'],
    ['santa-8', 'santa-08-auntie-jennifer'],
    ['santa-9', 'santa-09-grandpa-tony'],
    ['santa-10', 'santa-10-brainy-bytes-bryan'],
    ['santa-11', 'santa-11-sister-rain'],
    ['santa-12', 'santa-12-lovely-leia'],
    ['santa-13', 'santa-13-uncle-phil'],
    ['santa-14', 'santa-14-ravishing-rosemary'],
    ['santa-15', 'santa-15-cousin-rami'],
    ['santa-16', 'santa-16-auntie-jaimie'],
    ['santa-back', 'santa-back'],
    // --- Bonus / Special Ability (ids 1..4, matching Material::bonusCards()) + back ---
    ['bonus-1', 'bonus-1-little-brothers'],
    ['bonus-2', 'bonus-2-tina'],
    ['bonus-3', 'bonus-3-maria'],
    ['bonus-4', 'bonus-4-billy'],
    ['bonus-back', 'bonus-back'],
    // --- Player aids: Draft Order 1..4 (holly wreath), Score Reference, Express Round Tracker, grey back ---
    ['draftorder-1', 'draftorder-1'],
    ['draftorder-2', 'draftorder-2'],
    ['draftorder-3', 'draftorder-3'],
    ['draftorder-4', 'draftorder-4'],
    ['scoreref', 'scoreref'],
    ['roundtracker', 'roundtracker'],
    ['aid-back', 'aid-back'],
];

const ROWS = Math.ceil(FACES.length / COLS);
const src = (base) => join(ART_DIR, `${base}.png`);
const cell = (base) => sharp(src(base)).extract(TRIM).resize(CELL_W, CELL_H, { fit: 'fill' })
    .flatten({ background: '#ffffff' }).toBuffer();

/**
 * The Secret Santa headshots, as a CSS crop of the sheet above. The consumer sets ONE variable,
 * --ucs-head-size (the square's side); everything else is derived here, so the crop lands on the head
 * whatever size it is asked for.
 *
 * The maths: HEAD covers the fraction `fw` of a cell's width, so the sheet has to be scaled until
 * `fw * cardW` equals the requested square — hence cardW = size / fw. cardH then follows from the
 * CELL_H/CELL_W ratio rather than from HEAD's own height fraction, so the sheet is never stretched. The
 * two agree to within 0.1%, and erring this way shows a sliver MORE head rather than a hairline of the
 * neighbouring cell.
 *
 * The rotation is not decoration: the santa art is drawn to be read in landscape (which is why
 * .ucs-santa-card turns the whole card 90deg), so the head lies on its side until turned the same way. A
 * square's layout footprint is unchanged by the turn, so nothing has to reserve a rotated box the way
 * .ucs-santa-slot does for the full card.
 */
function santaHeadScss() {
    const fx = (HEAD.left - TRIM.left) / TRIM.width;
    const fy = (HEAD.top - TRIM.top) / TRIM.height;
    const fw = HEAD.size / TRIM.width;
    const r = (n) => Number(n.toFixed(5)).toString();

    let out = `\n// ---- Secret Santa headshots: a square crop of the santa faces above ----\n`
        + `.ucs-santa-head {\n`
        + `    --ucs-card-w: calc(var(--ucs-head-size) * ${r(1 / fw)});\n`
        + `    --ucs-card-h: calc(var(--ucs-card-w) * ${r(CELL_H / CELL_W)});\n`
        + `    width: var(--ucs-head-size);\n`
        + `    height: var(--ucs-head-size);\n`
        + `    background-image: url(img/secondary.jpg);\n`
        + `    background-repeat: no-repeat;\n`
        + `    background-size: calc(var(--ucs-card-w) * ${COLS}) calc(var(--ucs-card-h) * ${ROWS});\n`
        + `    transform: rotate(90deg);\n`
        + `}\n`;
    FACES.forEach(([key], i) => {
        if (!/^santa-\d+$/.test(key)) return; // faces only — the deck back has no headshot
        const col = i % COLS, row = Math.floor(i / COLS);
        out += `.ucs-head-${key.slice(6)} { background-position: `
            + `calc(var(--ucs-card-w) * ${r(-(col + fx))}) calc(var(--ucs-card-h) * ${r(-(row + fy))}); }\n`;
    });
    return out;
}

async function main() {
    const composites = [];
    FACES.forEach(([, base], i) => composites.push({ base, i }));
    const inputs = [];
    for (const { base, i } of composites) {
        inputs.push({ input: await cell(base), left: (i % COLS) * CELL_W, top: Math.floor(i / COLS) * CELL_H });
    }
    await sharp({ create: { width: COLS * CELL_W, height: ROWS * CELL_H, channels: 3, background: '#ffffff' } })
        .composite(inputs)
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(join(REPO, 'img', 'secondary.jpg'));

    // ---- Emit the SCSS partial ----
    let scss = `// GENERATED by scripts/build-secondary-sprites.mjs — do not edit by hand.\n`
        + `// One class per Stage-2 card face; consumer sets --ucs-card-w/--ucs-card-h to size it.\n\n`
        + `.ucs-art2 {\n`
        + `    background-image: url(img/secondary.jpg);\n`
        + `    background-size: calc(var(--ucs-card-w) * ${COLS}) calc(var(--ucs-card-h) * ${ROWS});\n`
        + `    background-repeat: no-repeat;\n`
        + `}\n\n`;
    FACES.forEach(([key], i) => {
        const col = i % COLS, row = Math.floor(i / COLS);
        scss += `.ucs-${key} { background-position: calc(var(--ucs-card-w) * ${-col}) calc(var(--ucs-card-h) * ${-row}); }\n`;
    });
    scss += santaHeadScss();
    writeFileSync(join(REPO, 'src', 'scss', '_secondary-sprites.scss'), scss);

    console.log(`Wrote img/secondary.jpg (${COLS * CELL_W}x${ROWS * CELL_H}, ${FACES.length} faces), src/scss/_secondary-sprites.scss`);
}

main().catch((e) => { console.error(e); process.exit(1); });
