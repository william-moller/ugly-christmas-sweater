import { Game } from "../Game";

/**
 * Client handler for the DraftCard (Draft phase) state.
 * Clicking a draftable pool card selects it; the player then chooses where to place it (and, for a
 * Patch, its value / icon / orientation) via the placement panel before the draft is submitted.
 */
export class DraftCard {
    constructor(private game: Game, private bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>) {
    }

    onEnteringState(args: DraftCardArgs, isCurrentPlayerActive: boolean) {
        // Every player (and an F5 reload) shows the Draft Order cards dealt onto the ranked Trade Area
        // cards during the draft phase — before the active-player check so all seats see it.
        this.game.syncDraftOrder('dealt');
        if (!isCurrentPlayerActive) {
            return;
        }
        this.game.beginDraft(args.draftableIds || [], (cardId: number, placement: DraftPlacement) => {
            this.bga.actions.performAction('actDraftCard', {
                card_id: cardId,
                build_no: placement.build_no,
                slot: placement.slot,
                floating_patch_slot: placement.floating_patch_slot,
            });
        });
    }

    onLeavingState(args: DraftCardArgs, isCurrentPlayerActive: boolean) {
        this.game.endDraft();
    }
}
