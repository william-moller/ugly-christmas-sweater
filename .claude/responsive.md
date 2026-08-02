# Responsive layout spec

What the board looks like at each width, and the size floors nothing may go below. Written because the
narrow layout was previously designed reactively — one screenshot complaint at a time — which cost
several rebuild/deploy round trips and still left "too small" judgements unsettled.

Ground rule 1 still applies: **these numbers are derived, not preferences.** Each floor below is
computed from the card's own CSS ratios (in `src/scss/Game.scss`), so if those ratios change,
re-derive rather than nudging the number until a screenshot looks right.

## Scoping a layout instruction — the three axes

Spacing/sizing here varies along **three orthogonal axes**, each driven by a *different* mechanism.
An instruction that doesn't pin all three is ambiguous, and a fix aimed at the wrong axis regresses
the other two. So scope every layout instruction as a **coordinate** — one value per axis — using this
vocabulary:

| Axis | Words | Code vocabulary | Controls | Lives in |
|------|-------|-----------------|----------|----------|
| **Variant** | avid / casual / express | game mode, option `101`; `isExpress()` / `isAvid()` | **which components exist** (Round Tracker, Fad display, claimed-Fad chips, extra Secret Santas) — a DOM-presence axis, not a sizing one | server gamedatas + client branches |
| **Card-size preference** | small / medium / large | pref `101` → `<html>.ucs-cards-{small,medium,large}` → `--ucs-card-scale` | a **discrete multiplier** on interactive card art only (hand, centre stack, own knitting); needs a reload | `gamepreferences.jsonc` + `Game.scss` |
| **Display size** | phone / tablet / monitor | responsive **Tier C / B / A** at `<450` / `450–1000` / `≥1000` px `innerWidth` | **layout structure** (stacked / rail / four-column grid) | this doc + `@media` in `Game.scss` |

Template: **"In [variant], at [tier / px], with card size [pref] — [component] should [change]."**

Defaults when an axis is omitted (so all three needn't be spelled out every time): **Tier A** (monitor,
≥1000px), card size **Medium**, variant **Express**. Say "all variants" / "all sizes" / "everywhere"
to explicitly leave an axis unscoped.

Keep **preference ≠ display size** sharp: "Large" is a user's chosen multiplier, "monitor" is a viewport
width — a phone user can pick Large and a monitor user can pick Small. They're set in different places,
so "bigger cards on desktop" is ambiguous until you say which one you mean.

Two scope caveats already documented below, restated because they change how an instruction lands: the
Tier vocabulary is currently specified **against Express only** (Casual/Avid haven't been through the
responsive pass — see Open items), and Tier C (phones) is **unimplemented**. An instruction into either
region gets design questions from me, not just a nudged number.

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

> **Stale-structure caveat (verify against `Game.scss`).** The per-tier *structures* below — the
> four-column grid, the 120px reference rail — predate the current layout: the grid was reworked to
> flex (`#ucs-upper` / `#ucs-lower`), the tablet rail was retired (see the note in `Game.scss`'s
> desktop `@media` block), and the narrow view now uses the Express Round-Tracker sidebar
> (`.ucs-narrow-sidebar`, toggled in `Game.ts::layoutNarrowSidebar`). Treat the tier structures as
> historical rationale; the **size floors above are the durable part**.

### Tier A — wide, ≥1000px
The full four-column grid: `params | santa | center | oppo`, knitting under the centre.

**Express · 3 players** folds the board strip instead of running it flat, because 3P deals 4 Fads
(`players + 1`) and a six-card parameter row pushes the centre column right for no gain:

- Fads in a **2×2 grid** (`display: grid`, not a wrap — a wrap can reflow to 3+1).
- **Perfect Fit under Trendy Yarn**, as a column beside the Fads. The markup order is Perfect Fit
  first, so this is `column-reverse` rather than a DOM change.
- **Round Tracker top-right**: stacked over the opponents in `#ucs-right-col`, right of the Draft
  Pool, instead of bottom-left in `#ucs-lower`. Sized `1.4 × $card-w` there (down from `2 ×`) —
  106px at Small, still clear of the 95px reference-card floor above.

