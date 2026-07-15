# Ugly Christmas Sweaters — architecture

How this repo is built. Framework-agnostic BGA facts (Deck component, notifications, zombie rule,
the PHP-lint scar) are in [`../../.claude/framework.md`](../../.claude/framework.md). The rules this
code implements are in [`game-rules.md`](game-rules.md).

> This doc is written from on-disk state. If it disagrees with the code, the code wins — re-read the
> files (state `id:`/`type:` in each `modules/php/States/*.php`, the transitions returned from
> `onEnteringState`, `dbmodel.sql`, `package.json`) and fix this doc.

## Framework

**Modern / Studio.** PHP **state classes** (one per file, `modules/php/States/*.php`, each extending
`Bga\GameFramework\States\GameState` with an `id`, a `StateType`, and `#[PossibleAction]` methods)
plus a **TypeScript** client that generates the HTML in `setup()` and registers per-state handlers.
No Smarty templates, no dojo.

## Server layout (`modules/php/`)

- `Game.php` — core logic: setup, the Deck instances, all the shared helpers the states call (dealing, trick resolution, scoring, patch/bonus logic, notifications).
- `Material.php` — static card data (`FACES`, Perfect Fit / Trendy Yarn / Fads, Secret Santa, bonus cards). No dynamic state.
- `States/*.php` — the state machine (below).

## State machine

Each state declares an `id` and `StateType` (`GAME` = automatic, no player input; `ACTIVE_PLAYER`;
`MULTIPLE_ACTIVE_PLAYER`). Transitions are the next state **class** returned from `onEnteringState`
or an action method. Verified list (`id` · type · role · → next):

| State | id | Type | Role | → |
|-------|---:|------|------|---|
| `NewRound` | 5 | GAME | Deal a round: carry over the 4 pool cards, reshuffle & re-deal the rest, refill hands, flip gameplay cards, deal Secret Santa | `PlayCard` |
| `PlayCard` | 10 | ACTIVE | Active player leads/follows one card into the trick (patch-copy sub-flow when leading a patch) | `NextInTrick` |
| `NextInTrick` | 20 | GAME | More players still to play this trick? | `PlayCard` / `ResolveTrick` |
| `ResolveTrick` | 30 | GAME | Rank the played cards into Draft Order (Perfect Fit → Trendy Yarn → value; later-played wins ties) | `BillyChoice` |
| `BillyChoice` | 35 | ACTIVE | If a *Billy's a Brute* owner can jump the draft, prompt Play/Pass; else pass straight through | `DraftCard` |
| `DraftCard` | 40 | ACTIVE | Active drafter picks a Draft Pool card and places/orients it in their Knitting Area (patch & Maria sub-flows) | `NextDrafter` |
| `NextDrafter` | 50 | GAME | More drafters left in this Draft Order? | `DraftCard` / `EndTrickCleanup` |
| `EndTrickCleanup` | 60 | GAME | Rotate Trade Area → Draft Pool, redraw hands; is the round over? | `PlayCard` / `TinaTink` |
| `TinaTink` | 62 | MULTI | *Tina Can Tink* owner may move/swap a placed piece before scoring | `AssignPatches` |
| `AssignPatches` | 65 | MULTI | Players assign a value+icon to each wild patch in a completed sweater | `ScoreRound` |
| `ScoreRound` | 70 | GAME | Score the round (public bonuses + Secret Santa + Little Brothers); was it the last round? | `RoundReview` / `EndScore` |
| `RoundReview` | 75 | MULTI | All players acknowledge the scoring-summary overlay | `NewRound` |
| `EndScore` | 98 | GAME | Fold tie-break keys into `score_aux`, then end | `GameStopped` / framework end |
| `GameStopped` | 97 | ACTIVE | Terminal/hold state (zombie handler only) | — |

The per-trick loop is `PlayCard ↔ NextInTrick → ResolveTrick → BillyChoice → DraftCard ↔ NextDrafter
→ EndTrickCleanup`, looping back to `PlayCard` until the round ends, then
`TinaTink → AssignPatches → ScoreRound → RoundReview → NewRound` (or `EndScore` after the last round).

## Data model (`dbmodel.sql`)

The Deck component **auto-creates the `card` table with exactly its 5 standard columns and ignores
extra columns** — so per-card dynamic extras live in a **separate `card_meta` table**.

