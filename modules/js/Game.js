/**
 * Client handler for the PlayCard (Trade phase) state.
 * Minimal for now: shows a button per playable card. Real card-clicking UI comes with the board layout.
 */
class PlayCard {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
    }
    onEnteringState(args, isCurrentPlayerActive) {
        if (!isCurrentPlayerActive) {
            return;
        }
        (args.playableCardsIds || []).forEach(cardId => this.bga.statusBar.addActionButton(_('Play card ${id}').replace('${id}', `${cardId}`), () => this.bga.actions.performAction('actPlayCard', { card_id: cardId })));
    }
    onLeavingState(args, isCurrentPlayerActive) {
    }
}

/**
 * Client handler for the DraftCard (Draft phase) state.
 * Minimal for now: a button per draftable pool card. Real pool/knitting UI comes with the board layout.
 */
class DraftCard {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
    }
    onEnteringState(args, isCurrentPlayerActive) {
        if (!isCurrentPlayerActive) {
            return;
        }
        (args.draftableIds || []).forEach(cardId => this.bga.statusBar.addActionButton(_('Draft card ${id}').replace('${id}', `${cardId}`), () => this.bga.actions.performAction('actDraftCard', { card_id: cardId })));
    }
    onLeavingState(args, isCurrentPlayerActive) {
    }
}

class Game {
    constructor(bga) {
        console.log('uglychristmassweater constructor');
        this.bga = bga;
        // Register the state handlers (one per active-player PHP state).
        this.bga.states.register('PlayCard', new PlayCard(this, bga));
        this.bga.states.register('DraftCard', new DraftCard(this, bga));
        // Uncomment to debug state changes in the console (remove before production):
        // this.bga.states.logger = console.log;
    }
    /*
        setup: build the game UI from current game state ("gamedatas" = the result of Game::getAllDatas).
        Called on game start and on every page refresh (F5).
    */
    setup(gamedatas) {
        console.log("Starting game setup");
        this.gamedatas = gamedatas;
        // Skeleton placeholder layout — real board (draft pool, trade area, knitting areas) comes next.
        this.bga.gameArea.getElement().insertAdjacentHTML('beforeend', `
            <div id="ucs-table">
                <div id="draft-pool"></div>
                <div id="trade-area"></div>
                <div id="player-tables"></div>
            </div>
        `);
        Object.entries(gamedatas.players).forEach(([pId, player]) => {
            document.getElementById('player-tables').insertAdjacentHTML('beforeend', `
                <div id="player-table-${player.id}">
                    <strong>${player.name}</strong>
                    <div class="knitting-area" id="knitting-${player.id}"></div>
                </div>
            `);
        });
        // TODO: render hand, draft pool, trade area, knitting areas, and active gameplay cards from gamedatas.
        this.setupNotifications();
        console.log("Ending game setup");
    }
    ///////////////////////////////////////////////////
    //// Notifications
    setupNotifications() {
        console.log('notifications subscriptions setup');
        // Promise notifications are auto-wired from `notif_*` methods on this class.
        // TODO: add notif_cardPlayed / notif_cardDrafted / notif_draftOrder / notif_trickCleanup /
        //       notif_roundScored handlers as the UI is built.
        this.bga.notifications.setupPromiseNotifications({
        // logger: console.log
        });
    }
}

export { Game };
