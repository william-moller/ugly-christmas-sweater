import { PlayCard } from "./States/PlayCard";
import { DraftCard } from "./States/DraftCard";
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
    private patchValue: number | null = null;
    private patchIcon: string | null = null;
    private patchSlot: string | null = null;
    // The exact knitting cell (build no; 0 = new sweater) the player clicked to place into. Held —
    // shown highlighted in green — while a Patch still needs its value/icon before it can be placed.
    private pendingBuildNo: number | null = null;

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

        // The current revealed card (with a "stacked" look when earlier reveals sit beneath it).
        const active = document.createElement('div');
        active.className = 'ucs-gp-active';
        if (pile && (pile.seenCount ?? 0) > 1) active.classList.add('ucs-gp-stacked');
        active.appendChild(this.gameplayCardEl(type, pile?.active ?? null));
        cards.appendChild(active);

        // The face-down draw pile + how many cards remain.
        const deck = document.createElement('div');
        deck.className = 'ucs-gp-deck';
        const remaining = pile?.deckCount ?? 0;
        deck.innerHTML = `<div class="ucs-card ucs-card-back ucs-gp-back ${remaining ? '' : 'ucs-gp-empty'}"></div>`
            + `<div class="ucs-gp-count">${remaining} left</div>`;
        cards.appendChild(deck);

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

    /** Group a player's knitting cards by build number and lay them out as L/R/B slots. */
    private renderKnitting(playerId: number) {
        const zone = document.getElementById(`ucs-knitting-${playerId}`);
        if (!zone) return;
        zone.innerHTML = '';

        const cards = this.cardArray(this.gamedatas.knitting).filter(
            (c) => Number(c.location_arg) === playerId
        );

        // While this player is mid-draft (their own area), the knitting area doubles as a placement
        // picker. Candidate slots show as dashed-yellow OPTIONS (a normal card offers its printed slot;
        // a Patch offers all three — clicking one sets its orientation). Clicking a position picks that
        // exact cell: it turns solid GREEN while the other options stay clickable but dim to faint
        // yellow, so the choice is clear yet still changeable. (Once value+icon are known for a Patch
        // the held pick advances to Confirm.)
        const drafting = playerId === this.myId && !this.confirming
            && this.selectedDraftId != null && this.onDraftComplete != null;
        const optionSlots = drafting ? this.draftTargetSlots(playerId) : [];
        const pickedBuild = this.pendingBuildNo;          // the exact cell chosen (held, awaiting value/icon)
        const pickedSlot = drafting ? this.selectedSlot() : null;
        const hasPick = drafting && pickedBuild != null;
        const targetMode = (buildNo: number, slot: string): 'option' | 'faint' | 'selected' =>
            (hasPick && buildNo === pickedBuild && slot === pickedSlot) ? 'selected' : hasPick ? 'faint' : 'option';

        if (!cards.length && !drafting) {
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
                builds[buildNo].forEach((card) => {
                    const el = createCardElement(card, this.material);
                    // Position each piece into the sweater silhouette: L top-left, R top-right,
                    // B centred below (grid areas defined in .ucs-build).
                    const slot = (card.slot as string) ?? faceOf(card, this.material).slot ?? null;
                    if (slot) {
                        el.style.gridArea = slot;
                        el.classList.add(`ucs-slot-${slot}`); // lets CSS rotate the B (hem) piece
                        occupied.add(slot);
                    }
                    // A "place over" target on an occupied slot (green if picked, else option/faint).
                    if (slot && optionSlots.includes(slot)) {
                        this.markTarget(el, buildNo, slot, targetMode(buildNo, slot));
                    }
                    this.attachTooltip(el, card);
                    build.appendChild(el);
                });
                // An empty target slot is an "add here" target (green if picked, else option/faint).
                optionSlots.forEach((ts) => {
                    if (!occupied.has(ts)) build.appendChild(this.makeGhostTarget(ts, buildNo, targetMode(buildNo, ts)));
                });
                zone.appendChild(build);
            });

        // The "new sweater" target — the chosen slot position(s), same option/faint/selected styling.
        if (optionSlots.length) {
            const newBuild = document.createElement('div');
            newBuild.className = 'ucs-build ucs-build-new';
            optionSlots.forEach((ts) => newBuild.appendChild(this.makeGhostTarget(ts, 0, targetMode(0, ts))));
            zone.appendChild(newBuild);
        }
    }

    /** The slot(s) a draft placement OPTION should occupy in this player's area now ([] = none). */
    private draftTargetSlots(playerId: number): string[] {
        if (playerId !== this.myId || this.confirming) return [];
        if (this.selectedDraftId == null || !this.onDraftComplete) return [];
        const card = this.gamedatas.draftpool[this.selectedDraftId];
        // A Patch keeps all three slots clickable throughout (clicking one (re)sets its orientation);
        // a normal card only ever targets its single printed slot.
        if (card && isPatch(card, this.material)) {
            return ['L', 'R', 'B'];
        }
        const slot = this.selectedSlot();
        return slot ? [slot] : [];
    }

    /** CSS class for a placement-target visual state. */
    private targetClass(mode: 'option' | 'faint' | 'selected'): string {
        return mode === 'selected' ? 'ucs-target-selected' : mode === 'faint' ? 'ucs-target-faint' : 'ucs-target-option';
    }

    /** Mark an existing knitting piece as a clickable placement target. */
    private markTarget(el: HTMLElement, buildNo: number, slot: string, mode: 'option' | 'faint' | 'selected') {
        el.classList.add('ucs-target', this.targetClass(mode));
        el.addEventListener('click', () => this.placeDraftTarget(buildNo, slot));
    }

    /** A ghost cell at `slot` that targets `buildNo` (0 = new sweater) when clicked. */
    private makeGhostTarget(slot: string, buildNo: number, mode: 'option' | 'faint' | 'selected'): HTMLElement {
        const ghost = document.createElement('div');
        ghost.className = `ucs-card ucs-ghost ucs-target ucs-slot-${slot} ${this.targetClass(mode)}`;
        ghost.style.gridArea = slot;
        ghost.innerHTML = `<div class="ucs-ghost-label">${slot}</div>`;
        ghost.addEventListener('click', () => this.placeDraftTarget(buildNo, slot));
        return ghost;
    }

    /**
     * A knitting placement target was clicked: pick that exact position. For a Patch the clicked slot
     * (re)sets the orientation (as if its L/R/B button was clicked). The picked cell stays highlighted
     * green while the others remain clickable (faint). If the placement is fully determined (a normal
     * card, or a Patch whose value + icon are chosen) it advances to Confirm; otherwise the pick is
     * held and the player finishes value/icon in the action bar (then it advances automatically).
     */
    private placeDraftTarget(buildNo: number, slot: string) {
        const card = this.selectedDraftId != null ? this.gamedatas.draftpool[this.selectedDraftId] : null;
        const patch = card ? isPatch(card, this.material) : false;
        if (patch) this.patchSlot = slot; // clicking a position (re)picks the orientation
        this.pendingBuildNo = buildNo;
        const ready = this.selectedSlot() != null && (!patch || (this.patchValue != null && this.patchIcon != null));
        if (ready) {
            this.completeDraft(buildNo);
        } else {
            this.renderPlacementPanel(); // hold the pick (green) and wait for value/icon
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

    /**
     * Show a Confirm / Reset turn step in the top action bar before an action is actually sent to the
     * server. Confirm auto-fires after the action button's countdown (BGA's native autoclick); Reset
     * undoes the whole pending selection. The abort controller cancels the countdown on Reset / leave.
     */
    private confirmAction(submit: () => void, reset: () => void) {
        const sb = this.bga.statusBar;
        this.cancelConfirm();
        this.confirming = true;
        this.renderKnitting(this.myId); // drop the draft targets while confirming
        sb.removeActionButtons();
        sb.setTitle(_('${you} must confirm your action'));
        this.confirmAbort = new AbortController();
        sb.addActionButton(_('Confirm'), () => { this.confirmAbort = null; this.confirming = false; submit(); },
            { color: 'primary', autoclick: { abortSignal: this.confirmAbort.signal } });
        sb.addActionButton(_('Reset turn'), () => { this.cancelConfirm(); reset(); }, { color: 'secondary' });
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
        this.patchValue = null;
        this.patchIcon = null;
        this.patchSlot = null;
        this.pendingBuildNo = null;
    }

    /** A pool card was clicked: select it and open the placement panel. */
    private selectDraft(cardId: number) {
        this.clearDraftSelection();
        this.selectedDraftId = cardId;
        this.renderDraftPool();
        this.renderPlacementPanel();
    }

    /** The active player's builds: buildNo -> set of occupied slots. */
    private buildsOf(playerId: number): { [buildNo: number]: Set<string> } {
        const res: { [buildNo: number]: Set<string> } = {};
        this.cardArray(this.gamedatas.knitting)
            .filter((c) => Number(c.location_arg) === playerId)
            .forEach((c) => {
                const b = Number(c.buildNo ?? 0);
                (res[b] ||= new Set<string>()).add(String(c.slot));
            });
        return res;
    }

    /** The slot the currently-selected card will occupy (printed for a normal card; chosen for a patch). */
    private selectedSlot(): string | null {
        if (this.selectedDraftId == null) return null;
        const card = this.gamedatas.draftpool[this.selectedDraftId];
        if (!card) return null;
        return isPatch(card, this.material) ? this.patchSlot : (faceOf(card, this.material).slot ?? null);
    }

    /**
     * Render the placement controls for the selected draft card as compact buttons in the top
     * action bar (the status bar). For a Patch this is value / icon / orientation; once the slot
     * is known it's the target-sweater choice. Nothing selected → restore the default draft prompt.
     */
    private renderPlacementPanel() {
        const sb = this.bga.statusBar;
        sb.removeActionButtons();

        // Keep the in-area placement targets in sync with the current selection (they highlight the
        // target slot in my knitting area as a click-to-place alternative to the action-bar buttons).
        this.renderKnitting(this.myId);

        // The drafting flow no longer uses the in-board panel; keep it hidden.
        const panel = document.getElementById('ucs-placement');
        if (panel) {
            panel.style.display = 'none';
            panel.innerHTML = '';
        }

        if (this.selectedDraftId == null || !this.onDraftComplete) {
            sb.setTitle(_('${you} must draft a sweater card'));
            return;
        }

        const card = this.gamedatas.draftpool[this.selectedDraftId];
        const patch = card ? isPatch(card, this.material) : false;

        // Patch: pick value / icon / orientation. Shown together; the chosen one is highlighted
        // (primary), so a player can change any of the three before placing.
        if (patch) {
            sb.setTitle(_('Wild card — choose its value, icon and orientation'));
            for (let v = 1; v <= 12; v++) {
                sb.addActionButton(String(v), () => { this.patchValue = v; this.renderPlacementPanel(); },
                    { color: this.patchValue === v ? 'primary' : 'secondary' });
            }
            this.material.icons.forEach((ic) => {
                sb.addActionButton(ic, () => { this.patchIcon = ic; this.renderPlacementPanel(); },
                    { color: this.patchIcon === ic ? 'primary' : 'secondary' });
            });
            ['L', 'R', 'B'].forEach((s) => {
                sb.addActionButton(s, () => { this.patchSlot = s; this.renderPlacementPanel(); },
                    { color: this.patchSlot === s ? 'primary' : 'secondary' });
            });
        } else {
            sb.setTitle(_('Place your drafted card'));
        }

        // Build targets — actionable once the slot is known (always, for a normal card).
        const slot = this.selectedSlot();
        const ready = slot != null && (!patch || (this.patchValue != null && this.patchIcon != null));

        // A position already picked in the knitting area is held (shown green) until the placement is
        // fully determined; once it is (e.g. the Patch's value + icon are now chosen) advance to Confirm.
        if (this.pendingBuildNo != null && ready) {
            this.completeDraft(this.pendingBuildNo);
            return;
        }

        const builds = this.buildsOf(this.myId);
        const buildNos = Object.keys(builds).map(Number).sort((a, b) => a - b);

        // With no started sweaters, "New sweater" is the only possible target — don't make the
        // player choose. Auto-place into a new sweater as soon as the placement is fully
        // determined (immediately for a normal card; after value/icon/orientation for a Patch).
        if (buildNos.length === 0) {
            if (ready) {
                this.completeDraft(0);
                return;
            }
        } else {
            buildNos.forEach((no) => {
                const occupied = slot != null && builds[no].has(slot);
                const label = occupied ? `Sweater ${no}: replace ${slot}` : `Sweater ${no}: add ${slot ?? '?'}`;
                sb.addActionButton(label, () => this.completeDraft(no), { color: 'primary', disabled: !ready });
            });
            sb.addActionButton(_('+ New sweater'), () => this.completeDraft(0), { color: 'primary', disabled: !ready });
        }

        sb.addActionButton(_('Cancel'), () => {
            this.clearDraftSelection();
            this.renderDraftPool();
            this.renderPlacementPanel();
        }, { color: 'alert' });
    }

    /** Submit the draft with the chosen placement, then clear the local selection UI. */
    private completeDraft(buildNo: number) {
        if (this.selectedDraftId == null || !this.onDraftComplete) return;
        const card = this.gamedatas.draftpool[this.selectedDraftId];
        const patch = card ? isPatch(card, this.material) : false;
        const slot = this.selectedSlot();
        if (slot == null) return;

        const placement: DraftPlacement = {
            build_no: buildNo,
            slot,
            wild_value: patch ? (this.patchValue ?? 0) : 0,
            wild_icon: patch ? (this.patchIcon ?? '') : '',
        };
        const id = this.selectedDraftId;
        const cb = this.onDraftComplete;
        // Gate the draft behind Confirm/Reset. The pool card stays selected (and the chosen placement
        // pending) while confirming; Reset undoes the whole draft (pool card + placement + patch wilds).
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
        this.renderDraftPool();
        this.renderPlacementPanel();
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
}
