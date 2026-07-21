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

- **Tooltip coverage sweep** — checklist: "non-self explanatory graphic elements should have tool
  tips". *Blocked on the playing-area layout work below:* which elements need explaining is defined
  by which zones exist, and a reworked zone throws the sweep away. While there, use BGA's tooltip
  system for the draw pile rather than a native `title=` attribute (`src/ts/Game.ts:129`).
- **Help text on the special cards, via a hover icon** — Perfect Fit, Trendy Yarn, Fads and Secret
  Santa each get a small "?" (or ⓘ) affordance that reveals what the card does on hover. Distinct
  from the coverage sweep above: those cards already have plain tooltips, but a visible icon signals
  "there's help here" rather than relying on the player discovering the hover. Rules text lives in
  `.claude/game-rules.md`; wrap the strings (see the translation item above).
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

## Rules gaps (anchored in code)

These two carry a `TODO` at the exact line someone would edit; this file is the index, the comment
is the detail.

- **Avid Secret Santa variant** — `modules/php/Game.php:449`. Deals 3 at game start; all must be
  completed or the player doesn't qualify for scoring. Also needs a `gameoptions.jsonc` entry — see
  the note at its line 70, which lists 2P/3P player-count tuning as outstanding too.
- **Colour word is not translated in `cardLabel()`** — `modules/php/Game.php:694`. The rest of the
  translation-readiness sweep is done (client display strings wrapped, `Material` data marked with
  `clienttranslate`, client translates data at display); this one case is left because the colour is
  composed into a label server-side, so it renders English even for a translated client. Fixing it
  means passing colour + value as separate notification args with an `i18n` key across the
  cardPlayed / drafted / patch notifications (4 state files) and updating the log rendering — a
  notification restructure with replay implications, not a wrap.
