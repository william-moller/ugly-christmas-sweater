import { PlayCard } from "./States/PlayCard";
import { DraftCard } from "./States/DraftCard";
import { createCardElement, createCardBack, cardTooltip } from "./CardView";

type CardMapT = { [cardId: number]: SweaterCard };

export class Game {
    public bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>;
    private gamedatas: UglyChristmasSweaterGamedatas;

    // Selection state for the active player (set by the PlayCard / DraftCard state handlers).
    private playableIds: number[] = [];
    private onPlay: ((cardId: number) => void) | null = null;
    private draftableIds: number[] = [];
    private onDraft: ((cardId: number) => void) | null = null;

    // Current draft order (player ids, best-first) for the order badges.
    private draftOrder: number[] = [];

    constructor(bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>) {
        console.log('uglychristmassweater constructor');
        this.bga = bga;

        // Register the state handlers (one per active-player PHP state).
        this.bga.states.register('PlayCard', new PlayCard(this, bga));
        this.bga.states.register('DraftCard', new DraftCard(this, bga));
    }

    /*
        setup: build the game UI from current game state ("gamedatas" = the result of Game::getAllDatas).
        Called on game start and on every page refresh (F5).
    */
    setup(gamedatas: UglyChristmasSweaterGamedatas) {
        console.log("Starting game setup");
        this.gamedatas = gamedatas;

        this.bga.gameArea.getElement().insertAdjacentHTML('beforeend', `
            <div id="ucs-table">
                <div id="ucs-gameplay" class="ucs-zone"></div>
                <div id="ucs-draft-pool" class="ucs-zone"></div>
                <div id="ucs-trade-area" class="ucs-zone"></div>
                <div id="ucs-players"></div>
                <div id="ucs-my-hand" class="ucs-zone"></div>
            </div>
        `);

        // Build one table per player (header + knitting area); cards fill in via render*().
        Object.values(gamedatas.players).forEach((player) => {
            document.getElementById('ucs-players')!.insertAdjacentHTML('beforeend', `
                <div class="ucs-player-table" id="ucs-player-${player.id}" style="--player-color:#${player.color}">
                    <div class="ucs-player-header">
                        <span class="ucs-order-badge" id="ucs-order-${player.id}"></span>
                        <span class="ucs-player-name">${player.name}</span>
                        <span class="ucs-player-counts" id="ucs-counts-${player.id}"></span>
                    </div>
                    <div class="ucs-knitting" id="ucs-knitting-${player.id}"></div>
                </div>
            `);
        });

        this.renderAll();
        this.setupNotifications();
        console.log("Ending game setup");
    }

    // ===================================================================================
    //  Rendering (gamedatas is the single source of truth; mutate then re-render a zone)
    // ===================================================================================

    private get material(): UcsMaterial {
        return this.gamedatas.material;
    }

    private get myId(): number {
        return this.bga.gameui.player_id;
    }

    private cardArray(map: CardMapT | undefined): SweaterCard[] {
        return map ? Object.values(map) : [];
    }

    private renderAll() {
        this.renderGameplay();
        this.renderDraftPool();
        this.renderTradeArea();
        this.renderPlayers();
        this.renderHand();
    }

    /** Active round-parameter cards (Perfect Fit / Trendy Yarn / Fad). Placeholder until art lands. */
    private renderGameplay() {
        const zone = document.getElementById('ucs-gameplay')!;
        const active = this.cardArray(this.gamedatas.activeGameplay);
        if (!active.length) {
            zone.innerHTML = `<div class="ucs-zone-label">Round parameters: pending card data</div>`;
            return;
        }
        zone.innerHTML = `<div class="ucs-zone-label">Round parameters</div>`;
        // TODO: render Perfect Fit / Trendy Yarn / Fad faces once Material gameplay data is populated.
    }

    private renderDraftPool() {
        const zone = document.getElementById('ucs-draft-pool')!;
        zone.innerHTML = `<div class="ucs-zone-label">Draft Pool</div>`;
        const row = document.createElement('div');
        row.className = 'ucs-card-row';
        this.cardArray(this.gamedatas.draftpool).forEach((card) => {
            const el = createCardElement(card, this.material);
            this.attachTooltip(el, card);
            if (this.draftableIds.includes(Number(card.id))) {
                el.classList.add('ucs-selectable');
                el.addEventListener('click', () => this.onDraft && this.onDraft(Number(card.id)));
            }
            row.appendChild(el);
        });
        zone.appendChild(row);
    }

