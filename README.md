# Ugly Christmas Sweaters — Board Game Arena

An online adaptation of **Ugly Christmas Sweaters** (Hunter R. Hennigar, art by Brooklin Holbrough,
published by H² Games) for [Board Game Arena](https://boardgamearena.com), built under BGA's license
for the game. It has passed BGA's framework and visual review and is in public alpha.

## The game

A 2–4 player card game that combines trick-taking, card drafting, and set collection. Each card is one
third of a sweater (left, right, or bottom) with a value, a colour, and an icon. Every trick, players
play one card each; the trick's result sets the order in which they draft from a shared pool, and the
drafted card goes into their knitting area. Only completed sweaters score: points for building one, for
a run of three consecutive values, for matching the round's Fad or a single colour or icon, and for
meeting your hidden Secret Santa request. Each round deals a new trump number, trump colour, and Fad.

The implementation supports three modes (Casual, Express, and Avid), three difficulty levels, and the
optional Bonus cards from the Kickstarter mini-expansion. Deal sizes and drafting adjust automatically
for 2, 3, or 4 players. The
official rulebook is in [`docs/`](docs/ugly-christmas-sweater-rules.pdf) and on
[BoardGameGeek](https://boardgamegeek.com/filepage/186495/).

## How it's built

BGA Studio's **Modern** framework: an authoritative PHP server and a TypeScript client.

- **Server (`modules/php/`)** — the game is a state machine of 15 states, one PHP class per state
  (`States/`). Each state either runs automatically or waits on one or more players, and returns the
  next state. `Game.php` holds the shared logic (dealing, trick resolution, scoring, notifications);
  `Material.php` holds the static card data. Disconnected players are handled by a zombie mode that
  plays legal moves for them.
- **Client (`src/ts/`, `src/scss/`)** — TypeScript compiled by rollup, SCSS compiled by sass. It renders
  the whole table, registers a handler per interactive state, and animates cards between zones with
  FLIP transitions. The layout switches between a narrow and a wide arrangement at a width computed
  from the player count and variant, and has been checked down to a 320px phone screen.
- **Art pipeline (`scripts/`)** — Node scripts using `sharp` trim the print bleed from the publisher's
  card scans and pack them into CSS sprite sheets, generating the SCSS position classes. The card art
  belongs to the publisher and is not in this repo; only the generated SCSS is committed.
- **Deploy (`scripts/deploy.mjs`)** — uploads an allowlist of files to the BGA Studio server over SFTP.
  It does a dry run by default.

## Building

```sh
npm install
npm run build              # TypeScript -> modules/js/Game.js, SCSS -> uglychristmassweaters.css
npm run deploy -- --yes    # upload to BGA Studio (requires Studio SFTP credentials)
```

## Developed with Claude Code

This project is developed agent-first with [Claude Code](https://claude.com/claude-code). The
[`CLAUDE.md`](CLAUDE.md) and [`.claude/`](.claude/) docs are committed on purpose: they hold the rules
digest, architecture notes, open work, and a log of mistakes along with the rule that prevents each
one from happening again.

## License

Code is covered by the Board Game Arena developer license in [`LICENCE_BGA`](LICENCE_BGA). The game
design, name, and artwork belong to their owners.
