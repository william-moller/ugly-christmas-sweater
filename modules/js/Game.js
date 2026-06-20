/**
 * Client handler for the PlayCard (Trade phase) state.
 * Highlights the legally-playable cards in the active player's hand; clicking one plays it.
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
        this.game.enablePlayable(args.playableCardsIds || [], (cardId) => {
            this.bga.actions.performAction('actPlayCard', { card_id: cardId });
        });
    }
    onLeavingState(args, isCurrentPlayerActive) {
        this.game.disablePlayable();
    }
}

/**
 * Client handler for the DraftCard (Draft phase) state.
 * Highlights the draftable pool cards; clicking one drafts it into the knitting area.
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
        this.game.enableDraftable(args.draftableIds || [], (cardId) => {
            this.bga.actions.performAction('actDraftCard', { card_id: cardId });
        });
    }
    onLeavingState(args, isCurrentPlayerActive) {
        this.game.disableDraftable();
    }
}

/*
 * CardView — builds placeholder DOM for a sweater card.
 *
 * The publisher art has not arrived yet, so cards are drawn from data we DO have (colour + value,
 * with a colour-blind-friendly pattern per colour). Icon and orientation are printed on the physical
 * cards and live in Material::FACES once transcribed; until then they render as "?" and the markup is
 * already in place to show them the moment that data exists.
 */
/** Unicode glyphs for the four icons (used once Material::FACES is populated). */
const ICON_GLYPH = {
    snowman: '☃', // ☃
    candycane: '\u{1F36C}', // 🍬 (placeholder glyph)
    bell: '\u{1F514}', // 🔔
    tree: '\u{1F384}', // 🎄
};
/** Human-readable orientation label. */
const SLOT_LABEL = { L: 'L', R: 'R', B: 'B' };
/** Resolve a card row to its static face via the material map. */
function faceOf(card, material) {
    const key = `${card.type}_${card.type_arg}`;
    return material.sweaters[key];
}
/** True when a card is a patch (wild). */
function isPatch(card, material) {
    const face = faceOf(card, material);
    return !!face && face.patch;
}
/**
 * Build a card element. `extras` lets callers add a small overlay (e.g. the slot a card occupies in a
 * build, which is dynamic and lives on the card row rather than the static face).
 */
function createCardElement(card, material) {
    const face = faceOf(card, material);
    const el = document.createElement('div');
    el.id = `ucs-card-${card.id}`;
    el.dataset.cardId = String(card.id);
    el.classList.add('ucs-card', `ucs-color-${face.color}`);
    if (face.patch) {
        el.classList.add('ucs-patch');
    }
    // Value: patches show a star (wild) until resolved.
    const valueLabel = face.patch ? '★' : String(face.value);
    // Icon: known glyph, or "?" placeholder until the art data lands.
    const iconLabel = face.icon ? (ICON_GLYPH[face.icon] ?? face.icon) : '?';
    // Orientation: prefer the card's placed slot (knitting), else the printed slot, else placeholder.
    const slotRaw = card.slot ?? face.slot ?? null;
    const slotLabel = slotRaw ? (SLOT_LABEL[slotRaw] ?? slotRaw) : (face.patch ? '✶' : '?');
    el.innerHTML = `
        <div class="ucs-card-pattern"></div>
        <div class="ucs-card-value">${valueLabel}</div>
        <div class="ucs-card-icon">${iconLabel}</div>
        <div class="ucs-card-slot" title="orientation">${slotLabel}</div>
    `;
    return el;
}
/** A face-down placeholder (e.g. opponents' hand backs). */
function createCardBack() {
    const el = document.createElement('div');
    el.classList.add('ucs-card', 'ucs-card-back');
    return el;
}
/** Tooltip HTML describing a card (colour + value; icon/orientation once known). */
function cardTooltip(card, material) {
    const face = faceOf(card, material);
    const colour = face.color.charAt(0).toUpperCase() + face.color.slice(1);
    if (face.patch) {
        return `<strong>${colour} Patch</strong><br>Wild — value, icon and orientation are chosen when played/placed.`;
    }
    const icon = face.icon ?? '? (pending art)';
    const slot = face.slot ?? '? (pending art)';
    return `<strong>${colour} ${face.value}</strong><br>Icon: ${icon}<br>Orientation: ${slot}`;
}

