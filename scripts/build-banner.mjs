/**
 * build-banner.mjs — compose the BGA metadata BANNER (1386x400 JPG) from the box-front artwork.
 *
 *   node scripts/build-banner.mjs            (writes banner.jpg beside this repo; BANNER_OUT to redirect)
 *
 * Not a game asset: the banner is uploaded through BGA's Game Metadata Manager, NOT deployed to the
 * project directory, so nothing here writes into img/ — and the JPG must never be committed
 * (publisher art, public repo — see ../.claude/conventions.md).
 *
 * BGA banner spec: JPG, exactly 1386x400, under 2MB, NO TEXT, and the box cover is laid over the
 * banner's left edge and must stand out — hence the quiet left third below.
 */
import sharp from 'sharp';
import { join } from 'node:path';

const ART_DIR = 'C:/Users/Will/Desktop/Programming/BGA/UglyChristmasSweater/ArtFiles/PANDA PDF';
const OUT_DIR = process.env.BANNER_OUT ?? '.';

// --- Source ---------------------------------------------------------------------------------------
// The four finished sweaters are the box-front illustration — the artist's own arrangement, complete
// with hems, and the only place all four colours appear as whole garments.
//
// They live on page 1 of `Front.pdf`, but that PDF is unusable as a direct source: one page of 18
// stacked 2569x3230 CMYK JPEG layers with no ICC profile, so nothing can convert them back to the
// intended colour (the naive transform lands on a vivid 29,230,108 where the artwork is a muted
// 103,135,59 — right hue, hopelessly wrong saturation, and no profile to correct it with).
// `Jpeg/boxcoverfrombgg.jpg` is the SAME artwork already converted to sRGB correctly. At 1125x1425 the
// sweater row is ~470px tall against the 372px this banner needs, so it downsamples — no quality lost.
const SRC = join(ART_DIR, 'Jpeg', 'boxcoverfrombgg.jpg');

// The sweater row on that cover: full width, from just above the collars to the bottom edge.
const STRIP = { left: 0, top: 860, width: 1125, height: 565 };

// The cover's flat background, sampled (it is uniform — the same triple at every point tested).
const BG = [103, 135, 59];
// Distance from BG still counted as background. Kept tight on purpose: the GREEN sweater's darkest
// knit sits about 36 away, so anything near that starts eating the sweater we are trying to keep.
const BG_TOL = 24;
// The sweaters overlap, which traps pockets of background between them (between purple and yellow,
// and yellow and red) that a border fill can never reach. Those pockets are the flat cover colour
// exactly, so a second, much tighter test clears them wherever they sit. It has to be tighter than
// BG_TOL because it is applied everywhere, with no enclosure to protect the green sweater — whose
// darkest knit is ~36 away, comfortably outside this.
const BG_EXACT = 14;

/** Banner canvas required by BGA's metadata manager. */
const BANNER = { width: 1386, height: 400 };

/**
 * Lift the sweater row off the cover's flat background.
 *
 * Far simpler than segmenting a card: the backdrop is one uniform colour, so a border flood-fill over
 * pixels near it takes the lot. Flood-filling rather than testing every pixel matters for the green
 * sweater — its dark knit is close enough to the cover green to be caught by a plain colour test, but
 * it is enclosed by lighter knit, so the fill never reaches it.
 */
