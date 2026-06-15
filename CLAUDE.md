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

**Deck composition (INFERRED — must confirm against the physical card faces):** 48 numbered cards = 12 values × 4 colours, plus **4 Patches** (one per colour) = 52. The exact **icon and orientation assigned to each of the 48 numbered cards** is printed on the cards and is NOT derivable from the rules — we must transcribe it (from the card art / publisher data) into `material.inc.php`. ⚠️ This is the single biggest missing data dependency.

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

**Proposed game states (`states.inc.php`):**
`gameSetup → roundSetup (deal, flip gameplay cards, secret santa) → leadTrick → followTrick (loop over non-leaders; multi-card in 2P) → resolveTrick (compute draft order, no input) → draftCard (loop in draft order: pick from pool + place/orient in knitting area; patch sub-choices) → trickCleanup (rotate pool, redraw) → [back to leadTrick OR] roundScoring → [nextRound OR gameEnd]`.

**Data model pointers (`dbmodel.sql`):**
- A `card` table with `card_value` (1–12 / wild), `card_color`, `card_icon`, `card_orientation`, `is_patch`, plus a `card_location` enum (`deck`/`hand`/`draftpool`/`tradearea`/`knitting`/`discard`) and `card_location_arg` (owner / sweater-build id / play order). BGA's `Deck` component handles most of this.
- Per-round parameters: active `perfect_fit` value, `trendy_yarn` colour, `fad` card id(s) — store as global game state values.
- `secret_santa` assignments per player per round; cumulative + per-round scores per player.
- Sweater builds: group knitting-area cards by a build id; track L/R/B slots and "floating patch" state.

**Tricky bits to get right:** the colour-OR-icon follow rule; the Perfect Fit / Trendy Yarn / Ultimate-Trump resolution order; patches resolving wild value/icon at different times (trade vs knit vs scoring); pool rotation keeping the pool at 4; "place over" replacement; per-player variable cards-per-trick (2P).

## BGA Project

- **BGA project name / remote path:** TBD — set in `.vscode/sftp.json` after creating the project in the Studio Control Panel.
- **BGG ID:** TBD (set in `gameinfos.inc.php`). Game by H² Games.

## Current State (as of 2026-06-14)

Scaffolding + full rules reference (this file). No game code yet.

Open data dependencies before coding logic:
- **Exact 52-card composition** (icon + orientation per numbered card) → `material.inc.php`.
- The **16 Secret Santa** requirements, **10 Fad** definitions, **6 Perfect Fit** numbers, **4 Trendy Yarn** colours.
- These come from the card faces / publisher art (request via the BGA "Request Art Files" button).

Next steps:
1. Reserve/create the project in the BGA Studio Control Panel; record the project name; request art files.
2. Download BGA's generated skeleton via SFTP and commit it as the code baseline.
3. Copy `.vscode/sftp.json.example` → `.vscode/sftp.json` and fill in `remotePath`.
4. Transcribe card data into `material.inc.php`; build the state machine above.

## File Structure

Standard BGA layout (see `../CLAUDE.md` → "Standard BGA File Roles"). Files will be prefixed with the BGA project name once the skeleton is downloaded.