class Game {
    constructor(bga) {
        // Selection state for the active player (set by the PlayCard / DraftCard state handlers).
        this.playableIds = [];
        this.onPlay = null;
        this.draftableIds = [];
        this.onDraft = null;
        // Current draft order (player ids, best-first) for the order badges.
        this.draftOrder = [];
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
    setup(gamedatas) {
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
            document.getElementById('ucs-players').insertAdjacentHTML('beforeend', `
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
    get material() {
        return this.gamedatas.material;
    }
    get myId() {
        return this.bga.gameui.player_id;
    }
    cardArray(map) {
        return map ? Object.values(map) : [];
    }
    renderAll() {
        this.renderGameplay();
        this.renderDraftPool();
        this.renderTradeArea();
        this.renderPlayers();
        this.renderHand();
    }
    /** Active round-parameter cards (Perfect Fit / Trendy Yarn / Fad). Placeholder until art lands. */
    renderGameplay() {
        const zone = document.getElementById('ucs-gameplay');
        const active = this.cardArray(this.gamedatas.activeGameplay);
        if (!active.length) {
            zone.innerHTML = `<div class="ucs-zone-label">Round parameters: pending card data</div>`;
            return;
        }
        zone.innerHTML = `<div class="ucs-zone-label">Round parameters</div>`;
        // TODO: render Perfect Fit / Trendy Yarn / Fad faces once Material gameplay data is populated.
    }
    renderDraftPool() {
        const zone = document.getElementById('ucs-draft-pool');
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
    renderTradeArea() {
        const zone = document.getElementById('ucs-trade-area');
        zone.innerHTML = `<div class="ucs-zone-label">Trade Area (this trick)</div>`;
        const row = document.createElement('div');
        row.className = 'ucs-card-row';
        // Show in play order (trickOrder) when available.
        const cards = this.cardArray(this.gamedatas.trick).sort((a, b) => Number(a.trickOrder ?? 0) - Number(b.trickOrder ?? 0));
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
    renderPlayers() {
        Object.values(this.gamedatas.players).forEach((player) => {
            this.renderCounts(Number(player.id));
            this.renderOrderBadge(Number(player.id));
            this.renderKnitting(Number(player.id));
        });
    }
    renderCounts(playerId) {
        const el = document.getElementById(`ucs-counts-${playerId}`);
        if (!el)
            return;
        const c = this.gamedatas.counts?.[playerId];
        el.textContent = c ? `✋ ${c.hand} · 🂠 ${c.pile}` : '';
    }
    renderOrderBadge(playerId) {
        const el = document.getElementById(`ucs-order-${playerId}`);
        if (!el)
            return;
        const idx = this.draftOrder.indexOf(playerId);
        if (idx >= 0) {
            el.textContent = String(idx + 1);
            el.classList.add('ucs-has-order');
        }
        else {
            el.textContent = '';
            el.classList.remove('ucs-has-order');
        }
    }
    /** Group a player's knitting cards by build number and lay them out as L/R/B slots. */
    renderKnitting(playerId) {
        const zone = document.getElementById(`ucs-knitting-${playerId}`);
        if (!zone)
            return;
        zone.innerHTML = '';
        const cards = this.cardArray(this.gamedatas.knitting).filter((c) => Number(c.location_arg) === playerId);
        if (!cards.length) {
            zone.innerHTML = `<div class="ucs-empty">No sweaters yet</div>`;
            return;
        }
        const builds = {};
        cards.forEach((c) => {
            const b = Number(c.buildNo ?? 0);
            (builds[b] || (builds[b] = [])).push(c);
        });
        Object.keys(builds)
            .map(Number)
            .sort((a, b) => a - b)
            .forEach((buildNo) => {
            const build = document.createElement('div');
            build.className = 'ucs-build';
            const complete = this.isBuildComplete(builds[buildNo]);
            if (complete)
                build.classList.add('ucs-build-complete');
            builds[buildNo].forEach((card) => {
                const el = createCardElement(card, this.material);
                this.attachTooltip(el, card);
                build.appendChild(el);
            });
            zone.appendChild(build);
        });
    }
    isBuildComplete(build) {
        const slots = new Set(build.map((c) => c.slot));
        return slots.has('L') && slots.has('R') && slots.has('B');
    }
    renderHand() {
        const zone = document.getElementById('ucs-my-hand');
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
            }
            else if (this.playableIds.length) {
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
    handSort(a, b) {
        if (a.type !== b.type)
            return a.type < b.type ? -1 : 1;
        return Number(a.type_arg) - Number(b.type_arg);
    }
    attachTooltip(el, card) {
        // gameui.addTooltipHtml works on an element id; ours are unique (ucs-card-<id>).
        this.bga.gameui.addTooltipHtml?.(el.id, cardTooltip(card, this.material));
    }
    // ===================================================================================
    //  Selection API — called by the PlayCard / DraftCard state handlers
    // ===================================================================================
    enablePlayable(ids, onPlay) {
        this.playableIds = ids;
        this.onPlay = onPlay;
        this.renderHand();
    }
    disablePlayable() {
        this.playableIds = [];
        this.onPlay = null;
        this.renderHand();
    }
    enableDraftable(ids, onDraft) {
        this.draftableIds = ids;
        this.onDraft = onDraft;
        this.renderDraftPool();
    }
    disableDraftable() {
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
    async notif_cardPlayed(args) {
        const id = Number(args.card_id);
        this.gamedatas.trick[id] = args.card;
        // If it left my hand, drop it; either way the player's hand count decreases.
        delete this.gamedatas.hand[id];
        if (this.gamedatas.counts?.[args.player_id]) {
            this.gamedatas.counts[args.player_id].hand = Math.max(0, this.gamedatas.counts[args.player_id].hand - 1);
        }
        this.renderTradeArea();
        this.renderHand();
        this.renderCounts(args.player_id);
    }
    /** A card was drafted from the pool into a player's knitting area. */
    async notif_cardDrafted(args) {
        const id = Number(args.card_id);
        delete this.gamedatas.draftpool[id];
        this.gamedatas.knitting[id] = args.card;
        this.renderDraftPool();
        this.renderKnitting(args.player_id);
    }
    /** The trick resolved into a draft order; show the order badges. */
    async notif_draftOrder(args) {
        this.draftOrder = args.order.map(Number);
        this.gamedatas.players && Object.values(this.gamedatas.players).forEach((p) => this.renderOrderBadge(Number(p.id)));
    }
    /** End of trick: the trade area becomes the new draft pool; counts resync. */
    async notif_trickCleanup(args) {
        const pool = {};
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
    async notif_handUpdate(args) {
        const hand = {};
        args.hand.forEach((c) => (hand[Number(c.id)] = c));
        this.gamedatas.hand = hand;
        if (this.gamedatas.counts?.[this.myId]) {
            this.gamedatas.counts[this.myId].hand = args.hand.length;
        }
        this.renderHand();
        this.renderCounts(this.myId);
    }
}

export { Game };
