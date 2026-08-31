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

### Studio debug helpers (`Game.php`, bottom)

`debug_*` methods appear in the Studio bug-icon menu; see
[`../../.claude/framework.md`](../../.claude/framework.md) for how that menu works and why the
zombie-driven one must stay bounded. What matters here is **which helper reaches which phase**:

| Helper | Kind | Reaches |
|--------|------|---------|
| `debug_playMoves(int $moves = 20)` | zombie-driven | a plausible board — built sweaters, patches to assign. Bounded and capped at 50 on purpose; click it repeatedly. |
| `debug_forceRoundEnd()` | deterministic | the real `TinaTink → AssignPatches → ScoreRound → RoundReview/EndScore` chain |
| `debug_setRound(int)` | deterministic | set to `totalRounds()` so the next scoring pass takes the `EndScore` branch |
| `debug_forceRoundOver()` | deterministic | `ScoreRound` directly — **bypasses TinaTink and AssignPatches**, so it is not a round-end test |
| `debug_goToState(int)` | deterministic | any state; **99 is how you actually end a game** (see below) |
| `debug_addScore(int, int)` | deterministic | a target score without playing to it |

Three things about this game specifically shaped those, each of which cost a round-trip:

- **`debug_forceRoundEnd` empties the per-player piles as well as hands.** `EndTrickCleanup` calls
  `refillHands()` **before** it asks `isRoundOver()`, so emptying hands alone just tops them straight
  back up from the piles and the round carries on.
- **`GameStopped` (97) is the terminus on Studio**, not 98/99, because `preventEndGame` is forced on
  there (`Game.php` constructor). Its `zombie()` is a deliberate no-op, so any `playUntil` predicate
  has to treat **97** as terminal or it spins against the move cap.
- **To make the game genuinely end**, jump to state **99** (`debug_goToState`). That is precisely the
  transition `EndScore` makes when `preventEndGame` is false — `EndScore`'s own work has already run
  by the time you are parked at 97, so nothing is skipped by jumping.

### Zombie play

Every non-`GAME` state has a `zombie()`. Two carry real logic rather than a safe default:

- `PlayCard::zombie` plays a random legal card.
- `DraftCard::zombie` delegates to **`Game::zombieDraftPlacement()`**, which picks the existing
  sweater nearest completion where the card lands *cleanly*, and opens a new build only when none
  qualifies. "Cleanly" is load-bearing: `placeDraftedCard` throws on a patch with no slot, on a
  missing/duplicate/filled floating-patch orientation, and on a Fad-locked build in Express — and a
  `UserException` raised inside a zombie turn surfaces as a **failed skip turn**. It also never takes
  an occupied slot, because that is a silent "place over" that discards the occupant, which a zombie
  has no basis for judging. Originally this passed `build_no = 0` unconditionally, so an abandoned
  player opened a brand-new sweater on every draft and finished with a spread of one-card builds
  worth nothing.

⚠️ Zombie code is **production behaviour** — it runs whenever a real player quits mid-game — so it is
worth eyeballing on a normal table, not only under `debug_playMoves`.

## Data model (`dbmodel.sql`)

A Deck-backed table takes its NAME from `createDeck()`, but its **columns must always be the five
`card_*` ones** — the component's own SQL selects them by those names regardless of table name. So
per-card dynamic extras live in a **separate `card_meta` table**.

