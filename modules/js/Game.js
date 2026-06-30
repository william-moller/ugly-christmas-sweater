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
        this.game.enablePlayable(args.playableCardsIds || [], (cardId, copyFromCardId) => {
            this.bga.actions.performAction('actPlayCard', { card_id: cardId, copy_from_card_id: copyFromCardId });
        });
    }
    onLeavingState(args, isCurrentPlayerActive) {
        this.game.disablePlayable();
    }
}

/**
 * Client handler for the DraftCard (Draft phase) state.
 * Clicking a draftable pool card selects it; the player then chooses where to place it (and, for a
 * Patch, its value / icon / orientation) via the placement panel before the draft is submitted.
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
        this.game.beginDraft(args.draftableIds || [], (cardId, placement) => {
            this.bga.actions.performAction('actDraftCard', {
                card_id: cardId,
                build_no: placement.build_no,
                slot: placement.slot,
                floating_patch_slot: placement.floating_patch_slot,
            });
        });
    }
    onLeavingState(args, isCurrentPlayerActive) {
        this.game.endDraft();
    }
}

/**
 * Client handler for the RoundReview (between-round pause) state. Every player sees the round's scoring
 * summary; clicking Continue acknowledges it (server: actContinueRound). Once all players continue, the
 * next round is dealt. The summary is rendered from the state args (not just the notif) so it survives a
 * page refresh.
 */
class RoundReview {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
    }
    onEnteringState(args, isCurrentPlayerActive) {
        this.game.showRoundReview(args, isCurrentPlayerActive, () => {
            this.bga.actions.performAction('actContinueRound', {});
        });
    }
    onLeavingState() {
        this.game.endRoundReview();
    }
}

/**
 * Client handler for the AssignPatches (round-end) state. Each player with patch(es) in a completed
 * sweater assigns a value + icon to each, simultaneously. The value/icon pickers live in the action bar
 * (the patch being assigned is highlighted in the player's knitting area); each assignment is sent via
 * actAssignPatch. Non-active players (none to assign) just wait.
 */
