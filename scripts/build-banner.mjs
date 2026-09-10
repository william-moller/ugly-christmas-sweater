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
 *
 * The banner is the box front's own composition and nothing else: its flat green and its four
 * sweaters, no type, no added art, no invented pixels.
 */
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';

const ART_DIR = 'C:/Users/Will/Desktop/Programming/BGA/UglyChristmasSweater/ArtFiles/PANDA PDF';
const OUT_DIR = process.env.BANNER_OUT ?? '.';
const WORK = process.env.BANNER_WORK ?? OUT_DIR;

// --- Source ---------------------------------------------------------------------------------------
// `Front.pdf` is the print box wrap and the only source where all four sweaters are WHOLE. The
// obvious shortcut — `Jpeg/boxcoverfrombgg.jpg` — is a tighter crop of the same art that runs the
// sweaters off its left and right edges, so the lavender sweater loses its whole left sleeve and cuff.
// Mid-banner that crop reads as a sliced sweater, which is what this rebuild exists to fix.
//
// The PDF cannot be read as pixels directly: one page of 18 stacked DeviceCMYK JPEG layers with ZERO
// ICC profiles, and each layer is a flat color field shaped by a soft mask — layer 0 alone is a
// silhouette (its sweater interior is a single CMYK value where the printed cover carries all the
// knit detail). Compositing that by hand is a prepress job, not a scripting one. So we let Windows'
// own PDF renderer do it: `Windows.Data.Pdf` ships with the OS, handles the masks and transparency,
// and returns a flat RGB raster of the real thing. No install, no network.
const PAGE_PNG = join(WORK, 'front-page.png');

/** Rasterise Front.pdf page 1 via the Windows PDF renderer. Cached — it takes a few seconds. */
function renderPage() {
    if (fs.existsSync(PAGE_PNG)) return;
    const ps = join(WORK, '_render-front.ps1');
    fs.writeFileSync(ps, `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$ms = [System.WindowsRuntimeSystemExtensions].GetMethods()
$op = ($ms | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
$ac = ($ms | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.FullName -eq 'Windows.Foundation.IAsyncAction' })[0]
function AwaitOp($o, $t) { $x = $op.MakeGenericMethod($t).Invoke($null, @($o)); $x.Wait(-1) | Out-Null; $x.Result }
function AwaitAct($a) { $x = $ac.Invoke($null, @($a)); $x.Wait(-1) | Out-Null }
$file = AwaitOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${ART_DIR.replace(/\//g, '\\')}\\Front.pdf')) ([Windows.Storage.StorageFile])
$doc  = AwaitOp ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
$page = $doc.GetPage(0)
$opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
$opts.DestinationWidth = [uint32]2569
$stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
AwaitAct ($page.RenderToStreamAsync($stream, $opts))
$size = [int]$stream.Size
$reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
AwaitOp ($reader.LoadAsync($size)) ([uint32]) | Out-Null
$bytes = New-Object byte[] $size
$reader.ReadBytes($bytes)
[System.IO.File]::WriteAllBytes('${PAGE_PNG.replace(/\//g, '\\')}', $bytes)
`);
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps], { stdio: 'inherit' });
    fs.unlinkSync(ps);
}

/** Banner canvas required by BGA's metadata manager. */
const BANNER = { width: 1386, height: 400 };

// The two flat greens. COVER_BG is the published cover's, measured at eight points across
// `Jpeg/boxcoverfrombgg.jpg` and identical at every one. REN_BG is what the Windows renderer makes of
// the same ink. They are two renderings of one CMYK color, and the banner uses the published one.
const COVER_BG = [103, 135, 59];
const REN_BG = [117, 131, 68];

// Per-channel remap pinned to two anchors: white stays white, and the rendered green lands exactly on
// the published green. Deliberately NOT a fitted model — fitting needs pixel-to-pixel pairs between
// the render and the cover, and the two are different compositions (the cover enlarges and overlaps
// the sweaters, the box front spaces them out), so no single transform registers them: the best
// silhouette alignment found was IoU 0.79, and color models fitted on those pairs came back at
// RMS dE 78 and mapped white to green. Two measured anchors and a straight line beat a fitted lie.
const GAIN = [0, 1, 2].map(k => (255 - COVER_BG[k]) / (255 - REN_BG[k]));
const OFF = [0, 1, 2].map(k => 255 - GAIN[k] * 255);

// The sweater row inside the rendered page. The render is the whole box WRAP, so this window has to
// exclude the spine text down each side (the vertical "UGLY CHRISTMAS SWEATERS"), the byline above
// the sweaters and the age/player icons below — the banner must carry no text at all. Verified by
// column/row occupancy scans: the four sweaters are one connected run at x 623..2569, with clear
// background gaps above y 2420 and below y 3120.
const ROW = { x0: 623, x1: 2569, y0: 2420, y1: 3120 };

/**
 * Lift the sweater row off the render's flat background and remap it to the cover's palette.
 *
 * A plain color test is enough here — no flood fill needed, unlike the old cover-crop pipeline. The
 * sweaters on the box front are drawn against one uniform color and none of their own knit comes
 * near it, so there are no trapped pockets to chase and no dark green to protect.
 */
async function cutout() {
    const { data, info } = await sharp(PAGE_PNG).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width;
    const w = ROW.x1 - ROW.x0 + 1, h = ROW.y1 - ROW.y0 + 1;
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const s = ((ROW.y0 + y) * W + (ROW.x0 + x)) * 3, d = (y * w + x) * 4;
            for (let k = 0; k < 3; k++) {
                out[d + k] = Math.max(0, Math.min(255, Math.round(GAIN[k] * data[s + k] + OFF[k])));
            }
            const dr = data[s] - REN_BG[0], dg = data[s + 1] - REN_BG[1], db = data[s + 2] - REN_BG[2];
            out[d + 3] = (dr * dr + dg * dg + db * db) <= 24 * 24 ? 0 : 255;
        }
    }
    return sharp(out, { raw: { width: w, height: h, channels: 4 } })
        .png().trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
}

async function main() {
    renderPage();
    const { data: row, info } = await cutout();
    console.log(`sweater row  ${info.width}x${info.height}`);

    // Sit the row against the RIGHT with a small margin, leaving the left clear for the box cover BGA
    // lays over it. No contact shadow: the cover casts none, and on a flat ground a shadow is the one
    // thing that would announce this as a composite rather than the artwork itself.
    //
    // Unlike the old cover-crop row, nothing here is bled off an edge. Every sweater is whole, so
    // running one off the canvas would re-introduce exactly the cut this rebuild removed. The height
    // is set so the left margin stays wide enough for the box overlay to sit clear of the sweaters.
    const H_ROW = 330, RIGHT_MARGIN = 26;
    const w = Math.round(H_ROW * info.width / info.height);
    const left = BANNER.width - w - RIGHT_MARGIN;
    const top = Math.round((BANNER.height - H_ROW) / 2);

    const scaled = await sharp(row).resize(w, H_ROW).toBuffer();
    await sharp({
        create: {
            width: BANNER.width, height: BANNER.height, channels: 3,
            background: { r: COVER_BG[0], g: COVER_BG[1], b: COVER_BG[2] },
        },
    })
        .composite([{ input: scaled, left, top }])
        .jpeg({ quality: 92, mozjpeg: true })
        .toFile(join(OUT_DIR, 'banner.jpg'));
    console.log(`banner.jpg  ${BANNER.width}x${BANNER.height}  row ${w}x${H_ROW} at x=${left} (left margin ${left})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
