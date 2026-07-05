import { Game } from "../Game";

/**
 * Client handler for the PlayCard (Trade phase) state.
 * Highlights the legally-playable cards in the active player's hand; clicking one plays it.
 */
export class PlayCard {
    constructor(private game: Game, private bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>) {
    }

    onEnteringState(args: PlayCardArgs, isCurrentPlayerActive: boolean) {
        // During the play phase the Draft Order cards rest in their stack — snap to that for every player
        // (and on an F5), before the active-player check so spectators/opponents see it too.
        this.game.syncDraftOrder('idle');
        if (!isCurrentPlayerActive) {
            return;
        }
        this.game.enablePlayable(args.playableCardsIds || [], (cardId: number, copyFromCardId: number) => {
            this.bga.actions.performAction('actPlayCard', { card_id: cardId, copy_from_card_id: copyFromCardId });
        });
    }

    onLeavingState(args: PlayCardArgs, isCurrentPlayerActive: boolean) {
        this.game.disablePlayable();
    }
}