    private renderTradeArea() {
        const zone = document.getElementById('ucs-trade-area')!;
        zone.innerHTML = `<div class="ucs-zone-label">Trade Area (this trick)</div>`;
        const row = document.createElement('div');
        row.className = 'ucs-card-row';
        // Show in play order (trickOrder) when available.
        const cards = this.cardArray(this.gamedatas.trick).sort(
            (a, b) => Number(a.trickOrder ?? 0) - Number(b.trickOrder ?? 0)
        );
        cards.forEach((card) => {
            const el = createCardElement(card, this.material);
            this.attachTooltip(el, card);
            const owner = this.gamedatas.players[Number(card.location_arg)];
            if (owner) {
                el.style.setProperty('--player-color', `#${owner.color}`);
                el.classList.add('ucs-owned');
            }
            row.appendChild(el);
        });
        if (!cards.length) {
            row.innerHTML = `<div class="ucs-empty">No cards played yet</div>`;
        }
        zone.appendChild(row);
    }

    private renderPlayers() {
        Object.values(this.gamedatas.players).forEach((player) => {
            this.renderCounts(Number(player.id));
            this.renderOrderBadge(Number(player.id));
            this.renderKnitting(Number(player.id));
        });
    }

    private renderCounts(playerId: number) {
        const el = document.getElementById(`ucs-counts-${playerId}`);
        if (!el) return;
        const c = this.gamedatas.counts?.[playerId];
        el.textContent = c ? `✋ ${c.hand} · 🂠 ${c.pile}` : '';
    }

    private renderOrderBadge(playerId: number) {
        const el = document.getElementById(`ucs-order-${playerId}`);
        if (!el) return;
        const idx = this.draftOrder.indexOf(playerId);
        if (idx >= 0) {
            el.textContent = String(idx + 1);
            el.classList.add('ucs-has-order');
        } else {
            el.textContent = '';
            el.classList.remove('ucs-has-order');
        }
    }

    /** Group a player's knitting cards by build number and lay them out as L/R/B slots. */
    private renderKnitting(playerId: number) {
        const zone = document.getElementById(`ucs-knitting-${playerId}`);
        if (!zone) return;
        zone.innerHTML = '';

        const cards = this.cardArray(this.gamedatas.knitting).filter(
            (c) => Number(c.location_arg) === playerId
        );
        if (!cards.length) {
            zone.innerHTML = `<div class="ucs-empty">No sweaters yet</div>`;
            return;
        }

        const builds: { [buildNo: number]: SweaterCard[] } = {};
        cards.forEach((c) => {
            const b = Number(c.buildNo ?? 0);
            (builds[b] ||= []).push(c);
        });

        Object.keys(builds)
            .map(Number)
            .sort((a, b) => a - b)
            .forEach((buildNo) => {
                const build = document.createElement('div');
                build.className = 'ucs-build';
                const complete = this.isBuildComplete(builds[buildNo]);
                if (complete) build.classList.add('ucs-build-complete');
                builds[buildNo].forEach((card) => {
                    const el = createCardElement(card, this.material);
                    this.attachTooltip(el, card);
                    build.appendChild(el);
                });
                zone.appendChild(build);
            });
    }

    private isBuildComplete(build: SweaterCard[]): boolean {
        const slots = new Set(build.map((c) => c.slot));
        return slots.has('L') && slots.has('R') && slots.has('B');
    }

    private renderHand() {
        const zone = document.getElementById('ucs-my-hand')!;
        if (this.bga.gameui.isSpectator) {
            zone.innerHTML = `<div class="ucs-zone-label">Spectating</div>`;
            return;
        }
        zone.innerHTML = `<div class="ucs-zone-label">Your hand</div>`;
        const row = document.createElement('div');
        row.className = 'ucs-card-row';
        const hand = this.cardArray(this.gamedatas.hand).sort(this.handSort.bind(this));
        hand.forEach((card) => {
            const el = createCardElement(card, this.material);
            this.attachTooltip(el, card);
            if (this.playableIds.includes(Number(card.id))) {
                el.classList.add('ucs-selectable');
                el.addEventListener('click', () => this.onPlay && this.onPlay(Number(card.id)));
            } else if (this.playableIds.length) {
                el.classList.add('ucs-disabled'); // a play is required but this card can't follow
            }
            row.appendChild(el);
        });
        if (!hand.length) {
            row.innerHTML = `<div class="ucs-empty">Hand is empty</div>`;
        }
        zone.appendChild(row);
    }

