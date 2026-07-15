# Ugly Christmas Sweaters — BGA implementation (index)

A Board Game Arena adaptation of **Ugly Christmas Sweaters** by Hunter R. Hennigar (art by Brooklin
Holbrough, publisher H² Games), licensed. Built on the BGA Studio **Modern** framework (PHP state
classes + TypeScript client).

Shared BGA-wide guidance (SFTP/deploy, test tables, framework conventions, never-commit rules) lives
one level up in [`../CLAUDE.md`](../CLAUDE.md) and is inherited automatically. This repo's docs cover
only what's specific to this game.

## Ground rules

1. **Verify, don't trust.** The rulebook PDF, the wiki mirror, *these docs* — all wrong/stale until confirmed against on-disk state or a test table. When a doc disagrees with the code, the code wins.
2. **No status in docs. Git is the status.** No "not yet synced", "current state", "as of <date>". Ask git.
3. **History lives in commit messages, not required reading.** If a session needs history, `git log` it.
4. **Every convention line must have burned us at least once.** If it never bit anyone, cut it.

## Where to find things

| Topic | File |
|-------|------|
| Game rules, components, card data, scoring, variants, Bonus cards | [`.claude/game-rules.md`](.claude/game-rules.md) |
| Framework, state machine, data model, client layout, build | [`.claude/architecture.md`](.claude/architecture.md) |
| Official rulebook (PDF) | [`docs/ugly-christmas-sweater-rules.pdf`](docs/ugly-christmas-sweater-rules.pdf) |
| SFTP/deploy, test tables, framework conventions, PHP-lint scar | [`../.claude/`](../.claude/) (shared) |

## Project facts

- **Framework:** Modern / Studio (PHP state classes + TypeScript client).
- **BGA project name:** `uglychristmassweater` · **SFTP remote path:** `/uglychristmassweater/` (in the gitignored `.vscode/sftp.json`).
- **BGG ID:** `285071` · **publisher BGG ID:** `46595` (both set in `gameinfos.jsonc`).
- **Game options** (`gameoptions.jsonc`): `100` Difficulty (Beginner/Novice/Expert), `101` Game mode (Casual/Express), `102` Bonus cards (Off/On).
- **Build:** `npm run build` (rollup TS + sass SCSS); `npm run watch`. Edit `src/`, never the generated `modules/js/Game.js` / `uglychristmassweater.css`.
- **Deploy:** **`npm run ship`** = build + push the game files to BGA (`build` then `deploy -- --yes`). ⚠️ **Never** use the VS Code `SFTP: Sync Local → Remote` — its ignore is broken on Windows and dumps `node_modules/` onto BGA (see `../.claude/deploy.md`). `npm run deploy` alone does a dry-run; `npm run clean:remote -- --yes` purges stray remote files. If the card art changes, re-run `npm run build:sprites` first.
