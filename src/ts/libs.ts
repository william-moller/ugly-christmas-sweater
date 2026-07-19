/*
BGA front libraries, loaded at runtime from the BGA-hosted ESM libs (no bundling needed — rollup
keeps its `es` output and BGA serves the library). The `.d.ts` typing files live at the repo root
(`bga-cards.d.ts` / `bga-animations.d.ts`, downloaded per https://en.doc.boardgamearena.com/BgaCards)
and are type-only imports here, so they are erased from the build.

Because these are top-level `await`s, the whole module graph resolves the libraries before `Game`
is constructed — so `setup()` can use `BgaCards` / `BgaAnimations` synchronously.
*/

import type { BgaAnimations as BgaAnimationsType } from "../../bga-animations";
import type { BgaCards as BgaCardsType } from "../../bga-cards";

const BgaAnimations: typeof BgaAnimationsType = await globalThis.importEsmLib('bga-animations', '1.x');
const BgaCards: typeof BgaCardsType = await globalThis.importEsmLib('bga-cards', '1.x');

// bga-help is a small local dojo (AMD) module shipped in modules/js/ (not a BGA-hosted ESM lib), so it
// loads via importDojoLibs from our own theme URL — same pattern as castlecombo (see _reference). It
// provides the lower-left "?" help button + popin dialog. Typed loosely (importDojoLibs returns any[]).
const [BgaHelp] = await globalThis.importDojoLibs([g_gamethemeurl + 'modules/js/bga-help.js']);

export { BgaAnimations, BgaCards, BgaHelp };
