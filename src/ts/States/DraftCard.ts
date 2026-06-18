import { Game } from "../Game";

/**
 * Client handler for the DraftCard (Draft phase) state.
 * Minimal for now: a button per draftable pool card. Real pool/knitting UI comes with the board layout.
 */
export class DraftCard {
    constructor(private game: Game, private bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>) {
    }

    onEnteringState(args: DraftCardArgs, isCurrentPlayerActive: boolean) {
        if (!isCurrentPlayerActive) {
            return;
        }
        (args.draftableIds || []).forEach(cardId =>
            this.bga.statusBar.addActionButton(
                _('Draft card ${id}').replace('${id}', `${cardId}`),
                () => this.bga.actions.performAction('actDraftCard', { card_id: cardId })
            )
        );
    }

    onLeavingState(args: DraftCardArgs, isCurrentPlayerActive: boolean) {
    }
}