    /** Sort the hand by colour then value for a tidy, stable layout. */
    private handSort(a: SweaterCard, b: SweaterCard): number {
        if (a.type !== b.type) return a.type < b.type ? -1 : 1;
        return Number(a.type_arg) - Number(b.type_arg);
    }

    private attachTooltip(el: HTMLElement, card: SweaterCard) {
        // gameui.addTooltipHtml works on an element id; ours are unique (ucs-card-<id>).
        (this.bga.gameui as any).addTooltipHtml?.(el.id, cardTooltip(card, this.material));
    }

    // ===================================================================================
    //  Selection API — called by the PlayCard / DraftCard state handlers
    // ===================================================================================

    public enablePlayable(ids: number[], onPlay: (cardId: number) => void) {
        this.playableIds = ids;
        this.onPlay = onPlay;
        this.renderHand();
    }

    public disablePlayable() {
        this.playableIds = [];
        this.onPlay = null;
        this.renderHand();
    }

    public enableDraftable(ids: number[], onDraft: (cardId: number) => void) {
        this.draftableIds = ids;
        this.onDraft = onDraft;
        this.renderDraftPool();
    }

    public disableDraftable() {
        this.draftableIds = [];
        this.onDraft = null;
        this.renderDraftPool();
    }

    // ===================================================================================
    //  Notifications
    // ===================================================================================

    setupNotifications() {
        console.log('notifications subscriptions setup');
        // Promise notifications are auto-wired from the `notif_*` methods below.
        this.bga.notifications.setupPromiseNotifications({
            // logger: console.log
        });
    }

    /** A card was played into the trade area (its face travels with the notification). */
    async notif_cardPlayed(args: NotifCardPlayed) {
        const id = Number(args.card_id);
        this.gamedatas.trick[id] = args.card;
        // If it left my hand, drop it; either way the player's hand count decreases.
        delete this.gamedatas.hand[id];
        if (this.gamedatas.counts?.[args.player_id]) {
            this.gamedatas.counts[args.player_id].hand = Math.max(
                0, this.gamedatas.counts[args.player_id].hand - 1
            );
        }
        this.renderTradeArea();
        this.renderHand();
        this.renderCounts(args.player_id);
    }

    /** A card was drafted from the pool into a player's knitting area. */
    async notif_cardDrafted(args: NotifCardDrafted) {
        const id = Number(args.card_id);
        delete this.gamedatas.draftpool[id];
        this.gamedatas.knitting[id] = args.card;
        this.renderDraftPool();
        this.renderKnitting(args.player_id);
    }

    /** The trick resolved into a draft order; show the order badges. */
    async notif_draftOrder(args: NotifDraftOrder) {
        this.draftOrder = args.order.map(Number);
        this.gamedatas.players && Object.values(this.gamedatas.players).forEach(
            (p) => this.renderOrderBadge(Number(p.id))
        );
    }

    /** End of trick: the trade area becomes the new draft pool; counts resync. */
    async notif_trickCleanup(args: NotifTrickCleanup) {
        const pool: CardMapT = {};
        args.pool.forEach((c) => (pool[Number(c.id)] = c));
        this.gamedatas.draftpool = pool;
        this.gamedatas.trick = {};
        this.gamedatas.counts = args.counts;
        this.draftOrder = [];
        this.renderDraftPool();
        this.renderTradeArea();
        this.renderPlayers();
    }

    /** Private: my hand was refilled — replace it. */
    async notif_handUpdate(args: NotifHandUpdate) {
        const hand: CardMapT = {};
        args.hand.forEach((c) => (hand[Number(c.id)] = c));
        this.gamedatas.hand = hand;
        if (this.gamedatas.counts?.[this.myId]) {
            this.gamedatas.counts[this.myId].hand = args.hand.length;
        }
        this.renderHand();
        this.renderCounts(this.myId);
    }
}
