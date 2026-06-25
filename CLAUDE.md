# Ugly Christmas Sweater — BGA Implementation

A Board Game Arena adaptation of **Ugly Christmas Sweaters** by Hunter R. Hennigar (art by Brooklin Holbrough), licensed. Built on the BGA Studio framework.

> Shared BGA-wide guidance (SFTP, test tables, zombie mode, PHP notes, framework conventions, file roles) lives one level up in `../CLAUDE.md` and is inherited automatically. This file covers only what is specific to *this* game.

## Game Overview

- **Type:** Card game — combines **trick-taking** (called the *Trade Phase*), **card drafting**, and **set collection / tableau building** (called the *Knit Phase*).
- **Players:** 2–4 (4-player is the base game; 2- and 3-player are variants).
- **Length:** 3 rounds (Casual). Highest cumulative VP after round 3 wins.
- **Rules source:** [`docs/ugly-christmas-sweater-rules.pdf`](docs/ugly-christmas-sweater-rules.pdf) · BGG rulebook: https://boardgamegeek.com/filepage/186495/ugly-christmas-sweaters-rulebook-10
- **Core loop:** each round is a series of **tricks**; every trick is `Trade (play 1 card each) → resolve into Draft Order → Draft 1 card each from the Draft Pool → place it into your Knitting Area`. Repeat until a player completes their 3rd sweater (or hands run out), then score.

## Components & Card Data

