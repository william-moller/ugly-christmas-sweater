# Mistakes — Ugly Christmas Sweaters

A behaviour log, not a changelog. Git records what changed; this records **what I got wrong and the
rule that prevents a repeat**. Read it before starting work here.

Game-specific only. BGA-wide mistakes are in [`../../.claude/MISTAKES.md`](../../.claude/MISTAKES.md)
and apply here too.

**Append an entry whenever something breaks or Will has to correct me** — in the same session it
happened, newest first, directly under the divider. Four fields, no more:

- **What happened** — the observable event, plainly.
- **Root cause** — the belief or shortcut behind it, not the symptom.
- **Consequence** — what it actually cost.
- **Rule** — a testable instruction that would have prevented it.

Entries are permanent. If a rule later turns out to be wrong, add a new entry saying so rather than
editing the old one — the point is the pattern over time, and a silently corrected log teaches
nothing.

---

## Superseded: "use sticky to keep chrome in the play zone" — sticky does not work on a BGA page

- **What happened** — the first entry in this log (the footer overlap) prescribed `position: sticky` as
  the fix, and that shipped. It never floated: the "?" strip sat at its flow position at the bottom of
  #left-side, below the How-to-Play block, unreachable without scrolling to the end of the page.
- **Root cause** — a sticky box is sticky only within its nearest scrollport, and any ancestor that is
  a scroll container becomes that scrollport; `overflow-x: hidden` on a page wrapper is enough, since
  it computes `overflow-y` to `auto`. I never checked BGA's ancestor chain. I had also written the
  degraded mode into the comment as "still compliant — it fails in the safe direction", which is what
  made shipping it unverified feel acceptable. It was not compliant: a help button nobody can find
  fails the requirement more completely than the overlap did.
- **Consequence** — a deploy and a review round trip, and a worse regression than the original defect.
- **Rule** — this supersedes the earlier entry's rule. Chrome must be `position: fixed` with its bottom
  offset COMPUTED against #left-side's bottom edge (Game.ts::pinHelpStrip). More generally: when a fix
  trades one behaviour for another, restate both halves of the requirement and verify the half you did
  not set out to change. The BGA-wide write-up is in
  [`../../.claude/framework.md`](../../.claude/framework.md).

---

## Picked the narrower of two layout structures without costing either

- **What happened** — the tall-strip lift put `#ucs-lower` inside a wrapper around the centre stack, so
  my Knitting Area was capped at the centre column's width for its whole height: two sweaters per row
  on a table with room for four, with the right column sitting empty beside it. Making `#ucs-upper` a
  grid and spanning the Knitting Area across centre + right was available from the start and is
  strictly better.
- **Root cause** — I checked that the structure fixed the reported symptom (the empty band) and stopped
  there. The width it cost was disclosed as a trade-off rather than *computed*, and it was entirely
  computable: a build is `2 × card + 8` and the gaps are 12px, so how many fit per row is arithmetic,
  not a judgement to be discovered on a screenshot.
- **Consequence** — a third deploy/push/review round trip on one feature, and a layout shipped that
  looked worse than what it replaced in the dimension nobody was asked about.
- **Rule** — **when a layout change trades one axis for another, compute the cost on the axis being
  given up before shipping, and put the number in the message.** "It will be narrower" is not a cost;
  "it drops from four builds per row to two" is, and it would have rejected this structure immediately.
  The components here all have exact box formulas in the stylesheet — use them.

---

## A gate invented from a card's height blocked the only shape it was written for

- **What happened** — `layoutTallStrip` was added to lift the Knitting Area beside Avid's stacked
  Secret Santa column, gated on `TALL_STRIP_MIN_SLACK = 160`. Shipped, and the reported empty band
  under the Trade Area was still there: the real slack in that shape is ~138px, so the gate blocked the
  one case the feature existed to fix.
- **Root cause** — the constant was *reasoned* ("a Medium knitting card is 125, plus label and padding,
  call it 160") instead of *measured* against the screenshot that prompted the work. The reasoning was
  about a different quantity entirely — how tall the Knitting Area IS — when the gate's question is how
  tall the hole is. Both are in px, which is what made the substitution feel sound.
- **Consequence** — a deploy, a push and a review round trip that changed nothing the reporter could
  see, and a second screenshot to establish what one calibrated measurement would have given first.
- **Rule** — **when a constant gates a behaviour for one specific reported shape, measure that shape
  before choosing the value, and record the measurement beside the constant.** The reporter's screenshot
  is a measuring instrument: calibrate it against a known fixed-px element (here the Secret Santa's
  pinned 200px rotated footprint, which also recovers the device-pixel ratio) and read the real number
  off it. A plausible derivation from a *different* quantity is not a substitute, and a gate whose value
  has never been compared against a real instance of the thing it gates is untested by construction.

---

## Game chrome pinned to the viewport landed on BGA's site footer

- **What happened** — the public-alpha request was rejected on a display issue: the lower-left "?"
  help button overlapped the boardgamearena.com footer. `#bga-help_buttons` was `position: fixed;
  bottom: 12px`, so whenever the footer was on screen — a short table, or the page scrolled to its
  end — the button sat on top of it.
- **Root cause** — copied the positioning straight from the reference games (castlecombo, crybaby,
  insidejob all ship `position: fixed` here) and treated "three live games do it" as proof it was
  correct. It is not: those games have tall boards, so their footer is rarely on screen at the same
  time as the button. Our shortest shapes (Express 2P) put both in view at once, which is a property
  of THIS game, not of the snippet.
- **Consequence** — a rejected alpha request and a full review round trip, for one CSS property.
- **Rule** — **anything the game paints must be positioned inside the play zone, not the viewport.**
  `position: fixed` has no idea where the game ends; `position: sticky` is stopped by its containing
  block, which is what "inside the play zone" means in CSS. Before shipping any corner-pinned control,
  open a test table at the game's *shortest* shape and confirm the site footer is reachable without
  anything of ours over it. And when lifting a pattern from a reference game, check the property that
  makes it work still holds for our content — not just that the game it came from is live.

