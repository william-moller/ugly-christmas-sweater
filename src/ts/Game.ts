import { PlayCard } from "./States/PlayCard";
import { DraftCard } from "./States/DraftCard";
import { RoundReview } from "./States/RoundReview";
import { AssignPatches } from "./States/AssignPatches";
import { createCardElement, createCardBack, cardTooltip, cardLogChip, faceOf, isPatch } from "./CardView";

type CardMapT = { [cardId: number]: SweaterCard };

export class Game {
    public bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>;
    private gamedatas: UglyChristmasSweaterGamedatas;

    // Selection state for the active player (set by the PlayCard / DraftCard state handlers).
    private playableIds: number[] = [];
    private onPlay: ((cardId: number, copyFromCardId: number) => void) | null = null;
    private selectedPlayId: number | null = null;

    // Drafting / placement selection state.
    private draftableIds: number[] = [];
    private onDraftComplete: ((cardId: number, placement: DraftPlacement) => void) | null = null;
    private selectedDraftId: number | null = null;
    // The build chosen to place into (0 = new sweater), plus the orientation choices a patch placement
    // may still need: the drafted patch's own slot (only when added to an existing sweater) and the
    // orientation to give a floating patch already sitting in the target sweater. null = not yet chosen.
    private pendingBuildNo: number | null = null;
    private patchSlot: string | null = null;
    private floatingPatchSlot: string | null = null;

    // Round-end patch assignment (AssignPatches state): a queue of my patch card ids still to assign,
    // and the value/icon being chosen for the head of the queue.
    private onAssignPatch: ((cardId: number, value: number, icon: string) => void) | null = null;
    private assignQueue: number[] = [];
    private assignValue: number | null = null;
    private assignIcon: string | null = null;

    // Confirm/Reset gate: a pending play/draft waits for the player to confirm (or auto-confirms via
    // the action button's countdown). The abort controller cancels that countdown on Reset / leave.
    private confirmAbort: AbortController | null = null;
    private confirming = false; // true while a play/draft is awaiting Confirm (hides draft targets)

    // Current draft order (player ids, best-first) for the order badges.
    private draftOrder: number[] = [];

    // Monotonic counter for assigning ids to gameplay-card elements (so tooltips can attach).
    private gpSeq = 0;

    constructor(bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>) {
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
    setup(gamedatas: UglyChristmasSweaterGamedatas) {
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
        this.maybeAddDebugButton();
        console.log("Ending game setup");
    }

    /**
     * Studio-only inspector button. Pure client side — dumps current state to the console (handy for
     * eyeballing the render/scoring batch) and reminds which server-side debug_* helpers exist. Those
     * helpers (debug_forceRoundOver / debug_addScore / debug_goToState) are invoked from the Studio
     * debug console, not from here. (Pattern borrowed from the "collect" reference game.)
     */
    private maybeAddDebugButton() {
        if (!this.gamedatas.isStudio) return;
        const area = this.bga.gameArea.getElement();
        area.insertAdjacentHTML('beforeend',
            `<a id="ucs-debug" class="bgabutton bgabutton_blue" href="#" style="margin:8px">DEBUG: dump state</a>`);
        document.getElementById('ucs-debug')!.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('[UCS DEBUG] gamedatas', this.gamedatas);
            console.log('[UCS DEBUG] my knitting builds', this.myBuilds());
            console.log('[UCS DEBUG] scores', Object.values(this.gamedatas.players)
                .map((p) => ({ name: p.name, score: (p as any).score })));
            console.log('[UCS DEBUG] Studio server helpers: debug_forceRoundOver(), '
                + 'debug_addScore(playerId, delta), debug_goToState(id)');
        });
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