- `card` — the 52-card sweater deck via `Deck`. `card_type` = colour, `card_type_arg` = value 1..12 (0 = patch), `card_location_arg` = player_id or pool slot. Locations (the `Game::LOC_*` constants): `deck` is the transient shuffle source used while dealing, **not** a per-player pile — each player's own face-down pile is `pile_<player_id>` (`Game::pileLoc`). The rest are `hand`, `draftpool`, `trick`, `knitting`, `discard`.
- `card_meta` — one row per card for what Deck doesn't manage: `trick_order` (play order for resolution tie-breaks), `build_no` (which sweater), `slot` (`L|R|B`, NULL = floating patch), `wild_value`/`wild_icon` (patch resolution). Read back via `Game::getCardsWithExtras`, which LEFT JOINs it onto `card`. Cleared at round start so stale wild data can't bleed into a re-dealt card.
- `gameplay_card` — a second Deck: Perfect Fit / Trendy Yarn / Fad cards. Locations are `deck_<type>` (face-down pile) and `seen_<type>` (revealed stack, `location_arg` = stack index — the **highest** arg is the active card, see `Game::activeGameplayCard`); Express adds `claimed_fad`, and reuses `seen_fad` as the Fad display.
- `secret_santa` — Deck of the 16 hidden objectives (`box|hand|discard`, arg = owner). Spent cards go to `discard`, never back to `box`, so a card someone has held can't be re-dealt.
- `bonus_card` — Deck of the 4 Special Ability cards (`box|hand|used`, arg = owner); gameoption `102`.
- `player.player_fad_points` — added column; tie-break #2 (total Fad points). Declared `INT UNSIGNED`, which is right (Fad points never go negative) but means **any expression mixing it with the negative `player_score_aux` must `CAST(... AS SIGNED)`** or MySQL evaluates the lot as `BIGINT UNSIGNED` and errors — see [`../../.claude/framework.md`](../../.claude/framework.md).
- Globals (declared in PHP): `round_no`, `leader_player_id`, plus per-feature globals (e.g. `roundResult` for F5-safe review, Billy/Maria/Tina bookkeeping).

`player_score` = cumulative VP (winner metric). `player_score_aux` = tie-break, folded at game end by
`EndScore` into one integer: `-(unbuilt) * TIEBREAK_K + fadPoints`, because BGA ranks on score then
aux and has no third sort column. `unbuilt` **accumulates across all rounds** (`scoreRound` subtracts
each round's total), so it is not a final-round figure.

That composite is unreadable in the results-screen parentheses on its own, so two things decode it:
`gameinfos.jsonc` `tie_breaker_split` asks BGA to display the components separately, and the
`sweaters_unbuilt` stat carries the same number independently of whether the split behaves. See
[`backlog.md`](backlog.md) — the split's handling of a *negative* composite is unverified.

## Statistics (`stats.jsonc`)

One table stat + eleven player stats, all `int`. BGA's pre-alpha checklist requires *meaningful* stats,
which here means the six `points_*` stats decompose the final score along exactly the rows of the
scoring table in [`game-rules.md`](game-rules.md) — so a player can see *where* their VP came from, and
so a scoring bug shows up as a stat that doesn't sum to `player_score`.

| Stat | Scope | Incremented | Notes |
|------|-------|-------------|-------|
| `rounds` | table | `Game.php::scoreRound` | Rounds actually played (1 in Express, up to 3 otherwise). |
| `tricks_won` | player | `States/ResolveTrick.php` | Credited to `$order[0]` — **the top of the resolved Draft Order**. No one "wins" a trick in this game, hence the label "Tricks won (led the draft)". |
| `sweaters_started` / `sweaters_built` / `patches_scored` | player | `Game.php::scoreRound` | Completed-sweater counts; patches counted only in *completed* sweaters, matching the rule that patches in incomplete sweaters never score. |
| `sweaters_unbuilt` | player | `Game.php::scoreRound` | Tie-break #1 in readable form. Incremented from the **same `$unbuilt`** that feeds `player_score_aux`, in the same loop, so the stat and the tie-break cannot drift. Exists because the aux composite is unreadable on the results screen. |
| `points_sweaters` · `points_runs` · `points_fad` · `points_secret_santa` · `points_nonfad_color` · `points_nonfad_icon` | player | `Game.php::scoreRound` | Computed off the same `sweaterParts` walk that awards the VP, deliberately, so the stats and the scored VP cannot drift. Colour and icon are separate stats because non-Fad matches score independently (+1 each) — see the scoring table. |

⚠️ **Mixed stat APIs.** Setup initialises with the **deprecated** `initStat()` (`Game.php:219-232`);
every increment uses the **current** `$this->tableStats->inc()` / `$this->playerStats->inc()`. Both work,
but `initStat`/`setStat`/`incStat` are deprecated in favour of the stat objects (see
[`../../.claude/reference/migration-guide.md`](../../.claude/reference/migration-guide.md)) — worth
noting before you grep for `incStat` and wrongly conclude the stats are never incremented.

## Client (`src/` → build → `modules/js/Game.js`, `uglychristmassweaters.css`)

TypeScript + SCSS. **Edit `src/`, never the generated `modules/js/Game.js` or `uglychristmassweaters.css`**
(overwritten every build).

- `src/ts/Game.ts` — the client entry (rollup `input`); holds selection state and all rendering.
- `src/ts/States/*.ts` — one handler per interactive state (`PlayCard`, `DraftCard`, `RoundReview`, `AssignPatches`, `BillyChoice`, `TinaTink`), imported and registered in `Game.ts`.
- `src/ts/CardView.ts` — card element/tooltip/log-chip/icon-glyph helpers. Faces are painted from the CSS sprite sheet via `.ucs-face-<colour>_<value>` (see `faceSpriteClass`); the printed art carries value/icon/orientation, so the only DOM overlay is a patch's wild-value badge.
- `src/ts/libs.ts` — `BgaAnimations` / `BgaCards` (loaded from BGA at runtime; not bundled).
- `src/ts/types.d.ts` — gamedatas / notif / args types.
- `src/scss/Game.scss` — the single stylesheet.

### Player preferences (`gamepreferences.jsonc`)

Three, all client-side. Only **101** is a layout axis; the other two are behavioural and are easy to
mistake for bugs during a testing sweep, which is why they're listed here rather than only in the jsonc.

| # | Preference | Read in | Applies |
|---|-----------|---------|---------|
| **100** | Confirm before acting — `0` Off / `1` auto-confirm / `2` manual | `Game.ts::confirmMode` → `confirmAction` | live |
| **101** | Card size — Small / Medium / Large → `--ucs-card-scale` | `<html>` `cssPref` class + `Game.ts::setupHandStock` | **needs reload** |
| **102** | Hand sort — draw order / by colour / by icon | `Game.ts::handSortMode` → `handSort` | live, via `userPreferences.onChange` |

**100 is the game's undo.** `confirmAction` wraps *every* interactive action (`PlayCard`, `DraftCard`,
`AssignPatches`, `BillyChoice`, `TinaTink`): it puts a Confirm / **Reset turn** step in the action bar
*before* anything is sent to the server, so Reset discards the whole pending selection with nothing
public. Mode `1` fires Confirm via BGA's native autoclick countdown (abortable); `2` waits for a click;
`0` skips the gate. Two deliberate fallbacks — an unreadable preference and a gate that fails to render
both **act immediately** rather than strand the turn behind a broken gate. Testing implication: "the
card click does nothing" is usually mode `2` waiting for a Confirm, not a dead handler.

