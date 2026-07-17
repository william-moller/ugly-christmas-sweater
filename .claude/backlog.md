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

- **Strings ready for translation** — checklist: "strings in your source code are ready for
  translation". Every user-facing string wrapped (`_()` in PHP, `clienttranslate()` / `_()` in TS),
  `CardView.ts::cardTooltip` and the round-parameter tooltips in `Game.ts` included. Worth doing as
  one sweep *after* the layout work below, so new strings land already wrapped rather than being
  swept twice. See also the colour-word gap under Rules gaps.
- **Tooltip coverage sweep** — checklist: "non-self explanatory graphic elements should have tool
  tips". *Blocked on the playing-area layout work below:* which elements need explaining is defined
  by which zones exist, and a reworked zone throws the sweep away. While there, use BGA's tooltip
  system for the draw pile rather than a native `title=` attribute (`src/ts/Game.ts:129`).
- **Responsive / mobile** — checklist: the game must work on a mobile device. Related checklist
  line: if elements don't occupy all available horizontal space, they should be centered.
- **Statistics** — checklist wants meaningful stats. *Open question:* which ones beyond the five
  already declared in `stats.jsonc`? Candidates: tricks won, cards traded, patches used, VP by
  source.
- **Cleanup: `console.log`** — checklist: remove tracing from JS before alpha (`src/ts/`).

## Polish / UX

- **Animations** — more of them. *Open question:* which moments? Trick resolution and scoring look
  like the gaps.
- **How-to-play rules summary** — in-client summary so players don't need the rulebook PDF.
- **Playing-area layout** — improve. Overlaps the centering checklist line above.
- **Player preferences** — `gamepreferences.jsonc`. *Open question:* which knobs? Animation speed
  is the conventional one.
- **Player panel improvements** — *open question:* what needs to change? Not actionable until we
  decide what's wrong with it today.

## Rules gaps (anchored in code)

These two carry a `TODO` at the exact line someone would edit; this file is the index, the comment
is the detail.

- **Avid Secret Santa variant** — `modules/php/Game.php:449`. Deals 3 at game start; all must be
  completed or the player doesn't qualify for scoring. Also needs a `gameoptions.jsonc` entry — see
  the note at its line 70, which lists 2P/3P player-count tuning as outstanding too.
- **Colour word is not translated in `cardLabel()`** — `modules/php/Game.php:694`.
