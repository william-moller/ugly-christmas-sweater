# Ugly Christmas Sweaters — game rules & card data

How the game works, independent of the implementation. The authoritative rules are
[`../docs/ugly-christmas-sweater-rules.pdf`](../docs/ugly-christmas-sweater-rules.pdf) (BGG rulebook:
https://boardgamegeek.com/filepage/186495/ugly-christmas-sweaters-rulebook-10) — this file is a
working digest; when they disagree, the PDF wins.

## Overview

- **Type:** card game combining **trick-taking** (the *Trade Phase*), **card drafting**, and **set collection / tableau building** (the *Knit Phase*).
- **Players:** 2–4 (4-player is the base game; 2- and 3-player are variants).
- **Length:** 3 rounds (Casual). Highest cumulative VP after round 3 wins.
- **Core loop:** each round is a series of **tricks**; every trick is `Trade (play 1 card each) → resolve into Draft Order → Draft 1 card each from the Draft Pool → place it into your Knitting Area`. Repeat until a player completes their 3rd sweater (or hands run out), then score.

## Components

| Count | Card | Notes |
|------:|------|-------|
| 52 | **Sweater Cards** | Main deck (48 numbered + 4 patches). See composition below. |
| 16 | **Secret Santa** | Hidden per-player objectives (colour + icon). Worth **3 VP**. |
| 10 | **Fad** | Round-wide bonus-scoring parameter (gameplay card #3). |
| 6 | **Perfect Fit** | "Super trump" number (gameplay card #1). |
| 4 | **Trendy Yarn** | Trump colour (gameplay card #2). |
| 4 | **Special Ability / Bonus** | Optional Kickstarter mini-expansion (see Bonus Cards). |
| 4 | **Score Reference** | Player aid (UI only). |
| 4 | **Draft Order** | Numbered 1–4; mark turn/draft order. |
| 1 | **Round Tracker** | Express variant only. |

### Sweater Card anatomy — four attributes

- **Value:** 1–12, ranked high→low (**12 strongest, 1 weakest**), unless modified by Perfect Fit / Trendy Yarn.
- **Colour:** Purple, Red, Green, or Yellow (each colour also has a distinct pattern for colour-blind accessibility — replicate in the UI).
- **Icon:** Snowmen, Candy Canes, Bells, or Trees.
- **Orientation:** Left / Right / Bottom (L/R/B) — which third of a sweater this piece is. Shown on the "Christmas light" under the number.

### Card art & sweater layout

Each card depicts one third of a knitted sweater so the three orientations assemble into one garment:
- **L** = upper-left third (left shoulder/sleeve + left of body). **R** = upper-right third. **B** = the lower third (waist/hem band), centred *beneath* L and R.
- A completed sweater lays out as a silhouette — **L and R side-by-side on top, B centred across the bottom**:
  ```
  [L][R]
   [ B ]
  ```
- Each card shows its **value in the top-left corner** with the **icon string ("Christmas light")** beneath the number; the rest is the sweater artwork for that third.

### Deck composition (transcribed into `Material::FACES`)

48 numbered cards = 12 values × 4 colours, plus **4 Patches** (one per colour) = 52. The icon +
orientation of the 48 numbered cards is transcribed into `Material::FACES`. The data has a regular
structure (a useful integrity check):
- **Orientation** by value 1..12 is identical for every colour — `L R B · B R L · L R B · B R L` (4 of each slot per colour).
- **Icons** run in blocks of three (1-3, 4-6, 7-9, 10-12) whose order rotates per colour: green = bell, snowman, candycane, tree · red = tree, bell, snowman, candycane · yellow = snowman, candycane, tree, bell · purple = candycane, tree, bell, snowman.

### Patches (wild Sweater Cards — colour fixed, value/icon/orientation wild)

- *Trade Phase:* a patch copies the **value and icon of the card played immediately before it**. If a patch *leads*, the player chooses any value/icon from a card currently in the Draft Pool. A patch following only needs to match its own colour; its icon stays undetermined until played.
- *Knit Phase:* a placed patch's **value and icon stay wild until round-end scoring** — not chosen at placement. **Orientation:** a patch *added to an existing sweater* takes an open orientation (L/R/B) immediately; a patch that *starts a new sweater* "floats" (no orientation) until a second card is added, at which point the player assigns the patch's orientation (an open slot, distinct from the card being added). Once placed, a patch can't move to another sweater (only be added to). At **round-end scoring**, every player with patch(es) in **completed** sweaters assigns each a value (1–12) + icon **simultaneously** (order doesn't matter); patches in *incomplete* sweaters never score. Colour is always fixed.

## Round setup

1. **Draft Order:** randomly deal the four Draft Order cards. Player **"1" leads**.
2. **Deal Sweater Cards:** place **4 face-up** into the **Draft Pool**. Deal the rest face-down evenly: **4P → 12 each, 3P → 16 each, 2P → 24 each**. Players draw to a **starting hand of 9** (4P).
3. **Flip Gameplay Cards** to set round parameters — Perfect Fit (1), Trendy Yarn (2), Fads (3). Difficulty scaling controls how many are active: **Beginner** = Fads only · **Novice** = Fads + Trendy Yarn · **Expert** = all three.
4. **Deal Secret Santa:** 1 face-down per player (Casual). Players may peek at their own anytime; reveal at scoring.

## Trade Phase (trick-taking)

- The lead player plays any 1 card face-up to the **Trade Area**. (2P variant: each player plays **2** cards per trick.)
- Going clockwise, each other player **must follow** by playing a card matching the led card's **Colour OR Icon** (either satisfies the requirement). If they can do neither, they may play any card.
- Once everyone has played, resolve the trick into a **Draft Order** (it does not "win" cards — it sets pick order).

### Trick resolution → Draft Order (priority)

Assign Draft Order cards 1→N by this priority:
1. **Perfect Fit (super trump):** a card whose value equals the Perfect Fit number takes the top spot. Multiple Perfect-Fit-value cards → the one played **later** in turn order wins. *Ultimate Trump exception:* a card matching **both** the Perfect Fit number **and** the Trendy Yarn colour beats a later-played Perfect Fit card that does **not** match the Trendy Yarn colour.
2. **Trendy Yarn (trump colour):** absent a Perfect Fit, any Trendy-Yarn-colour card beats all other colours regardless of value. Multiple → highest value wins.
3. **Card value:** otherwise rank by value high→low.
- **Ties:** the player who played **later** in turn order takes priority.
- Following colour/icon is required to *play* legally but confers **no** advantage in resolution — the highest number wins regardless of whether it followed. Off-suit high cards can top the draft order.

## Draft Phase

- In Draft Order, each player picks **1** card from the **4-card Draft Pool** and places it into their Knitting Area.
- **3P:** 4 in the pool but only **3** drafted (1 remains). **2P:** each player drafts **2**.
- You may **not** draft the cards just played into the Trade Area — those become the **next** trick's Draft Pool.

### Trick cleanup / pool rotation

After drafting: the Trade Area cards shift over to become the new Draft Pool, the Draft Order cards clear (the "1" player keeps theirs and leads again), everyone **draws back up to 9** (4P), then the next trick begins. Hands begin to deplete once the deck runs out (expected; from the 5th trick in 4P you may not refill to 9).

## Knit Phase (set collection / tableau building)

- Your **Knitting Area** holds in-progress and completed sweaters. A **completed sweater = one L + one R + one B**.
- Build as many sweaters as you like. **Each placed card belongs to one distinct sweater and never moves** — sweaters can **never be merged**.
- A **newly drafted card** (only the card placed this turn) may **start a new sweater** or be **added to any already-started sweater**. Adding includes **placing it *over* a previously-played piece of the *same* L/R/B orientation** (replace L with L, etc.); the covered card is discarded. You can only place a card into the slot matching its own orientation.
- **Round-end trigger:** when **any player completes their 3rd sweater** (Express: 4th). Players drafting *after* the trigger in the current Draft Order still draft & place. (2P: keep drafting until the pool empties — you can finish a 4th sweater.) A round **also ends if all hands are exhausted**.
- **Unfinished sweaters are wiped and do not score.**

## Scoring (end of each round)

For **completed** sweaters only:

| Bonus | VP | Condition |
|-------|---:|-----------|
| Sweater Build | **+2** | Each completed sweater (L+R+B). |
| Three Consecutive Numbers | **+2** | The sweater's 3 values form a run of 3 consecutive numbers. **No wrap** (11-12-1 invalid). |
| Fad | **+3** per Fad objective | Sweater entirely matches the Fad **colour** *or* the Fad **icon**. Fad cards list two objectives (e.g. "All Green / All Trees"); each scores independently. *Clash Is In* Fad: sweater must be all **different** colours and icons. |
| All-Matching Non-Fad | **+1** | Sweater all one colour **or** one icon that is **not** the active Fad. (Under *Clash Is In*, all four colours/icons count as non-fad matches.) |
| Secret Santa | **+3** | A completed sweater satisfies your Secret Santa's colour + icon request. Each card counts toward **either** its icon or colour (not both); orientation ignored. Scores **once**. |

## Between rounds & game end

- Carry the 4 most-recent Trade Area cards into the next round's Draft Pool. The "1" Draft Order holder keeps it (leads next round).
- Reshuffle **all other** Sweater Cards (hands, built, unfinished, removed) and re-deal 12 (4P). New Secret Santa each round.
- **Game ends after round 3.** Sum round scores; highest total wins.
- **Tiebreakers:** (1) fewest unbuilt sweaters → (2) most total Fad points → (3) physical knit-off *(omitted in the digital version)*.

## Player-count scaling (automatic, not an option)

Handled in the engine by player count (`Game::perPlayerDeal` / `getPlayersNumber`), not selectable:

- **2-player:** deal all 24 each; play 2 cards/trick; draft 2/trick; can complete a 4th sweater the same draft the 3rd triggers end.
- **3-player:** deal 16 each; 4 in pool, only 3 drafted per trick.

## Game modes (option 101 — mutually exclusive)

The Game mode option offers **Casual / Express / Avid**. Difficulty (option 100) is only selectable in
Casual; in Express and Avid it stays at its Expert default (the full game). Bonus cards (option 102)
require Difficulty = Expert, so they're available in Express/Avid and in Casual-at-Expert.

- **Casual:** the base game — 3 rounds, one parameter of each revealed type per round; **1** Secret
  Santa dealt per player each round (re-dealt every round), optional (satisfy for +3 VP, no penalty).
- **Express:** 1 round. 2 Secret Santas each; Fads = players+1 face-up and **claimed** when fulfilled;
  Trendy Yarn rotates (every 3rd trick in 2P, every 4th in 3–4P); Perfect Fit replaced whenever
  matched; round ends at the **4th** sweater. Uses the Round Tracker.
- **Avid:** the full 3-round base game, but **3** Secret Santas are dealt to each player **once at game
  start** and persist all game. Satisfaction is tracked **cumulatively** across rounds; each satisfied
  Secret Santa still scores **+3 VP**, and each is **revealed publicly** in that player's area the round
  it is first completed. A player who has **not** satisfied all 3 by game end has their **final score
  set to 0** (flagged with an asterisk + note on the scoring summary).

## Bonus Cards (optional Kickstarter expansion — the 4 "Special Ability" cards)

Deal 1 each, revealed. One-time cards are discarded after use.
- **The Little Brothers Colour Coordinate** — objective, **+3 VP**: two distinct completed sweaters, one of {1 green, 2 red} and another of {1 red, 2 green} (colour multisets; patches count as their fixed colour; orientation/value ignored).
- **Tina Can Tink** — one-time, at round end pre-scoring: move/swap a placed piece.
- **Mixed-up Maria** — one-time: break the orientation rule when placing a card.
- **Billy's a Brute** — one-time: when another player leads the draft, jump to the front and draft first, but the contested card is **discarded** instead of kept.
