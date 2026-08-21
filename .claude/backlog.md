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
  be centered. `Game.scss` centres in ~22 places, so this is a *verification* pass, not a build: find
  the zones that still stretch or left-pin when their row is shrink-to-fit. Two bands are worth the
  attention — narrow widths generally, and the 1000px-to-shape-floor band that the boundary change made
  reachable, where fluid rows now centre in the slack rather than filling it (see the caps section in
  [`responsive.md`](responsive.md)).
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
  - **The fanned hand on real hardware.** The narrow hand is now sized from the viewport rather than the
    Card-size preference, and clears the bottom-corner buttons by *rising* rather than by reserving
    width (`handCardWidth` / `fanLift`; the derivations are in
    [`responsive.md`](responsive.md#the-floating-hand-on-a-phone)). None of it can be checked off a
    static harness — it needs `bga-cards` running, a real 9-card hand, and BGA's own corner controls.
    Confirm on a phone: every card's value + orientation bulbs readable and *tappable* (the buttons are
    z-index 949 against the fan's 900, so anything of theirs over a card swallows its clicks), the fan
    still floating rather than locked in flow, and the lift relaxing to 0 once the hand scrolls above
    the fold. The right-hand clearance carries a measured 120px constant for BGA's replay + chat pair —
    if they still clip, that is the number to raise.
  - **Express 2P, phone widths — does the Fad art still read?** 2P is the one shape whose narrow Fads
    go under the ~72px where the art stops being legible: `min(135px, (100cqi - 24px) / 5)` resolves to
    ~64px at 360px and ~56px at 320px, against ~72–110px for every other shape. If it reads badly, fold
    the five-card row into a grid the way 3–4P already do — reflow, not shrink. (The `.ucs-fad-chip`
    abstraction that used to sit here as a maybe-fallback has been deleted; it belonged to the retired
    120px rail and never rendered.)
  - **Large, narrow** — Large now uses the sidebar like every other size, and my knitting area is capped
    at `min(card × scale, 25vw)` so one sweater can't claim most of a phone. Unverified by eye.
  - **Express, wide (≥1000px desktop)** — confirm the desktop layout is still clean after the
    Round-Tracker sidebar relocate/restore (2P/4P: tracker bottom-left, opponents in the right column;
    3P: tracker stacked over the opponents in the right column, Fads 2×2 — see `responsive.md`).
  - **Express 4P and Avid, wide** — both now folded (4P: Fads 3-across + Perfect Fit under Trendy Yarn +
    tracker top-right; Avid: Secret Santas stacked below its row floor). Verified by arithmetic only —
    1561 and 1467 at Large, per [`responsive.md`](responsive.md) — never seen in a real table. Wants eyes
    on a 4P Express and a 3P Avid game at each card size, particularly the strip *height*: 4P runs two
    Fad rows and Avid three stacked landscape Santas, and neither was checked against the centre
    column's height.
  - **Casual, wide (desktop)** — a confirmation sweep. It is the cheapest shape in the game (1291 at
    Small) and unchanged by the folds, so likely fine, but unverified since the layout reworks.
  - **Express 2P at Large (1659) is the one shape that still misses a 1536px laptop.** Every other shape
    now reaches the wide layout there — Casual 1467, Express 3P 1507, 4P 1561. The Fad-grid fold would
    bring 2P down too, but its five-card parameter row is not obviously wrong to look at, and at 1659 it
    now sits 261px inside a 1920 screen rather than 36px. Decide whether to fold it for the laptop case
    or leave it. (Widest *shipped* arrangement is no longer this one but Avid's unscaled Santa row at
    1813 — which is exactly what the item below is about.)
- **Decide whether Medium should draw bigger cards.** This is what is *left* of the old "narrow the
  card-size spread" item, which asked for size and layout to stop being one axis. That goal has been
  met — pinning the board strip took every zone except the Draft Pool off `--ucs-card-scale`, so
  within-shape spread across the preference is now a flat **176px** (`320 × 0.55`) instead of 300–500px,
  and Large is a size axis rather than a layout one (see finding 5 in [`responsive.md`](responsive.md)).
  What remains is purely aesthetic: our base 80px is *below* soothsayers' small (100px) while our Large
  (120px) matches their large, so Large is doing the work of "normal" and Medium can look thin on a big
  monitor. Raising base to ~96 with Large at `1.2 ×` would fill it out. Note it **raises** every floor
  by ~20% rather than lowering them, so judge it as a desktop aesthetics change and nothing more; it is
  not a prerequisite for anything responsive, since the narrow layout sizes off container queries and
  never off `--ucs-card-scale`. Costs a re-check of every tuned layout (2P Express is signed off — don't
  regress it).
- **Eyes on the Express 3P Santa column at Large, 1610–1840px.** `$santa-column-floors` was re-derived
  off the pinned formula (Large 1840 → 1610), so that 230px band now runs an arrangement it has never
  run before: my two Secret Santas as a third strip column rather than a stacked row under the
  parameter cards. The arithmetic says the strip fits, but that is the one direction where being wrong
  is *visible* — too low a floor lets `#ucs-board-strip` (`flex: 0 0 auto`) push `#ucs-center-stack`
  into the opponents. Wants a 3P Express table at Large, sized across the band. Revert to 1840 if it
  crowds; the column is an upgrade within the wide layout, so the old floor is a safe fallback.
- **Avid at Large stacks its Secret Santas on a laptop.** `$avid-santa-row-floors` puts the three-Santa
  row at 1590 for Large, while the wide layout itself starts at 1467 — so 1467–1590 is a band where the
  wide layout runs but the Santas fall back to the stacked column, which costs ~600px of height. A
  1536px laptop sits squarely in it, and only at Large: Small (1415) and Medium (1430) both clear at
  that width, which is why the shape reads fine at those sizes and wonky at Large. The 1590 is correctly
  derived, so this is a design choice rather than an arithmetic fix — the lever is the 125px minimum
  slot (an 80px card) that the row must clear before it is allowed. Either let the row run below 125px
  at Large, or accept the stacked column there. *Open question:* is a 108px Santa slot (what 1536 would
  give) readable enough? They are read-once and never clicked, so the 56px interactive floor does not
  bind — the 95px reference floor does not either, since a Santa has no Round Tracker numerals.
- **Animate the new-round board deal.** Every other point where a card changes location is now marked
  (play, draft, trick collection, hand refill and new-round deal, Billy's discard, Tina's rearrange, and
  the parameter reveals). `notif_newRound` is the one left: `renderAll()` replaces the draft pool and
  wipes every knitting area in a single snap. It was held back because it is a choreography question,
  not a helper call — stagger order across the pool, whether the knitting wipe animates out or is simply
  gone, and how long the whole thing may take before it is in the way of the first draft. The pieces to
  build it with already exist (`flipFromRects`, `fadeCardOut`, `handStock.addCards`'s `fromElement`).
- **Scoring has no animation.** Round scoring lands as a summary sheet; nothing on the table moves or
  counts up. Unlike the deals above, this is not a card-movement gap — it wants `displayScoring`-style
  point call-outs per scoring step, which is a different mechanism. *Open question:* is the sheet enough?
- **Knitting area: normalise sweater art registration across cards** — the sweater silhouette is
  drawn at a slightly different horizontal position on each card face, so an assembled sweater built
  from mismatched cards (the normal case) doesn't tile cleanly: the L/R/B pieces jog left/right of
  each other. Verified by extracting the B faces and mocking assemblies from the real sprite — a
  matched-colour set tiles, mixed sets don't, and the per-card offset varies in both directions, so
  no single CSS nudge fixes it. Real fix is in `scripts/build-sprites.mjs`: segment the sweater from
  the watercolour background per card and shift each cell to a consistent registration (L body to its
  right edge, R to its left, B centred), so any L+R+B tiles. Heuristic; verify across all 52 cards by
  eye. The layout itself (rotate B, centre, butt) is already correct.
