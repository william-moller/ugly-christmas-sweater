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
| **Display size** | phone / tablet / monitor | **narrow / wide**, split at the shape's own floor (`Game.ts::wideLayoutFloor`), plus a `<450px` phone tweak | **layout structure** (stacked+sidebar / three-column) | this doc + `#ucs-table.ucs-narrow` in `Game.scss` |

Note that **pref `101` is one of three player preferences**, and the only one that is a layout axis —
`100` (confirm gate) and `102` (hand sort) change behaviour, not arrangement, so they never enter a
layout coordinate. All three are tabulated in
[`architecture.md`](architecture.md#player-preferences-gamepreferencesjsonc).

Template: **"In [variant], at [tier / px], with card size [pref] — [component] should [change]."**

Defaults when an axis is omitted (so all three needn't be spelled out every time): **Tier A** (monitor —
the wide layout), card size **Medium**, variant **Express**. Say "all variants" / "all sizes" / "everywhere"
to explicitly leave an axis unscoped.

Keep **preference ≠ display size** sharp: "Large" is a user's chosen multiplier, "monitor" is a viewport
width — a phone user can pick Large and a monitor user can pick Small. They're set in different places,
so "bigger cards on desktop" is ambiguous until you say which one you mean.

The tier *names* below (A/B/C) are kept as vocabulary for the width bands, but they are no longer three
fixed structures: there are **two** — narrow and wide — and the switch between them is per shape and per
card size, not a shared px constant. See "The narrow/wide boundary".

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

## Upper caps — the narrow layout's fluid sizing

Everything above is a *lower* bound. The narrow layout needs upper ones too, for a reason that only
appeared once the boundary moved to each shape's real floor: **narrow stopped being a phone layout.**
It is now what renders at every width below that floor — up to 1467px for Casual at Large and 1659 for
Express 2P — so its fluid `100cqi` sizing, which divides the container across the row, gets handed
containers several times wider than the ~1000px it was tuned against. Uncapped, a Casual parameter card
resolved to **~376px on a 1536px laptop**: more than twice what the wide layout draws at Large, with the
arithmetic working exactly as written.

Every fluid rule is therefore capped at the **wide layout's own Large size** — the largest that card is
ever meant to be drawn anywhere:

| Cards | Cap | Derivation | Lives in |
|-------|----:|------------|----------|
| Fads / Perfect Fit / Trendy Yarn | 135px | 90px reference base × 1.5 | `$narrow-ref-cap` |
| Secret Santa (Casual 1 · Express 2 · Avid 3) | 192px | 128px Santa base × 1.5 | `$narrow-santa-cap` |
| Draft Pool / Trade Area | 128px | 80px interactive base × 1.6 | inline `min()` on `#ucs-draft-pool` |

The caps are **flat px, not `--ucs-card-scale`-derived**, so the narrow layout stays preference-independent
— which is the whole point of sizing it off the container in the first place. Below the cap the
expressions are untouched, so phone widths render exactly as they did; the caps bind only in the
1000–1659px band that the boundary change made reachable, where the rows now centre in the slack
instead of stretching to fill it.

> **If you add a fluid rule, cap it.** The Draft Pool was capped from the start and was the one zone
> that survived the boundary change intact; the eight rules that weren't all had to be fixed at once.

## Tiers

Widths are `window.innerWidth` in CSS px. Reference devices: 320 (iPhone SE), 360–414 (mainstream
phones), 768 (iPad portrait), 1024+ (tablet landscape / desktop).

> **Stale-structure caveat (verify against `Game.scss`).** The per-tier *structures* below — the
> four-column grid, the 120px reference rail — predate the current layout: the grid was reworked to
> flex (`#ucs-upper` / `#ucs-lower`), the tablet rail was retired (see the note in `Game.scss`'s
> desktop `@media` block), and the narrow view is now a sidebar layout
> (`.ucs-narrow`, toggled in `Game.ts::layoutNarrowSidebar` at the width `wideLayoutFloor()` returns, for every variant and card size). Treat the tier structures as
> historical rationale; the **size floors above are the durable part**.

### Tier A — wide (at or above the shape's floor; see "The narrow/wide boundary")
The full four-column grid: `params | santa | center | oppo`, knitting under the centre.

**Express · 3 and 4 players** fold the board strip instead of running it flat, because Express deals
`players + 1` Fads and a six- or seven-card parameter row pushes the centre column right for no gain:

- Fads in a **grid** with a fixed column count (`display: grid`, not a wrap — a wrap can reflow to a
  ragged 3+1): **2 across at 3P** (4 Fads → 2×2), **3 across at 4P** (5 Fads → 3 then 2). A 2-wide grid
  would make 4P narrower still, but three rows of Fads run taller than the whole centre column, and
  3-across already brings 4P inside a 1920 screen (1749 at Large).
- **Perfect Fit under Trendy Yarn**, as a column beside the Fads. The markup order is Perfect Fit
  first, so this is `column-reverse` rather than a DOM change.
- **Round Tracker top-right**: stacked over the opponents in `#ucs-right-col`, right of the Draft
  Pool, instead of bottom-left in `#ucs-lower`. Sized `1.4 × $card-w` there (down from `2 ×`) —
  106px at Small, still clear of the 95px reference-card floor above. It costs the right column no
  width: even at Large it is narrower than an opponents panel.

2P Express is left flat: 3 Fads make a five-card row that is already narrow, and there is no bottom-left
corner to reclaim.

**Avid · any player count** puts its **three revealed Secret Santas in a row**, and — the part that makes
the row affordable — **pins them to their unscaled 128×200**, ignoring the Card-size preference. They are
read-once private objectives; you never click one, so they are not interactive card art and the
preference's job (making the things you *pick from* bigger) does not apply. Scaled, a Large slot is 300px
and the row is 956px — 2093px of viewport, past any common monitor, which is why they were stacked into a
column instead. But stacked they run ~600px tall at Large, most of the table's height.

Unscaled, the row is **656px at every card size** (`3 × 200 slot + 2 × 8 gap + 16 zone padding + 24 label
overhang`), so only the Draft Pool still scales:

```
viewport = 320 × scale + 1333      # 320 = Draft Pool 4 × 80; the strip is now a pure FIXED term
```

→ **1637 / 1653 / 1813** at Small / Medium / Large — the widths at which three *full-size* slots fit.

Those are no longer the floors, because pinning the row to 128×200 made it all-or-nothing: one pixel
below and it collapsed to a column, which wastes the very width the row exists to reclaim (three cards
stacked leave the strip one card wide and the space beside them empty). The row now **shrinks** instead.
Rearranged, everything that is *not* the three slots costs `320 × scale + 733`, so:

```
slot = min(200px, (100vw - (320 × scale + 733)) / 3)
```

The cap binds at exactly 1637 / 1653 / 1813, so at those widths and above this renders identically to
the pinned row. `$avid-santa-row-floors` is now where a slot would fall under **125px (an 80px card)** —
**1415 / 1430 / 1590** — and only below that does the stacked column come back.

Note the 95px reference-card floor does **not** bind here: it is derived from the Round Tracker's wreath
numerals, and a Secret Santa card has none. The narrow layout already renders these same cards at ~69px.

The Express folds above only ever make the strip **narrower**, so neither carries a width floor. The Avid
row and the Express Secret Santa column both *widen* it, and therefore both do.

Note what the un-scaling does to the shape's cost curve: it is nearly **flat** across the preference
(1637→1813, a 176px spread, all of it the Draft Pool), where every other shape swings 300–500px. That is
the general lesson — moving a zone off `--ucs-card-scale` is the cheapest way to buy width at Large, and
the test for whether it is legitimate is *interactive or reference*, not *how big it looks*.

Casual keeps its single Santa scaled: its strip is the parameter row at every size, so the Large art is
free there.

None of this shrinks the Draft Pool: at Tier A its cards are a fixed multiple of the Card-size
preference, not a fraction of the container, and the tracker is narrower than a full opponents panel.
Holds at **every card-size preference**. The DOM moves live in `Game.ts::layoutNarrowSidebar`
(`rtTopRight()`); the narrow sidebar layout is excluded via `:not(.ucs-narrow)` and keeps its
own arrangement of the same cards.

**Express · 3 players · Medium and Large, on a wide enough viewport** adds one more fold: my two Secret
Santas become a **third column** of the board strip (right of Trendy Yarn / Perfect Fit, left of the
Draft Pool), **stacked** rather than side by side. The pair was a row nothing else shared — 576px wide
at Large, 388px at Medium — wider than the parameter row above it.

Each size carries its **own viewport floor**, because part of the width scales with `--ucs-card-scale`
and part doesn't. Don't derive these one at a time — use the formula below.

## The width floor formula

Every "does this arrangement fit?" question splits into two terms: card widths, which scale with the
Card-size preference, and everything else — gaps, padding, and the opponents' column — which doesn't
(`--ucs-mini-build-w` is a hard 44px on purpose, see `.ucs-knitting-compact`). So for any arrangement:

```
game area = CARD × scale + FIXED
viewport  = CARD × scale + FIXED + 263      # 263 = BGA's own player-panel column + margins
```

`--ucs-card-scale` is `0.95 / 1 / 1.5` for Small / Medium / Large (`Game.scss`, near the top).

**What is in CARD is now a short list.** The board strip — the round parameters and both Secret Santa
zones — no longer reads `--ucs-card-scale`: it is reference art you never click, so it is pinned and
belongs to FIXED. What is left in CARD is the Draft Pool and the Trade Area, i.e. exactly the cards you
pick from, plus my knitting area in `#ucs-lower`. So for every Tier A shape:

```
CARD  = 320                                 # Draft Pool, 4 x 80 — the same for all five shapes
FIXED = strip + gaps + opponents + padding  # the strip term is now a constant per shape
```

**Worked instance — Express · 3P · Tier A · with the Secret Santa column:**

| Term | Piece | px |
|------|-------|---:|
| CARD | Draft Pool (`4 × 80`) | 320 |
| | **CARD total** | **320** |
| FIXED | Fads 2×2 (`2 × 90`) — pinned | 180 |
| FIXED | Perfect Fit / Trendy Yarn column (`90`) — pinned | 90 |
| FIXED | Secret Santa, rotated (`--ucs-card-h` = 188) — pinned | 188 |
| FIXED | Fad grid gap 6 · strip gaps 24 · `#ucs-upper` gaps 24 | 54 |
| FIXED | Draft Pool `3 × 12` gaps + 16 zone padding + 24 rotated-label overhang | 76 |
| FIXED | Right column: opponent panel at the 5-sweater cap (`244 + 12 padding + 4 border`) | 260 |
| FIXED | `#ucs-table` padding | 16 |
| | **FIXED total** | **864** |

→ `viewport = 320 × scale + 1127`, which gives **1431 / 1447 / 1607** for Small / Medium / Large
(was 1408 / 1447 / **1836**). Medium is unchanged by construction — at scale 1 nothing moves — and the
whole effect of pinning lands on Large.

`$santa-column-floors` in `Game.scss` is derived off these numbers: **1450 / 1610** for Medium / Large,
which is 1447 / 1607 rounded up. Small has no floor — it keeps the Santa row at every width. Large held
**1840** for as long as the strip still scaled (the old CARD 778 / FIXED 406 gave 1836); pinning the
strip is what took it to 1607, so the column now appears 230px earlier than it used to.

`$avid-santa-row-floors` (1415 / 1430 / 1590) is **not** derived from this formula and is not stale — it
is the width at which one of three Santa slots would fall below 125px under that shape's own
`min(200px, (100vw - (320 × scale + 733)) / 3)` sizing, i.e. `1108 + 320 × scale`, which already carries
the pinned strip. Avid's Santa row is a fixed 656px and always dominated the 270px parameter row, so
pinning never moved it.

**To floor a new arrangement:** re-total CARD and FIXED for it, then read the answer off the formula
for each size. That is the whole derivation — no per-size arithmetic.

### Every shape, totalled (Tier A)

The strip is a flex column, so its width is `max(parameter row, Secret Santa row)` — which term wins is
noted below. The centre is `max(Draft Pool, Trade Area)`: the Trade Area is drawn for `--ucs-trick-size`
seats (2P→4, 3P→3, 4P→4) at `--ucs-card-w + 12` each, so it beats the always-4-card Draft Pool by 54px
wherever the trick is 4 — i.e. everywhere except 3P.

Rows marked *unfolded* are what the shape cost before its fold, kept because they are the argument for
the fold existing:

CARD is `320` throughout — the strip is pinned, so the Draft Pool is the only term left that scales. The
*Strip* column is the shape's pinned strip width, now folded into FIXED. Bracketed figures are what the
shape cost when the strip still scaled, kept because they are the argument for pinning it:

| Shape | Strip (winner) | CARD | FIXED | Small | Medium | Large |
|-------|---------------|-----:|------:|------:|-------:|------:|
| Casual (any count) | params `3 × 90` = 270 | 320 | 724 | 1291 | 1307 | **1467** *(1602)* |
| Express 2P | params `5 × 90` = 450 | 320 | 916 | 1483 | 1499 | **1659** *(1884)* |
| Express 3P — Santa row | Santa `2 × 188` = 376 | 320 | 764 | 1331 | 1347 | **1507** *(1695)* |
| Express 3P — Santa column | params + Santa = 458 | 320 | 864 | 1431 | 1447 | **1607** *(1836)* |
| Express 4P — Fads 3-across | Santa `2 × 188` = 376 | 320 | 818 | 1385 | 1401 | **1561** *(1749)* |
| Express 4P — *unfolded* | params `7 × 90` = 630 | 320 | 1108 | 1675 | 1691 | *1851* |
| Avid — Santa row, unscaled | Santa row (fixed 656) | 320 | 1070 | 1637 | 1653 | 1813 |
| Avid — Santas stacked (below floor) | params `3 × 90` = 270 | 320 | 724 | 1291 | 1307 | **1467** *(1602)* |

What falls out of the table:

1. **Nothing fits at 1000px.** The cheapest shape (Casual at Small) needs **1291**. The Tier A/B
   boundary is inherited from an older, narrower layout — see the stale-structure caveat above — and is
   ~300px too low for *every* shape at *every* card size. The band from 1001 to the shape's floor
   renders the wide layout squeezed: `#ucs-board-strip` is `flex: 0 0 auto`, so `#ucs-center-stack` is
   what gives.
2. **Folding Express 4P and Avid was not cosmetic** — unfolded they needed 2166 and 2093 against a 1920
   screen when the strip still scaled, i.e. they fit no common monitor at Large. Both were a single
   unfolded row. Pinning the strip has since taken the unfolded 4P cost to 1851, so the fold is no
   longer load-bearing for *fit* at 4P — but it is still what keeps the parameter row from pushing the
   centre column right, which is why it stays.
3. **Every shape now reaches the wide layout on a laptop at Large**, which was the point of pinning the
   strip. Against the three common widths — 1366 / 1440 / 1536 — Casual clears at 1467, Express 3P at
   1507 and 4P at 1561; only **Express 2P (1659)** still misses, and it is now 261px inside a 1920
   screen rather than 36px. Its parameter row is 5 cards across (3 Fads + Perfect Fit + Trendy Yarn);
   the Fad-grid fold would bring it down further, but at 2P the row is not obviously *wrong*, so that
   remains a judgement call rather than a defect.
4. **Avid's stacked column is now the below-floor fallback, not the target.** Once the Santas stack the
   strip is the parameter row and Avid costs exactly what Casual costs — the sanity check that the fold
   does what it should — but it buys that width with ~600px of height at Large, so above the floors the
   unscaled row wins. Avid is the one shape where the *height* of the strip, not its width, was the
   binding complaint.
5. **Large is no longer a layout axis, only a size one.** Within-shape spread across the preference
   collapses from 300–500px to a flat **176px** for every shape — and that 176 is just the Draft Pool
   (`320 × 0.55`). Medium is unchanged throughout by construction. This is the "narrow the card-size
   spread" goal in [`backlog.md`](backlog.md), reached by moving zones off the scale rather than by
   re-pitching it, so no already-tuned layout changes size at Medium.

Worst-case assumptions, so the floors err toward *not* folding: the opponents' column at its five-sweater
cap (early in a game it is ~115px, and `.ucs-knitting-compact` notes only Express reaches a 6th sweater
— Casual/Avid end by the 3rd–4th, so ~210 is their realistic cap), a full Draft Pool, and a player-name
header narrower than the knitting area.

## How many arrangements are there, really?

The cross-product of variant × player count × card size × tier is 81, which is not the real number.
Only two things change what has to be *arranged* — how many Fads are on display, and how many Secret
Santas — and `fadsOnDisplay()` is `players + 1` **in Express only** (Casual and Avid render a single
Fad face), while `secretSantasPerPlayer()` is fixed per variant:

| Shape | Fads | Santas |
|-------|-----:|-------:|
| Casual (any count) | 1 | 1 |
| Avid (any count) | 1 | 3 |
| Express 2P | 3 | 2 |
| Express 3P | 4 | 2 |
| Express 4P | 5 | 2 |

**Five content shapes**, times the structural bands (wide / narrow). Player count subdivides Express
and nothing else; opponent count changes the right column's height, not the arrangement. Card size
should multiply this by **one** — it is a scale factor, and the formula above is how it stays one.

## The narrow/wide boundary

There is no shared breakpoint px. `Game.ts::wideLayoutFloor()` computes **one** width for the session
from the formula above, and `layoutNarrowSidebar` toggles `#ucs-table.ucs-narrow` at it; every narrow
rule in `Game.scss` hangs off that class rather than a `@media`. This works because both inputs are
fixed for a session — the content shape (variant + player count) and the card-size preference, which is
`needReload`. **The floors live in `wideLayoutFloor()` only.** Don't restate them in CSS; that
duplication is exactly what the class exists to avoid.

The floors it produces, per shape and size:

| Shape | CARD | FIXED | Small | Medium | Large |
|-------|-----:|------:|------:|-------:|------:|
| Casual · Avid | 320 | 724 | 1291 | 1307 | 1467 |
| Express 2P | 320 | 916 | 1483 | 1499 | 1659 |
| Express 3P | 320 | 764 | 1331 | 1347 | 1507 |
| Express 4P | 320 | 818 | 1385 | 1401 | 1561 |

Avid uses the **stacked**-Santa numbers and Express 3P the **Santa-row** numbers — what each shape costs
when its wide layout first becomes viable. The unscaled Avid row and the 3P Santa column are upgrades
applied further up, at `$avid-santa-row-floors` / `$santa-column-floors`, and those two still live in
`Game.scss` because they select *within* the wide layout rather than deciding which layout runs.

Consequence worth knowing: **the narrow layout is now genuinely a narrow-screen layout again.** Every
Large floor sits between 1467 and 1659, so a 1366–1536px laptop gets the *wide* layout for three of the
four shapes; before pinning the strip it got the narrow one for all four, at every card size, because
the floors ran 1602–1884. That mattered more than the arithmetic suggests: narrow is a stacked
single-column arrangement with the Draft Pool below the parameter row, which is right on a phone and
wrong on a laptop no matter how well its cards are sized.

Anything inside a `@media (min-width: …)` block that styles the wide layout needs `:not(.ucs-narrow)`.
Those blocks carry an extra `html` element selector, so they out-specify the narrow rules and would
otherwise win inside the overlap band (which now exists for every shape whose floor is above 1000).

**Derive the scale from the preference, never from the `html.ucs-cards-*` class.** That class is a
`cssPref`, which BGA applies on its own schedule — it was not yet on `<html>` when `setup()` first
built `narrowMq()`, so a Large session computed the **Medium** floor (1307), cached it for the whole
session, and ran the wide layout below its real floor with no path to recover. It presented as crowding
rather than as a boundary failure, because the CSS variable was unaffected: the cards rendered correctly
Large while the layout decision had been made for Medium. `Game.ts::cardSizePref()` reads
`userPreferences.get(101)` instead, which arrives with the page from the server, and keeps the class
only as a fallback for paths where preferences aren't readable. **Every** card-size branch goes through
it — `cardSizeScale()` (tabletop, Large = 1.5) and `handSizeScale()` (fanned hand, Large = 1.4, capped
lower because the hand floats at the viewport bottom) both map its result to their own multipliers. Add
new branches the same way; reading the class directly reintroduces the hazard.

*(Superseded: an earlier build switched at 800px and then at a flat 1000px. 1000 was below every shape's
real floor — the cheapest is 1291 — so the band above it rendered the wide layout squeezed, since
`#ucs-board-strip` is `flex: 0 0 auto` and `#ucs-center-stack` was what gave.)*

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

- The narrow layout now covers **every variant at every card size** down to ~360px, but only Express at
  Small/Medium has had an eyes-on pass. Everything else is derived-and-built, not looked at. Tracked in
  [`backlog.md`](backlog.md) under "Visual polish sweep."
- Casual/Avid narrow is arithmetic only: the parameter row is three across and Avid's three landscape
  Secret Santas take a full-width row at `(100cqi - 24px) / 4.7` (~69px cards at 360px, against the 56px
  interactive floor). Avid at 360 has the least slack of any shape in the game.
- **The unexamined half of the narrow layout is now the WIDE end of it, not the narrow end.** Its whole
  range used to be phone-to-tablet; it now runs up to each shape's floor, so the band roughly
  1000px→1659px is where it has had the least scrutiny — that is where the uncapped `100cqi` sizing was
  found. The caps make it presentable there, but "presentable" is derived, not looked at: a laptop
  viewport (1366/1440/1536) in each of the five content shapes is the highest-value thing left to
  eyeball, and it is the band a desktop tester will actually hit.
