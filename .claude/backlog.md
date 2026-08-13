# Backlog — open work

**Intent, not status.** Everything here is work we *want*; nothing here describes what the code
currently does. An item leaves this file **in the same commit that implements it** — so if it is
listed, it is not done. No "partially", no percentages, no dates. The moment an entry starts
describing how far along something is, it has become status and it will rot exactly like the
pre-art TODO markers did (see ground rule 2 in [`../CLAUDE.md`](../CLAUDE.md)).

Not ranked. The split below is by BGA's
[pre-release checklist](../../.claude/reference/pre-release-checklist.md) — a property of the item,
not of the code.

## Release-blocking (BGA pre-release checklist)

- **Centering audit** — checklist: if elements don't occupy all available horizontal space, they should
  be centered. Only two places do it today (`.ucs-gameplay-row` under 450px, Avid's Secret Santa row);
  every other zone needs checking at narrow widths, where a shrink-to-fit row leaves the slack.
- **Special testing sweep** — the checklist's own *Special testing* block. None of it can be done from
  the repo; every item needs a live table, and the whole block sits *before* the alpha request.
  - **Minified JS + minified CSS** — toggle both on the manage-game page, then play. This is the only
    thing that behaves differently in production from every test run so far; BGA's own wording is that
    it stops the game shipping stuck on "Connecting to game". Use a **Casual 3-round or Avid** table,
    not Express — Express never enters `RoundReview`, so it exercises neither the round-summary sheet,
    the minimize chip, nor the Continue button. Two reasons to confirm rather than assume it passes:
    state handlers register by **string literal** precisely so the minifier cannot mangle the mapping,
    and `Game.js` ships as a bundled ES module with top-level `await`.
  - **Spectator** — red arrow by "Test spectator" under the player panels. All public information
    visible, no private: hands, unrevealed Secret Santas, any face-up-to-owner-only state.
  - **Replay from last move** — click a notification-log entry mid-game.
  - **Full replay** — "Replay game" on the table page after finishing, start to end, no errors.
  - **Browsers** — Chrome and Firefox required; Edge and Safari recommended.
  - **Real phone** — much of the narrow layout is derived arithmetically and has never been seen on
    hardware. The visual polish sweep below lists which shapes are in that position.
  - **Realtime mode** at default clocks, to confirm `giveExtraTime()` keeps players from timing out.
  - **Waiting screen** — game start can fail against it.
- **Verify the Bonus cards option end to end.** `gameoptions.jsonc` option **102** (Off/On) deals one
  face-up Special Ability card per player at game start (`Game::bonusEnabled`), persisting all game.
  It is *doubly* gated by `displaycondition` — shown only when Difficulty (option 100) is Expert, which
  is itself shown only in Casual — so the selector has three routes to reach and each needs checking:
  - **Casual** — the creator must set Difficulty to Expert before Bonus cards appears at all.
  - **Express** / **Avid** — Difficulty is hidden at its Expert default, so Bonus cards should appear.

  Where it is hidden the creator sees `notdisplayedmessage` instead; confirm that copy reads correctly.
  Then play with it **On** and confirm all 4 Special Ability cards resolve, that a card is visible to
  opponents (it is dealt face-up), and that it survives a round boundary in the 3-round modes.
  ⚠️ Editing `gameoptions.jsonc` and deploying is **not** enough — BGA caches options in its DB. Click
  **"Reload game options configuration"** on the manage-game page, *then* recreate the table, or the
  change will not appear at all (see [`../../.claude/deploy.md`](../../.claude/deploy.md)).

- **Confirm `tie_breaker_split` decodes a NEGATIVE composite.** `player_score_aux` is
  `-(unbuilt) * 1000 + fadPoints`, and `gameinfos.jsonc` now declares `"tie_breaker_split": [1000, 1]`
  so the results screen shows the two keys separately instead of the raw number. Every example in the
  wiki is a *positive* composite, so how BGA divides a negative one is its choice, not ours: floor
  division renders `-3997` as **(-4, 3)** (what we want), truncation renders it **(-3, -997)**
  (nonsense). Needs a table played to a genuine tie on score — two players on equal `player_score` —
  since BGA only prints aux for tied players. If it truncates, **delete the `tie_breaker_split` line**;
  the `sweaters_unbuilt` stat carries the same information and does not depend on it. The comment
  above the line in `gameinfos.jsonc` says the same, so this can be settled from either end.

## Polish / UX

- **Visual polish sweep — the layouts not yet hand-tuned.** The narrow/mobile pass so far covers
  **Express at Small/Medium** (2P: Fads + Perfect Fit + Trendy Yarn on one row; 3–4P: the wide layout's
  block — Fads in a 2-wide grid with Trendy Yarn over Perfect Fit beside them, 3 cards across at both
  counts; parameter + Secret Santa cards filled to the column beside the Round-Tracker sidebar). Every
  other combination still wants an eyes-on pass — down to true-phone widths (<450px) — so all read as
  clean as the 2P Express view now does:
  - **Express, 3–4 players, narrow** — checked at 412px (Pixel 7) at Small only. Confirm the 2-wide Fad
    grid, the Trendy-Yarn-over-Perfect-Fit column and the Secret Santa fill at Medium too, and from
    ~360px up to 1000px. At 4P the grid runs 3 rows (5 Fads), which is the tallest parameter block in
    the game — check it against the sidebar's height.
  - **Casual and Avid, narrow** — now built (three-across parameter row; Avid's three Secret Santas on a
    full-width row) but derived only, never looked at. Avid at 360px has the least slack in the game.
  - **`.ucs-fad-chip` is dead code.** `fadChipEl()` renders an abstracted "[colour] / [icon]" read-out
    into every Fad card for a narrow layout that would drop the card art, but no rule ever unsets its
    `display: none` — it belongs to the retired narrow rail (see `responsive.md`'s stale-structure
    caveat). Either wire it up as the genuine fallback for widths where Fad art stops being readable
    (~<72px card width, which is what stopped 4P mirroring the wide block), or delete it and its
    renderer. Right now it is a promise the CSS does not keep.
  - **Large, narrow** — Large now uses the sidebar like every other size, and my knitting area is capped
    at `min(card × scale, 25vw)` so one sweater can't claim most of a phone. Unverified by eye.
  - **Express, wide (≥1000px desktop)** — confirm the desktop layout is still clean after the
    Round-Tracker sidebar relocate/restore (2P/4P: tracker bottom-left, opponents in the right column;
    3P: tracker stacked over the opponents in the right column, Fads 2×2 — see `responsive.md`).
  - **Express 4P and Avid, wide** — both now folded (4P: Fads 3-across + Perfect Fit under Trendy Yarn +
    tracker top-right; Avid: Secret Santas stacked). Verified by arithmetic only — 1749 and 1602 at
    Large, per [`responsive.md`](responsive.md) — never seen in a real table. Wants eyes on a 4P Express
    and a 3P Avid game at each card size, particularly the strip *height*: 4P now runs two Fad rows and
    Avid three stacked landscape Santas, and neither was checked against the centre column's height.
  - **Express 2P at Large is now the widest shape in the game** (1884 vs a 1920 screen). The Fad-grid
    fold would bring it down, but its five-card parameter row is not obviously wrong to look at — decide
    whether to fold it for the 1600px-laptop case or leave it.
- **Narrow the card-size spread so size and layout stop being one axis.** The layout work keeps needing
  *per-card-size* width floors (`$santa-column-floors` in `Game.scss` is two numbers for one layout
  idea, and Large at Tier A already wants ≈1690px before 3P Express crowds — the centre stack is what
  gives, since `#ucs-board-strip` is `flex: 0 0 auto`). Root cause is **the spread, not the number of
  sizes**: our Large is `1.5 ×` base, which moves the 3P board strip from 488px to 717px — enough to
  change what fits in a row, which is what forces a size × width rule every time. Evidence from
  `../_reference/`: **soothsayers** ships two sizes at ~`1.15–1.25 ×` (100→120px cards, all hardcoded
  px, 11 size-scoped rules) and crosses size × width exactly **once**, as a `max-width` cap — never a
  reflow. None of the six reference games (soothsayers, castlecombo, collect, crybaby, insidejob,
  trickykids) uses `clamp()` or a container query at all; fluid card sizing is not the idiom here.
  Options, cheapest first:
  - **Re-pitch the scale.** Our base 80px is *below* soothsayers' small (100px) while our Large (120px)
    matches their large — so Large is doing the work of "normal". Raise base to ~96 and Large to `1.2 ×`.
    **Correcting an earlier claim here: this does not lower the floors, it raises them.** The base
    multiplies every size, so Small and Medium get ~20% bigger cards and need ~20% more width. Re-derived
    at base 96 / Large 1.2, against today in brackets:

    | Shape | Small | Medium | Large |
    |-------|------:|-------:|------:|
    | Casual · Avid | 1390 (1278) | 1425 (1307) | 1567 (1602) |
    | Express 2P | 1607 (1461) | 1653 (1499) | 1838 (1884) |
    | Express 3P | 1556 (1408) | 1603 (1447) | 1789 (1836) |
    | Express 4P | 1498 (1366) | 1540 (1401) | 1707 (1749) |

    Within-shape spread does collapse as intended (Casual 324 → 177), but the cheapest floor rises 112px
    and the dearest barely moves. So what the re-pitch actually buys is **a bigger Medium** — the
    felt-filling that Large was raised to `1.5 ×` for in the first place — and it should be judged as
    that, a desktop aesthetics change, not as a layout fix. It is **not** a prerequisite for anything
    responsive: the narrow layout sizes off container queries, never off `--ucs-card-scale`. Costs a
    re-check of every tuned layout (2P Express is signed off — don't regress it).
  - **Leave the scale, cap the strip.** Keep 1.5 × but stop it overflowing: `max-width` on the board
    strip, or let it wrap. Smallest change; leaves the floors in place.
  - **Fluid sizing off the container.** Only if the first two prove insufficient — it would be novel
    for this codebase *and* for every reference game, so it carries the most risk for the least
    precedent.
  - **Casual, wide (desktop)** — a confirmation sweep. It is the cheapest shape in the game (1278 at
    Small) and unchanged by the folds, so likely fine, but unverified since the layout reworks.
- **`handSizeScale()` has the cssPref race that `wideLayoutFloor()` just shed.** It reads
  `html.ucs-cards-*` off `document.documentElement` at setup, and BGA applies that class asynchronously —
  the same ordering hazard that had a Large session caching the Medium narrow/wide floor all game. Here
  the consequence is the fanned hand's card frame sized for Medium (1.0) instead of Large (1.4) whenever
  the class lands after `setupHandStock()`. Fix is to reuse `cardSizeScale()`, which reads the preference
  value. Worth checking whether any other DOM-class read shares the pattern before closing it out.
- **Animations** — more of them. *Open question:* which moments? Trick resolution and scoring look
  like the gaps.
- **Knitting area: normalise sweater art registration across cards** — the sweater silhouette is
  drawn at a slightly different horizontal position on each card face, so an assembled sweater built
  from mismatched cards (the normal case) doesn't tile cleanly: the L/R/B pieces jog left/right of
  each other. Verified by extracting the B faces and mocking assemblies from the real sprite — a
  matched-colour set tiles, mixed sets don't, and the per-card offset varies in both directions, so
  no single CSS nudge fixes it. Real fix is in `scripts/build-sprites.mjs`: segment the sweater from
  the watercolour background per card and shift each cell to a consistent registration (L body to its
  right edge, R to its left, B centred), so any L+R+B tiles. Heuristic; verify across all 52 cards by
  eye. The layout itself (rotate B, centre, butt) is already correct.
