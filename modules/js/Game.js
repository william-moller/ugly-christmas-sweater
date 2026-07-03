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
 * The inner face markup for a sweater card, matching the printed card art: the value, the
 * orientation letter on a "Christmas-light" bulb, and the icon all stacked in the TOP-LEFT corner,
 * over the colour + colour-blind pattern. Shared by the custom-DOM zones (createCardElement) and the
 * bga-cards hand (the CardManager's setupFrontDiv) so every card looks identical.
 */
function cardFaceInner(card, material) {
    const face = faceOf(card, material);
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
    const bulbKind = slotRaw ?? 'wild';
    return `
        <div class="ucs-card-pattern"></div>
        <div class="ucs-card-corner">
            <div class="ucs-card-value">${valueLabel}</div>
            <div class="ucs-bulb ucs-bulb-${bulbKind}" title="orientation">${slotLabel}</div>
            <div class="ucs-icon-col">${iconLabel}</div>
        </div>
    `;
}
/** Add the colour/patch classes and inner face to an element (shared by both render paths). */
function applyCardFace(el, card, material) {
    const face = faceOf(card, material);
    el.classList.add('ucs-card', `ucs-color-${face.color}`);
    if (face.patch) {
        el.classList.add('ucs-patch');
    }
    el.innerHTML = cardFaceInner(card, material);
}
/**
 * Build a standalone card element (used by the custom-DOM zones: draft pool, trade area, knitting).
 * The bga-cards hand builds its faces through the CardManager instead (see Game.ts), but both share
 * `cardFaceInner` so the visuals match.
 */
function createCardElement(card, material) {
    const el = document.createElement('div');
    el.id = `ucs-card-${card.id}`;
    el.dataset.cardId = String(card.id);
    applyCardFace(el, card, material);
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

/*
BGA front libraries, loaded at runtime from the BGA-hosted ESM libs (no bundling needed — rollup
keeps its `es` output and BGA serves the library). The `.d.ts` typing files live at the repo root
(`bga-cards.d.ts` / `bga-animations.d.ts`, downloaded per https://en.doc.boardgamearena.com/BgaCards)
and are type-only imports here, so they are erased from the build.

Because these are top-level `await`s, the whole module graph resolves the libraries before `Game`
is constructed — so `setup()` can use `BgaCards` / `BgaAnimations` synchronously.
*/
const BgaAnimations = await globalThis.importEsmLib('bga-animations', '1.x');
const BgaCards = await globalThis.importEsmLib('bga-cards', '1.x');

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
        // bga-cards: the fanned hand is a HandStock backed by a CardManager (both loaded at runtime via
        // libs.ts / importEsmLib). Typed loosely — the library ships its own generics we don't re-declare.
        this.animationManager = null;
        this.cardsManager = null;
        this.handStock = null;
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
                <div id="ucs-upper">
                    <div id="ucs-my-area" class="ucs-zone"></div>
                    <div id="ucs-center-stack">
                        <div id="ucs-params-row">
                            <div id="ucs-gameplay" class="ucs-zone"></div>
                            <div id="ucs-secret-santa" class="ucs-zone ucs-secret-santa" style="display:none"></div>
                        </div>
                        <div id="ucs-draft-pool" class="ucs-zone"></div>
                        <div id="ucs-trade-area" class="ucs-zone"></div>
                    </div>
                    <div id="ucs-opponents"></div>
                </div>
                <div id="ucs-placement" class="ucs-zone" style="display:none"></div>
                <div id="ucs-my-hand-wrap" class="ucs-zone">
                    <div class="ucs-zone-label" id="ucs-hand-label">${_('Your hand')}</div>
                    <div id="ucs-my-hand"></div>
                </div>
            </div>
            <div id="ucs-popin" class="ucs-popin" style="display:none">
                <div class="ucs-popin-backdrop"></div>
                <div class="ucs-popin-box">
                    <div class="ucs-popin-head">
                        <span id="ucs-popin-title"></span>
                        <a id="ucs-popin-close" href="#" class="ucs-popin-close">✕</a>
                    </div>
                    <div id="ucs-popin-body" class="ucs-knitting"></div>
                </div>
            </div>
        `);
        // Self-focus layout: my own table (large, primary) lives in #ucs-my-area; every opponent goes
        // into the compact, clickable #ucs-opponents side column. Element ids stay `ucs-*-<playerId>`
        // so the render* methods keep working regardless of which container a table sits in.
        Object.values(gamedatas.players).forEach((player) => {
            const mine = Number(player.id) === this.myId;
            const parent = mine ? 'ucs-my-area' : 'ucs-opponents';
            document.getElementById(parent).insertAdjacentHTML('beforeend', `
                <div class="ucs-player-table ${mine ? 'ucs-me' : 'ucs-oppo'}" id="ucs-player-${player.id}"
                     style="--player-color:#${player.color}" data-player-id="${player.id}">
                    <div class="ucs-player-header">
                        <span class="ucs-order-badge" id="ucs-order-${player.id}"></span>
                        <span class="ucs-player-name">${mine ? _('Your Knitting Area') : player.name}</span>
                    </div>
                    <div class="ucs-knitting" id="ucs-knitting-${player.id}"></div>
                    ${mine ? '' : `<div class="ucs-oppo-summary" id="ucs-summary-${player.id}"></div>`}
                </div>
            `);
        });
        // Clicking an opponent's table enlarges their Knitting Area in the popin.
        document.querySelectorAll('#ucs-opponents .ucs-oppo').forEach((el) => {
            el.addEventListener('click', () => this.openPopin(Number(el.dataset.playerId)));
        });
        document.getElementById('ucs-popin-close').addEventListener('click', (e) => { e.preventDefault(); this.closePopin(); });
        document.querySelector('#ucs-popin .ucs-popin-backdrop').addEventListener('click', () => this.closePopin());
        // Build the CardManager + fanned HandStock for my hand (spectators have no hand).
        if (this.bga.gameui.isSpectator) {
            document.getElementById('ucs-hand-label').textContent = _('Spectating');
        }
        else {
            this.setupHandStock();
        }
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
    /**
     * Create the CardManager + fanned HandStock (bga-cards) that power my hand. The stock renders the
     * cards as an overlapping, fan-shaped arc; each front face reuses the shared `cardFaceInner` so it
     * matches the custom-DOM cards in the other zones. Selection is wired to the existing play flow via
     * `onSelectionChange` (see handSelectionChanged / enablePlayable).
     */
    setupHandStock() {
        this.animationManager = new BgaAnimations.Manager({
            animationsActive: () => this.bga.gameui.bgaAnimationsActive(),
        });
        this.cardsManager = new BgaCards.Manager({
            animationManager: this.animationManager,
            type: 'ucs-sweater',
            // The hand is the primary interaction on a desktop table, so its cards run larger than the
            // 64/90 used elsewhere. The inner face content (sized off --ucs-card-w) is matched to this in
            // SCSS (#ucs-my-hand-wrap), and the mobile breakpoint scales the whole fan back down.
            cardWidth: 96,
            cardHeight: 135,
            getId: (c) => `ucs-hand-${c.id}`,
            isCardVisible: () => true,
            setupFrontDiv: (c, div) => {
                // Note: we deliberately do NOT add the `.ucs-card` sizing class here — the stock's own
                // card-side element handles sizing/positioning; we only paint colour + face.
                const face = faceOf(c, this.material);
                div.classList.add('ucs-card-face', `ucs-color-${face.color}`);
                if (face.patch)
                    div.classList.add('ucs-patch');
                div.innerHTML = cardFaceInner(c, this.material);
                if (!div.id)
                    div.id = `ucs-hand-${c.id}-front`;
                this.bga.gameui.addTooltipHtml?.(div.id, cardTooltip(c, this.material));
            },
        });
        this.handStock = new BgaCards.HandStock(this.cardsManager, document.getElementById('ucs-my-hand'), {
            fanShaped: true,
            // cardOverlap is a PERCENTAGE of card width (not px). Low enough that ~70% of every card
            // shows, so the whole hand (incl. the top-left value/orientation/icon) stays readable.
            cardOverlap: 30,
            emptyHandMessage: _('Hand is empty'),
        });
        this.handStock.setSelectionMode('none');
        this.handStock.onSelectionChange = (selection, last) => this.handSelectionChanged(selection, last);
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
        this.renderSecretSanta();
        this.renderDraftPool();
        this.renderTradeArea();
        this.renderPlayers();
        this.renderHand();
    }
    /** My own Secret Santa objective(s) — 1 in Casual, 2 in Express (private; hidden from other players). */
    renderSecretSanta() {
        const zone = document.getElementById('ucs-secret-santa');
        if (!zone)
            return;
        const cards = Object.values(this.gamedatas.secretSanta ?? {});
        if (!cards.length) {
            zone.style.display = 'none';
            return;
        }
        zone.style.display = '';
        zone.innerHTML = `<div class="ucs-zone-label">${_('Your Secret Santa')}</div>`;
        const row = document.createElement('div');
        row.className = 'ucs-santa-cards';
        cards.forEach((c) => {
            const ss = this.material.secretSantas?.[Number(c.type_arg)];
            // A slot reserves the card's rotated (landscape) footprint so the turned card sits neatly
            // beside the Round Parameters without overlapping its neighbour (Express deals 2).
            const slot = document.createElement('div');
            slot.className = 'ucs-santa-slot';
            const el = document.createElement('div');
            el.className = 'ucs-card ucs-santa-card';
            el.innerHTML = `<div class="ucs-santa-name">${ss?.name ?? _('Secret Santa')}</div>`;
            slot.appendChild(el);
            row.appendChild(slot);
        });
        zone.appendChild(row);
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
        row.appendChild(this.gameplayPileEl('perfectfit', 'Perfect Fit', gp?.perfectfit));
        row.appendChild(this.gameplayPileEl('trendyyarn', 'Trendy Yarn', gp?.trendyyarn));
        // Express shows a DISPLAY of claimable Fads (players+1); Casual shows the single revealed Fad.
        if (this.gamedatas.express) {
            row.appendChild(this.fadDisplayEl(gp?.express));
        }
        else {
            row.appendChild(this.gameplayPileEl('fad', 'Fads', gp?.fad));
        }
        zone.appendChild(row);
    }
    /** Express: the row of claimable Fad cards — unclaimed on display, claimed ones tagged with the owner. */
    fadDisplayEl(express) {
        const wrap = document.createElement('div');
        wrap.className = 'ucs-gp-pile ucs-fad-display';
        wrap.innerHTML = `<div class="ucs-gp-label">${_('Fads (claim to lock a sweater)')}</div>`;
        const cards = document.createElement('div');
        cards.className = 'ucs-fad-cards';
        (express?.fadDisplay ?? []).forEach((c) => cards.appendChild(this.fadCardEl(c, null)));
        (express?.fadClaimed ?? []).forEach((c) => cards.appendChild(this.fadCardEl(c, Number(c.location_arg))));
        wrap.appendChild(cards);
        return wrap;
    }
    /** One Fad card in the Express display; ownerId set → claimed (dimmed + tagged with the owner). */
    fadCardEl(card, ownerId) {
        const el = this.gameplayCardEl('fad', card);
        el.classList.add('ucs-fad-card');
        if (ownerId != null) {
            el.classList.add('ucs-fad-claimed');
            const owner = this.gamedatas.players[ownerId];
            if (owner)
                el.style.setProperty('--player-color', `#${owner.color}`);
            el.insertAdjacentHTML('beforeend', `<div class="ucs-fad-owner">${owner?.name ?? ''}</div>`);
        }
        return el;
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
            // Each Trade Area card is captioned with who played it this trick. (This label is NOT
            // carried into the Draft Pool — after the trick these cards rotate into the pool via
            // renderDraftPool, where ownership no longer matters.)
            const owner = this.gamedatas.players[Number(card.location_arg)];
            const wrap = document.createElement('div');
            wrap.className = 'ucs-trade-card';
            if (owner) {
                wrap.style.setProperty('--player-color', `#${owner.color}`);
                el.classList.add('ucs-owned');
                wrap.insertAdjacentHTML('afterbegin', `<div class="ucs-trade-owner">${owner.name}</div>`);
            }
            wrap.appendChild(el);
            row.appendChild(wrap);
        });
        if (!cards.length) {
            row.innerHTML = `<div class="ucs-empty">No cards played yet</div>`;
        }
        zone.appendChild(row);
    }
    renderPlayers() {
        Object.values(this.gamedatas.players).forEach((player) => {
            this.renderOrderBadge(Number(player.id));
            this.renderKnitting(Number(player.id));
            this.renderOppoSummary(Number(player.id));
        });
    }
    /**
     * The compact abstraction shown for an opponent on small screens (the side column collapses to
     * these chips): completed-sweater pips + a done/in-progress tally. No-op for my own table (no
     * summary element). Tapping the chip opens the full-size popin (wired in setup).
     */
    renderOppoSummary(playerId) {
        const el = document.getElementById(`ucs-summary-${playerId}`);
        if (!el)
            return;
        const cards = this.cardArray(this.gamedatas.knitting).filter((c) => Number(c.location_arg) === playerId);
        const builds = {};
        cards.forEach((c) => { const b = Number(c.buildNo ?? 0); (builds[b] || (builds[b] = [])).push(c); });
        const complete = Object.values(builds).filter((b) => this.isBuildComplete(b)).length;
        const wip = Object.keys(builds).length - complete;
        el.innerHTML = `<span class="ucs-pips">${'🧶'.repeat(complete) || '—'}</span>`
            + `<span class="ucs-oppo-progress">${complete} ${_('done')} · ${wip} ${_('wip')}</span>`;
    }
    /** Open the popin showing one player's Knitting Area at full size (from a click on their table). */
    openPopin(playerId) {
        const popin = document.getElementById('ucs-popin');
        const body = document.getElementById('ucs-popin-body');
        const player = this.gamedatas.players[playerId];
        document.getElementById('ucs-popin-title').textContent =
            player ? `${player.name} — ${_('Knitting Area')}` : _('Knitting Area');
        popin.style.setProperty('--player-color', player ? `#${player.color}` : '#888');
        this.renderKnitting(playerId, body);
        popin.style.display = '';
    }
    closePopin() {
        const popin = document.getElementById('ucs-popin');
        if (popin)
            popin.style.display = 'none';
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
    /** Express: the Fad-claim map (fadCardId -> {playerId, buildNo}), or empty outside Express. */
    expressClaims() {
        return this.gamedatas.gameplay?.express?.fadClaims ?? {};
    }
    /** Express: the type_arg (fad id in Material::fads) of the Fad locking playerId's build, or null. */
    claimedFadForBuild(playerId, buildNo) {
        const claims = this.expressClaims();
        for (const fadId of Object.keys(claims)) {
            const c = claims[Number(fadId)];
            if (Number(c.playerId) === playerId && Number(c.buildNo) === buildNo) {
                const card = (this.gamedatas.gameplay?.express?.fadClaimed ?? [])
                    .find((f) => Number(f.id) === Number(fadId));
                return card ? Number(card.type_arg) : -1;
            }
        }
        return null;
    }
    /** The Fad definition scoring a build: Casual's active round Fad, or Express's claimed Fad (or null). */
    fadForBuild(playerId, buildNo) {
        if (this.gamedatas.express) {
            const t = this.claimedFadForBuild(playerId, buildNo);
            return (t != null && t > 0) ? (this.material.fads[t] ?? null) : null;
        }
        const active = this.gamedatas.gameplay?.fad?.active;
        return active ? (this.material.fads[Number(active.type_arg)] ?? null) : null;
    }
    /** A card's effective value (a placed patch carries its chosen wildValue; else its printed value). */
    effValue(c) {
        if (c.wildValue != null && c.wildValue !== '')
            return Number(c.wildValue);
        return Number(faceOf(c, this.material).value);
    }
    /** A card's effective icon (a placed patch's wildIcon; else its printed icon; may be null pre-art). */
    effIcon(c) {
        if (c.wildIcon != null && c.wildIcon !== '')
            return String(c.wildIcon);
        return faceOf(c, this.material).icon;
    }
    /**
     * Live public VP for one sweater — a DISPLAY helper for the per-sweater badge that MIRRORS the
     * server's Game::publicSweaterScore (the server stays authoritative; keep this in sync with the
     * PHP). Returns 0 for an incomplete sweater, and +2 only for a complete one still holding an
     * unassigned patch (its run / Fad / icon bonuses land at round-end once the patch is assigned).
     */
    buildPublicScore(cards, playerId, buildNo) {
        const VP_SWEATER = 2, VP_RUN = 2, VP_FAD = 3, VP_NONFAD = 1; // == Material::VP_*
        const bySlot = {};
        cards.forEach((c) => {
            const slot = c.slot ?? faceOf(c, this.material).slot ?? null;
            if (slot)
                bySlot[slot] = c;
        });
        if (!bySlot.L || !bySlot.R || !bySlot.B)
            return 0; // not a completed L+R+B sweater
        const trio = [bySlot.L, bySlot.R, bySlot.B];
        // A completed sweater with an unresolved patch scores only the +2 build for now.
        for (const c of trio) {
            if (isPatch(c, this.material)
                && (c.wildValue == null || c.wildValue === '' || c.wildIcon == null || c.wildIcon === '')) {
                return VP_SWEATER;
            }
        }
        const values = trio.map((c) => this.effValue(c)).sort((a, b) => a - b);
        const colors = trio.map((c) => faceOf(c, this.material).color);
        const icons = trio.map((c) => this.effIcon(c));
        let vp = VP_SWEATER;
        if (values[1] === values[0] + 1 && values[2] === values[1] + 1)
            vp += VP_RUN;
        const allSameColor = new Set(colors).size === 1;
        const allSameIcon = !icons.includes(null) && new Set(icons).size === 1;
        const fad = this.fadForBuild(playerId, buildNo);
        if (fad && fad.clash) {
            // "Clash Is In": +3 when all three differ in BOTH colour and icon; any all-same still +1.
            const allDiffColor = new Set(colors).size === 3;
            const allDiffIcon = !icons.includes(null) && new Set(icons).size === 3;
            if (allDiffColor && allDiffIcon)
                vp += VP_FAD;
            if (allSameColor || allSameIcon)
                vp += VP_NONFAD;
        }
        else {
            let fadColor = null, fadIcon = null;
            (fad?.objectives ?? []).forEach((o) => {
                if (o.match === 'color')
                    fadColor = o.value;
                if (o.match === 'icon')
                    fadIcon = o.value;
            });
            if (fadColor !== null && allSameColor && colors[0] === fadColor)
                vp += VP_FAD;
            if (fadIcon !== null && allSameIcon && icons[0] === fadIcon)
                vp += VP_FAD;
            if ((allSameColor && colors[0] !== fadColor) || (allSameIcon && icons[0] !== fadIcon))
                vp += VP_NONFAD;
        }
        return vp;
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
    renderKnitting(playerId, targetEl) {
        const zone = targetEl ?? document.getElementById(`ucs-knitting-${playerId}`);
        if (!zone)
            return;
        zone.innerHTML = '';
        const cards = this.cardArray(this.gamedatas.knitting).filter((c) => Number(c.location_arg) === playerId);
        const sel = this.selectedDraftId != null ? this.gamedatas.draftpool[this.selectedDraftId] : null;
        const mine = playerId === this.myId && this.onDraftComplete != null && sel != null;
        const selPatch = mine ? isPatch(sel, this.material) : false;
        const picked = mine ? this.pendingBuildNo : null; // chosen build (highlighted green)
        // A regular card is placed by clicking its (single) printed slot in my area; a patch is wild and
        // may be clicked into ANY L/R/B of any sweater (covering an occupied slot discards it). Either
        // way the targets stay clickable so the placement can be changed freely until Submit (the picked
        // cell shows green, the rest as options).
        const regularSlot = (mine && !selPatch) ? (faceOf(sel, this.material).slot ?? null) : null;
        // A floating-patch orientation (chosen on the action bar when a 2nd card joins a sweater that
        // holds a floating patch) shows as green, non-clickable, so the player sees where it will land.
        const floatDest = (mine && this.pendingBuildNo != null && this.floatingPatchSlot)
            ? { buildNo: this.pendingBuildNo, slot: this.floatingPatchSlot } : null;
        if (!cards.length && regularSlot == null && !selPatch) {
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
            // Express: a sweater that has claimed a Fad is locked — it can't be altered, and the
            // claimed Fad is shown on it. Locked builds draw no draft targets (guards below).
            const claimedFad = this.claimedFadForBuild(playerId, buildNo);
            const locked = claimedFad != null;
            if (locked)
                build.classList.add('ucs-build-locked');
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
            // onClick omitted → a non-clickable (green, informational) destination.
            const cell = (slot, mode, onClick) => {
                if (slotEls[slot])
                    this.applyTarget(slotEls[slot], mode, onClick);
                else
                    build.appendChild(this.makeTargetGhost(slot, mode, onClick));
            };
            if (regularSlot && !locked) {
                cell(regularSlot, picked === buildNo ? 'selected' : 'option', () => this.placeDraftTarget(buildNo));
            }
            if (selPatch && !locked) {
                // Offer all three orientations; exclude the slot reserved for this sweater's floating
                // patch (the two patches must land in different slots).
                const reserved = (floatDest && floatDest.buildNo === buildNo) ? floatDest.slot : null;
                ['L', 'R', 'B'].forEach((s) => {
                    if (s === reserved)
                        return;
                    const isSel = picked === buildNo && this.patchSlot === s;
                    cell(s, isSel ? 'selected' : 'option', () => this.placePatchTarget(buildNo, s));
                });
            }
            if (floatDest && floatDest.buildNo === buildNo)
                cell(floatDest.slot, 'selected'); // green
            if (locked && claimedFad != null) {
                const fad = this.material.fads[claimedFad];
                const chip = document.createElement('div');
                chip.className = 'ucs-build-fad';
                chip.textContent = fad?.title ?? _('Fad');
                build.appendChild(chip);
            }
            // A live VP counter on each of MY sweaters (public info; shown only in my own area).
            if (playerId === this.myId) {
                const badge = document.createElement('div');
                badge.className = 'ucs-build-score';
                badge.textContent = `${this.buildPublicScore(builds[buildNo], playerId, buildNo)} VP`;
                badge.title = _('Current VP this sweater scores');
                build.appendChild(badge);
            }
            zone.appendChild(build);
        });
        // "New sweater" target: a regular card shows its printed slot; a patch shows a slot-less float ghost.
        if (regularSlot) {
            const newBuild = document.createElement('div');
            newBuild.className = 'ucs-build ucs-build-new';
            newBuild.appendChild(this.makeTargetGhost(regularSlot, picked === 0 ? 'selected' : 'option', () => this.placeDraftTarget(0)));
            zone.appendChild(newBuild);
        }
        else if (selPatch) {
            const newBuild = document.createElement('div');
            newBuild.className = 'ucs-build ucs-build-new';
            newBuild.appendChild(this.makeFloatGhost(picked === 0 ? 'selected' : 'option', () => this.placePatchNew()));
            zone.appendChild(newBuild);
        }
    }
    /** Style an existing piece as a placement target/destination; `onClick` (if given) makes it clickable. */
    applyTarget(el, mode, onClick) {
        el.classList.add('ucs-target', mode === 'selected' ? 'ucs-target-selected' : 'ucs-target-option');
        if (onClick)
            el.addEventListener('click', onClick);
    }
    /** A ghost cell at `slot`; `onClick` (if given) makes it clickable. */
    makeTargetGhost(slot, mode, onClick) {
        const ghost = document.createElement('div');
        ghost.className = `ucs-card ucs-ghost ucs-target ${mode === 'selected' ? 'ucs-target-selected' : 'ucs-target-option'} ucs-slot-${slot}`;
        ghost.style.gridArea = slot;
        ghost.innerHTML = `<div class="ucs-ghost-label">${slot}</div>`;
        if (onClick)
            ghost.addEventListener('click', onClick);
        return ghost;
    }
    /** A slot-less ghost for starting a NEW sweater with a floating patch; `onClick` makes it clickable. */
    makeFloatGhost(mode, onClick) {
        const ghost = document.createElement('div');
        ghost.className = `ucs-card ucs-ghost ucs-floating ucs-target ${mode === 'selected' ? 'ucs-target-selected' : 'ucs-target-option'}`;
        ghost.innerHTML = `<div class="ucs-ghost-label">${_('float')}</div>`;
        if (onClick)
            ghost.addEventListener('click', onClick);
        return ghost;
    }
    /**
     * A knitting target was clicked while drafting a REGULAR card: (re)choose that sweater. The choice
     * is freely changeable — re-render so the picked cell shows green and the action bar offers Submit
     * (or, if the target holds a floating patch, its orientation first). Nothing is sent until Submit.
     */
    placeDraftTarget(buildNo) {
        if (this.pendingBuildNo !== buildNo)
            this.floatingPatchSlot = null; // re-picking clears the float choice
        this.pendingBuildNo = buildNo;
        this.renderPlacementPanel();
    }
    /**
     * A knitting slot was clicked while drafting a PATCH: choose that sweater AND the patch's own
     * orientation in one click (clicking an occupied slot covers it → discards the piece underneath).
     * Freely changeable until Submit.
     */
    placePatchTarget(buildNo, slot) {
        if (this.pendingBuildNo !== buildNo)
            this.floatingPatchSlot = null; // re-picking a build clears the float choice
        this.pendingBuildNo = buildNo;
        this.patchSlot = slot;
        if (this.floatingPatchSlot === slot)
            this.floatingPatchSlot = null; // the two patches can't share a slot
        this.renderPlacementPanel();
    }
    /** The "new sweater (floats)" ghost was clicked while drafting a PATCH: start a new floating sweater. */
    placePatchNew() {
        this.pendingBuildNo = 0;
        this.patchSlot = null;
        this.floatingPatchSlot = null;
        this.renderPlacementPanel();
    }
    isBuildComplete(build) {
        const slots = new Set(build.map((c) => c.slot));
        return slots.has('L') && slots.has('R') && slots.has('B');
    }
    /**
     * Resync the fanned HandStock from gamedatas.hand. The hand is small, so a full clear+add is fine;
     * removeAll/addCards are async but their DOM ops apply in order and we don't need to await here.
     * (Selectable/disabled styling is driven by the stock's selection API — see enablePlayable.)
     */
    renderHand() {
        if (this.bga.gameui.isSpectator || !this.handStock)
            return;
        const hand = this.cardArray(this.gamedatas.hand).sort(this.handSort.bind(this));
        this.handStock.removeAll();
        if (hand.length)
            this.handStock.addCards(hand);
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
        this.hidePanel();
        if (!this.handStock)
            return;
        this.handStock.setSelectionMode('single');
        const selectable = this.cardArray(this.gamedatas.hand).filter((c) => ids.includes(Number(c.id)));
        document.getElementById('ucs-my-hand')?.classList.add('ucs-hand-choosing');
        // setSelectableCards is sync but addCards (from a hand refill on state entry) is async — defer a
        // tick so the cards exist in the stock before we mark them selectable (bga-cards gotcha).
        setTimeout(() => this.handStock?.setSelectableCards(selectable), 0);
    }
    disablePlayable() {
        this.cancelConfirm();
        this.playableIds = [];
        this.onPlay = null;
        this.selectedPlayId = null;
        this.hidePanel();
        if (this.handStock) {
            this.handStock.setSelectionMode('none');
            this.handStock.unselectAll(true);
        }
        document.getElementById('ucs-my-hand')?.classList.remove('ucs-hand-choosing');
    }
    /** A hand card was selected in the stock — route to the existing play logic (ignore deselections). */
    handSelectionChanged(selection, last) {
        if (!this.onPlay || !last)
            return;
        if (!selection.some((c) => String(c.id) === String(last.id)))
            return;
        this.selectPlay(Number(last.id));
    }
    /** A hand card was clicked. A leading Patch needs a pool card to copy first; everything else plays now. */
    selectPlay(cardId) {
        if (!this.onPlay)
            return;
        const card = this.gamedatas.hand[cardId];
        const leading = this.cardArray(this.gamedatas.trick).length === 0;
        if (card && isPatch(card, this.material) && leading) {
            this.selectedPlayId = cardId;
            this.renderPatchCopyPanel(cardId);
        }
        else {
            this.completePlay(cardId, 0);
        }
    }
    /** A card (and, for a leading patch, its copy source) has been chosen — gate it behind Confirm/Reset. */
    completePlay(cardId, copyFromCardId) {
        this.selectedPlayId = cardId; // the stock keeps the pending card highlighted while confirming
        this.confirmAction(() => {
            const cb = this.onPlay;
            this.selectedPlayId = null;
            this.hidePanel();
            cb && cb(cardId, copyFromCardId);
        }, () => {
            // Reset: clear the stock selection, back to choosing a card from hand.
            this.selectedPlayId = null;
            this.hidePanel();
            this.handStock?.unselectAll(true);
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
            this.handStock?.unselectAll(true);
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
        // ---- Patch: placement is by clicking a slot in my Knitting Area (renderKnitting draws the
        // targets — any L/R/B in any sweater, incl. covering; a slot-less "float" ghost starts a new
        // sweater). The action bar only guides, orients an existing floating patch, and submits. ----
        const { builds, floating, buildNos } = this.myBuilds();
        // Auto-pick a new floating sweater when there's nothing to click into.
        if (this.pendingBuildNo == null && buildNos.length === 0)
            this.pendingBuildNo = 0;
        const buildNo = this.pendingBuildNo;
        const isNewBuild = buildNo === 0 || (buildNo != null && !(buildNo in builds));
        const occupied = (buildNo != null && !isNewBuild) ? builds[buildNo] : new Set();
        const floatId = (buildNo != null && !isNewBuild) ? floating[buildNo] : undefined;
        // The patch's own slot: chosen on an existing sweater, null (floating) when starting a new one.
        const cardSlot = isNewBuild ? null : this.patchSlot;
        const changeCancel = () => {
            if (buildNos.length > 0 && this.pendingBuildNo != null) {
                sb.addActionButton(_('Change'), () => {
                    this.pendingBuildNo = null;
                    this.patchSlot = null;
                    this.floatingPatchSlot = null;
                    this.renderPlacementPanel();
                }, { color: 'secondary' });
            }
            cancelBtn();
        };
        // Nothing chosen yet, or an existing sweater chosen but no slot clicked → wait for a board click.
        if (buildNo == null || (!isNewBuild && this.patchSlot == null)) {
            sb.setTitle(_('Click a slot in your sweaters to place your patch — or:'));
            sb.addActionButton(_('+ New sweater (floats)'), () => this.placePatchNew(), { color: 'primary' });
            changeCancel();
            return;
        }
        // The chosen sweater still holds a floating patch → orient it (needs a 2nd, distinct open slot).
        if (floatId !== undefined && this.floatingPatchSlot == null) {
            const openForFloat = ['L', 'R', 'B'].filter((s) => !occupied.has(s) && s !== cardSlot);
            sb.setTitle(_('Orient the floating patch already in this sweater'));
            openForFloat.forEach((s) => sb.addActionButton(`${_('Patch')} ${s}`, () => {
                this.floatingPatchSlot = s;
                this.renderPlacementPanel();
            }, { color: 'secondary' }));
            changeCancel();
            return;
        }
        // Ready: act immediately if the preference is "Off", else show Submit (the board stays editable).
        if (this.confirmMode() === 0) {
            this.submitDraft(buildNo);
            return;
        }
        sb.setTitle(_('Click a different slot to change, or submit'));
        sb.addActionButton(_('Submit'), () => this.submitDraft(buildNo), { color: 'primary' });
        changeCancel();
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
        // Only my own hand changes visually; slide the played card out of the fan (other players' plays
        // don't touch my stock). disablePlayable on state-leave clears any lingering selection.
        if (Number(args.player_id) === this.myId && this.handStock) {
            this.handStock.removeCard(args.card).catch(() => { });
        }
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
    }
    /** A new round revealed fresh gameplay cards — refresh the round-parameter decks. */
    async notif_gameplayRevealed(args) {
        this.gamedatas.gameplay = args.gameplay;
        this.renderGameplay();
    }
    /**
     * Express: a player claimed a Fad. The Fad moves from the display onto their (now locked) sweater;
     * re-render the Fad display and that player's knitting. Their score updates via the framework's
     * score counter (server playerScore->inc), so no manual score bump is needed here.
     */
    async notif_fadClaimed(args) {
        this.gamedatas.gameplay = args.gameplay;
        this.renderGameplay();
        this.renderKnitting(args.player_id);
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
