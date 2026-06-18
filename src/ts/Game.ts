import { PlayCard } from "./States/PlayCard";
import { DraftCard } from "./States/DraftCard";

export class Game {
    public bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>;
    private gamedatas: UglyChristmasSweaterGamedatas;

    constructor(bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>) {
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
    setup(gamedatas: UglyChristmasSweaterGamedatas) {
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
            document.getElementById('player-tables')!.insertAdjacentHTML('beforeend', `
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
