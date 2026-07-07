import { Game } from "../Game";

/**
 * Client handler for the AssignPatches (round-end) state. Each player with patch(es) in a completed
 * sweater assigns a value + icon to each, simultaneously. Every pending patch glows and gets an "Assign
 * <Colour> Patch" action button; clicking one focuses that patch — the board dims except that sweater,
 * the Fad, and the Secret Santa, and a value/icon picker popover opens under the card (Confirm sends
 * actAssignPatch). See Game.beginAssignPatches / renderAssign. Non-active players (none to assign) wait.
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
