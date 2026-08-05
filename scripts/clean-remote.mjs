/**
 * clean-remote.mjs — remove dev-only files that were mistakenly uploaded to the BGA SFTP server.
 *
 *   node scripts/clean-remote.mjs           (dry run — lists what WOULD be deleted)
 *   node scripts/clean-remote.mjs --yes      (actually delete)
 *
 * Deletes ONLY the explicit allowlist below (dev tooling / build artefacts), never the game files
 * (modules/, img/, misc/, *.css, *.jsonc, dbmodel.sql, LICENCE_BGA, _ide_helper.php, *.d.ts stay).
 * Connection details are read from .vscode/sftp.json so they can't drift.
 */
import Client from 'ssh2-sftp-client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(REPO, '.vscode', 'sftp.json'), 'utf8'));
const remote = cfg.remotePath.replace(/\/$/, ''); // e.g. /uglychristmassweater

// Explicit allowlist of REMOTE paths to remove. Dirs are deleted recursively.
// `src-disabled` is what a Studio project ends up with after `src` has been parked server-side; it is
// our TypeScript/SCSS source sitting on the game server, which the pre-release checklist asks us to
// clear out. Found on the uglychristmassweaters project, carried over when it was copied.
const DIRS = ['node_modules', 'scripts', 'src', 'src-disabled'];
const FILES = [
    'package.json', 'package-lock.json', 'tsconfig.json', 'rollup.config.mjs',
    // BGA's project-template state classes. A new/copied Studio project ships with these, and
    // deploy.mjs uses uploadDir — which adds and overwrites but never REMOVES — so they survive every
    // deploy. They declare state ids that collide with ours, and the collision is fatal at table
    // creation: "Invalid id for state class ... PlayerTurn (already used by another state)". Nothing
    // in the repo references them; they are pure skeleton.
    'modules/php/States/PlayerTurn.php',
    'modules/php/States/NextPlayer.php',
];

const APPLY = process.argv.includes('--yes');

async function main() {
    const sftp = new Client();
    await sftp.connect({
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        privateKey: readFileSync(cfg.privateKeyPath),
    });
    console.log(`Connected to ${cfg.host}:${cfg.port}  remote root: ${remote}`);
    console.log(APPLY ? '\n*** DELETING ***\n' : '\n(dry run — pass --yes to delete)\n');

    for (const d of DIRS) {
        const path = `${remote}/${d}`;
        const type = await sftp.exists(path);
        if (type !== 'd') { console.log(`skip  dir  ${path} (not present)`); continue; }
        if (APPLY) { await sftp.rmdir(path, true); console.log(`DEL   dir  ${path}`); }
        else console.log(`would delete dir   ${path}`);
    }
    for (const f of FILES) {
        const path = `${remote}/${f}`;
        const type = await sftp.exists(path);
        if (type !== '-') { console.log(`skip  file ${path} (not present)`); continue; }
        if (APPLY) { await sftp.delete(path); console.log(`DEL   file ${path}`); }
        else console.log(`would delete file  ${path}`);
    }

    await sftp.end();
    console.log(APPLY ? '\nDone.' : '\nNothing changed (dry run).');
}

main().catch((e) => { console.error(e); process.exit(1); });