None of this shrinks the Draft Pool: at Tier A its cards are a fixed multiple of the Card-size
preference, not a fraction of the container, and the tracker is narrower than a full opponents panel.
Holds at **every card-size preference**. The DOM moves live in `Game.ts::layoutNarrowSidebar`
(`rtTopRight()`); the ≤1000px sidebar layout is excluded via `:not(.ucs-narrow-sidebar)` and keeps its
own arrangement of the same cards.

**Express · 3 players · Medium and Large, on a wide enough viewport** adds one more fold: my two Secret
Santas become a **third column** of the board strip (right of Trendy Yarn / Perfect Fit, left of the
Draft Pool), **stacked** rather than side by side. The pair was a row nothing else shared — 576px wide
at Large, 388px at Medium — wider than the parameter row above it.

Each size carries its **own viewport floor**, because every width in the sum scales with
`--ucs-card-scale`. Derived, not nudged (`$santa-column-floors` in `Game.scss`):

| Piece | Medium | Large |
|-------|-------:|------:|
| Fads 2×2 (`2 × card-w + 6`) | 186 | 276 |
| Perfect Fit / Trendy Yarn column + gap | 102 | 147 |
| Secret Santa column + gap (rotated: `--ucs-card-h` 188 × scale) | 200 | 294 |
| Centre (4 Draft Pool cards + `3 × 12` + 16 padding + 24 label overhang) + gap | 408 | 568 |
| Right column at the opponents' 5-sweater cap + gap | 268 | 268 |
| `#ucs-table` padding | 16 | 16 |
| **Game area needed** | **1180** | **1569** |
| BGA's own player-panel column + margins | ≈263 | ≈263 |
| **Viewport floor** | **1450** | **1840** |

Below its floor a size keeps the stacked Santa row: the strip would otherwise push the centre column
into the opponents. **Small** has no floor — it uses the Santa row at every width. Note the right column
is the opponents' worst case (five sweaters wide); early in a game it is ~115px, so the fold has more
slack in practice than the floor assumes.

> **Large at Tier A is tight before any of this.** Even without the Santa column, 3P Express at Large
> needs ≈1428 game-area px (≈1690 viewport); under that the centre column and the opponents already
> crowd. Nothing clamps it — `#ucs-board-strip` is `flex: 0 0 auto`, so the centre stack is what gives.
> Tracked in [`backlog.md`](backlog.md).

**Why 1000px:** the desktop layout needs roughly `params + centre (four cards + gaps) + opponents +
gaps + padding` ≈ **980px** before it gets cramped, so the stacked layout collapses at
`@media (max-width: 1000px)` in `Game.scss`. (An earlier build switched at 800px, leaving 800–1000px
rendering a squeezed desktop — that discrepancy is resolved.)

### Tier B — rail, 450–1000px
Two columns: a fixed 120px reference rail (Perfect Fit → Trendy Yarn → Fad chips → Round Tracker) and
a flexible play column (Draft Pool → Trade Area → knitting → opponents). Draft Pool and Trade Area are
both four slots wide and share a card size derived from the column's container width.

**Why 450 is the floor:** `16 (table padding) + 120 (rail) + 10 (gap) + centre`, where the centre
needs `4 × 56 (cards) + 36 (gaps) + 16 (zone padding) + 24 (rotated label overhang)` = 300px.
Total ≈ **446px**. Below that the rail and a four-card row cannot coexist at the floors.

### Tier C — stacked, <450px  *(superseded — see the stale-structure caveat)*
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

- The narrow view is built for **Express** at Small/Medium. Every other combination (Express 3–4P,
  Express Large, Express wide, and **Casual/Avid** — whose Fad keeps full card art and whose revealed
  Secret Santa widens the strip) still needs a visual pass. Tracked in [`backlog.md`](backlog.md)
  under "Visual polish sweep."
- True-phone widths (<450px) now render via the Express narrow-sidebar layout down to ~360px; the
  other variants/counts there are part of the same sweep.
