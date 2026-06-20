import { Game } from "../Game";

/**
 * Client handler for the DraftCard (Draft phase) state.
 * Highlights the draftable pool cards; clicking one drafts it into the knitting area.
 */
export class DraftCard {
    constructor(private game: Game, private bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>) {
    }

    onEnteringState(args: DraftCardArgs, isCurrentPlayerActive: boolean) {
        if (!isCurrentPlayerActive) {
            return;
        }
        this.game.enableDraftable(args.draftableIds || [], (cardId: number) => {
            this.bga.actions.performAction('actDraftCard', { card_id: cardId });
        });
    }

    onLeavingState(args: DraftCardArgs, isCurrentPlayerActive: boolean) {
        this.game.disableDraftable();
    }
}