**101** is the discrete multiplier on *interactive* card art only; the narrow/wide split reads it too.
Full treatment — including why it is `needReload` and how it interacts with the width floors — is in
[`responsive.md`](responsive.md).

**102** re-sorts the `bga-cards` hand stock in place (`sort:` on the stock, plus a re-sort on every hand
render). Patches have no printed icon, so they sort last in *by icon*.

### Player-panel knitting tally

Each BGA player board carries a per-player read-out of what that player has knitted, injected into the
game-specific div from `this.bga.playerPanels.getElement(playerId)` (`renderPanelTally` in `Game.ts`,
called from `renderPlayers` so it refreshes on setup and after every knitting change). Row 1 is one
valueless swatch per sweater colour, row 2 one chip per icon, each with a running count. A numbered
card counts toward **both** its colour and its icon; a **patch** has a colour but no printed icon, so
it counts toward its colour only and marks that colour's swatch with a capital **P** (there is exactly
one patch per colour, so the P is a boolean flag, not a count). Colours/icons come from
`material.colors` / `material.icons` (server-canonical, `Material::COLORS`/`ICONS`) and all always
render, 0 included, so the grid is stable. Icons sit on a light chip because the icon sprite art has
near-white detail that greys out on a dark panel.

### Layout: narrow vs wide is a class, not a media query

`Game.ts::wideLayoutFloor()` computes **one** viewport width for the session and
`layoutNarrowSidebar()` toggles `#ucs-table.ucs-narrow` at it via `matchMedia`; every narrow rule in
`Game.scss` hangs off that class. This works because both inputs are constant for a session — the
content shape (variant + player count) and the card-size preference, which is `needReload`. The floors
live in that function **only**; don't restate them in CSS. Full derivation and the per-shape table are
in [`responsive.md`](responsive.md).