class AssignPatches {
    constructor(game, bga) {
        this.game = game;
        this.bga = bga;
    }
    onEnteringState(args, isCurrentPlayerActive) {
        if (!isCurrentPlayerActive) {
            return;
        }
        const mine = (args.assignable && args.assignable[this.bga.gameui.player_id]) || [];
        this.game.beginAssignPatches(mine, (cardId, value, icon) => {
            this.bga.actions.performAction('actAssignPatch', { card_id: cardId, value, icon });
        });
    }
    onLeavingState() {
        this.game.endAssignPatches();
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
    // A placed patch carries its chosen value/icon on the card row (wildValue / wildIcon); a regular
    // card uses its printed face. An unresolved patch shows a wild star / placeholder.
    const wildValue = card.wildValue != null && card.wildValue !== '' ? Number(card.wildValue) : null;
    const wildIcon = card.wildIcon != null && card.wildIcon !== '' ? String(card.wildIcon) : null;
    // Value: chosen patch value, else printed value, else a wild star for an unresolved patch.
    const valueLabel = wildValue != null ? String(wildValue) : (face.patch ? '★' : String(face.value));
    // Icon: chosen patch icon or printed icon → glyph; "?" placeholder until art, "✶" for a wild patch.
    const effIcon = wildIcon ?? face.icon;
    const iconLabel = effIcon ? (ICON_GLYPH[effIcon] ?? effIcon) : (face.patch ? '✶' : '?');
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
/**
 * A compact inline card "chip" for the game log: a colour-coded box showing the card's value
 * (colour + value is enough to identify the exact card in play). Built client-side from the card
 * row carried in the notification, so historical logs / replays stay valid.
 *
 * A **Patch** is shown as its own wild-star chip so it's never confused with the real card it copies:
 * a patch that has taken on a value (e.g. mimicking the previous card in a trick) reads "★ as 11";
 * an unresolved patch (just drafted) shows only the star.
 */
function cardLogChip(card, material) {
    const face = faceOf(card, material);
    const color = face?.color ?? String(card.type);
    const wildValue = card.wildValue != null && card.wildValue !== '' ? Number(card.wildValue) : null;
    if (face?.patch) {
        const patchChip = `<span class="ucs-log-card ucs-log-patch ucs-color-${color}">★</span>`;
        if (wildValue != null) {
            const valueChip = `<span class="ucs-log-card ucs-color-${color}">${wildValue}</span>`;
            return `${patchChip} ${_('as')} ${valueChip}`;
        }
        return patchChip;
    }
    const valueLabel = wildValue != null ? String(wildValue) : String(face?.value ?? '?');
    return `<span class="ucs-log-card ucs-color-${color}">${valueLabel}</span>`;
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
        return `<strong>${colour} Patch</strong><br>Wild. Starting a new sweater it "floats" (no orientation) `
            + `until a second card joins; its value &amp; icon are chosen at round-end scoring.`;
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
        this.selectedPlayId = null;
        // Drafting / placement selection state.
        this.draftableIds = [];
        this.onDraftComplete = null;
        this.selectedDraftId = null;
        // The build chosen to place into (0 = new sweater), plus the orientation choices a patch placement
        // may still need: the drafted patch's own slot (only when added to an existing sweater) and the
        // orientation to give a floating patch already sitting in the target sweater. null = not yet chosen.
        this.pendingBuildNo = null;
        this.patchSlot = null;
        this.floatingPatchSlot = null;
        // Round-end patch assignment (AssignPatches state): a queue of my patch card ids still to assign,
        // and the value/icon being chosen for the head of the queue.
        this.onAssignPatch = null;
        this.assignQueue = [];
        this.assignValue = null;
        this.assignIcon = null;
        // Confirm/Reset gate: a pending play/draft waits for the player to confirm (or auto-confirms via
        // the action button's countdown). The abort controller cancels that countdown on Reset / leave.
        this.confirmAbort = null;
        this.confirming = false; // true while a play/draft is awaiting Confirm (hides draft targets)
        // Current draft order (player ids, best-first) for the order badges.
        this.draftOrder = [];
        // Monotonic counter for assigning ids to gameplay-card elements (so tooltips can attach).
        this.gpSeq = 0;
        console.log('uglychristmassweater constructor');
        this.bga = bga;
        // Register the state handlers (one per active-player PHP state).
        this.bga.states.register('PlayCard', new PlayCard(this, bga));
        this.bga.states.register('DraftCard', new DraftCard(this, bga));
        this.bga.states.register('RoundReview', new RoundReview(this, bga));
        this.bga.states.register('AssignPatches', new AssignPatches(this, bga));
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
                <div id="ucs-placement" class="ucs-zone" style="display:none"></div>
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
        this.maybeAddDebugButton();
        console.log("Ending game setup");
    }
    /**
     * Studio-only inspector button. Pure client side — dumps current state to the console (handy for
     * eyeballing the render/scoring batch) and reminds which server-side debug_* helpers exist. Those
     * helpers (debug_forceRoundOver / debug_addScore / debug_goToState) are invoked from the Studio
     * debug console, not from here. (Pattern borrowed from the "collect" reference game.)
     */
    maybeAddDebugButton() {
        if (!this.gamedatas.isStudio)
            return;
        const area = this.bga.gameArea.getElement();
        area.insertAdjacentHTML('beforeend', `<a id="ucs-debug" class="bgabutton bgabutton_blue" href="#" style="margin:8px">DEBUG: dump state</a>`);
        document.getElementById('ucs-debug').addEventListener('click', (e) => {
            e.preventDefault();
            console.log('[UCS DEBUG] gamedatas', this.gamedatas);
            console.log('[UCS DEBUG] my knitting builds', this.myBuilds());
            console.log('[UCS DEBUG] scores', Object.values(this.gamedatas.players)
                .map((p) => ({ name: p.name, score: p.score })));
            console.log('[UCS DEBUG] Studio server helpers: debug_forceRoundOver(), '
                + 'debug_addScore(playerId, delta), debug_goToState(id)');
        });
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
    /**
     * The three round-parameter decks (Perfect Fit / Trendy Yarn / Fad), shown off to the side and
     * public to all players. Each shows its face-down draw pile (with the count remaining) and the
     * current face-up revealed card; previous reveals stay stacked beneath. Placeholder faces until art.
     */
    renderGameplay() {
        const zone = document.getElementById('ucs-gameplay');
        zone.innerHTML = `<div class="ucs-zone-label">Round Parameters</div>`;
        const row = document.createElement('div');
        row.className = 'ucs-gameplay-row';
        const gp = this.gamedatas.gameplay;
        [
            ['perfectfit', 'Perfect Fit'],
            ['trendyyarn', 'Trendy Yarn'],
            ['fad', 'Fads'],
        ].forEach(([type, label]) => {
            row.appendChild(this.gameplayPileEl(type, label, gp?.[type]));
        });
        zone.appendChild(row);
    }
    /** One gameplay deck: label, the current face-up card, and the face-down draw pile + count. */
    gameplayPileEl(type, label, pile) {
        const wrap = document.createElement('div');
        wrap.className = 'ucs-gp-pile';
        wrap.innerHTML = `<div class="ucs-gp-label">${label}</div>`;
        const cards = document.createElement('div');
        cards.className = 'ucs-gp-cards';
        // The face-down draw pile + how many cards remain — shown on the LEFT.
        const deck = document.createElement('div');
        deck.className = 'ucs-gp-deck';
        const remaining = pile?.deckCount ?? 0;
        deck.innerHTML = `<div class="ucs-card ucs-card-back ucs-gp-back ${remaining ? '' : 'ucs-gp-empty'}"></div>`
            + `<div class="ucs-gp-count">${remaining} left</div>`;
        cards.appendChild(deck);
        // The current revealed card to the RIGHT of its draw pile (with a "stacked" look when earlier
        // reveals sit beneath it).
        const active = document.createElement('div');
        active.className = 'ucs-gp-active';
        if (pile && (pile.seenCount ?? 0) > 1)
            active.classList.add('ucs-gp-stacked');
        active.appendChild(this.gameplayCardEl(type, pile?.active ?? null));
        cards.appendChild(active);
        wrap.appendChild(cards);
        return wrap;
    }
    /** Placeholder face for a revealed gameplay card (colour swatch / value / fad title). */
    gameplayCardEl(type, card) {
        const el = document.createElement('div');
        el.className = 'ucs-card ucs-gp-card';
        if (!card) {
            el.classList.add('ucs-gp-none');
            el.innerHTML = `<div class="ucs-gp-face">—</div>`;
            return el;
        }
        const arg = Number(card.type_arg);
        if (type === 'perfectfit') {
            el.innerHTML = `<div class="ucs-gp-kind">Perfect Fit</div><div class="ucs-gp-big">${arg}</div>`;
            this.bga.gameui.addTooltipHtml?.(this.gpId(el), `<strong>Perfect Fit ${arg}</strong><br>Cards of value ${arg} are the super-trump this round.`);
        }
        else if (type === 'trendyyarn') {
            const color = this.material.colors[arg] ?? String(arg);
            el.classList.add(`ucs-color-${color}`);
            el.innerHTML = `<div class="ucs-card-pattern"></div><div class="ucs-gp-kind">Trendy Yarn</div>`
                + `<div class="ucs-gp-big">${color.charAt(0).toUpperCase()}</div>`;
            this.bga.gameui.addTooltipHtml?.(this.gpId(el), `<strong>Trendy Yarn: ${color}</strong><br>${color.charAt(0).toUpperCase() + color.slice(1)} is the trump colour this round.`);
        }
        else {
            const fad = this.material.fads[arg];
            const title = fad?.title ?? `Fad ${arg}`;
            el.classList.add('ucs-gp-fad');
            el.innerHTML = `<div class="ucs-gp-kind">Fad</div><div class="ucs-gp-fad-title">${title}</div>`;
            this.bga.gameui.addTooltipHtml?.(this.gpId(el), `<strong>${title}</strong><br>Round scoring bonus (applies to all players).`);
        }
        return el;
    }
    /** Ensure an element has an id (so a tooltip can attach), and return it. */
    gpId(el) {
        if (!el.id)
            el.id = `ucs-gp-${++this.gpSeq}`;
        return el.id;
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
                if (Number(card.id) === this.selectedDraftId) {
                    el.classList.add('ucs-chosen');
                }
                el.addEventListener('click', () => this.selectDraft(Number(card.id)));
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
    /**
     * Render a player's knitting area: builds laid out in the sweater silhouette (L top-left, R
     * top-right, B centred below). A floating Patch (orientation not yet chosen) renders centred with a
     * "floating" treatment; during round-end assignment the patch being assigned is highlighted.
     *
     * Hybrid placement: while *I* am drafting a REGULAR card and still choosing a sweater, the area
     * doubles as a click-to-place picker — the card's printed slot shows as a target in each build (and
     * a "new sweater" ghost). Patches are placed from the action bar instead, so they draw no targets.
     */
    renderKnitting(playerId) {
        const zone = document.getElementById(`ucs-knitting-${playerId}`);
        if (!zone)
            return;
        zone.innerHTML = '';
        const cards = this.cardArray(this.gamedatas.knitting).filter((c) => Number(c.location_arg) === playerId);
        const sel = this.selectedDraftId != null ? this.gamedatas.draftpool[this.selectedDraftId] : null;
        const mine = playerId === this.myId && this.onDraftComplete != null && sel != null;
        const selPatch = mine ? isPatch(sel, this.material) : false;
        const picked = mine ? this.pendingBuildNo : null; // chosen build (highlighted green)
        // A regular card is placed by clicking a slot in my area — those targets stay clickable so the
        // position can be changed freely until Submit (the picked cell shows green, the rest as options).
        const regularSlot = (mine && !selPatch) ? (faceOf(sel, this.material).slot ?? null) : null;
        // A patch's chosen orientation (picked from the action bar) and any floating-patch destination
        // show as green, non-clickable, so the player can see where things will land before submitting.
        const patchDest = (mine && selPatch && this.pendingBuildNo != null && this.patchSlot)
            ? { buildNo: this.pendingBuildNo, slot: this.patchSlot } : null;
        const floatDest = (mine && this.pendingBuildNo != null && this.floatingPatchSlot)
            ? { buildNo: this.pendingBuildNo, slot: this.floatingPatchSlot } : null;
        if (!cards.length && regularSlot == null) {
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
            if (this.isBuildComplete(builds[buildNo]))
                build.classList.add('ucs-build-complete');
            const slotEls = {};
            builds[buildNo].forEach((card) => {
                const el = createCardElement(card, this.material);
                const slot = card.slot ?? faceOf(card, this.material).slot ?? null;
                if (slot) {
                    el.style.gridArea = slot;
                    el.classList.add(`ucs-slot-${slot}`); // lets CSS rotate the B (hem) piece
                    slotEls[slot] = el;
                }
                else {
                    el.classList.add('ucs-floating'); // a floating patch — orientation not set yet
                }
                if (Number(card.id) === this.assignQueue[0]) {
                    el.classList.add('ucs-assigning'); // the patch being assigned right now
                }
                this.attachTooltip(el, card);
                build.appendChild(el);
            });
            // Apply a target/destination at `slot`: reuse the card el if present, else a ghost cell.
            const cell = (slot, mode, clickable) => {
                if (slotEls[slot])
                    this.applyTarget(slotEls[slot], buildNo, mode, clickable);
                else
                    build.appendChild(this.makeTargetGhost(slot, buildNo, mode, clickable));
            };
            if (regularSlot)
                cell(regularSlot, picked === buildNo ? 'selected' : 'option', true);
            if (patchDest && patchDest.buildNo === buildNo)
                cell(patchDest.slot, 'selected', false);
            if (floatDest && floatDest.buildNo === buildNo)
                cell(floatDest.slot, 'selected', false);
            zone.appendChild(build);
        });
        // "New sweater" target for a regular card (clickable; green when it's the picked destination).
        if (regularSlot) {
            const newBuild = document.createElement('div');
            newBuild.className = 'ucs-build ucs-build-new';
            newBuild.appendChild(this.makeTargetGhost(regularSlot, 0, picked === 0 ? 'selected' : 'option', true));
            zone.appendChild(newBuild);
        }
    }
    /** Style an existing piece as a placement target/destination; clickable ones (re)choose that sweater. */
    applyTarget(el, buildNo, mode, clickable) {
        el.classList.add('ucs-target', mode === 'selected' ? 'ucs-target-selected' : 'ucs-target-option');
        if (clickable)
            el.addEventListener('click', () => this.placeDraftTarget(buildNo));
    }
    /** A ghost cell at `slot` for `buildNo` (0 = new sweater); clickable ones (re)choose that sweater. */
    makeTargetGhost(slot, buildNo, mode, clickable) {
        const ghost = document.createElement('div');
        ghost.className = `ucs-card ucs-ghost ucs-target ${mode === 'selected' ? 'ucs-target-selected' : 'ucs-target-option'} ucs-slot-${slot}`;
        ghost.style.gridArea = slot;
        ghost.innerHTML = `<div class="ucs-ghost-label">${slot}</div>`;
        if (clickable)
            ghost.addEventListener('click', () => this.placeDraftTarget(buildNo));
        return ghost;
    }
    /**
     * A knitting target was clicked while drafting a regular card: (re)choose that sweater. The choice
     * is freely changeable — re-render so the picked cell shows green and the action bar offers Submit
     * (or, if the target holds a floating patch, its orientation first). Nothing is sent until Submit.
     */
    placeDraftTarget(buildNo) {
        if (this.pendingBuildNo !== buildNo)
            this.floatingPatchSlot = null; // re-picking clears the float choice
        this.pendingBuildNo = buildNo;
        this.renderPlacementPanel();
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
                if (Number(card.id) === this.selectedPlayId) {
                    el.classList.add('ucs-chosen');
                }
                el.addEventListener('click', () => this.selectPlay(Number(card.id)));
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
        this.selectedPlayId = null;
        this.renderHand();
        this.hidePanel();
    }
    disablePlayable() {
        this.cancelConfirm();
        this.playableIds = [];
        this.onPlay = null;
        this.selectedPlayId = null;
        this.renderHand();
        this.hidePanel();
    }
    /** A hand card was clicked. A leading Patch needs a pool card to copy first; everything else plays now. */
    selectPlay(cardId) {
        if (!this.onPlay)
            return;
        const card = this.gamedatas.hand[cardId];
        const leading = this.cardArray(this.gamedatas.trick).length === 0;
        if (card && isPatch(card, this.material) && leading) {
            this.selectedPlayId = cardId;
            this.renderHand();
            this.renderPatchCopyPanel(cardId);
        }
        else {
            this.completePlay(cardId, 0);
        }
    }
    /** A card (and, for a leading patch, its copy source) has been chosen — gate it behind Confirm/Reset. */
    completePlay(cardId, copyFromCardId) {
        this.selectedPlayId = cardId; // keep the pending card highlighted while confirming
        this.renderHand();
        this.confirmAction(() => {
            const cb = this.onPlay;
            this.selectedPlayId = null;
            this.hidePanel();
            this.renderHand();
            cb && cb(cardId, copyFromCardId);
        }, () => {
            // Reset: back to choosing a card from hand.
            this.selectedPlayId = null;
            this.hidePanel();
            this.renderHand();
            this.bga.statusBar.setTitle(_('${you} must play a card'));
        });
    }
    /** Confirm-gate behaviour, from the "Confirm before acting" game preference (gamepreferences 100). */
    confirmMode() {
        try {
            const raw = Number(this.bga.userPreferences?.get?.(100));
            return (raw === 0 || raw === 2) ? raw : 1; // default: auto-confirm
        }
        catch (e) {
            // Reading the preference can throw if it isn't loaded for this table; don't let that
            // strand the action — fall back to the auto-confirm default.
            console.warn('UCS: could not read the confirm preference; defaulting to auto-confirm', e);
            return 1;
        }
    }
    /**
     * Show a Confirm / Reset turn step in the top action bar before an action is actually sent to the
     * server. Reset undoes the whole pending selection (the action hasn't been sent yet, so nothing is
     * public — this IS the game's "undo"). The "Confirm before acting" preference controls the gate:
     *   0 Off    — skip it, send immediately;
     *   1 Auto   — Confirm auto-fires after BGA's native autoclick countdown (default);
     *   2 Manual — Confirm waits for an explicit click (no timer).
     */
    confirmAction(submit, reset) {
        const mode = this.confirmMode();
        if (mode === 0) {
            this.cancelConfirm();
            submit();
            return;
        }
        try {
            const sb = this.bga.statusBar;
            this.cancelConfirm();
            this.confirming = true;
            this.renderKnitting(this.myId); // drop the draft targets while confirming
            sb.removeActionButtons();
            sb.setTitle(_('${you} must confirm your action'));
            this.confirmAbort = new AbortController();
            const autoclick = mode === 1 ? { abortSignal: this.confirmAbort.signal } : false;
            sb.addActionButton(_('Confirm'), () => { this.confirmAbort = null; this.confirming = false; submit(); }, { color: 'primary', autoclick });
            sb.addActionButton(_('Reset turn'), () => { this.cancelConfirm(); reset(); }, { color: 'secondary' });
        }
        catch (e) {
            // The gate failed to render (a status-bar / preference quirk on this table). Never strand a
            // play/draft behind a broken gate: log the cause and just perform the action immediately.
            console.error('UCS: confirm gate failed to render; acting immediately', e);
            this.cancelConfirm();
            this.confirming = false;
            submit();
        }
    }
    /** Cancel any pending Confirm countdown (so it can't auto-fire after a Reset or state change). */
    cancelConfirm() {
        this.confirming = false;
        if (this.confirmAbort) {
            this.confirmAbort.abort();
            this.confirmAbort = null;
        }
    }
    /**
     * Leading with a patch: choose which numbered draft-pool card it copies (value + icon).
     * Rendered as compact buttons in the top action bar (one per copyable pool card), to match
     * the draft-placement controls.
     */
    renderPatchCopyPanel(cardId) {
        const sb = this.bga.statusBar;
        sb.removeActionButtons();
        const sources = this.cardArray(this.gamedatas.draftpool).filter((c) => !isPatch(c, this.material));
        sb.setTitle(_('Leading with a Patch — copy a draft-pool card\'s value & icon'));
        sources.forEach((c) => {
            const f = faceOf(c, this.material);
            const icon = f.icon ?? '?';
            sb.addActionButton(`${f.color} ${f.value} · ${icon}`, () => this.completePlay(cardId, Number(c.id)), { color: 'primary' });
        });
        sb.addActionButton(_('Cancel'), () => {
            this.selectedPlayId = null;
            sb.removeActionButtons();
            sb.setTitle(_('${you} must play a card'));
            this.renderHand();
        }, { color: 'alert' });
    }
    /** Hide and clear the shared placement / patch-copy panel and any status-bar action buttons. */
    hidePanel() {
        this.bga.statusBar.removeActionButtons();
        const panel = document.getElementById('ucs-placement');
        if (panel) {
            panel.style.display = 'none';
            panel.innerHTML = '';
        }
    }
    /** Enter the draft phase for the active player: pool cards become selectable. */
    beginDraft(ids, onComplete) {
        this.draftableIds = ids;
        this.onDraftComplete = onComplete;
        this.clearDraftSelection();
        this.renderDraftPool();
        this.renderPlacementPanel();
    }
    endDraft() {
        this.cancelConfirm();
        this.draftableIds = [];
        this.onDraftComplete = null;
        this.clearDraftSelection();
        this.renderDraftPool();
        this.renderPlacementPanel();
    }
    clearDraftSelection() {
        this.selectedDraftId = null;
        this.pendingBuildNo = null;
        this.patchSlot = null;
        this.floatingPatchSlot = null;
    }
    /** A pool card was clicked: select it and open the placement panel. */
    selectDraft(cardId) {
        this.clearDraftSelection();
        this.selectedDraftId = cardId;
        this.renderDraftPool();
        this.renderPlacementPanel();
    }
    /** My knitting grouped into builds: oriented slots per build, plus any floating-patch card id per build. */
    myBuilds() {
        const builds = {};
        const floating = {};
        this.cardArray(this.gamedatas.knitting)
            .filter((c) => Number(c.location_arg) === this.myId)
            .forEach((c) => {
            const b = Number(c.buildNo ?? 0);
            (builds[b] || (builds[b] = new Set()));
            const slot = c.slot ? String(c.slot) : null;
            if (slot)
                builds[b].add(slot);
            else
                floating[b] = Number(c.id); // a floating patch (orientation not yet assigned)
        });
        return { builds, floating, buildNos: Object.keys(builds).map(Number).sort((a, b) => a - b) };
    }
    /**
     * Drive the draft placement from the action bar. A patch no longer picks value/icon here (those are
     * assigned at round-end). Steps: (1) choose the target sweater (skipped when "new" is the only
     * option); (2) for a patch added to an EXISTING sweater, choose its orientation; (3) if the target
     * already holds a floating patch, choose that floating patch's orientation too; then the placement
     * gates behind Confirm. A patch starting a NEW sweater simply floats — no orientation needed.
     */
    renderPlacementPanel() {
        const sb = this.bga.statusBar;
        sb.removeActionButtons();
        this.renderKnitting(this.myId); // (re)draws the in-area targets for a regular card
        if (this.selectedDraftId == null || !this.onDraftComplete) {
            sb.setTitle(_('${you} must draft a sweater card'));
            return;
        }
        const card = this.gamedatas.draftpool[this.selectedDraftId];
        const patch = card ? isPatch(card, this.material) : false;
        const cancelBtn = () => sb.addActionButton(_('Cancel'), () => {
            this.clearDraftSelection();
            this.renderDraftPool();
            this.renderPlacementPanel();
        }, { color: 'alert' });
        // ---- Regular card: placement is driven by the in-area click targets (renderKnitting). ----
        if (!patch) {
            const { builds, floating, buildNos } = this.myBuilds();
            // Choosing the sweater: the (clickable, freely-changeable) targets in my area do it; the
            // action bar offers New + Cancel until a position is picked.
            if (this.pendingBuildNo == null) {
                if (buildNos.length === 0) {
                    this.pendingBuildNo = 0; // only option: new sweater — fall through to Submit
                }
                else {
                    sb.setTitle(_('Click a slot in your sweaters to place — or:'));
                    sb.addActionButton(_('+ New sweater'), () => this.placeDraftTarget(0), { color: 'primary' });
                    cancelBtn();
                    return;
                }
            }
            // A sweater was picked but it holds a floating patch → orient that patch first.
            const buildNo = this.pendingBuildNo;
            const floatId = (buildNo in builds) ? floating[buildNo] : undefined;
            if (floatId !== undefined && this.floatingPatchSlot == null) {
                const cardSlot = faceOf(card, this.material).slot ?? null;
                const openForFloat = ['L', 'R', 'B'].filter((s) => !builds[buildNo].has(s) && s !== cardSlot);
                sb.setTitle(_('Orient the floating patch already in this sweater'));
                openForFloat.forEach((s) => sb.addActionButton(`${_('Patch')} ${s}`, () => {
                    this.floatingPatchSlot = s;
                    this.renderPlacementPanel();
                }, { color: this.floatingPatchSlot === s ? 'primary' : 'secondary' }));
                cancelBtn();
                return;
            }
            // Ready: act immediately if the preference is "Off", else show Submit (position still editable).
            if (this.confirmMode() === 0) {
                this.submitDraft(buildNo);
                return;
            }
            sb.setTitle(_('Click a different slot to change, or submit'));
            sb.addActionButton(_('Submit'), () => this.submitDraft(buildNo), { color: 'primary' });
            cancelBtn();
            return;
        }
        // ---- Patch: placement is action-bar driven (new sweater floats; no value/icon here). ----
        const { builds, floating, buildNos } = this.myBuilds();
        // Step 1 — choose the target sweater (auto when a new sweater is the only option).
        if (this.pendingBuildNo == null) {
            if (buildNos.length === 0) {
                this.pendingBuildNo = 0; // only option: start a new (floating) sweater
            }
            else {
                sb.setTitle(_('Place your patch — choose a sweater'));
                buildNos.forEach((no) => sb.addActionButton(`${_('Sweater')} ${no}`, () => {
                    this.pendingBuildNo = no;
                    this.patchSlot = null;
                    this.floatingPatchSlot = null;
                    this.renderPlacementPanel();
                }, { color: 'primary' }));
                sb.addActionButton(_('+ New sweater (floats)'), () => {
                    this.pendingBuildNo = 0;
                    this.patchSlot = null;
                    this.floatingPatchSlot = null;
                    this.renderPlacementPanel();
                }, { color: 'primary' });
                cancelBtn();
                return;
            }
        }
        // Step 2 — orientation choices for the chosen sweater.
        const buildNo = this.pendingBuildNo;
        const isNewBuild = buildNo === 0 || !(buildNo in builds);
        const occupied = isNewBuild ? new Set() : builds[buildNo];
        const floatId = isNewBuild ? undefined : floating[buildNo];
        // The patch's own slot: chosen on an existing sweater, null (floating) when starting a new one.
        const cardSlot = isNewBuild ? null : this.patchSlot;
        if (!isNewBuild) {
            // A patch may take ANY orientation — including covering (placing over) an occupied slot,
            // which discards the piece underneath. Offer all three; flag the ones that would cover.
            sb.setTitle(_('Choose an orientation for your patch'));
            ['L', 'R', 'B'].forEach((s) => {
                const label = occupied.has(s) ? `${s} ${_('(cover)')}` : s;
                sb.addActionButton(label, () => {
                    this.patchSlot = s;
                    if (this.floatingPatchSlot === s)
                        this.floatingPatchSlot = null;
                    this.renderPlacementPanel();
                }, { color: this.patchSlot === s ? 'primary' : 'secondary' });
            });
        }
        if (floatId !== undefined) {
            const openForFloat = ['L', 'R', 'B'].filter((s) => !occupied.has(s) && s !== cardSlot);
            sb.setTitle(_('Orient the floating patch already in this sweater'));
            openForFloat.forEach((s) => sb.addActionButton(`${_('Patch')} ${s}`, () => {
                this.floatingPatchSlot = s;
                this.renderPlacementPanel();
            }, { color: this.floatingPatchSlot === s ? 'primary' : 'secondary' }));
        }
        const cardSlotReady = isNewBuild || this.patchSlot != null;
        const floatReady = floatId === undefined || this.floatingPatchSlot != null;
        const ready = cardSlotReady && floatReady;
        // Ready: act immediately if the preference is "Off", else show Submit. The orientation buttons
        // above stay live so the player can change a choice before submitting.
        if (ready && this.confirmMode() === 0) {
            this.submitDraft(buildNo);
            return;
        }
        if (ready) {
            sb.addActionButton(_('Submit'), () => this.submitDraft(buildNo), { color: 'primary' });
        }
        if (buildNos.length > 0) {
            sb.addActionButton(_('Change sweater'), () => {
                this.pendingBuildNo = null;
                this.patchSlot = null;
                this.floatingPatchSlot = null;
                this.renderPlacementPanel();
            }, { color: 'secondary' });
        }
        cancelBtn();
    }
    /** Send the draft with the chosen placement (no timer — the player has already clicked Submit, or
     *  the "act immediately" preference is on), then clear the local selection UI. */
    submitDraft(buildNo) {
        if (this.selectedDraftId == null || !this.onDraftComplete)
            return;
        const card = this.gamedatas.draftpool[this.selectedDraftId];
        const patch = card ? isPatch(card, this.material) : false;
        const placement = {
            build_no: buildNo,
            // slot only matters for a patch added to an existing sweater (regular = printed, patch-new = float).
            slot: (patch && this.patchSlot) ? this.patchSlot : '',
            floating_patch_slot: this.floatingPatchSlot ?? '',
        };
        const id = this.selectedDraftId;
        const cb = this.onDraftComplete;
        this.clearDraftSelection();
        this.renderDraftPool();
        this.bga.statusBar.removeActionButtons();
        this.renderKnitting(this.myId);
        cb(id, placement);
    }
    // ===================================================================================
    //  Round-end patch assignment — called by the AssignPatches state handler
    // ===================================================================================
    /** Begin assigning value+icon to my patches that sit in completed sweaters (round-end). */
    beginAssignPatches(cardIds, onAssign) {
        this.onAssignPatch = onAssign;
        this.assignQueue = [...cardIds];
        this.assignValue = null;
        this.assignIcon = null;
        this.renderAssignPanel();
    }
    endAssignPatches() {
        this.onAssignPatch = null;
        this.assignQueue = [];
        this.assignValue = null;
        this.assignIcon = null;
        this.bga.statusBar.removeActionButtons();
        this.renderKnitting(this.myId);
    }
    /** Value/icon pickers for the patch at the head of my assignment queue (highlighted in my area). */
    renderAssignPanel() {
        const sb = this.bga.statusBar;
        sb.removeActionButtons();
        this.renderKnitting(this.myId); // highlights assignQueue[0]
        if (!this.onAssignPatch || this.assignQueue.length === 0) {
            sb.setTitle(_('Waiting for other players…'));
            return;
        }
        const cardId = this.assignQueue[0];
        sb.setTitle(_('Assign a value and icon to your patch (highlighted)'));
        for (let v = 1; v <= 12; v++) {
            sb.addActionButton(String(v), () => { this.assignValue = v; this.renderAssignPanel(); }, { color: this.assignValue === v ? 'primary' : 'secondary' });
        }
        this.material.icons.forEach((ic) => {
            sb.addActionButton(ic, () => { this.assignIcon = ic; this.renderAssignPanel(); }, { color: this.assignIcon === ic ? 'primary' : 'secondary' });
        });
        if (this.assignValue != null && this.assignIcon != null) {
            const v = this.assignValue, ic = this.assignIcon, cb = this.onAssignPatch;
            sb.addActionButton(_('Confirm'), () => {
                this.assignQueue.shift();
                this.assignValue = null;
                this.assignIcon = null;
                cb(cardId, v, ic);
                this.renderAssignPanel();
            }, { color: 'primary' });
        }
    }
    // ===================================================================================
    //  Round review (between-round pause) — called by the RoundReview state handler
    // ===================================================================================
    /**
     * Show the round's scoring summary and, for an active player, a Continue button. Rendered from the
     * state args so it survives a page refresh. Clicking Continue acknowledges and waits for the others.
     */
    showRoundReview(args, isCurrentPlayerActive, onContinue) {
        this.renderRoundResult(args);
        const sb = this.bga.statusBar;
        sb.removeActionButtons();
        if (isCurrentPlayerActive) {
            sb.addActionButton(_('Continue'), () => {
                sb.removeActionButtons();
                sb.setTitle(_('Waiting for other players…'));
                onContinue();
            }, { color: 'primary' });
        }
    }
    /** Tear down the round-review screen when leaving the state (next round is about to be dealt). */
    endRoundReview() {
        this.bga.statusBar.removeActionButtons();
        document.getElementById('ucs-round-result')?.remove();
    }
    /** Render (or replace) the between-round results panel from a round summary. */
    renderRoundResult(args) {
        document.getElementById('ucs-round-result')?.remove();
        const rows = (args.breakdown || []).map((b) => `<tr><td class="ucs-rr-name">${b.player_name}</td>`
            + `<td>${b.sweaters}</td><td>${b.runs}</td><td class="ucs-rr-score">${b.score}</td></tr>`).join('');
        const html = `
            <div id="ucs-round-result" class="ucs-zone">
                <div class="ucs-zone-label">${_('Round')} ${args.round} — ${_('results')}</div>
                <table class="ucs-result-table">
                    <tr><th>${_('Player')}</th><th>${_('Sweaters')}</th><th>${_('Runs')}</th><th>${_('Total')}</th></tr>
                    ${rows}
                </table>
            </div>`;
        this.bga.gameArea.getElement().insertAdjacentHTML('beforeend', html);
    }
    // ===================================================================================
    //  Notifications
    // ===================================================================================
    /**
     * Replay-safe client-side log injection: the framework calls this for every log line. We swap the
     * `card_label` argument for an inline colour-coded card chip built from the `card` row carried in
     * the notification (cardPlayed / cardDrafted). Per BGA guidance we only mutate `args` — never the
     * `${...}` keys in the log string — so translations and historical logs keep working.
     */
    bgaFormatText(log, args) {
        try {
            if (log && args && !args.processed) {
                args.processed = true;
                if (args.card_label && args.card) {
                    args.card_label = cardLogChip(args.card, this.material);
                }
            }
        }
        catch (e) {
            console.error('bgaFormatText', log, args, e);
        }
        return { log, args };
    }
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
    /** A card was drafted from the pool into a player's knitting area (possibly placed over a piece). */
    async notif_cardDrafted(args) {
        const id = Number(args.card_id);
        delete this.gamedatas.draftpool[id];
        if (args.replaced_card_id != null) {
            delete this.gamedatas.knitting[Number(args.replaced_card_id)];
        }
        this.gamedatas.knitting[id] = args.card;
        // A floating patch already in the target sweater may have just been oriented by this placement.
        if (args.floating_patch) {
            this.gamedatas.knitting[Number(args.floating_patch.id)] = args.floating_patch;
        }
        this.renderDraftPool();
        this.renderKnitting(args.player_id);
    }
    /** Round-end: a player set a patch's value + icon — re-render it with its chosen face. */
    async notif_patchAssigned(args) {
        const id = Number(args.card_id);
        this.gamedatas.knitting[id] = args.card;
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
    /** A new round revealed fresh gameplay cards — refresh the round-parameter decks. */
    async notif_gameplayRevealed(args) {
        this.gamedatas.gameplay = args.gameplay;
        this.renderGameplay();
    }
    /**
     * A round was scored. The clienttranslate message auto-logs; the review panel itself is rendered
     * from the RoundReview state args (refresh-safe), but render it here too so the summary appears the
     * instant scoring resolves (also covers the final round, which has no RoundReview state).
     */
    async notif_roundScored(args) {
        this.renderRoundResult(args);
    }
}

export { Game };
