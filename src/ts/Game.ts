import { PlayCard } from "./States/PlayCard";
import { DraftCard } from "./States/DraftCard";
import { createCardElement, createCardBack, cardTooltip, faceOf, isPatch } from "./CardView";

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
                    // Position each piece into the sweater silhouette: L top-left, R top-right,
                    // B centred below (grid areas defined in .ucs-build). A floating patch with no
                    // chosen orientation auto-flows.
                    const slot = (card.slot as string) ?? faceOf(card, this.material).slot ?? null;
                    if (slot) el.style.gridArea = slot;
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

    private completePlay(cardId: number, copyFromCardId: number) {
        const cb = this.onPlay;
        this.selectedPlayId = null;
        this.hidePanel();
        this.renderHand();
        cb && cb(cardId, copyFromCardId);
    }

    /** Leading with a patch: choose which numbered draft-pool card it copies (value + icon). */
    private renderPatchCopyPanel(cardId: number) {
        const panel = document.getElementById('ucs-placement');
        if (!panel) return;
        panel.style.display = '';

        const sources = this.cardArray(this.gamedatas.draftpool).filter((c) => !isPatch(c, this.material));
        const btns = sources.map((c) => {
            const f = faceOf(c, this.material);
            const icon = f.icon ?? '?';
            return `<button class="ucs-build-btn" data-pool="${c.id}">${f.color} ${f.value} · ${icon}</button>`;
        }).join('');

        panel.innerHTML = `
            <div class="ucs-zone-label">Leading with a Patch — copy a draft-pool card's value &amp; icon</div>
            <div class="ucs-choice-row">${btns || '<span class="ucs-empty">No numbered pool card to copy</span>'}</div>
            <div class="ucs-choice-row"><button class="ucs-build-btn ucs-cancel" data-cancel="1">Cancel</button></div>
        `;
        panel.querySelectorAll<HTMLButtonElement>('.ucs-build-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.dataset.cancel) {
                    this.selectedPlayId = null;
                    this.hidePanel();
                    this.renderHand();
                    return;
                }
                this.completePlay(cardId, Number(btn.dataset.pool));
            });
        });
    }

    /** Hide and clear the shared placement / patch-copy panel. */
    private hidePanel() {
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

    /** Render the placement panel for the selected draft card (or hide it when nothing is selected). */
    private renderPlacementPanel() {
        const panel = document.getElementById('ucs-placement');
        if (!panel) return;

        if (this.selectedDraftId == null || !this.onDraftComplete) {
            panel.style.display = 'none';
            panel.innerHTML = '';
            return;
        }
        panel.style.display = '';

        const card = this.gamedatas.draftpool[this.selectedDraftId];
        const patch = card ? isPatch(card, this.material) : false;
        const slot = this.selectedSlot();

        const parts: string[] = [`<div class="ucs-zone-label">Place your drafted card</div>`];

        // Patch: choose value, icon, orientation.
        if (patch) {
            const values = Array.from({ length: 12 }, (_, i) => i + 1)
                .map((v) => `<button class="ucs-choice ${this.patchValue === v ? 'ucs-on' : ''}" data-kind="value" data-val="${v}">${v}</button>`)
                .join('');
            const icons = this.material.icons
                .map((ic) => `<button class="ucs-choice ${this.patchIcon === ic ? 'ucs-on' : ''}" data-kind="icon" data-val="${ic}">${ic}</button>`)
                .join('');
            const slots = ['L', 'R', 'B']
                .map((s) => `<button class="ucs-choice ${this.patchSlot === s ? 'ucs-on' : ''}" data-kind="slot" data-val="${s}">${s}</button>`)
                .join('');
            parts.push(`
                <div class="ucs-choice-row"><span class="ucs-choice-label">Value</span>${values}</div>
                <div class="ucs-choice-row"><span class="ucs-choice-label">Icon</span>${icons}</div>
                <div class="ucs-choice-row"><span class="ucs-choice-label">Orientation</span>${slots}</div>
            `);
        }

        // Build targets — enabled once the slot is known (always, for a normal card).
        const ready = slot != null && (!patch || (this.patchValue != null && this.patchIcon != null));
        const builds = this.buildsOf(this.myId);
        const buildBtns: string[] = [];
        Object.keys(builds).map(Number).sort((a, b) => a - b).forEach((no) => {
            const occupied = slot != null && builds[no].has(slot);
            const label = occupied ? `Sweater ${no} (replace ${slot})` : `Sweater ${no} (add ${slot ?? '?'})`;
            buildBtns.push(`<button class="ucs-build-btn" data-build="${no}" ${ready ? '' : 'disabled'}>${label}</button>`);
        });
        buildBtns.push(`<button class="ucs-build-btn" data-build="0" ${ready ? '' : 'disabled'}>＋ New sweater</button>`);
        parts.push(`<div class="ucs-choice-row"><span class="ucs-choice-label">Place into</span>${buildBtns.join('')}</div>`);
        parts.push(`<div class="ucs-choice-row"><button class="ucs-build-btn ucs-cancel" data-cancel="1">Cancel</button></div>`);

        panel.innerHTML = parts.join('');

        // Wire up the buttons.
        panel.querySelectorAll<HTMLButtonElement>('.ucs-choice').forEach((btn) => {
            btn.addEventListener('click', () => {
                const kind = btn.dataset.kind!;
                const val = btn.dataset.val!;
                if (kind === 'value') this.patchValue = Number(val);
                else if (kind === 'icon') this.patchIcon = val;
                else if (kind === 'slot') this.patchSlot = val;
                this.renderPlacementPanel();
            });
        });
        panel.querySelectorAll<HTMLButtonElement>('.ucs-build-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.dataset.cancel) {
                    this.clearDraftSelection();
                    this.renderDraftPool();
                    this.renderPlacementPanel();
                    return;
                }
                if (!btn.disabled) this.completeDraft(Number(btn.dataset.build));
            });
        });
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
        this.clearDraftSelection();
        this.renderDraftPool();
        this.renderPlacementPanel();
        cb(id, placement);
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
}