`layoutNarrowSidebar` also **moves containers by id** — `#ucs-rt-col` and `#ucs-opponents` into a
generated `#ucs-sidebar`, and the wide Secret Santa zone (`#ucs-my-santa` in Express at 3–4P,
`#ucs-secret-santa` in Avid) up into `#ucs-upper` for a full-width grid row. It moves the *containers*,
not their contents, so `renderRoundTracker()` (targets `#ucs-rt-col`) and the opponent tables keep
working wherever those containers currently live. It is idempotent and safe to re-run.

Two traps this cost us, both live in the code comments too:

- A zone lifted out of `#ucs-board-strip` loses that query container, so it has to become one itself —
  and the `cqi` sizing then has to move onto its **child**, because container-query units resolve
  against an *ancestor* container, never the element carrying `container-type`.
- Anything inside a `@media (min-width: …)` block that styles the wide layout needs `:not(.ucs-narrow)`.
  Those blocks carry an extra `html` element selector, so they out-specify the class-based narrow rules
  and win inside the overlap band — which now exists for every shape whose floor is above 1000.

### Round-end patch assignment (`beginAssignPatches`)

`AssignPatches` is `MULTIPLE_ACTIVE_PLAYER`, so on the JS side you are **not** flagged active during
`onEnteringState` — gating on `isCurrentPlayerActive` there always bails. The server args say which
patches are whose, so the client drives off that instead.

Patches are resolved **one at a time**: only `assignPending[0]` glows and gets the inline value/icon
picker, the rest carry a static dashed marker, and the status bar counts down. The picker popover is
absolutely positioned to the right of its sweater, so rendering one per pending patch hid the very
cards still to be assigned. Confirming sends `actAssignPatch`, drops that patch and re-renders, which
brings up the next.

### Round-end scoring summary (`renderRoundSummary`)

One overlay, two modes. In `RoundReview` it is **modal** and its Okay acknowledges (`actContinueRound`),
which is what lets the next round deal; the action bar carries a **Continue** button wired to the same
handler, so a minimized sheet never has to be reopened to say you're ready. After the **final** round
there is no `RoundReview` state at all — `ScoreRound` returns `EndScore` directly — so nothing is gated
and the sheet renders **modeless** (`renderRoundSummary(args, undefined, false)`): no backdrop, and
`pointer-events` pass through everywhere except the sheet, leaving the end-of-game screen live.

`setRoundSummaryMinimized()` shrinks the sheet into a restore chip parked in bga-help's lower-left
strip (so it inherits that strip's pinning and can't land on the "?" button). That strip is `position:
sticky` inside `#left-side`, not `fixed` — a viewport-pinned button reaches BGA's own site footer, which
is what the public-alpha review rejected; sticky floats identically but stops at the play zone's bottom. `display: none` can't be animated,
so a **timer** applies it after the shrink plays — `SHEET_ANIM_MS` and `$ucs-sheet-anim` must stay in
step. A timer rather than `animationend`, so a browser that suppresses the animation still lands in the
right state; and `hideRoundSummary()` clears that timer, or an Okay mid-minimize strands the chip.

### Client animations

Five helpers in `Game.ts`, all of which no-op when `bgaAnimationsActive()` is false and all of which
follow the same shape: **re-render first, animate second.** The destination element is already at its
final spot, so the animation transforms it back to where it came from and transitions that away. Any
new one must respect both rules.

| Helper | Used for | Motion |
|--------|----------|--------|
| `flipCardFrom(el, rect, secs)` | one card arriving from a known place — play, draft | FLIP from a captured rect (`translate` + `scale`, deltas ÷ tabletop scale) |
| `flipFromRects(rects, secs)` | a set of cards re-arranging — trick collection (2s, via `animateTradeToPool`), Tina's rearrange (0.6s) | batch FLIP, resolving `ucs-card-<id>` then `ucs-mini-<id>` |
| `revealFlip(el, secs)` | a round parameter changing | half flip in from edge-on + `.ucs-gp-revealing` glow |
| `fadeCardOut(el, secs)` | a card leaving to nowhere visible — Billy's discard | shrink + fade, run **before** the model drops it |
| `handStock.addCards(…, {fromElement})` | cards entering the fan — refill, new-round deal | bga-cards' own slide, 80ms stagger |

