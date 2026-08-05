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

- **Responsive / mobile** — checklist: the game must work on a mobile device. Related checklist
  line: if elements don't occupy all available horizontal space, they should be centered.

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
  - **Avid and Casual, narrow** — never given a narrow arrangement at all. Avid's 3 landscape Secret
    Santas are the wide layout's most expensive term and it only stacks them above 1000px; below that
    they still run as a row. Part of the Casual/Avid responsive item below.
  - **`.ucs-fad-chip` is dead code.** `fadChipEl()` renders an abstracted "[colour] / [icon]" read-out
    into every Fad card for a narrow layout that would drop the card art, but no rule ever unsets its
    `display: none` — it belongs to the retired narrow rail (see `responsive.md`'s stale-structure
    caveat). Either wire it up as the genuine fallback for widths where Fad art stops being readable
    (~<72px card width, which is what stopped 4P mirroring the wide block), or delete it and its
    renderer. Right now it is a promise the CSS does not keep.
  - **Express, Large card size, narrow** — Large deliberately keeps the plain vertical stack (no
    sidebar). Confirm that still reads well, or decide whether Large should also get the sidebar.
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
  - **The Tier A/B boundary is ~300px too low.** The wide layout is selected from 1001px, but the
    cheapest shape (Casual at Small) needs **1278** and most need far more. Between 1001 and a shape's
    floor the three-column layout is chosen and then squeezed — `#ucs-board-strip` is `flex: 0 0 auto`,
    so `#ucs-center-stack` is what gives. Re-derive the breakpoint from the totals table now that all
    five shapes are costed, rather than inheriting 1000 from the retired four-column grid. Interacts
    with Large being excluded from the narrow sidebar.
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
    matches their large — so Large is doing the work of "normal". Raising base to ~95–100 and Large to
    ~`1.2 ×` puts Large's floor at ≈1600 against Medium's 1443 (per the formula in
    [`responsive.md`](responsive.md)) — not identical, but close enough that **one** floor at 1600 could
    serve all three sizes, costing Medium only a 157px band where it could have folded and doesn't.
    Today's `1.5 ×` spreads those floors 392px apart, which is why they can't share a number. Costs a
    re-check of the tuned layouts (2P Express is signed off — don't regress it); the numbers themselves
    now fall out of the formula rather than needing re-derivation.
  - **Leave the scale, cap the strip.** Keep 1.5 × but stop it overflowing: `max-width` on the board
    strip, or let it wrap. Smallest change; leaves the floors in place.
  - **Fluid sizing off the container.** Only if the first two prove insufficient — it would be novel
    for this codebase *and* for every reference game, so it carries the most risk for the least
    precedent.
  - **Casual & Avid, narrow/mobile** — never taken through the responsive pass: their Fad keeps full
    card art and the revealed Secret Santa widens the strip, so the narrow layout needs the same
    fill treatment Express got, at all card sizes. Relates to the release-blocking responsive item.
  - **Casual, wide (desktop)** — a confirmation sweep. It is the cheapest shape in the game (1278 at
    Small) and unchanged by the folds, so likely fine, but unverified since the layout reworks.
- **Animations** — more of them. *Open question:* which moments? Trick resolution and scoring look
  like the gaps.
- **How-to-play rules summary** — in-client summary so players don't need the rulebook PDF.
- **Knitting area: normalise sweater art registration across cards** — the sweater silhouette is
  drawn at a slightly different horizontal position on each card face, so an assembled sweater built
  from mismatched cards (the normal case) doesn't tile cleanly: the L/R/B pieces jog left/right of
  each other. Verified by extracting the B faces and mocking assemblies from the real sprite — a
  matched-colour set tiles, mixed sets don't, and the per-card offset varies in both directions, so
  no single CSS nudge fixes it. Real fix is in `scripts/build-sprites.mjs`: segment the sweater from
  the watercolour background per card and shift each cell to a consistent registration (L body to its
  right edge, R to its left, B centred), so any L+R+B tiles. Heuristic; verify across all 52 cards by
  eye. The layout itself (rotate B, centre, butt) is already correct.
