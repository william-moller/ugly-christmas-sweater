import { Game } from "../Game";

/**
 * Client handler for the TinaTink (bonus, round-end) state. Only the Tina owner is active; they may move
 * one placed piece, swap two placed pieces, or pass, before scoring. Everyone else waits. The interactive
 * flow (clicking pieces in the knitting area + choosing a target) lives in Game.beginTinaTink.
 *
 * NB: this is a MULTIPLE_ACTIVE_PLAYER state, so on the JS side the player is NOT flagged active yet
 * during onEnteringState (per BGA docs) — gating on isCurrentPlayerActive here would always bail. The
 * server args carry the Tina owner, so we drive off that instead.
 */
export class TinaTink {
    constructor(private game: Game, private bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>) {
    }

    onEnteringState(args: TinaTinkArgs) {
        const mine = args.owner != null && Number(args.owner) === this.bga.gameui.player_id;
        if (!mine || !this.game.myUnusedBonus('tina')) {
            return;
        }
        this.game.beginTinaTink(
            (cardId: number, buildNo: number, slot: string) =>
                this.bga.actions.performAction('actTinaMove', { card_id: cardId, build_no: buildNo, slot }),
            (cardA: number, cardB: number) =>
                this.bga.actions.performAction('actTinaSwap', { card_a: cardA, card_b: cardB }),
            () => this.bga.actions.performAction('actTinaSkip', {}),
        );
    }

    onLeavingState() {
        this.game.endTinaTink();
    }
}
