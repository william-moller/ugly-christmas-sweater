# Responsive layout spec

What the board looks like at each width, and the size floors nothing may go below. Written because the
narrow layout was previously designed reactively — one screenshot complaint at a time — which cost
several rebuild/deploy round trips and still left "too small" judgements unsettled.

Ground rule 1 still applies: **these numbers are derived, not preferences.** Each floor below is
computed from the card's own CSS ratios (in `src/scss/Game.scss`), so if those ratios change,
re-derive rather than nudging the number until a screenshot looks right.

## Size floors (the non-negotiables)

Card sub-elements are all sized as fractions of `--ucs-card-w`, so one card width sets every glyph:

| Element | Ratio of card width | Source |
|---------|--------------------|--------|
| Printed value | `0.30` | `.ucs-card-value` |
| Orientation letter on the bulb (L/R/B) | `0.16` | `.ucs-bulb` |
| Sweater icon | `0.46` | `--ucs-icon-size` |
| Round Tracker wreath cell | `26.5%` | `.ucs-rt-cell` |

**Interactive card (Draft Pool, Trade Area, hand): floor 56px wide.**
The binding constraint is the *smallest* glyph, the bulb letter at `0.16 × W`. A single uppercase
letter needs ≈9px to stay readable → `W ≥ 56px`. At 56px the value renders 17px and the icon 26px,
both comfortable. A 56px card is 87px tall, which clears WCAG 2.2 AA target size (24×24 CSS px,
SC 2.5.8) and Apple's 44×44 HIG guidance with room to spare — so tap targets are never the binding
constraint here; legibility is.

**Reference card (Perfect Fit / Trendy Yarn / Round Tracker in the rail): floor 95px wide.**
Driven entirely by the Round Tracker: each wreath is `0.265 × W`, and the printed 1–12 numeral inside
it is roughly 45% of the wreath, so the numeral is ≈`0.119 × W`. For a ~10px numeral, `W ≥ 84px`;
rounded up for safety → **95px**. The rail currently runs 120px, which is deliberately above the
floor so the Fad chips (32×44 swatch/icon) also sit comfortably.

**Text: 11px absolute floor, 13–15px for anything you navigate by.**
Zone labels you orient from (Draft Pool, Trade Area, Your Secret Santa) are 15px. 9–10px uppercase
letter-spaced text is legible only in short bursts and should not carry meaning you need mid-turn —
if a caption only works at 9px, cut the caption instead (this is why the rail's Fad and Round Tracker
headings were removed rather than shrunk).

**Never below the floors — reflow instead.** If a tier can't fit its content at these sizes, it moves
to the next tier's structure. Shrinking past a floor is not an option.

## Tiers

Widths are `window.innerWidth` in CSS px. Reference devices: 320 (iPhone SE), 360–414 (mainstream
phones), 768 (iPad portrait), 1024+ (tablet landscape / desktop).

### Tier A — wide, ≥1000px
The full four-column grid: `params | santa | center | oppo`, knitting under the centre.

**Why 1000 and not the current 800:** the desktop grid needs `210 (params) + ~128 (santa) + ~380
(centre, four cards + gaps) + 210 (opponents) + 36 (gaps) + 16 (padding)` ≈ **980px**. Below that it
is already cramped, so a breakpoint at 800 leaves 800–1000px rendering a squeezed desktop layout.
**This is a live discrepancy: the code currently switches at 800px and should switch at 1000px.**

### Tier B — rail, 450–1000px
Two columns: a fixed 120px reference rail (Perfect Fit → Trendy Yarn → Fad chips → Round Tracker) and
a flexible play column (Draft Pool → Trade Area → knitting → opponents). Draft Pool and Trade Area are
both four slots wide and share a card size derived from the column's container width.

**Why 450 is the floor:** `16 (table padding) + 120 (rail) + 10 (gap) + centre`, where the centre
needs `4 × 56 (cards) + 36 (gaps) + 16 (zone padding) + 24 (rotated label overhang)` = 300px.
Total ≈ **446px**. Below that the rail and a four-card row cannot coexist at the floors.

### Tier C — stacked, <450px  *(not yet implemented)*
Single column. The rail's contents become a **horizontal strip across the top** (Perfect Fit, Trendy
Yarn, Round Tracker, Fad chips side by side), with everything else full width beneath it.

**Why this works at phone widths:** at 360px the usable width is 344px, so four Draft Pool cards get
`(344 − 16 − 36 − 24) / 4` = **67px** each — above the 56px floor. Giving up the rail buys back
exactly the width the cards need. At 320px the same arithmetic yields 61px, still above the floor.

## Deliberate non-goals

- **No `bga-zoom` scale-to-fit as the primary mechanism.** Our design width is ~1000px, so fitting a
  500px viewport by scaling means 0.5× — 80px cards become 40px and 12px labels become 6px, straight
  through every floor above. Scaling is viable only for the mid-range where the desktop layout is
  merely a little large. If it is ever added, it must wrap **only the tabletop**: `bga-zoom` scales
  via `transform`, and a transformed ancestor breaks the floating `HandStock` (see the shared
  `framework.md`) — `#ucs-my-hand-wrap` has to stay outside the zoomed element.
- **`bga-autofit` is not a layout tool.** It shrinks content to fit a box that already has a fixed
  size (its own docs require fixed width/height). Useful for variable-length text in a fixed box —
  opponent names, bonus card names — and nothing else here.
- **No transform on the hand or any ancestor of it, at any width, ever.** See `framework.md`.

## Open items

- Tier A breakpoint is 800px in code, should be 1000px per the derivation above.
- Tier C is unimplemented; below 450px the Tier B layout will overflow horizontally.
- Casual/Avid have not been through any of this: their Fads keep full card art in the rail, and the
  Secret Santa card widens the rail past 120px. Tier B is specified against Express only.
