/**
 * rename-art.mjs — ONE-TIME (re-runnable) rename of the publisher's opaque source PNGs to clear,
 * semantic names, so the sprite-build maps read plainly. The art lives OUTSIDE the repo (ART_DIR) and
 * is never committed/deployed — only the packed sprite sheets ship — so this touches build inputs only.
 *
 *   node scripts/rename-art.mjs            (dry run — validate + print the old->new manifest)
 *   node scripts/rename-art.mjs --apply     (perform the rename in place)
 *   node scripts/rename-art.mjs --reverse   (undo: rename new -> old, if a mistake slips through)
 *
 * The mapping below is the verified card->file decode (cross-checked against Material.php and the
 * rendered sprite sheet on 2026-07-15). After --apply, update the source basenames in build-sprites.mjs
 * and build-secondary-sprites.mjs to the new names, rebuild sprites, and confirm the sheets are
 * byte-identical (same pixels in the same order == rename proven correct).
 */
import { readdirSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ART_DIR = 'C:/Users/Will/Desktop/Programming/BGA/UglyChristmasSweater/ArtFiles/PANDA PDF/Jpeg';
const pad2 = (n) => String(n).padStart(2, '0');

// --- Sweater cards (from build-sprites.mjs MAP): target = sweater-<color>-<NN|patch>, back = sweater-back
const SWEATER_MAP = {
    green:  { 0: 'PANDA Patches3', 1: 'bells9', 2: 'bells8', 3: 'bells7', 4: 'snowman9', 5: 'snowman8', 6: 'snowman7', 7: 'candycane9', 8: 'candycane8', 9: 'candycane7', 10: 'trees9', 11: 'trees8', 12: 'trees7' },
    red:    { 0: 'PANDA Patches',  1: 'trees10', 2: 'trees11', 3: 'trees12', 4: 'bells10', 5: 'bells11', 6: 'bells12', 7: 'snowman10', 8: 'snowman11', 9: 'snowman12', 10: 'candycane10', 11: 'candycane11', 12: 'candycane12' },
    yellow: { 0: 'PANDA Patches4', 1: 'snowman4', 2: 'snowman5', 3: 'snowman6', 4: 'candycane4', 5: 'candycane5', 6: 'candycane6', 7: 'trees4', 8: 'trees5', 9: 'trees6', 10: 'bells4', 11: 'bells5', 12: 'bells6' },
    purple: { 0: 'PANDA Patches2', 1: 'candycane3', 2: 'candycane2', 3: 'candycane', 4: 'trees3', 5: 'trees2', 6: 'trees', 7: 'bells3', 8: 'bells2', 9: 'bells', 10: 'snowman3', 11: 'snowman2', 12: 'snowman' },
};

// --- Secondary cards: [oldBasename, newBasename] (order/keys mirror build-secondary-sprites.mjs) ---
const SECONDARY = [
    ['PANDA Perfect Fit 1', 'perfectfit-1'], ['PANDA Perfect Fit 12', 'perfectfit-2'],
    ['PANDA Perfect Fit 13', 'perfectfit-3'], ['PANDA Perfect Fit 14', 'perfectfit-4'],
    ['PANDA Perfect Fit 15', 'perfectfit-5'], ['PANDA Perfect Fit 16', 'perfectfit-6'],
    ['PANDA Perfect Fit 17', 'perfectfit-back'],
    ['PANDA Trendy Yarn 2', 'trendyyarn-yellow'], ['PANDA Trendy Yarn 22', 'trendyyarn-green'],
    ['PANDA Trendy Yarn 23', 'trendyyarn-red'], ['PANDA Trendy Yarn 24', 'trendyyarn-purple'],
    ['PANDA Trendy Yarn 25', 'trendyyarn-back'],
    ['PANDA fads 3', 'fad-01-yellow-bells'], ['PANDA fads 37', 'fad-02-yellow-snowmen'],
    ['PANDA fads 32', 'fad-03-purple-snowmen'], ['PANDA fads 38', 'fad-04-purple-bells'],
    ['PANDA fads 33', 'fad-05-red-candycane'], ['PANDA fads 39', 'fad-06-red-trees'],
    ['PANDA fads 34', 'fad-07-green-trees'], ['PANDA fads 310', 'fad-08-green-candycane'],
    ['PANDA fads 35', 'fad-09-clash'], ['PANDA fads 36', 'fad-10-clash'], ['PANDA fads 311', 'fad-back'],
    ['PANDA secret santa16', 'santa-01-aunt-jo-ann'], ['PANDA secret santa12', 'santa-02-baby-bro-mads'],
    ['PANDA secret santa11', 'santa-03-boisterous-barley'], ['PANDA secret santa9', 'santa-04-aunt-bleu'],
    ['PANDA secret santa10', 'santa-05-indiana-alex'], ['PANDA secret santa13', 'santa-06-cousin-veny'],
    ['PANDA secret santa15', 'santa-07-spoon'], ['PANDA secret santa', 'santa-08-auntie-jennifer'],
    ['PANDA secret santa7', 'santa-09-grandpa-tony'], ['PANDA secret santa4', 'santa-10-brainy-bytes-bryan'],
    ['PANDA secret santa5', 'santa-11-sister-rain'], ['PANDA secret santa6', 'santa-12-lovely-leia'],
    ['PANDA secret santa14', 'santa-13-uncle-phil'], ['PANDA secret santa2', 'santa-14-ravishing-rosemary'],
    ['PANDA secret santa3', 'santa-15-cousin-rami'], ['PANDA secret santa8', 'santa-16-auntie-jaimie'],
    ['PANDA secret santa17', 'santa-back'],
    ['PANDA bonus cards', 'bonus-1-little-brothers'], ['PANDA bonus cards2', 'bonus-2-tina'],
    ['PANDA bonus cards3', 'bonus-3-maria'], ['PANDA bonus cards4', 'bonus-4-billy'],
    ['PANDA bonus cards5', 'bonus-back'],
    ['PANDA 1234', 'draftorder-1'], ['PANDA 12342', 'draftorder-2'],
    ['PANDA 12343', 'draftorder-3'], ['PANDA 12344', 'draftorder-4'],
    ['PANDA 12345', 'scoreref'], ['PANDA 12349', 'roundtracker'], ['PANDA 123410', 'aid-back'],
    // The score-reference card is printed 4x; only 'scoreref' is used, keep the spares clearly labelled.
    ['PANDA 12346', 'scoreref-spare-2'], ['PANDA 12347', 'scoreref-spare-3'], ['PANDA 12348', 'scoreref-spare-4'],
];

// Build the full old->new list.
const pairs = [];
for (const [color, byVal] of Object.entries(SWEATER_MAP)) {
    for (const [v, oldBase] of Object.entries(byVal)) {
        const val = Number(v);
        pairs.push([oldBase, `sweater-${color}-${val === 0 ? 'patch' : pad2(val)}`]);
    }
}
pairs.push(['PANDA Patches5', 'sweater-back']);
for (const [o, n] of SECONDARY) pairs.push([o, n]);

const REVERSE = process.argv.includes('--reverse');
const APPLY = process.argv.includes('--apply') || REVERSE;

function validate(from) {
    const froms = new Set(), tos = new Set(), problems = [];
    for (const [o, n] of pairs) {
        const [a, b] = REVERSE ? [n, o] : [o, n];
        if (froms.has(a)) problems.push(`duplicate source: ${a}`);
        if (tos.has(b)) problems.push(`duplicate target: ${b}`);
        froms.add(a); tos.add(b);
        if (!existsSync(join(ART_DIR, `${a}.png`))) problems.push(`missing source file: ${a}.png`);
    }
    return problems;
}

function main() {
    const problems = validate();
    console.log(`Art dir: ${ART_DIR}`);
    console.log(`${pairs.length} files to ${REVERSE ? 'REVERSE-rename (new->old)' : 'rename (old->new)'}${APPLY ? '' : '  [dry run]'}\n`);
    for (const [o, n] of pairs) {
        const [a, b] = REVERSE ? [n, o] : [o, n];
        console.log(`  ${a}.png  ->  ${b}.png`);
    }
    if (problems.length) {
        console.error(`\n!! ${problems.length} problem(s):\n` + problems.map(p => '   - ' + p).join('\n'));
        process.exit(1);
    }
    if (!APPLY) { console.log('\nValidation OK. Re-run with --apply to rename (or --reverse to undo).'); return; }
    let done = 0;
    for (const [o, n] of pairs) {
        const [a, b] = REVERSE ? [n, o] : [o, n];
        renameSync(join(ART_DIR, `${a}.png`), join(ART_DIR, `${b}.png`));
        done++;
    }
    console.log(`\nRenamed ${done} files.`);
}

main();