| Count | Card | Notes |
|------:|------|-------|
| 52 | **Sweater Cards** | The main deck. See composition below. |
| 16 | **Secret Santa** | Hidden per-player objectives (colour + icon requirement). Worth **3 VP**. |
| 10 | **Fad** | Round-wide bonus-scoring parameter (gameplay card #3). |
| 6 | **Perfect Fit** | "Super trump" number (gameplay card #1). |
| 4 | **Trendy Yarn** | Trump colour (gameplay card #2). |
| 4 | **Special Ability / Bonus** | Optional Kickstarter mini-expansion (see Bonus Cards). |
| 4 | **Score Reference** | Player aid (UI only). |
| 4 | **Draft Order** | Numbered 1–4; mark turn/draft order. |
| 1 | **Round Tracker** | Express variant only. |

**Sweater Card anatomy** — each card has four attributes:
- **Value:** 1–12, ranked high→low (**12 strongest, 1 weakest**), unless modified by Perfect Fit / Trendy Yarn.
- **Colour:** Purple, Red, Green, or Yellow (each colour also has a distinct pattern for colour-blind accessibility — replicate in the UI).
- **Icon:** Snowmen, Candy Canes, Bells, or Trees.
- **Orientation:** Left / Right / Bottom (L/R/B) — which third of a sweater this piece is. Shown on the "Christmas light" under the number.

**Card art & sweater layout (spec'd 2026-06-24, from publisher card photo).** Each card depicts one third of a knitted sweater so that the three orientations assemble into one continuous garment:
- **L** = upper-left third (left shoulder/sleeve + left of the body). **R** = upper-right third (right shoulder/sleeve + right of the body). **B** = the lower third (waist/hem band), drawn to sit centred *beneath* L and R.
- A completed sweater therefore lays out as a silhouette — **L and R side-by-side on top, B centred across the bottom**:
  ```
  [L][R]
   [ B ]
  ```
- Each card shows its **value in the top-left corner** with the **icon string ("Christmas light")** running just beneath the number; the rest of the card is the sweater artwork for that third.
- **UI implementation:** the Knitting Area renders each build with this grid (`src/scss/Game.scss` → `.ucs-build` uses `grid-template-areas: "L R" / "B B"`; `Game.ts::renderKnitting` sets each piece's `grid-area` from its slot). Incomplete builds keep the full 2×2 grid so missing pieces read as gaps in the sweater shape. The continuous cross-card artwork awaits the art files; the placeholder renderer still shows colour+value+icon+slot.

**Deck composition (TRANSCRIBED 2026-06-22 — `Material::FACES`):** 48 numbered cards = 12 values × 4 colours, plus **4 Patches** (one per colour) = 52. The icon + orientation of each of the 48 numbered cards is printed on the card and has now been transcribed into `Material::FACES`. The data has a regular structure (a useful integrity check): orientation by value 1..12 is identical for every colour — `L R B · B R L · L R B · B R L` (4 of each slot per colour); icons run in blocks of three (1-3,4-6,7-9,10-12) whose order rotates per colour (green=bell,snowman,candycane,tree / red=tree,bell,snowman,candycane / yellow=snowman,candycane,tree,bell / purple=candycane,tree,bell,snowman).

**Patches** = wild Sweater Cards (one per colour; **colour is fixed, value/icon/orientation are wild**):
- *Trade Phase:* a patch copies the **value and icon of the card played immediately before it**. If a patch *leads*, the player chooses any value/icon from a card currently in the Draft Pool. A patch following only needs to match its own colour; its icon stays undetermined until played (FAQ).
- *Knit Phase:* the drafter freely chooses value, icon, and orientation; once placed it follows normal placement rules (can't move). A patch may start a new "floating" sweater whose orientation is decided only when a real card attaches. Number/icon stay wild until scoring.

## Round Setup

1. **Draft Order:** randomly deal the four Draft Order cards (or, festively, most red+green worn gets "1"). Player **"1" leads**.
2. **Deal Sweater Cards:** place **4 face-up** into the **Draft Pool**. Deal the rest face-down evenly: **4P → 12 each, 3P → 16 each, 2P → 24 each**. Players draw up to a **starting hand of 9** (4P).
3. **Flip Gameplay Cards** to set round parameters — Perfect Fit (1), Trendy Yarn (2), Fads (3). Difficulty scaling controls how many are active:
   - **Beginner:** Fads only · **Novice:** Fads + Trendy Yarn · **Expert:** all three.
4. **Deal Secret Santa:** 1 face-down per player (Casual). Players may peek at their own anytime; reveal at scoring.

## Trade Phase (trick-taking)

- The lead player plays any 1 card face-up to the **Trade Area**. (2P variant: each player plays **2** cards per trick.)
- Going clockwise, each other player **must follow** by playing a card matching the led card's **Colour OR Icon** (either one satisfies the follow requirement). If they can do neither, they may play any card.
- Once everyone has played, resolve the trick into a **Draft Order** (it does not "win" cards — it sets pick order).

### Trick resolution → Draft Order (priority checklist)

Assign Draft Order cards 1→N by this priority:
1. **Perfect Fit (super trump):** a card whose value equals the Perfect Fit number takes the top spot. Multiple Perfect-Fit-value cards → the one played **later** in turn order wins. *Ultimate Trump exception:* a card matching **both** the Perfect Fit number **and** the Trendy Yarn colour beats a later-played Perfect Fit card that does **not** match the Trendy Yarn colour.
2. **Trendy Yarn (trump colour):** absent a Perfect Fit, any card of the Trendy Yarn colour beats all other colours regardless of value. Multiple Trendy-Yarn-colour cards → highest value wins.
3. **Card value:** otherwise, rank by value high→low.
- **Ties:** the player who played **later** in turn order takes priority.
- **Key FAQ:** following colour/icon is required to *play* legally but confers **no** advantage in resolution — the highest number wins regardless of whether it followed the lead. Off-suit high cards can top the draft order.

## Draft Phase

- In the established Draft Order, each player picks **1** card from the **4-card Draft Pool** and places it into their Knitting Area (see Knit Phase). 
- **3P:** 4 cards in the pool but only **3** are drafted (1 remains). **2P:** each player drafts **2**.
- You may **not** draft the cards just played into the Trade Area — those become the **next** trick's Draft Pool.

### Trick cleanup / pool rotation

After drafting: the Trade Area cards shift over to become the new Draft Pool, clear the Draft Order cards (the "1" player keeps theirs and leads again), everyone **draws back up to 9** (4P), then the next trick begins. (Hands begin to deplete once the deck runs out — that's expected; from the 5th trick in 4P you may not refill to 9.)

## Knit Phase (set collection / tableau building)

- Your **Knitting Area** holds in-progress and completed sweaters. A **completed sweater = one Left + one Right + one Bottom** piece.
- Build as many sweaters as you like. **Each placed card belongs to one distinct sweater and never moves** — sweaters can **never be merged** (you can't combine two already-started sweaters, nor relocate a placed piece into another sweater).
- A **newly drafted card** (only the card being placed this turn) may either **start a new sweater** or be **added to any already-started sweater**. Adding includes **placing it *over* a previously-played piece of the *same* L/R/B orientation** (replace L with L, R with R, B with B); the covered card is discarded from the build. You can only place a card into the slot matching its own orientation.
- **Round-end trigger:** when **any player completes their 3rd sweater** (Express: 4th). Players drafting *after* the trigger in the current Draft Order still draft & place. (2P: keep drafting until the Draft Pool empties — you can finish a 4th sweater.) A round **also ends if all hands are exhausted**.
- **Unfinished sweaters are wiped and do not score.**

## Scoring (end of each round)

Per the Score Reference card, for **completed** sweaters only:

| Bonus | VP | Condition |
|-------|---:|-----------|
| Sweater Build | **+2** | Each completed sweater (L+R+B). |
| Three Consecutive Numbers | **+2** | The sweater's 3 values form a run of 3 consecutive numbers. **No wrap** (11-12-1 invalid). |
| Fad | **+3** (per Fad objective) | Sweater entirely matches the Fad **colour** *or* the Fad **icon**. Fad cards list two objectives (e.g. "All Green / All Trees"); each scores independently, so one sweater can score both. *Clash Is In* Fad: sweater must be all **different** colours and icons. |
| All-Matching Non-Fad | **+1** | Sweater all one colour **or** all one icon that is **not** the active Fad. (When Fad = *Clash Is In*, all four colours/icons count as non-fad matches.) |
| Secret Santa | **+3** | A completed sweater satisfies your Secret Santa's colour + icon request. Each card counts toward **either** its icon or its colour (not both); orientation is ignored. Scores **once** only. |

## Between Rounds & Game End

- Carry the 4 most-recent Trade Area cards into the next round's Draft Pool. The "1" Draft Order card holder keeps it (leads next round).
- Reshuffle **all other** Sweater Cards (hands, built, unfinished, removed) and re-deal 12 (4P). New Secret Santa each round.
- **Game ends after round 3.** Sum round scores; highest total wins.
- **Tiebreakers:** (1) fewest unbuilt sweaters → (2) most total Fad points → (3) physical knit-off *(omit/ignore in the digital version)*.

## Variants (implement as game options)

- **2-player:** deal all 24 each; play 2 cards/trick; draft 2/trick; can complete a 4th sweater the same draft the 3rd triggers end.
- **3-player:** deal 16 each; 4 in pool, only 3 drafted per trick.
- **Casual vs Avid** (Secret Santa mode): *Casual* = optional 1 Secret Santa/round. *Avid* = 3 Secret Santas dealt at game start that **must all** be completed by game end or the player **doesn't qualify for scoring** (effectively loses); reveal only completed ones each round.
- **Express:** condenses to 1 round. 2 Secret Santas each; Fads = players+1 face-up and **claimed** when fulfilled (the Fad card locks onto that sweater; simultaneous completions broken by Draft Order); Trendy Yarn rotates (every 3rd trick in 2P, every 4th in 3–4P); Perfect Fit replaced whenever matched; round ends at the **4th** sweater. Uses the Round Tracker.
- **Bonus Cards** (optional Kickstarter expansion — the "4 Special Ability cards"): deal 1 each, revealed. *The Little Brothers Colour Coordinate* (objective, 3VP), *Tina Can Tink* (one-time, at round end pre-scoring move/swap a piece), *Mixed-up Maria* (one-time, break orientation rule when placing), *Billy's a Brute* (one-time, when another player wins a trick you draft first; the contested card is discarded). One-time cards are discarded after use.

## Implementation Notes (first pass)

**Framework: Modern / Studio** — PHP **state classes** (`modules/php/States/*`) with `#[PossibleAction]` methods + a `zombie(int $playerId)` per state; static card data in `modules/php/Material.php`; **TypeScript** client (HTML generated in `setup()`, promise notifications, per-state handler registration). See `../CLAUDE.md` → "Classic vs Modern framework".

**Proposed state flow (one class per state under `modules/php/States/`):**
`GameSetup → RoundSetup (deal, flip gameplay cards, secret santa) → LeadTrick → FollowTrick (loop over non-leaders; multi-card in 2P) → ResolveTrick (GAME state, compute draft order, no input) → DraftCard (loop in draft order: pick from pool + place/orient in knitting area; patch sub-choices) → TrickCleanup (rotate pool, redraw) → [back to LeadTrick OR] RoundScoring → [NextRound OR GameEnd]`.

**Data model pointers (`dbmodel.sql`):**
- A `card` table with `card_value` (1–12 / wild), `card_color`, `card_icon`, `card_orientation`, `is_patch`, plus a `card_location` enum (`deck`/`hand`/`draftpool`/`tradearea`/`knitting`/`discard`) and `card_location_arg` (owner / sweater-build id / play order). BGA's `Deck` component handles most of this.
- Per-round parameters: active `perfect_fit` value, `trendy_yarn` colour, `fad` card id(s) — store as global game state values.
- `secret_santa` assignments per player per round; cumulative + per-round scores per player.
- Sweater builds: group knitting-area cards by a build id; track L/R/B slots and "floating patch" state.

**Tricky bits to get right:** the colour-OR-icon follow rule; the Perfect Fit / Trendy Yarn / Ultimate-Trump resolution order; patches resolving wild value/icon at different times (trade vs knit vs scoring); pool rotation keeping the pool at 4; "place over" replacement; per-player variable cards-per-trick (2P).

## BGA Project

- **Framework:** **Modern / Studio** (PHP state classes + TypeScript client).
- **BGA project name:** `uglychristmassweater` · **SFTP remote path:** `/uglychristmassweater/` (set in the gitignored `.vscode/sftp.json`).
- **BGG ID:** `285071` (set in `gameinfos.jsonc`). Game by H² Games.

## Build / Toolchain

TypeScript + SCSS are **enabled**. Source lives in `src/ts/` and `src/scss/`; build with:
- `npm run build` — one-off (`rollup` compiles `src/ts/Game.ts` → `modules/js/Game.js`; `sass` compiles `src/scss/Game.scss` → `uglychristmassweater.css`).
- `npm run watch` — rebuild on save during development.

Edit **`src/`**, never the generated `modules/js/Game.js` / `uglychristmassweater.css` (overwritten on build). `node_modules/` is gitignored; `package-lock.json` is committed. State handlers go in `src/ts/States/*` and register in `src/ts/Game.ts`.

## Current State (as of 2026-06-22)

Modern/Studio skeleton baseline is in place and the **TypeScript/SCSS toolchain is enabled and builds clean** (fixed a skeleton glitch where `PlayerTurn.ts` used placeholder `EmptyGame*` types). **`gameinfos.jsonc` configured** (name, BGG id 285071, players 2–4, suggest 4, tie-breaker text). **`dbmodel.sql` + `modules/php/Material.php` drafted** (structure complete; see below). **Setup + state machine wired AND smoke-tested on BGA (2026-06-17)** — a 4-player table ran the full Trade → Resolve → Draft → Knit → cleanup loop cleanly through multiple tricks with no errors. `Game.php` deals/flips/activates; the loop is implemented as state classes; client builds clean.

**State machine (`modules/php/States/`):**
`NewRound(5)` → `PlayCard(10)` → `NextInTrick(20)` → `ResolveTrick(30)` → `DraftCard(40)` → `NextDrafter(50)` → `EndTrickCleanup(60)` → [`PlayCard` again OR `ScoreRound(70)`] → [`NewRound` OR `EndScore(98)` → end(99)]. (Old example states `PlayerTurn`/`NextPlayer` removed.) `Game.php` `setupNewGame` creates the 3 decks, deals per player-count, sets a random leader, and starts. Client handlers: `src/ts/States/PlayCard.ts` + `DraftCard.ts` (minimal button UI for now).

**Implemented vs TODO (rule internals):** the control flow, dealing, **follow-rule (colour OR icon — fully working via `Material::FACES`; `Game::effectiveIcon`/`cardFollows`)**, trick→draft-order resolution (value + play-order; **Perfect Fit / Trendy Yarn / Ultimate-Trump TODO**), **real placement (printed orientation + player-chosen build + "place over" + patch wilds chosen at draft — DONE 2026-06-22)**, **trade-phase patch wilds (`Game::moveCardToTrick` — a played patch copies the prior card's value+icon; a leading patch copies a player-chosen numbered pool card; cleared on pool rotation so they don't persist — DONE 2026-06-22)**, round-end detection, and **scoring (only base +2/sweater so far — runs/Fad/non-fad/Secret-Santa TODO**). Search `Game.php` for `TODO`.

**Data model (drafted 2026-06-17):**
- `dbmodel.sql` — three Deck tables (`card` 52 sweaters, `gameplay_card`, `secret_santa`) + a `card_meta` side-table for dynamic per-card extras (`trick_order`/`build_no`/`slot`/`wild_value`/`wild_icon`) + `player.player_fad_points` (tie-break #2). **Gotcha (learned the hard way): the modern Deck component auto-creates its `card` table with only the 5 standard columns and ignores extra columns in dbmodel.sql — so extras MUST live in a separate table (`card_meta`), not as columns on `card`.** Decks: `$this->deckFactory->createDeck('card'|'gameplay_card'|'secret_santa')`.
- `modules/php/Material.php` — class `Material` (PSR-4, same namespace). Colour/icon/slot/VP constants; `sweaters()` builds the 52-card list; `sweaterDeckRows()` feeds `createCards`; `fads()`/`secretSantas()`/`PERFECT_FIT`/`TRENDY_YARN` structured with rulebook examples. **Card icon/orientation and the exact Fad/Secret-Santa/Perfect-Fit values are `TODO` — search Material.php for "TODO"; they need the art files.**

Open data dependencies (TODO in `Material.php`):
- ~~Exact 52-card composition — icon + orientation per numbered card (`Material::FACES`).~~ **DONE 2026-06-22.**
- ~~**6 Perfect Fit** numbers~~ **DONE 2026-06-24** (values 1–6). · ~~**4 Trendy Yarn** colours~~ **DONE 2026-06-24** (one per colour).
- **10 Fad** definitions — **5 types transcribed 2026-06-24** (Clash Is In + one colour⇄icon fad per colour: red⇄candycane, green⇄tree, yellow⇄bell, purple⇄snowman). **Deck distribution still UNRESOLVED**: 10 physical cards, unconfirmed whether 2× each of these 5 or a different mix; deck currently built from the 5 unique fads. Revisit when the full 10-card list is known.
- **16 Secret Santa** requirements — still pending.
- Card-face *art* (`img/`) still pending (**Request Art Files requested 2026-06-17**); the placeholder renderer shows colour+value+icon-glyph+slot from `Material::FACES` in the meantime.

**Knitting layout = sweater silhouette (2026-06-24).** Each build now renders L/R top-row + B centred below (`.ucs-build` CSS grid + `renderKnitting` per-piece `grid-area`); see "Card art & sweater layout" above. Confirmed the clarified knitting rules (distinct sweaters, never merged; "place over" only onto the *same* orientation) already match the engine — `placeDraftedCard` fixes each card's slot and only replaces a same-slot occupant, with no merge path. Continuous cross-card art still pending art files. Build clean (`npm run build`); not yet pushed/table-tested.

**Board UI built and table-tested on BGA (2026-06-19).** Replaced the placeholder buttons with a rendered board: a draft pool, trade area, per-player tables (header + draft-order badge + hand/pile counts + knitting area grouped into L/R/B builds), and the current player's clickable hand. Click-to-play / click-to-draft drives the existing `actPlayCard` / `actDraftCard`; selectable cards get a **pulsing gold glow** + hover lift. Placeholder card visuals show **colour + value** with a per-colour diagonal/orthogonal **pattern for colour-blind accessibility** (rules requirement); icon + orientation render as `?` until the art lands (the markup slot is already there). Build is clean (`npm run build`, no warnings). **A 4-player table ran 3 full tricks through the new UI cleanly** — render, the colour-follow dimming, hand/pile counts, drafting, trade→pool rotation, and refill (`handUpdate`) all verified correct on BGA.
- **New/changed client files:** `src/ts/CardView.ts` (placeholder card renderer + tooltip), `src/ts/Game.ts` (zone rendering from `gamedatas`, selection API `enable/disablePlayable`/`Draftable`, `notif_*` handlers), `src/ts/States/PlayCard.ts` + `DraftCard.ts` (card selection not buttons), `src/ts/types.d.ts` (full gamedatas + card + notif types), `src/scss/Game.scss`.
- **Server notif enrichment (needed for the UI):** `cardPlayed` / `cardDrafted` now carry the full `card` row (a played card comes from a hidden hand, so its face must travel with the notification); `trickCleanup` carries the new `pool` + public `counts`; a private `handUpdate` per player delivers the refilled hand after cleanup; `getAllDatas` `players` now includes `name`/`color`. Helpers: `Game::cardForNotif()`, `Game::publicCounts()`.
- **Client state model:** `gamedatas` is the single source of truth; `notif_*` handlers mutate it then re-render the affected zone(s). Knitting "complete" highlight keys off L/R/B slots.
- **Real placement (`Game::placeDraftedCard`, replaced the temp L→R→B cycling 2026-06-22):** a drafted regular card uses its **printed** orientation (`Material::FACES`); a drafted **Patch** lets the player choose value + icon + orientation (colour is fixed). The player chooses which **build (sweater)** to place into, and placing into a slot a build already holds **replaces** the occupant ("place over" → discarded). `actDraftCard` now takes `build_no, slot, wild_value, wild_icon`; the client collects these in a **placement panel** (`#ucs-placement`) shown after a pool card is selected, then submits. Notif `cardDrafted` carries `replaced_card_id` so clients drop a placed-over piece. Because completion is now intentional (not every-3-drafts auto), exercise round-end either by deliberately finishing 3 sweaters or by exhausting hands.

Next steps (engine + board UI proven; remaining work):
1. **Test on BGA (not yet done):** (a) the **icon-follow rule** + **real placement / patch-draft placement panel** added 2026-06-22 — verify colour-OR-icon dimming, printed orientation, build choice, "place over", and patch value/icon/orientation selection; (b) the round-end → `ScoreRound` → `NewRound` loop (completion is now intentional, so build 3 sweaters or empty hands). *(Trade→Draft→cleanup loop verified on BGA 2026-06-19.)*
2. **Remaining `Material.php` data** (needs the publisher card lists, not the art images): **16 Secret Santa**; **Fad deck distribution** (5 fad types done; confirm whether 10 cards = 2× each or another mix). (`Material::FACES`, **6 Perfect Fit**, **4 Trendy Yarn** done 2026-06-24.)
3. Remaining rule internals: **Perfect Fit / Trendy Yarn / Ultimate-Trump** resolution; **full scoring** (three-consecutive-numbers needs only values → doable now; Fad/non-fad/Secret-Santa need the data in #2). *(Trade-phase patch wilds done 2026-06-22.)*
4. Configure `gameoptions.jsonc` variants (Casual/Avid, Express, bonus cards) and `stats.jsonc`.

## File Structure

**Modern / Studio layout** — see the framework file-roles table in `../CLAUDE.md` → "Classic vs Modern framework". Key files appear once BGA's skeleton is downloaded: `gameinfos.jsonc`, `stats.json`, `gameoptions.json`, `dbmodel.sql`, `modules/php/Material.php`, `modules/php/States/*`, and the TypeScript client.
