import { Game } from "../Game";

/**
 * Client handler for the BillyChoice (bonus) state. Only the Billy owner is active, and only when another
 * player leads the draft — they may play Billy's a Brute (draft & discard first) or pass. Everyone else
 * waits. See Game.beginBillyChoice.
 */
export class BillyChoice {
    constructor(private game: Game, private bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>) {
    }

    onEnteringState(_args: BillyChoiceArgs, isCurrentPlayerActive: boolean) {
        // Only the (unused) Billy owner is ever meant to act here; guard against the pass-through case
        // where the normal first drafter is briefly the active player.
        if (!isCurrentPlayerActive || !this.game.myUnusedBonus('billy')) {
            return;
        }
        this.game.beginBillyChoice(
            () => this.bga.actions.performAction('actBillyActivate', {}),
            () => this.bga.actions.performAction('actBillySkip', {}),
        );
    }

    onLeavingState() {
        this.game.endBillyChoice();
    }
}