**Why `revealFlip` is a HALF flip.** `gameplayFaceEl` draws the revealed parameter alone, with no draw
pile beside it, and `renderGameplay` rebuilds the row via `innerHTML` — so there is nothing to fly from
*and* no old face left to turn away. The new face turns in from edge-on instead. Don't "fix" it into a
full flip without first giving the row a second face to flip from.

**Parameter changes are detected by diffing, not announced.** `gpActiveIds()` snapshots the active card
id per single-face deck before a re-render; `revealChangedParameters(before)` flips whichever changed.
One mechanism covers both triggers — Express's mid-round rotations (Trendy Yarn every
`trendyRotateEvery()` tricks, Perfect Fit when a matching card was played; `EndTrickCleanup`) and the
fresh reveal at a round boundary, which is the only path Casual and Avid take. It is `await`ed so two
rotations landing on the same trick play in sequence. Express renders its Fads as a multi-card display,
so `ucs-gp-face-fad` doesn't exist there and the Fad flip silently no-ops — which is why claiming a Fad
doesn't flash the row.

`gameplayCardEl`'s optional `domId` pins those `ucs-gp-face-<type>` ids. It **must** be applied before
`addTip`: `gpId()` only generates an id when the element hasn't got one, and the tooltip binds by the id
it was handed, so setting the id afterwards breaks parameter-card tooltips.

The origin of a **card played from my hand** (`notif_cardPlayed` → Trade Area) is snapshotted **when

The origin of a **card played from my hand** (`notif_cardPlayed` → Trade Area) is snapshotted **when
I confirm the play**, not read in the notification handler. By the time the notif fires,
`disablePlayable` has run and the floating `HandStock` has toggled back to attached (see the
float↔attach note in `Game.scss` around `#ucs-my-hand-row`), so the card has moved — reading it then
launches the flight from the wrong place (it "snaps" to a fallback centre first). So
`completePlay`'s submit closure stores the rect in `playFromRect[cardId]` and `notif_cardPlayed`
consumes it. Read a hand card's rect via **`handCardRect(card)`**, which calls
`handStock.getCardElement(card)` — **never** a hand-built element id (bga-cards prefixes ids with the
manager `type`; see [`../../.claude/framework.md`](../../.claude/framework.md)). Opponents' plays have
no snapshot; they launch from the player-panel centre (`cardRectAtCenter`), which is also the fallback
if the snapshot is missing (e.g. an F5 mid-flight).

## Build / toolchain

TypeScript + SCSS are enabled (`package.json`):
- `npm run build` = `build:ts` (**rollup** compiles `src/ts/Game.ts` → `modules/js/Game.js`, ES format, `inlineDynamicImports`, `treeshake:false` — see `rollup.config.mjs`) + `build:scss` (**sass** compiles `src/scss/Game.scss` → `uglychristmassweaters.css`).
- `npm run watch` — rebuild both on save during development.
- `node_modules/` is gitignored; `package-lock.json` is committed.

`npm run ship` = build + deploy in one step, which is the normal way to get a change onto BGA. The two
generated artifacts are **not** covered by `uploadOnSave`, so a plain build leaves the server stale —
see [`../../.claude/deploy.md`](../../.claude/deploy.md), and never use the VS Code
`SFTP: Sync Local → Remote` (its ignore is broken on Windows and uploads `node_modules/`).

### Card-face sprites (`scripts/build-sprites.mjs`, `npm run build:sprites`)

The 52 sweater/patch faces are packed into one CSS sprite (`img/sweaters.jpg`, a 4×13 grid: row =
colour, col = value 0..12 with 0 = patch) plus a shared `img/card-back.jpg`; the script also emits the
GENERATED `src/scss/_sweater-sprites.scss` (one `.ucs-face-<colour>_<value>` position class per card).
Its input is the publisher PNGs (path hard-coded in the script) mapped by the card→file table verified
against `Material::FACES`. The emitted SCSS partial *is* committed, so the CSS builds on a fresh
checkout even though the art doesn't ship — see **Regenerating the art** below. Uses the `sharp`
dev-dependency. The script trims the
~37.5px print bleed off the 750×1125 PNGs (→ 675×1050, a **bridge card**, ratio **0.643**) so the sweater
art reaches the card edge; all six `--ucs-card-w/h` contexts in `Game.scss` are kept at that 0.643 ratio.

