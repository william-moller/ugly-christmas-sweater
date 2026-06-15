# Ugly Christmas Sweater — BGA Implementation

A Board Game Arena adaptation of the card game **Ugly Christmas Sweater** (licensed). Built on the BGA Studio framework.

> Shared BGA-wide guidance (SFTP, test tables, zombie mode, PHP notes, framework conventions, file roles) lives one level up in `../CLAUDE.md` and is inherited automatically. This file covers only what is specific to *this* game.

## Game Overview

- **Type:** Card game
- **Core mechanics:** trick-taking, card drafting, set collection, tableau building
- **Players:** TBD (confirm from rules)
- **Rules source:** [`docs/ugly-christmas-sweater-rules.pdf`](docs/ugly-christmas-sweater-rules.pdf) · official rulebook on BGG: https://boardgamegeek.com/filepage/186495/ugly-christmas-sweaters-rulebook-10 — _pending: extract mechanics, card list, scoring into this file_

<!--
TODO once the rules PDF is added to docs/:
  - Player count + turn structure
  - Card types / deck composition (the "material" that goes in material.inc.php)
  - Trick-taking rules (lead, follow, trump?, who wins a trick)
  - Drafting procedure
  - Set-collection scoring (which sets score, how much)
  - Tableau-building rules (what gets placed, adjacency/placement constraints)
  - End-game trigger + final scoring
  - Map each phase to a BGA game state (states.inc.php)
-->

## BGA Project

- **BGA project name / remote path:** TBD — set in `.vscode/sftp.json` after creating the project in the Studio Control Panel.
- **BGG ID:** TBD (set in `gameinfos.inc.php`).

## Current State (as of 2026-06-14)

Project scaffolding only. No game code yet.

Next steps:
1. Add the rules PDF to `docs/` and extract mechanics into this file.
2. Reserve/create the project in the BGA Studio Control Panel; record the project name.
3. Download BGA's generated skeleton via SFTP and commit it as the code baseline.
4. Copy `.vscode/sftp.json.example` → `.vscode/sftp.json` and fill in `remotePath`.

## File Structure

Standard BGA layout (see `../CLAUDE.md` → "Standard BGA File Roles"). Files will be prefixed with the BGA project name once the skeleton is downloaded.
