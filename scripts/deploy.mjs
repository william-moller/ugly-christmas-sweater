/**
 * deploy.mjs — reliable, allowlist-based deploy to the BGA SFTP server.
 *
 *   node scripts/deploy.mjs            (dry run — lists what WOULD upload)
 *   node scripts/deploy.mjs --yes       (actually upload)   |  npm run deploy -- --yes
 *
 * WHY THIS EXISTS: the vscode-sftp "Sync Local -> Remote" command's `ignore` filter is broken on
 * Windows (it feeds node-ignore backslash paths, which never match), so a full Sync dumps
 * node_modules/, scripts/, src/ etc. onto BGA. This uploads ONLY the game files BGA needs — the same
 * set the reference games deploy — and nothing else. Run it after `npm run build`.
 *
 * (Individual-file `uploadOnSave` in VS Code is still fine; it's only the full Sync that's unsafe.)
 */
import Client from 'ssh2-sftp-client';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(REPO, '.vscode', 'sftp.json'), 'utf8'));
const remote = cfg.remotePath.replace(/\/$/, '');

// The allowlist of what BGA needs (mirrors the reference games' deployed file set). Anything not
// listed here — node_modules, scripts, src, package.json, tsconfig, rollup config — never uploads.
const DIRS = ['modules', 'img', 'misc'];
// Note: the bga-*.d.ts TypeScript typedefs are intentionally NOT deployed — BGA never uses them,
// and the server denies overwriting them. They stay local (build-time only).
const FILES = [
    'uglychristmassweater.css',
    'gameinfos.jsonc', 'gameoptions.jsonc', 'gamepreferences.jsonc', 'stats.jsonc',
    'dbmodel.sql', 'LICENCE_BGA', '_ide_helper.php',
];

const APPLY = process.argv.includes('--yes');

async function main() {
    const present = { dirs: DIRS.filter(d => existsSync(join(REPO, d))), files: FILES.filter(f => existsSync(join(REPO, f))) };
    console.log(`Deploy target: ${cfg.host}:${cfg.port}  ${remote}`);
    console.log(APPLY ? '\n*** UPLOADING ***\n' : '\n(dry run — pass --yes to upload)\n');
    for (const d of present.dirs) console.log(`  dir   ${d}/  ->  ${remote}/${d}/`);
    for (const f of present.files) console.log(`  file  ${f}`);

    if (!APPLY) { console.log('\nNothing uploaded (dry run).'); return; }

    const sftp = new Client();
    await sftp.connect({ host: cfg.host, port: cfg.port, username: cfg.username, privateKey: readFileSync(cfg.privateKeyPath) });
    for (const d of present.dirs) { await sftp.uploadDir(join(REPO, d), `${remote}/${d}`); console.log(`UP   ${d}/`); }
    for (const f of present.files) { await sftp.fastPut(join(REPO, f), `${remote}/${f}`); console.log(`UP   ${f}`); }
    await sftp.end();
    console.log('\nDeployed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