- `card` — the 52-card sweater deck via `Deck`. `card_type` = colour, `card_type_arg` = value 1..12 (0 = patch), `card_location` ∈ `deck|hand|draftpool|trick|knitting|discard`, `card_location_arg` = player_id or pool slot. Each player has their own face-down `deck` pile keyed by player_id.
- `card_meta` — one row per card for what Deck doesn't manage: `trick_order` (play order for resolution tie-breaks), `build_no` (which sweater), `slot` (`L|R|B`), `wild_value`/`wild_icon` (patch resolution). Cleared at round start so stale wild data can't bleed into a re-dealt card.
- `gameplay_card` — a second Deck: Perfect Fit / Trendy Yarn / Fad cards, flipped to `active` per round.
- `secret_santa` — Deck of the 16 hidden objectives (`box|hand|completed`, arg = owner).
- `bonus_card` — Deck of the 4 Special Ability cards (`box|hand|used`, arg = owner); gameoption `102`.
- `player.player_fad_points` — added column; tie-break #2 (total Fad points).
- Globals (declared in PHP): `round_no`, `leader_player_id`, plus per-feature globals (e.g. `roundResult` for F5-safe review, Billy/Maria/Tina bookkeeping).

`player_score` = cumulative VP (winner metric). `player_score_aux` = tie-break, set at game end by
`EndScore` as a composite of fewest-unbuilt-sweaters then Fad points.

## Client (`src/` → build → `modules/js/Game.js`, `uglychristmassweater.css`)

TypeScript + SCSS. **Edit `src/`, never the generated `modules/js/Game.js` or `uglychristmassweater.css`**
(overwritten every build).

- `src/ts/Game.ts` — the client entry (rollup `input`); holds selection state and all rendering.
- `src/ts/States/*.ts` — one handler per interactive state (`PlayCard`, `DraftCard`, `RoundReview`, `AssignPatches`, `BillyChoice`, `TinaTink`), imported and registered in `Game.ts`.
- `src/ts/CardView.ts` — card element/tooltip/log-chip/icon-glyph helpers. Faces are painted from the CSS sprite sheet via `.ucs-face-<colour>_<value>` (see `faceSpriteClass`); the printed art carries value/icon/orientation, so the only DOM overlay is a patch's wild-value badge.
- `src/ts/libs.ts` — `BgaAnimations` / `BgaCards` (loaded from BGA at runtime; not bundled).
- `src/ts/types.d.ts` — gamedatas / notif / args types.
- `src/scss/Game.scss` — the single stylesheet.

## Build / toolchain

TypeScript + SCSS are enabled (`package.json`):
- `npm run build` = `build:ts` (**rollup** compiles `src/ts/Game.ts` → `modules/js/Game.js`, ES format, `inlineDynamicImports`, `treeshake:false` — see `rollup.config.mjs`) + `build:scss` (**sass** compiles `src/scss/Game.scss` → `uglychristmassweater.css`).
- `npm run watch` — rebuild both on save during development.
- `node_modules/` is gitignored; `package-lock.json` is committed.

After a build, the two generated artifacts must be SFTP-synced manually — see
[`../../.claude/deploy.md`](../../.claude/deploy.md) (`uploadOnSave` does not cover build output).

### Card-face sprites (`scripts/build-sprites.mjs`, `npm run build:sprites`)

The 52 sweater/patch faces are packed into one CSS sprite (`img/sweaters.jpg`, a 4×13 grid: row =
colour, col = value 0..12 with 0 = patch) plus a shared `img/card-back.jpg`; the script also emits the
GENERATED `src/scss/_sweater-sprites.scss` (one `.ucs-face-<colour>_<value>` position class per card).
Its input is the publisher PNGs (path hard-coded in the script) mapped by the card→file table verified
against `Material::FACES`. `img/` is **gitignored** (publisher IP), so on a fresh checkout the sprites
must be regenerated with `npm run build:sprites` before the art will show; the emitted SCSS partial *is*
committed so the CSS still builds without the art. Uses the `sharp` dev-dependency. The script trims the
~37.5px print bleed off the 750×1125 PNGs (→ 675×1050, a **bridge card**, ratio **0.643**) so the sweater
art reaches the card edge; all six `--ucs-card-w/h` contexts in `Game.scss` are kept at that 0.643 ratio.
