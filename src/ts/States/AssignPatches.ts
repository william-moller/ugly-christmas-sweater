import { Game } from "../Game";

/**
 * Client handler for the AssignPatches (round-end) state. Each player with patch(es) in a completed
 * sweater assigns a value + icon to each, simultaneously. The value/icon pickers live in the action bar
 * (the patch being assigned is highlighted in the player's knitting area); each assignment is sent via
 * actAssignPatch. Non-active players (none to assign) just wait.
 */
export class AssignPatches {
    constructor(private game: Game, private bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>) {
    }

    onEnteringState(args: AssignPatchesArgs, isCurrentPlayerActive: boolean) {
        this.game.hideDraftOrder(); // round-end: the Draft Order cards go back to their stack
        if (!isCurrentPlayerActive) {
            return;
        }
        const mine = (args.assignable && args.assignable[this.bga.gameui.player_id]) || [];
        this.game.beginAssignPatches(mine, (cardId: number, value: number, icon: string) => {
            this.bga.actions.performAction('actAssignPatch', { card_id: cardId, value, icon });
        });
    }

    onLeavingState() {
        this.game.endAssignPatches();
    }
}
