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
const DIRS = ['node_modules', 'scripts', 'src'];
const FILES = ['package.json', 'package-lock.json', 'tsconfig.json', 'rollup.config.mjs'];

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
