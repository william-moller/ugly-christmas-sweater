import { Game } from "../Game";

/**
 * Client handler for the RoundReview (between-round pause) state. Every player sees the round's scoring
 * summary; clicking Continue acknowledges it (server: actContinueRound). Once all players continue, the
 * next round is dealt. The summary is rendered from the state args (not just the notif) so it survives a
 * page refresh.
 */
export class RoundReview {
    constructor(private game: Game, private bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>) {
    }

    onEnteringState(args: RoundReviewArgs, isCurrentPlayerActive: boolean) {
        this.game.showRoundReview(args, isCurrentPlayerActive, () => {
            this.bga.actions.performAction('actContinueRound', {});
        });
    }

    onLeavingState() {
        this.game.endRoundReview();
    }
}
