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
  **Express at Small/Medium** (2P: Fads + Perfect Fit + Trendy Yarn on one row; 3–4P: Fads 3-across
  with Trendy Yarn under Perfect Fit; parameter + Secret Santa cards filled to the column beside the
  Round-Tracker sidebar). Every other combination still wants an eyes-on pass — down to true-phone
  widths (<450px) — so all read as clean as the 2P Express view now does:
  - **Express, 3–4 players, narrow** — the layout exists but has only been verified at 2P. Confirm the
    Fad wrap (max 3 across), the stacked Perfect Fit / Trendy Yarn, and the Secret Santa fill at Small
    and Medium, from ~360px up to 1000px.
  - **Express, Large card size, narrow** — Large deliberately keeps the plain vertical stack (no
    sidebar). Confirm that still reads well, or decide whether Large should also get the sidebar.
  - **Express, wide (≥1000px desktop)** — confirm the desktop layout is still clean after the
    Round-Tracker sidebar relocate/restore (2P/4P: tracker bottom-left, opponents in the right column;
    3P: tracker stacked over the opponents in the right column, Fads 2×2 — see `responsive.md`). 4P
    deals 5 Fads and still runs them all in one row; decide whether it wants the 3P treatment too.
  - **Large cards on a mid-size desktop (≈1000–1700px)** — Large at Tier A wants ≈1690px of viewport
    before 3P Express stops crowding, and nothing clamps it: `#ucs-board-strip` is `flex: 0 0 auto`, so
    the centre stack is what gives when the row runs out of room. Decide what should happen in that band
    — drop Large to the narrow sidebar (it's currently excluded), let the strip wrap, or cap the card
    scale off the available width. Numbers in [`responsive.md`](responsive.md).
  - **Casual & Avid, narrow/mobile** — never taken through the responsive pass: their Fad keeps full
    card art and the revealed Secret Santa widens the strip, so the narrow layout needs the same
    fill treatment Express got, at all card sizes. Relates to the release-blocking responsive item.
  - **Casual & Avid, wide (desktop)** — a confirmation sweep; likely fine (original design) but
    unverified since the layout reworks.
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
- **Reveal covered cards in a knitting area** — a way to see what a build slot previously held after a
  card was "placed over" it. Today the covered piece is discarded outright (`modules/php/Game.php:1090`),
  so nothing is retained to reveal — the feature first needs covered pieces kept under the slot (a
  data-model change that also has to reshuffle them at round end). *Open question — ask the publisher:*
  is peeking at covered cards meant to be allowed for anyone, only the owner of that knitting area, or
  nobody? That answer decides both whether pieces are retained and who the reveal is exposed to.
- **Patch assignment UI: compact grid + one-at-a-time** — at end of round, choosing a patch's value
  and icon currently renders one tall single-column button list per patch, stacked side by side. Two
  problems: (1) the buttons waste space — lay them out like a keypad, ~4 numbers wide, and the same
  for the icon buttons, so the menu is a compact grid instead of a full-height column. (2) When a
  player has multiple patches to assign, resolve them one at a time: today all menus show at once and
  the second patch's sweater sits fully hidden behind the first patch's selection menu, so the player
  can't see the card they're assigning to.