    /**
     * The three round-parameter decks (Perfect Fit / Trendy Yarn / Fad), shown off to the side and
     * public to all players. Each shows its face-down draw pile (with the count remaining) and the
     * current face-up revealed card; previous reveals stay stacked beneath. Placeholder faces until art.
     */
    private renderGameplay() {
        const zone = document.getElementById('ucs-gameplay')!;
        zone.innerHTML = `<div class="ucs-zone-label">Round Parameters</div>`;
        const row = document.createElement('div');
        row.className = 'ucs-gameplay-row';
        const gp = this.gamedatas.gameplay;
        ([
            ['perfectfit', 'Perfect Fit'],
            ['trendyyarn', 'Trendy Yarn'],
            ['fad', 'Fads'],
        ] as const).forEach(([type, label]) => {
            row.appendChild(this.gameplayPileEl(type, label, gp?.[type]));
        });
        zone.appendChild(row);
    }

    /** One gameplay deck: label, the current face-up card, and the face-down draw pile + count. */
    private gameplayPileEl(type: string, label: string, pile: GameplayPile | undefined): HTMLElement {
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
        if (pile && (pile.seenCount ?? 0) > 1) active.classList.add('ucs-gp-stacked');
        active.appendChild(this.gameplayCardEl(type, pile?.active ?? null));
        cards.appendChild(active);

        wrap.appendChild(cards);
        return wrap;
    }