The Stage-2 (non-sweater) cards are packed the same way by `scripts/build-secondary-sprites.mjs` into
`img/secondary.jpg` (8×7 grid) + the GENERATED `src/scss/_secondary-sprites.scss` (one `.ucs-<key>`
position class per face; base class `.ucs-art2`). Covers Perfect Fit (`ucs-gp-perfectfit-<1..6>`),
Trendy Yarn (`ucs-gp-trendyyarn-<colour>`), Fad (`ucs-gp-fad-<1..10>`), Secret Santa (`ucs-santa-<1..16>`),
Bonus (`ucs-bonus-<1..4>`), Draft Order (`ucs-draftorder-<1..4>`), Score Reference, Round Tracker, plus each
deck's back. Consumers (`Game.ts`) add `.ucs-art2` + the
face class to a `.ucs-card`-sized element; Secret Santa cards are turned `rotate(90deg)` (the art is drawn
to read in landscape). The publisher source PNGs were renamed to systematic names (`scripts/rename-art.mjs`,
reversible via `--reverse`), so the build maps read plainly (e.g. `fad-05-red-candycane.png`).

**Fad deck (verified from art):** 10 physical cards = 8 distinct colour+icon fads + "Clash Is In" ×2. Each
colour appears on two cards paired with a *different* icon (NOT one tidy colour⇄icon pair ×2). See
`Material::fads()`.

### Sweater-icon sprites (`scripts/build-icons.mjs`, `npm run build:icons`)

The third generator run by `build:sprites`. It bakes the four sweater icons (snowman / candy cane / bell / tree) into one transparent
`img/icons.png` (4 × 128px square cells) plus the GENERATED `src/scss/_icon-sprites.scss` (`.ucs-icon`
base + one class per icon), consumed wherever an icon appears outside printed card art — the patch
wild-value badge, the `AssignPatches` picker, the player-panel tally.

Two constraints that are baked into the script and must not be undone in CSS:

- The source PNGs sit each icon on a pale watercolour rectangle, which the script keys out by
  colour-distance from the sampled corner. What survives has **near-white detail** (snowman body, candy
  cane stripes), so these must be shown on a **light** chip — on a dark surface they grey out. This is
  the same constraint the panel tally notes above.
- The snowman's linework is thin enough to anti-alias back to light grey at the ~20–40px it renders, so
  the script darkens strokes away from white (`boost`) and thickens them (`thicken`) **at source
  resolution**. A CSS `filter: brightness()` greys the body and `contrast()` lightens the above-midpoint
  strokes, so neither can substitute — if an icon reads badly, fix it in the script and re-run.

### Regenerating the art (fresh checkout)

`img/` is **gitignored** (publisher IP), so a fresh clone has no art at all. The generated SCSS partials
*are* committed, so `npm run build` succeeds — you just get empty/broken backgrounds until the sprites
are rebuilt. All three generators read the same hard-coded publisher `ART_DIR` (a local path outside the
repo), so this only works on a machine that has the art:

```
npm run build:sprites   # img/sweaters.jpg + img/card-back.jpg + img/secondary.jpg + img/icons.png
```

`build:sprites` runs **all three** generators, so it is the only command needed to rebuild the art.
`build:icons` remains as its own script purely for iterating on the icon keying (`boost`/`thicken`),
which is slow and rarely needed — it is not a step you have to remember.

Supporting one-offs, neither wired to an npm script:

- `scripts/rename-art.mjs` — renamed the publisher PNGs to systematic names; reversible via `--reverse`.
- `scripts/analyze-bleed.mjs` — how the ~37.5px print bleed above was *derived* (scans inward from each
  edge of sample cards for the frame line). Re-run it if the publisher ever reissues the art at a
  different trim, rather than nudging the constant.
- `scripts/sprite-preview.html` — opens the built sheets straight from disk (relative paths, no BGA) to
  eyeball every generated face at once. Fastest check that a sprite rebuild landed correctly.
- `scripts/build-banner.mjs` — composes the BGA metadata **banner** (1386×400 JPG, no text) from the
  box-front art. Not a game asset and not deployed: the banner is uploaded by hand through BGA's Game
  Metadata Manager. Writes beside the repo (`BANNER_OUT` to redirect) and its JPG must never be
  committed.
