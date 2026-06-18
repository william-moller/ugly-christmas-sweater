import { Game } from "../Game";

/**
 * Client handler for the PlayCard (Trade phase) state.
 * Minimal for now: shows a button per playable card. Real card-clicking UI comes with the board layout.
 */
export class PlayCard {
    constructor(private game: Game, private bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>) {
    }

    onEnteringState(args: PlayCardArgs, isCurrentPlayerActive: boolean) {
        if (!isCurrentPlayerActive) {
            return;
        }
        (args.playableCardsIds || []).forEach(cardId =>
            this.bga.statusBar.addActionButton(
                _('Play card ${id}').replace('${id}', `${cardId}`),
                () => this.bga.actions.performAction('actPlayCard', { card_id: cardId })
            )
        );
    }

    onLeavingState(args: PlayCardArgs, isCurrentPlayerActive: boolean) {
    }
}
