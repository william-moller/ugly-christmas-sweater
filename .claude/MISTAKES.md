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

