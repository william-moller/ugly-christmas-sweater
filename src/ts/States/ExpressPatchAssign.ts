import { Game } from "../Game";

/**
 * Client handler for the ExpressPatchAssign state — Express only, mid-draft. The drafter just completed a
 * sweater still holding a wild Patch, and may pin its value + icon down NOW so it can claim an icon Fad,
 * rather than waiting for the round-end pass by which time the Fad display has moved on.
 *
 * Entirely optional: the same board picker as the round-end pass is reused, plus a Skip button (the
 * `onFinish` callback), because the server waits here until the player explicitly finishes. Setting the
 * last eligible patch finishes automatically — see Game.beginAssignPatches.
 */
export class ExpressPatchAssign {
    constructor(private game: Game, private bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>) {
    }

    onEnteringState(args: ExpressPatchAssignArgs, isCurrentPlayerActive: boolean) {
        if (!isCurrentPlayerActive) {
            return;
        }
        this.game.beginAssignPatches(
            (args.assignable || []).map(Number),
            (cardId: number, value: number, icon: string) =>
                this.bga.actions.performAction('actAssignExpressPatch', { card_id: cardId, value, icon }),
            () => this.bga.actions.performAction('actFinishExpressPatch', {}),
        );
    }

    onLeavingState() {
        this.game.endAssignPatches();
    }
}
