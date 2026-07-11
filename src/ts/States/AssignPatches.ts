import { Game } from "../Game";

/**
 * Client handler for the AssignPatches (round-end) state. Each player with patch(es) in a completed
 * sweater assigns a value + icon to each, simultaneously. Every pending patch glows and gets an inline
 * value/icon picker beside it (Confirm sends actAssignPatch). See Game.beginAssignPatches.
 *
 * NB: this is a MULTIPLE_ACTIVE_PLAYER state, so on the JS side the player is NOT flagged active yet
 * during onEnteringState (per BGA docs) — gating on isCurrentPlayerActive here would always bail. The
 * server args tell each client exactly which patches are theirs, so we drive off that instead.
 */
export class AssignPatches {
    constructor(private game: Game, private bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>) {
    }

    onEnteringState(args: AssignPatchesArgs) {
        this.game.hideDraftOrder(); // round-end: the Draft Order cards go back to their stack
        const mine = (args.assignable && args.assignable[this.bga.gameui.player_id]) || [];
        this.game.beginAssignPatches(mine.map(Number), (cardId: number, value: number, icon: string) => {
            this.bga.actions.performAction('actAssignPatch', { card_id: cardId, value, icon });
        });
    }

    onLeavingState() {
        this.game.endAssignPatches();
    }
}