    /** Placeholder face for a revealed gameplay card (colour swatch / value / fad title). */
    private gameplayCardEl(type: string, card: GameplayCard | null): HTMLElement {
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
            (this.bga.gameui as any).addTooltipHtml?.(this.gpId(el), `<strong>Perfect Fit ${arg}</strong><br>Cards of value ${arg} are the super-trump this round.`);
        } else if (type === 'trendyyarn') {
            const color = this.material.colors[arg] ?? String(arg);
            el.classList.add(`ucs-color-${color}`);
            el.innerHTML = `<div class="ucs-card-pattern"></div><div class="ucs-gp-kind">Trendy Yarn</div>`
                + `<div class="ucs-gp-big">${color.charAt(0).toUpperCase()}</div>`;
            (this.bga.gameui as any).addTooltipHtml?.(this.gpId(el), `<strong>Trendy Yarn: ${color}</strong><br>${color.charAt(0).toUpperCase() + color.slice(1)} is the trump colour this round.`);
        } else {
            const fad = this.material.fads[arg];
            const title = fad?.title ?? `Fad ${arg}`;
            el.classList.add('ucs-gp-fad');
            el.innerHTML = `<div class="ucs-gp-kind">Fad</div><div class="ucs-gp-fad-title">${title}</div>`;
            (this.bga.gameui as any).addTooltipHtml?.(this.gpId(el), `<strong>${title}</strong><br>Round scoring bonus (applies to all players).`);
        }
        return el;
    }

    /** Ensure an element has an id (so a tooltip can attach), and return it. */
    private gpId(el: HTMLElement): string {
        if (!el.id) el.id = `ucs-gp-${++this.gpSeq}`;
        return el.id;
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
                if (Number(card.id) === this.selectedDraftId) {
                    el.classList.add('ucs-chosen');
                }
                el.addEventListener('click', () => this.selectDraft(Number(card.id)));
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

    /**
     * Render a player's knitting area: builds laid out in the sweater silhouette (L top-left, R
     * top-right, B centred below). A floating Patch (orientation not yet chosen) renders centred with a
     * "floating" treatment; during round-end assignment the patch being assigned is highlighted.
     *
     * Hybrid placement: while *I* am drafting a REGULAR card and still choosing a sweater, the area
     * doubles as a click-to-place picker — the card's printed slot shows as a target in each build (and
     * a "new sweater" ghost). Patches are placed from the action bar instead, so they draw no targets.
     */
    private renderKnitting(playerId: number) {
        const zone = document.getElementById(`ucs-knitting-${playerId}`);
        if (!zone) return;
        zone.innerHTML = '';

        const cards = this.cardArray(this.gamedatas.knitting).filter(
            (c) => Number(c.location_arg) === playerId
        );

        const sel = this.selectedDraftId != null ? this.gamedatas.draftpool[this.selectedDraftId] : null;
        const mine = playerId === this.myId && this.onDraftComplete != null && sel != null;
        const selPatch = mine ? isPatch(sel!, this.material) : false;

        // Clickable place-into targets: a regular card, while still CHOOSING the sweater (not confirming).
        const choosing = mine && !selPatch && this.pendingBuildNo == null && !this.confirming;
        const printedSlot = choosing ? (faceOf(sel!, this.material).slot ?? null) : null;

        // Once a build is chosen (the Confirm gate, or the floating-orientation step), show where the
        // card will land as a persistent GREEN "selected" highlight that stays put until placed/reset.
        const selecting = mine && this.pendingBuildNo != null;
        const selBuild = selecting ? this.pendingBuildNo! : null;
        const selCardSlot = selecting ? (selPatch ? this.patchSlot : (faceOf(sel!, this.material).slot ?? null)) : null;
        const selFloatSlot = selecting ? this.floatingPatchSlot : null;

        const showingTargets = (choosing && printedSlot) || selecting;
        if (!cards.length && !showingTargets) {
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
                if (this.isBuildComplete(builds[buildNo])) build.classList.add('ucs-build-complete');
                const occupied = new Set<string>();
                const slotEls: { [slot: string]: HTMLElement } = {};
                builds[buildNo].forEach((card) => {
                    const el = createCardElement(card, this.material);
                    const slot = (card.slot as string) ?? faceOf(card, this.material).slot ?? null;
                    if (slot) {
                        el.style.gridArea = slot;
                        el.classList.add(`ucs-slot-${slot}`); // lets CSS rotate the B (hem) piece
                        occupied.add(slot);
                        slotEls[slot] = el;
                    } else {
                        el.classList.add('ucs-floating'); // a floating patch — orientation not set yet
                    }
                    if (Number(card.id) === this.assignQueue[0]) {
                        el.classList.add('ucs-assigning'); // the patch being assigned right now
                    }
                    // Place-over target: the printed slot is already filled → clicking replaces it.
                    if (printedSlot && slot === printedSlot) {
                        this.markDraftTarget(el, buildNo);
                    }
                    this.attachTooltip(el, card);
                    build.appendChild(el);
                });
                // Empty printed-slot → an "add here" ghost target (choosing phase).
                if (printedSlot && !occupied.has(printedSlot)) {
                    build.appendChild(this.makeDraftGhost(printedSlot, buildNo));
                }
                // Chosen build → highlight the destination cell(s) green (the card, and a floating patch).
                if (selBuild === buildNo) {
                    const markSel = (slot: string) => {
                        if (slotEls[slot]) {
                            slotEls[slot].classList.add('ucs-target', 'ucs-target-selected');
                        } else {
                            build.appendChild(this.makeSelectedGhost(slot));
                        }
                    };
                    if (selCardSlot) markSel(selCardSlot);
                    if (selFloatSlot) markSel(selFloatSlot);
                }
                zone.appendChild(build);
            });

        // "New sweater" cell: a clickable ghost while choosing, or a green selected ghost once chosen.
        if (printedSlot) {
            const newBuild = document.createElement('div');
            newBuild.className = 'ucs-build ucs-build-new';
            newBuild.appendChild(this.makeDraftGhost(printedSlot, 0));
            zone.appendChild(newBuild);
        } else if (selBuild === 0 && selCardSlot) {
            const newBuild = document.createElement('div');
            newBuild.className = 'ucs-build ucs-build-new';
            newBuild.appendChild(this.makeSelectedGhost(selCardSlot));
            zone.appendChild(newBuild);
        }
    }

    /** Mark an existing knitting piece as a click-to-place-over target for the regular card being drafted. */
    private markDraftTarget(el: HTMLElement, buildNo: number) {
        el.classList.add('ucs-target', 'ucs-target-option');
        el.addEventListener('click', () => this.placeDraftTarget(buildNo));
    }

    /** A ghost cell at `slot` targeting `buildNo` (0 = new sweater) for the regular card being drafted. */
    private makeDraftGhost(slot: string, buildNo: number): HTMLElement {
        const ghost = document.createElement('div');
        ghost.className = `ucs-card ucs-ghost ucs-target ucs-target-option ucs-slot-${slot}`;
        ghost.style.gridArea = slot;
        ghost.innerHTML = `<div class="ucs-ghost-label">${slot}</div>`;
        ghost.addEventListener('click', () => this.placeDraftTarget(buildNo));
        return ghost;
    }

    /** A non-clickable green "this is where it's going" ghost cell shown while confirming a placement. */
    private makeSelectedGhost(slot: string): HTMLElement {
        const ghost = document.createElement('div');
        ghost.className = `ucs-card ucs-ghost ucs-target ucs-target-selected ucs-slot-${slot}`;
        ghost.style.gridArea = slot;
        ghost.innerHTML = `<div class="ucs-ghost-label">${slot}</div>`;
        return ghost;
    }

    /**
     * A knitting target was clicked while drafting a regular card: choose that sweater. If it already
     * holds a floating patch, the action bar then asks for that patch's orientation; otherwise place now.
     */
    private placeDraftTarget(buildNo: number) {
        this.pendingBuildNo = buildNo;
        const { builds, floating } = this.myBuilds();
        const isNew = buildNo === 0 || !(buildNo in builds);
        const floatId = isNew ? undefined : floating[buildNo];
        if (floatId !== undefined) {
            this.renderPlacementPanel(); // need to orient the floating patch (action bar)
        } else {
            this.completeDraft(buildNo);
        }
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
                if (Number(card.id) === this.selectedPlayId) {
                    el.classList.add('ucs-chosen');
                }
                el.addEventListener('click', () => this.selectPlay(Number(card.id)));
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

    public enablePlayable(ids: number[], onPlay: (cardId: number, copyFromCardId: number) => void) {
        this.playableIds = ids;
        this.onPlay = onPlay;
        this.selectedPlayId = null;
        this.renderHand();
        this.hidePanel();
    }

    public disablePlayable() {
        this.cancelConfirm();
        this.playableIds = [];
        this.onPlay = null;
        this.selectedPlayId = null;
        this.renderHand();
        this.hidePanel();
    }

    /** A hand card was clicked. A leading Patch needs a pool card to copy first; everything else plays now. */
    private selectPlay(cardId: number) {
        if (!this.onPlay) return;
        const card = this.gamedatas.hand[cardId];
        const leading = this.cardArray(this.gamedatas.trick).length === 0;
        if (card && isPatch(card, this.material) && leading) {
            this.selectedPlayId = cardId;
            this.renderHand();
            this.renderPatchCopyPanel(cardId);
        } else {
            this.completePlay(cardId, 0);
        }
    }

    /** A card (and, for a leading patch, its copy source) has been chosen — gate it behind Confirm/Reset. */
    private completePlay(cardId: number, copyFromCardId: number) {
        this.selectedPlayId = cardId; // keep the pending card highlighted while confirming
        this.renderHand();
        this.confirmAction(
            () => {
                const cb = this.onPlay;
                this.selectedPlayId = null;
                this.hidePanel();
                this.renderHand();
                cb && cb(cardId, copyFromCardId);
            },
            () => {
                // Reset: back to choosing a card from hand.
                this.selectedPlayId = null;
                this.hidePanel();
                this.renderHand();
                this.bga.statusBar.setTitle(_('${you} must play a card'));
            },
        );
    }

    /** Confirm-gate behaviour, from the "Confirm before acting" game preference (gamepreferences 100). */
    private confirmMode(): 0 | 1 | 2 {
        try {
            const raw = Number(this.bga.userPreferences?.get?.(100));
            return (raw === 0 || raw === 2) ? raw : 1; // default: auto-confirm
        } catch (e) {
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
    private confirmAction(submit: () => void, reset: () => void) {
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
            sb.addActionButton(_('Confirm'), () => { this.confirmAbort = null; this.confirming = false; submit(); },
                { color: 'primary', autoclick });
            sb.addActionButton(_('Reset turn'), () => { this.cancelConfirm(); reset(); }, { color: 'secondary' });
        } catch (e) {
            // The gate failed to render (a status-bar / preference quirk on this table). Never strand a
            // play/draft behind a broken gate: log the cause and just perform the action immediately.
            console.error('UCS: confirm gate failed to render; acting immediately', e);
            this.cancelConfirm();
            this.confirming = false;
            submit();
        }
    }

    /** Cancel any pending Confirm countdown (so it can't auto-fire after a Reset or state change). */
    private cancelConfirm() {
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
    private renderPatchCopyPanel(cardId: number) {
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
    private hidePanel() {
        this.bga.statusBar.removeActionButtons();
        const panel = document.getElementById('ucs-placement');
        if (panel) {
            panel.style.display = 'none';
            panel.innerHTML = '';
        }
    }

    /** Enter the draft phase for the active player: pool cards become selectable. */
    public beginDraft(ids: number[], onComplete: (cardId: number, placement: DraftPlacement) => void) {
        this.draftableIds = ids;
        this.onDraftComplete = onComplete;
        this.clearDraftSelection();
        this.renderDraftPool();
        this.renderPlacementPanel();
    }

    public endDraft() {
        this.cancelConfirm();
        this.draftableIds = [];
        this.onDraftComplete = null;
        this.clearDraftSelection();
        this.renderDraftPool();
        this.renderPlacementPanel();
    }

    private clearDraftSelection() {
        this.selectedDraftId = null;
        this.pendingBuildNo = null;
        this.patchSlot = null;
        this.floatingPatchSlot = null;
    }

    /** A pool card was clicked: select it and open the placement panel. */
    private selectDraft(cardId: number) {
        this.clearDraftSelection();
        this.selectedDraftId = cardId;
        this.renderDraftPool();
        this.renderPlacementPanel();
    }

    /** My knitting grouped into builds: oriented slots per build, plus any floating-patch card id per build. */
    private myBuilds(): { builds: { [no: number]: Set<string> }; floating: { [no: number]: number }; buildNos: number[] } {
        const builds: { [no: number]: Set<string> } = {};
        const floating: { [no: number]: number } = {};
        this.cardArray(this.gamedatas.knitting)
            .filter((c) => Number(c.location_arg) === this.myId)
            .forEach((c) => {
                const b = Number(c.buildNo ?? 0);
                (builds[b] ||= new Set<string>());
                const slot = c.slot ? String(c.slot) : null;
                if (slot) builds[b].add(slot);
                else floating[b] = Number(c.id); // a floating patch (orientation not yet assigned)
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
    private renderPlacementPanel() {
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
            this.clearDraftSelection(); this.renderDraftPool(); this.renderPlacementPanel();
        }, { color: 'alert' });

        // ---- Regular card: placement is driven by the in-area click targets (renderKnitting). ----
        if (!patch) {
            const { builds, floating, buildNos } = this.myBuilds();
            // Choosing the sweater: the targets in my area handle it; the action bar offers New + Cancel.
            if (this.pendingBuildNo == null) {
                if (buildNos.length === 0) { this.completeDraft(0); return; } // only option: new sweater
                sb.setTitle(_('Click a slot in your sweaters to place — or:'));
                sb.addActionButton(_('+ New sweater'), () => this.placeDraftTarget(0), { color: 'primary' });
                cancelBtn();
                return;
            }
            // A sweater was picked but it holds a floating patch → orient that patch first.
            const buildNo = this.pendingBuildNo;
            const floatId = (buildNo in builds) ? floating[buildNo] : undefined;
            if (floatId !== undefined && this.floatingPatchSlot == null) {
                const cardSlot = faceOf(card, this.material).slot ?? null;
                const openForFloat = ['L', 'R', 'B'].filter((s) => !builds[buildNo].has(s) && s !== cardSlot);
                sb.setTitle(_('Orient the floating patch already in this sweater'));
                openForFloat.forEach((s) => sb.addActionButton(`${_('Patch')} ${s}`, () => {
                    this.floatingPatchSlot = s; this.renderPlacementPanel();
                }, { color: this.floatingPatchSlot === s ? 'primary' : 'secondary' }));
                sb.addActionButton(_('Change sweater'), () => {
                    this.pendingBuildNo = null; this.floatingPatchSlot = null; this.renderPlacementPanel();
                }, { color: 'secondary' });
                cancelBtn();
                return;
            }
            this.completeDraft(buildNo);
            return;
        }

        // ---- Patch: placement is action-bar driven (new sweater floats; no value/icon here). ----
        const { builds, floating, buildNos } = this.myBuilds();

        // Step 1 — choose the target sweater (auto when a new sweater is the only option).
        if (this.pendingBuildNo == null) {
            if (buildNos.length === 0) {
                this.pendingBuildNo = 0; // only option: start a new (floating) sweater
            } else {
                sb.setTitle(_('Place your patch — choose a sweater'));
                buildNos.forEach((no) => sb.addActionButton(`${_('Sweater')} ${no}`, () => {
                    this.pendingBuildNo = no; this.patchSlot = null; this.floatingPatchSlot = null;
                    this.renderPlacementPanel();
                }, { color: 'primary' }));
                sb.addActionButton(_('+ New sweater (floats)'), () => {
                    this.pendingBuildNo = 0; this.patchSlot = null; this.floatingPatchSlot = null;
                    this.renderPlacementPanel();
                }, { color: 'primary' });
                cancelBtn();
                return;
            }
        }

        // Step 2 — orientation choices for the chosen sweater.
        const buildNo = this.pendingBuildNo!;
        const isNewBuild = buildNo === 0 || !(buildNo in builds);
        const occupied = isNewBuild ? new Set<string>() : builds[buildNo];
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
                    if (this.floatingPatchSlot === s) this.floatingPatchSlot = null;
                    this.renderPlacementPanel();
                }, { color: this.patchSlot === s ? 'primary' : 'secondary' });
            });
        }
        if (floatId !== undefined) {
            const openForFloat = ['L', 'R', 'B'].filter((s) => !occupied.has(s) && s !== cardSlot);
            sb.setTitle(_('Orient the floating patch already in this sweater'));
            openForFloat.forEach((s) => sb.addActionButton(`${_('Patch')} ${s}`, () => {
                this.floatingPatchSlot = s; this.renderPlacementPanel();
            }, { color: this.floatingPatchSlot === s ? 'primary' : 'secondary' }));
        }

        const cardSlotReady = isNewBuild || this.patchSlot != null;
        const floatReady = floatId === undefined || this.floatingPatchSlot != null;
        if (cardSlotReady && floatReady) {
            this.completeDraft(buildNo);
            return;
        }
        if (buildNos.length > 0) {
            sb.addActionButton(_('Change sweater'), () => {
                this.pendingBuildNo = null; this.patchSlot = null; this.floatingPatchSlot = null;
                this.renderPlacementPanel();
            }, { color: 'secondary' });
        }
        cancelBtn();
    }

    /** Submit the draft with the chosen placement (gated behind Confirm/Reset), then clear the UI. */
    private completeDraft(buildNo: number) {
        if (this.selectedDraftId == null || !this.onDraftComplete) return;
        const card = this.gamedatas.draftpool[this.selectedDraftId];
        const patch = card ? isPatch(card, this.material) : false;

        const placement: DraftPlacement = {
            build_no: buildNo,
            // slot only matters for a patch added to an existing sweater (regular = printed, patch-new = float).
            slot: (patch && this.patchSlot) ? this.patchSlot : '',
            floating_patch_slot: this.floatingPatchSlot ?? '',
        };
        const id = this.selectedDraftId;
        const cb = this.onDraftComplete;
        this.confirmAction(
            () => {
                this.clearDraftSelection();
                this.renderDraftPool();
                this.bga.statusBar.removeActionButtons();
                cb(id, placement);
            },
            () => {
                this.clearDraftSelection();
                this.renderDraftPool();
                this.renderPlacementPanel();
            },
        );
    }

    // ===================================================================================
    //  Round-end patch assignment — called by the AssignPatches state handler
    // ===================================================================================

    /** Begin assigning value+icon to my patches that sit in completed sweaters (round-end). */
    public beginAssignPatches(cardIds: number[], onAssign: (cardId: number, value: number, icon: string) => void) {
        this.onAssignPatch = onAssign;
        this.assignQueue = [...cardIds];
        this.assignValue = null;
        this.assignIcon = null;
        this.renderAssignPanel();
    }

    public endAssignPatches() {
        this.onAssignPatch = null;
        this.assignQueue = [];
        this.assignValue = null;
        this.assignIcon = null;
        this.bga.statusBar.removeActionButtons();
        this.renderKnitting(this.myId);
    }

    /** Value/icon pickers for the patch at the head of my assignment queue (highlighted in my area). */
    private renderAssignPanel() {
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
            sb.addActionButton(String(v), () => { this.assignValue = v; this.renderAssignPanel(); },
                { color: this.assignValue === v ? 'primary' : 'secondary' });
        }
        this.material.icons.forEach((ic) => {
            sb.addActionButton(ic, () => { this.assignIcon = ic; this.renderAssignPanel(); },
                { color: this.assignIcon === ic ? 'primary' : 'secondary' });
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
    public showRoundReview(args: RoundReviewArgs, isCurrentPlayerActive: boolean, onContinue: () => void) {
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
    public endRoundReview() {
        this.bga.statusBar.removeActionButtons();
        document.getElementById('ucs-round-result')?.remove();
    }

    /** Render (or replace) the between-round results panel from a round summary. */
    private renderRoundResult(args: RoundReviewArgs) {
        document.getElementById('ucs-round-result')?.remove();
        const rows = (args.breakdown || []).map((b) =>
            `<tr><td class="ucs-rr-name">${b.player_name}</td>`
            + `<td>${b.sweaters}</td><td>${b.runs}</td><td class="ucs-rr-score">${b.score}</td></tr>`
        ).join('');
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
    public bgaFormatText(log: string, args: any): { log: string; args: any } {
        try {
            if (log && args && !args.processed) {
                args.processed = true;
                if (args.card_label && args.card) {
                    args.card_label = cardLogChip(args.card, this.material);
                }
            }
        } catch (e) {
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

    /** A card was drafted from the pool into a player's knitting area (possibly placed over a piece). */
    async notif_cardDrafted(args: NotifCardDrafted) {
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
    async notif_patchAssigned(args: NotifPatchAssigned) {
        const id = Number(args.card_id);
        this.gamedatas.knitting[id] = args.card;
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

    /** A new round revealed fresh gameplay cards — refresh the round-parameter decks. */
    async notif_gameplayRevealed(args: NotifGameplayRevealed) {
        this.gamedatas.gameplay = args.gameplay;
        this.renderGameplay();
    }

    /**
     * A round was scored. The clienttranslate message auto-logs; the review panel itself is rendered
     * from the RoundReview state args (refresh-safe), but render it here too so the summary appears the
     * instant scoring resolves (also covers the final round, which has no RoundReview state).
     */
    async notif_roundScored(args: NotifRoundScored) {
        this.renderRoundResult(args);
    }
}