async function cutout() {
    const { data, info } = await sharp(SRC).extract(STRIP)
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: W, height: H, channels: C } = info;

    const dist2 = (i) => {
        const dr = data[i] - BG[0], dg = data[i + 1] - BG[1], db = data[i + 2] - BG[2];
        return dr * dr + dg * dg + db * db;
    };
    const isBg = (i) => dist2(i) <= BG_TOL * BG_TOL;

    const seen = new Uint8Array(W * H);
    const stack = [];
    for (let x = 0; x < W; x++) { stack.push(x, (H - 1) * W + x); }
    for (let y = 0; y < H; y++) { stack.push(y * W, y * W + W - 1); }

    while (stack.length) {
        const p = stack.pop();
        if (seen[p] || !isBg(p * C)) continue;
        seen[p] = 1;
        const x = p % W, y = (p / W) | 0;
        if (x > 0) stack.push(p - 1);
        if (x < W - 1) stack.push(p + 1);
        if (y > 0) stack.push(p - W);
        if (y < H - 1) stack.push(p + W);
    }

    // Clear the trapped pockets the fill could not reach.
    for (let p = 0; p < W * H; p++) {
        if (!seen[p] && dist2(p * C) <= BG_EXACT * BG_EXACT) seen[p] = 1;
    }

    // Erode two pixels. JPEG ringing leaves a rim of half-background colour around every sleeve that
    // the threshold cannot classify; on a pale backdrop it reads as a dirty green outline.
    for (let pass = 0; pass < 2; pass++) {
        const before = seen.slice();
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                const p = y * W + x;
                if (before[p]) continue;
                if (before[p - 1] || before[p + 1] || before[p - W] || before[p + W]) seen[p] = 1;
            }
        }
    }

    for (let p = 0; p < W * H; p++) if (seen[p]) data[p * C + 3] = 0;

    return sharp(data, { raw: { width: W, height: H, channels: C } })
        .png().trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
}

/**
 * Backdrop: the card back (a knitted red/green stripe) turned landscape, filled to the canvas and
 * softened. It is the game's own art, carries no text, and blurring it keeps the sweaters the only
 * thing in focus. The veil is weighted left, where BGA lays the box cover.
 */
async function backdrop() {
    const knit = await sharp(join(ART_DIR, 'Jpeg', 'sweater-back.png'))
        .rotate(90)
        .resize(BANNER.width, BANNER.height, { fit: 'cover', position: 'centre' })
        .blur(9)
        .toBuffer();
    const veil = Buffer.from(`<svg width="${BANNER.width}" height="${BANNER.height}">
        <defs><linearGradient id="v" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0"    stop-color="#fffcf5" stop-opacity="0.88"/>
            <stop offset="0.28" stop-color="#fffcf5" stop-opacity="0.72"/>
            <stop offset="0.55" stop-color="#fffcf5" stop-opacity="0.60"/>
            <stop offset="1"    stop-color="#fffcf5" stop-opacity="0.56"/>
        </linearGradient></defs>
        <rect width="100%" height="100%" fill="url(#v)"/>
    </svg>`);
    return sharp(knit).composite([{ input: veil }]).toBuffer();
}

async function main() {
    const { data: row, info } = await cutout();
    await sharp(row).toFile(join(OUT_DIR, 'sweater-row.png'));
    await sharp(row).flatten({ background: '#ff00ff' }).toFile(join(OUT_DIR, 'check-row.png'));
    console.log(`sweater-row.png  ${info.width}x${info.height}`);

    // Size to the canvas height, then sit the row against the right edge so the left stays clear for
    // the box cover. A soft contact shadow lifts the sweaters off the blurred knit behind them.
    // Flush to the right edge, no margin: the green sweater is already truncated in the source (it
    // bleeds off the box cover's right edge), so running it off the banner edge too reads as a
    // deliberate bleed instead of a sweater with a slice missing.
    const H_ROW = 356;
    const w = Math.round(H_ROW * info.width / info.height);
    const left = BANNER.width - w;
    const top = Math.round((BANNER.height - H_ROW) / 2);

    const scaled = await sharp(row).resize(w, H_ROW).toBuffer();

    // Build the shadow on a full-canvas layer rather than padding the sweater and offsetting it: the
    // row is nearly as tall as the banner, so a padded shadow would need to be composited at a
    // negative y and sharp rejects that.
    const silhouette = await sharp(scaled)
        .composite([{
            input: { create: { width: w, height: H_ROW, channels: 4,
                               background: { r: 40, g: 20, b: 15, alpha: 1 } } },
            blend: 'in',
        }]).toBuffer();
    const shadow = await sharp({
        create: { width: BANNER.width, height: BANNER.height, channels: 4,
                  background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([{ input: silhouette, left, top }]).blur(12).png().toBuffer();

    await sharp(await backdrop())
        .composite([
            { input: shadow, left: 0, top: 0 },
            { input: scaled, left, top },
        ])
        .jpeg({ quality: 90, mozjpeg: true })
        .toFile(join(OUT_DIR, 'banner.jpg'));
    console.log(`banner.jpg  ${BANNER.width}x${BANNER.height}  row ${w}x${H_ROW} at x=${left}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
