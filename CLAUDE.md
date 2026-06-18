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

**Deck composition (INFERRED — must confirm against the physical card faces):** 48 numbered cards = 12 values × 4 colours, plus **4 Patches** (one per colour) = 52. The exact **icon and orientation assigned to each of the 48 numbered cards** is printed on the cards and is NOT derivable from the rules — we must transcribe it (from the card art / publisher data) into the material definitions (`modules/php/Material.php`). ⚠️ This is the single biggest missing data dependency.

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
- Build as many sweaters as you like. **Once a card is placed it cannot move to a different sweater**, but a newly drafted card **may be placed *over* an existing piece** (replacing it; the replaced card is discarded from the build).
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

## Current State (as of 2026-06-17)

Modern/Studio skeleton baseline is in place and the **TypeScript/SCSS toolchain is enabled and builds clean** (fixed a skeleton glitch where `PlayerTurn.ts` used placeholder `EmptyGame*` types). **`gameinfos.jsonc` configured** (name, BGG id 285071, players 2–4, suggest 4, tie-breaker text). **`dbmodel.sql` + `modules/php/Material.php` drafted** (structure complete; see below). **Setup + state machine wired** — `Game.php` deals/flips/activates and the full Trade → Resolve → Draft → Knit → round-end → scoring loop is implemented as state classes; client builds clean.

**State machine (`modules/php/States/`):**
`NewRound(5)` → `PlayCard(10)` → `NextInTrick(20)` → `ResolveTrick(30)` → `DraftCard(40)` → `NextDrafter(50)` → `EndTrickCleanup(60)` → [`PlayCard` again OR `ScoreRound(70)`] → [`NewRound` OR `EndScore(98)` → end(99)]. (Old example states `PlayerTurn`/`NextPlayer` removed.) `Game.php` `setupNewGame` creates the 3 decks, deals per player-count, sets a random leader, and starts. Client handlers: `src/ts/States/PlayCard.ts` + `DraftCard.ts` (minimal button UI for now).

**Implemented vs TODO (rule internals):** the control flow, dealing, follow-rule scaffold (colour works; icon-follow needs card data), trick→draft-order resolution (value + play-order; **Perfect Fit / Trendy Yarn / Ultimate-Trump TODO**), drafting/placement (auto default build/slot; **player-chosen placement + patch wilds TODO**), round-end detection, and **scoring (only base +2/sweater so far — runs/Fad/non-fad/Secret-Santa TODO**). Search `Game.php` for `TODO`.

**Data model (drafted 2026-06-17):**
- `dbmodel.sql` — three Deck-backed tables: `card` (52 sweaters, Deck-compatible + extension columns `trick_order`/`build_no`/`slot`/`wild_value`/`wild_icon`), `gameplay_card` (Perfect Fit / Trendy Yarn / Fad piles), `secret_santa` (per-player objectives). Plus `player.player_fad_points` (tie-break #2). Decks: `$this->deckFactory->createDeck('card'|'gameplay_card'|'secret_santa')`.
- `modules/php/Material.php` — class `Material` (PSR-4, same namespace). Colour/icon/slot/VP constants; `sweaters()` builds the 52-card list; `sweaterDeckRows()` feeds `createCards`; `fads()`/`secretSantas()`/`PERFECT_FIT`/`TRENDY_YARN` structured with rulebook examples. **Card icon/orientation and the exact Fad/Secret-Santa/Perfect-Fit values are `TODO` — search Material.php for "TODO"; they need the art files.**

Open data dependencies (all TODO in `Material.php`):
- **Exact 52-card composition** — icon + orientation per numbered card (`Material::FACES`).
- **16 Secret Santa** requirements, **10 Fad** definitions, **6 Perfect Fit** numbers, **4 Trendy Yarn** colours.
- From the card faces / publisher art — **Request Art Files requested 2026-06-17** (pending delivery).

Next steps:
1. **Smoke-test on BGA** — upload via SFTP, restart a table, Express Start, and walk the trick→draft loop to validate the state machine end-to-end (works with placeholder/empty gameplay-card data).
2. Fill the `TODO` card data in `Material.php` once art files arrive (icons/orientation, Fad/Secret-Santa/Perfect-Fit/Trendy-Yarn).
3. Complete rule internals: Perfect Fit / Trendy Yarn / Ultimate-Trump resolution, full scoring (runs/Fad/non-fad/Secret Santa), patch wilds, player-chosen placement.
4. Configure `gameoptions.jsonc` variants (Casual/Avid, Express, bonus cards) and `stats.jsonc`; build the real board UI (draft pool, trade area, knitting areas).

## File Structure

**Modern / Studio layout** — see the framework file-roles table in `../CLAUDE.md` → "Classic vs Modern framework". Key files appear once BGA's skeleton is downloaded: `gameinfos.jsonc`, `stats.json`, `gameoptions.json`, `dbmodel.sql`, `modules/php/Material.php`, `modules/php/States/*`, and the TypeScript client.
