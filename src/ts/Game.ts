import { PlayCard } from "./States/PlayCard";
import { DraftCard } from "./States/DraftCard";
import { RoundReview } from "./States/RoundReview";
import { AssignPatches } from "./States/AssignPatches";
import { createCardElement, cardTooltip, cardLogChip, faceOf, isPatch, cardFaceInner } from "./CardView";
import { BgaAnimations, BgaCards } from "./libs";

type CardMapT = { [cardId: number]: SweaterCard };

export class Game {
    public bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>;
    private gamedatas: UglyChristmasSweaterGamedatas;

    // Selection state for the active player (set by the PlayCard / DraftCard state handlers).
    private playableIds: number[] = [];
    private onPlay: ((cardId: number, copyFromCardId: number) => void) | null = null;
    private selectedPlayId: number | null = null;
    // Leading with a patch: the patch card awaiting a copy source, and the pool card chosen to copy.
    // While patchCopyPatchId is set, the numbered Draft Pool cards render as clickable copy options
    // (in parallel with the action-bar buttons in renderPatchCopyPanel). null = not choosing a copy.
    private patchCopyPatchId: number | null = null;
    private patchCopySourceId: number | null = null;

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

    // Draft Order cards (physical cards numbered 1..N, N = player count). They live in a stack left of
    // Round Parameters, deal out onto the ranked Trade Area cards while drafting, then return home —
    // except the "1" card, which parks by the leader between tricks. `draftOrderEls[k-1]` is card "k";
    // `draftOrderCardIds` is the current trick's trade-card ids in rank order (rank k → the k-th id).
    private draftOrderEls: HTMLElement[] = [];
    private draftOrderCardIds: number[] = [];
    private draftOrderMode: 'idle' | 'dealt' | 'leader' = 'idle';
    private draftOrderAnimating = false; // true while a deal/park transition is in flight (blocks snap)

    // Monotonic counter for assigning ids to gameplay-card elements (so tooltips can attach).
    private gpSeq = 0;

    // bga-cards: the fanned hand is a HandStock backed by a CardManager (both loaded at runtime via
    // libs.ts / importEsmLib). Typed loosely — the library ships its own generics we don't re-declare.
    private animationManager: any = null;
    private cardsManager: any = null;
    private handStock: any = null;

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
                <div id="ucs-upper">
                    <div id="ucs-my-area" class="ucs-zone"></div>
                    <div id="ucs-center-stack">
                        <div id="ucs-params-row">
                            <div id="ucs-draft-order" class="ucs-zone ucs-draft-order"></div>
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
                    <div id="ucs-my-hand-row">
                        <div id="ucs-my-pile" class="ucs-draw-pile ucs-my-pile" title="${_('Your draw pile')}"></div>
                        <div id="ucs-my-hand"></div>
                    </div>
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
            document.getElementById(parent)!.insertAdjacentHTML('beforeend', `
                <div class="ucs-player-table ${mine ? 'ucs-me' : 'ucs-oppo'}" id="ucs-player-${player.id}"
                     style="--player-color:#${player.color}" data-player-id="${player.id}">
                    <div class="ucs-player-header">
                        <span class="ucs-order-badge" id="ucs-order-${player.id}"></span>
                        <span class="ucs-player-name">${mine ? _('Your Knitting Area') : player.name}</span>
                        ${mine ? '' : `<div class="ucs-draw-pile ucs-oppo-pile" id="ucs-pile-${player.id}"></div>`}
                    </div>
                    <div class="ucs-knitting" id="ucs-knitting-${player.id}"></div>
                    ${mine ? '' : `<div class="ucs-oppo-summary" id="ucs-summary-${player.id}"></div>`}
                </div>
            `);
        });

        // Clicking an opponent's table enlarges their Knitting Area in the popin.
        document.querySelectorAll('#ucs-opponents .ucs-oppo').forEach((el) => {
            el.addEventListener('click', () => this.openPopin(Number((el as HTMLElement).dataset.playerId)));
        });
        document.getElementById('ucs-popin-close')!.addEventListener('click', (e) => { e.preventDefault(); this.closePopin(); });
        document.querySelector('#ucs-popin .ucs-popin-backdrop')!.addEventListener('click', () => this.closePopin());

        // Build the CardManager + fanned HandStock for my hand (spectators have no hand).
        if (this.bga.gameui.isSpectator) {
            document.getElementById('ucs-hand-label')!.textContent = _('Spectating');
        } else {
            this.setupHandStock();
        }

        this.renderAll();

        // Draft Order cards: build the N fixed-position cards and drop them home. The active state's
        // handler (PlayCard / DraftCard onEnteringState, which fires right after setup — including on an
        // F5) snaps them to the correct dealt/leader layout; keep them aligned on viewport resize.
        this.draftOrderCardIds = (gamedatas.draftOrderCards ?? []).map(Number);
        this.draftOrderMode = 'idle';
        this.setupDraftOrderCards();
        // Position after the layout settles (BGA may still be sizing player panels / the tabletop right
        // after setup), and again on a short delay to catch any late reflow. The active state's handler
        // (PlayCard/DraftCard onEnteringState) also re-snaps against the final layout.
        requestAnimationFrame(() => this.positionDraftOrder(false));
        setTimeout(() => this.positionDraftOrder(false), 400);
        window.addEventListener('resize', () => this.positionDraftOrder(false));

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

    /**
     * Create the CardManager + fanned HandStock (bga-cards) that power my hand. The stock renders the
     * cards as an overlapping, fan-shaped arc; each front face reuses the shared `cardFaceInner` so it
     * matches the custom-DOM cards in the other zones. Selection is wired to the existing play flow via
     * `onSelectionChange` (see handSelectionChanged / enablePlayable).
     */
    private setupHandStock() {
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
            getId: (c: SweaterCard) => `ucs-hand-${c.id}`,
            isCardVisible: () => true,
            setupFrontDiv: (c: SweaterCard, div: HTMLElement) => {
                // Note: we deliberately do NOT add the `.ucs-card` sizing class here — the stock's own
                // card-side element handles sizing/positioning; we only paint colour + face.
                const face = faceOf(c, this.material);
                div.classList.add('ucs-card-face', `ucs-color-${face.color}`);
                if (face.patch) div.classList.add('ucs-patch');
                div.innerHTML = cardFaceInner(c, this.material);
                if (!div.id) div.id = `ucs-hand-${c.id}-front`;
                (this.bga.gameui as any).addTooltipHtml?.(div.id, cardTooltip(c, this.material));
            },
        });
        this.handStock = new BgaCards.HandStock(this.cardsManager, document.getElementById('ucs-my-hand')!, {
            fanShaped: true,
            // cardOverlap is a PERCENTAGE of card width (not px). Low enough that ~70% of every card
            // shows, so the whole hand (incl. the top-left value/orientation/icon) stays readable.
            cardOverlap: 30,
            emptyHandMessage: _('Hand is empty'),
            // Keep the fan sorted (colour then value) so a card drawn on refill slides into its correct
            // position rather than tacking onto the end — see notif_handUpdate's incremental addCards.
            sort: this.handSort.bind(this),
        });
        this.handStock.setSelectionMode('none');
        this.handStock.onSelectionChange = (selection: SweaterCard[], last: SweaterCard | null) =>
            this.handSelectionChanged(selection, last);
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
        this.renderSecretSanta();
        this.renderDraftOrderZone();
        this.renderDraftPool();
        this.renderTradeArea();
        this.renderPlayers();
        this.renderPiles();
        this.renderHand();
    }

    /** My own Secret Santa objective(s) — 1 in Casual, 2 in Express (private; hidden from other players). */
    private renderSecretSanta() {
        const zone = document.getElementById('ucs-secret-santa');
        if (!zone) return;
        const cards = Object.values(this.gamedatas.secretSanta ?? {});
        if (!cards.length) { zone.style.display = 'none'; return; }
        zone.style.display = '';
        zone.innerHTML = `<div class="ucs-zone-label">${_('Your Secret Santa')}</div>`;
        const row = document.createElement('div');
        row.className = 'ucs-santa-cards';
        cards.forEach((c) => {
            const ss = this.material.secretSantas?.[Number((c as any).type_arg)];
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
    private renderGameplay() {
        const zone = document.getElementById('ucs-gameplay')!;
        zone.innerHTML = `<div class="ucs-zone-label">Round Parameters</div>`;
        const row = document.createElement('div');
        row.className = 'ucs-gameplay-row';
        const gp = this.gamedatas.gameplay;
        row.appendChild(this.gameplayPileEl('perfectfit', 'Perfect Fit', gp?.perfectfit));
        row.appendChild(this.gameplayPileEl('trendyyarn', 'Trendy Yarn', gp?.trendyyarn));
        // Express shows a DISPLAY of claimable Fads (players+1); Casual shows the single revealed Fad.
        if (this.gamedatas.express) {
            row.appendChild(this.fadDisplayEl(gp?.express));
        } else {
            row.appendChild(this.gameplayPileEl('fad', 'Fads', gp?.fad));
        }
        zone.appendChild(row);
    }

    /** Express: the row of claimable Fad cards — unclaimed on display, claimed ones tagged with the owner. */
    private fadDisplayEl(express: ExpressGameplay | undefined): HTMLElement {
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
    private fadCardEl(card: GameplayCard, ownerId: number | null): HTMLElement {
        const el = this.gameplayCardEl('fad', card);
        el.classList.add('ucs-fad-card');
        if (ownerId != null) {
            el.classList.add('ucs-fad-claimed');
            const owner = this.gamedatas.players[ownerId];
            if (owner) el.style.setProperty('--player-color', `#${owner.color}`);
            el.insertAdjacentHTML('beforeend', `<div class="ucs-fad-owner">${owner?.name ?? ''}</div>`);
        }
        return el;
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
        // While leading with a patch, the numbered pool cards are clickable copy sources (a patch can't
        // copy another patch). Otherwise, during the Draft phase they're clickable draft picks.
        const copying = this.patchCopyPatchId != null;
        this.cardArray(this.gamedatas.draftpool).forEach((card) => {
            const el = createCardElement(card, this.material);
            this.attachTooltip(el, card);
            if (copying) {
                if (!isPatch(card, this.material)) {
                    el.classList.add('ucs-selectable', 'ucs-copy-option');
                    if (Number(card.id) === this.patchCopySourceId) {
                        el.classList.add('ucs-chosen');
                    }
                    el.addEventListener('click', () => this.chooseCopySource(Number(card.id)));
                }
            } else if (this.draftableIds.includes(Number(card.id))) {
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

    private renderPlayers() {
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
    private renderOppoSummary(playerId: number) {
        const el = document.getElementById(`ucs-summary-${playerId}`);
        if (!el) return;
        const cards = this.cardArray(this.gamedatas.knitting).filter((c) => Number(c.location_arg) === playerId);
        const builds: { [buildNo: number]: SweaterCard[] } = {};
        cards.forEach((c) => { const b = Number(c.buildNo ?? 0); (builds[b] ||= []).push(c); });
        const complete = Object.values(builds).filter((b) => this.isBuildComplete(b)).length;
        const wip = Object.keys(builds).length - complete;
        el.innerHTML = `<span class="ucs-pips">${'🧶'.repeat(complete) || '—'}</span>`
            + `<span class="ucs-oppo-progress">${complete} ${_('done')} · ${wip} ${_('wip')}</span>`;
    }

    /**
     * Draw piles: my own (beside the hand, with a remaining count) and each opponent's (a face-down
     * pile in their table header, no count). A pile shows a card-back while it holds cards and collapses
     * to an empty slot once exhausted — it's also the origin element the refill animation slides from.
     */
    private renderPiles() {
        const my = document.getElementById('ucs-my-pile');
        if (my) {
            const n = this.gamedatas.counts?.[this.myId]?.pile ?? 0;
            my.innerHTML = n
                ? `<div class="ucs-pile-card ucs-card-back"></div><div class="ucs-pile-count">${n} ${_('left')}</div>`
                : `<div class="ucs-pile-card ucs-pile-empty"></div><div class="ucs-pile-count ucs-pile-count-empty">${_('empty')}</div>`;
        }
        Object.values(this.gamedatas.players).forEach((p) => {
            const pid = Number(p.id);
            if (pid === this.myId) return;
            const el = document.getElementById(`ucs-pile-${pid}`);
            if (!el) return;
            const n = this.gamedatas.counts?.[pid]?.pile ?? 0;
            // No count text for opponents (per design) — just the pile presence.
            el.innerHTML = n ? `<div class="ucs-pile-card ucs-card-back"></div>` : '';
        });
    }

    /**
     * A card-back "drawn" animation for an opponent: a face-down card flies from their draw pile to
     * their BGA player panel (far right), signalling they refilled a card without revealing it. Purely
     * decorative — a self-contained fixed-position transform, so it doesn't depend on stock/model state.
     */
    private animateOpponentDraw(pid: number) {
        if (!this.bga.gameui.bgaAnimationsActive?.()) return;
        const from = document.querySelector(`#ucs-pile-${pid} .ucs-pile-card`) as HTMLElement | null;
        const to = document.getElementById(`overall_player_board_${pid}`)
            ?? document.getElementById(`player_board_${pid}`);
        if (!from || !to) return;
        const a = from.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        const ghost = document.createElement('div');
        ghost.className = 'ucs-card-back ucs-draw-fly';
        ghost.style.left = `${a.left}px`;
        ghost.style.top = `${a.top}px`;
        ghost.style.width = `${a.width}px`;
        ghost.style.height = `${a.height}px`;
        document.body.appendChild(ghost);
        const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
        const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
        requestAnimationFrame(() => {
            ghost.style.transform = `translate(${dx}px, ${dy}px) scale(0.35)`;
            ghost.style.opacity = '0';
        });
        setTimeout(() => ghost.remove(), 650);
    }

    /** Open the popin showing one player's Knitting Area at full size (from a click on their table). */
    private openPopin(playerId: number) {
        const popin = document.getElementById('ucs-popin')!;
        const body = document.getElementById('ucs-popin-body')!;
        const player = this.gamedatas.players[playerId];
        document.getElementById('ucs-popin-title')!.textContent =
            player ? `${player.name} — ${_('Knitting Area')}` : _('Knitting Area');
        popin.style.setProperty('--player-color', player ? `#${player.color}` : '#888');
        this.renderKnitting(playerId, body);
        popin.style.display = '';
    }

    private closePopin() {
        const popin = document.getElementById('ucs-popin');
        if (popin) popin.style.display = 'none';
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

    // ===================================================================================
    //  Draft Order cards (physical cards 1..N that mark pick order — see the fields above)
    // ===================================================================================

    /** Number of Draft Order cards in play = number of players (4P→1-4, 3P→1-3, 2P→1-2). */
    private draftOrderCount(): number {
        return Object.keys(this.gamedatas.players).length;
    }

    private draftOrderCardW(): number {
        const t = document.getElementById('ucs-table');
        return (t && parseFloat(getComputedStyle(t).getPropertyValue('--ucs-card-w'))) || 64;
    }
    private draftOrderCardH(): number {
        const t = document.getElementById('ucs-table');
        return (t && parseFloat(getComputedStyle(t).getPropertyValue('--ucs-card-h'))) || 90;
    }

    /** The static "home" box + label for the stack, left of Round Parameters (reserves the footprint). */
    private renderDraftOrderZone() {
        const zone = document.getElementById('ucs-draft-order');
        if (!zone) return;
        zone.innerHTML = `<div class="ucs-zone-label">${_('Draft Order')}</div>`
            + `<div class="ucs-draftorder-home"></div>`;
    }

    /**
     * The overlay that holds the Draft Order cards. It lives INSIDE #ucs-table (position:absolute,
     * inset:0) so the cards share the tabletop's coordinate/transform context — positions are computed
     * as deltas relative to this layer, which is robust to any transform/scale/offset BGA applies to the
     * game area (a plain document.body + position:fixed approach mis-aligned by the game-area offset).
     */
    private draftOrderLayer(): HTMLElement | null {
        let layer = document.getElementById('ucs-draftorder-layer');
        if (!layer) {
            const table = document.getElementById('ucs-table');
            if (!table) return null;
            layer = document.createElement('div');
            layer.id = 'ucs-draftorder-layer';
            table.appendChild(layer);
        }
        return layer;
    }

    /** Create the N Draft Order card elements once (rebuilt if the count changed), inside the layer. */
    private setupDraftOrderCards() {
        const layer = this.draftOrderLayer();
        if (!layer) return;
        if (this.draftOrderEls.length === this.draftOrderCount() && this.draftOrderEls[0]?.isConnected) return;
        this.draftOrderEls.forEach((el) => el.remove());
        this.draftOrderEls = [];
        for (let k = 1; k <= this.draftOrderCount(); k++) {
            const el = document.createElement('div');
            el.className = 'ucs-draftorder-card';
            el.id = `ucs-draftcard-${k}`;
            el.innerHTML = `<span class="ucs-draftorder-num">${k}</span>`;
            el.style.display = 'none';
            layer.appendChild(el);
            this.draftOrderEls.push(el);
        }
    }

    /**
     * Home (stack) rect for card k — a small diagonal stack under the "Draft Order" label. Anchored to
     * the label's rect (reliably positioned) for the vertical, and centred in the reserved home box for
     * the horizontal, so the stack always sits directly beneath its label regardless of row height.
     */
    private draftOrderHomeRect(k: number): { left: number; top: number; w: number; h: number } | null {
        const label = document.querySelector('#ucs-draft-order .ucs-zone-label') as HTMLElement | null;
        const box = document.querySelector('#ucs-draft-order .ucs-draftorder-home') as HTMLElement | null;
        if (!label || !box) return null;
        const rl = label.getBoundingClientRect(), rb = box.getBoundingClientRect();
        const w = this.draftOrderCardW(), h = this.draftOrderCardH();
        const step = 5, span = step * (this.draftOrderCount() - 1);
        return {
            left: rb.left + (rb.width - w - span) / 2 + step * (k - 1),
            top: rl.bottom + 4 + step * (k - 1),
            w, h,
        };
    }

    /** Where the "1" card parks to show who leads the next trick — over the leader's player table. */
    private leaderMarkerRect(): { left: number; top: number; w: number; h: number } | null {
        const el = document.getElementById(`ucs-player-${this.gamedatas.leaderId}`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left + 6, top: r.top + 6, w: this.draftOrderCardW(), h: this.draftOrderCardH() };
    }

    /** Target rect for card k under the current mode (dealt onto a trade card / parked at leader / home). */
    private draftOrderTargetRect(k: number): { left: number; top: number; w: number; h: number } | null {
        const home = this.draftOrderHomeRect(k);
        if (this.draftOrderMode === 'idle') return home;
        if (this.draftOrderMode === 'leader') {
            return k === 1 ? (this.leaderMarkerRect() ?? home) : home;
        }
        // dealt: sit directly BELOW the k-th ranked trade card (same x) so the played card's face stays
        // fully visible; the Trade Area is expanded downward to frame this row (see ucs-trade-has-order).
        const cardId = this.draftOrderCardIds[k - 1];
        const cardEl = cardId != null ? document.getElementById(`ucs-card-${cardId}`) : null;
        if (!cardEl) return home; // e.g. 2P has 4 trade cards but only 2 order cards → extras stay home
        const r = cardEl.getBoundingClientRect();
        return { left: r.left, top: r.bottom + 6, w: r.width, h: r.height };
    }

    /** Lay every Draft Order card at its current-mode position (animated or snapped). */
    private positionDraftOrder(animate: boolean) {
        this.setupDraftOrderCards();
        const layer = this.draftOrderLayer();
        if (!layer) return;
        // Convert the (viewport) target rects into the layer's internal coordinates. `scale` accounts for
        // any transform BGA applies to the game area; the layer and the targets share that transform, so
        // the delta / scale lands the card exactly over its target regardless of scale or offset.
        const lr = layer.getBoundingClientRect();
        const scale = layer.offsetWidth ? lr.width / layer.offsetWidth : 1;
        // Expand the Trade Area to reserve room for the Draft Order card row below the played cards
        // (only while they're dealt there). padding-bottom doesn't move the played cards, so their rects
        // stay valid for positioning below.
        document.getElementById('ucs-trade-area')
            ?.classList.toggle('ucs-trade-has-order', this.draftOrderMode === 'dealt');
        this.draftOrderEls.forEach((el, i) => {
            const t = this.draftOrderTargetRect(i + 1);
            if (!t) { el.style.display = 'none'; return; }
            el.style.display = '';
            el.style.transition = animate
                ? 'left .5s ease, top .5s ease, width .5s ease, height .5s ease'
                : 'none';
            el.style.left = `${(t.left - lr.left) / scale}px`;
            el.style.top = `${(t.top - lr.top) / scale}px`;
            // Always the internal card size (matches the tabletop cards); the target's viewport size would
            // be scale-inflated. left/top already carry the 35% dealt offset baked in viewport terms.
            el.style.width = `${this.draftOrderCardW()}px`;
            el.style.height = `${this.draftOrderCardH()}px`;
            el.classList.toggle('ucs-draftorder-out', this.draftOrderMode !== 'idle'
                && !(this.draftOrderMode === 'leader' && i + 1 !== 1));
        });
    }

    /**
     * Draft order resolved: deal the numbered cards onto the ranked Trade Area cards. If the "1" card was
     * parked at the previous leader, first send it home so all cards reunite in the stack, then deal — the
     * "put the #1 card back before redealing" step the design calls for.
     */
    public dealDraftOrder(orderCards: number[]) {
        this.draftOrderCardIds = orderCards.map(Number);
        this.gamedatas.draftOrderCards = this.draftOrderCardIds; // keep the model fresh for a later F5 sync
        this.beginDraftOrderAnim(1100);
        const deal = () => { this.draftOrderMode = 'dealt'; this.positionDraftOrder(true); };
        if (this.draftOrderMode === 'leader') {
            this.draftOrderMode = 'idle';
            this.positionDraftOrder(true);
            setTimeout(deal, 520); // let the "reunite in the stack" animation finish first
        } else {
            deal();
        }
    }

    /** Drafting done: cards 2..N return to the stack; the "1" card parks by the leader for the next trick. */
    public parkDraftOrderAtLeader() {
        this.beginDraftOrderAnim(600);
        this.draftOrderMode = 'leader';
        this.positionDraftOrder(true);
    }

    /** Tuck all Draft Order cards home (idle) — used by the round-end states so they don't linger. */
    public hideDraftOrder() {
        // Forget the resolved order too, so the next round's opening leader shows no parked "1" card.
        this.gamedatas.draftOrderCards = [];
        this.beginDraftOrderAnim(600);
        this.draftOrderMode = 'idle';
        this.positionDraftOrder(true);
    }

    /** Flag an in-flight deal/park so a state-entry sync doesn't snap over it mid-animation. */
    private beginDraftOrderAnim(ms: number) {
        this.draftOrderAnimating = true;
        setTimeout(() => { this.draftOrderAnimating = false; }, ms);
    }

    /**
     * Snap the Draft Order cards to a state's layout (no animation) — called from the PlayCard / DraftCard
     * handlers for every player. On an F5 reload this restores the right picture; during live play the
     * matching notif already animated, so we skip (don't interrupt the in-flight transition, and don't
     * redundantly re-snap when we're already in the target state).
     */
    public syncDraftOrder(mode: 'dealt' | 'leader') {
        if (this.draftOrderAnimating) return; // don't snap over an in-flight notif animation
        const ids = (this.gamedatas.draftOrderCards ?? []).map(Number);
        // No trick has resolved yet this round → keep every card home. The opening leader doesn't need a
        // Draft Order card parked on them to show they lead first (issue raised 2026-07-05).
        const effective: 'idle' | 'dealt' | 'leader' =
            (mode === 'leader' && ids.length === 0) ? 'idle' : mode;
        if (effective === 'dealt') this.draftOrderCardIds = ids;
        this.draftOrderMode = effective;
        // Always re-snap (don't early-return when already in this mode): the setup-time layout may not
        // have settled, and this state entry is our reliable chance to place against the final layout.
        this.positionDraftOrder(false);
    }

    /** Express: the Fad-claim map (fadCardId -> {playerId, buildNo}), or empty outside Express. */
    private expressClaims(): { [fadId: number]: FadClaim } {
        return this.gamedatas.gameplay?.express?.fadClaims ?? {};
    }

    /** Express: the type_arg (fad id in Material::fads) of the Fad locking playerId's build, or null. */
    private claimedFadForBuild(playerId: number, buildNo: number): number | null {
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
    private fadForBuild(playerId: number, buildNo: number): any | null {
        if (this.gamedatas.express) {
            const t = this.claimedFadForBuild(playerId, buildNo);
            return (t != null && t > 0) ? (this.material.fads[t] ?? null) : null;
        }
        const active = this.gamedatas.gameplay?.fad?.active;
        return active ? (this.material.fads[Number(active.type_arg)] ?? null) : null;
    }

    /** A card's effective value (a placed patch carries its chosen wildValue; else its printed value). */
    private effValue(c: SweaterCard): number {
        if (c.wildValue != null && c.wildValue !== '') return Number(c.wildValue);
        return Number(faceOf(c, this.material).value);
    }

    /** A card's effective icon (a placed patch's wildIcon; else its printed icon; may be null pre-art). */
    private effIcon(c: SweaterCard): string | null {
        if (c.wildIcon != null && c.wildIcon !== '') return String(c.wildIcon);
        return faceOf(c, this.material).icon;
    }

    /**
     * Live public VP for one sweater — a DISPLAY helper for the per-sweater badge that MIRRORS the
     * server's Game::publicSweaterScore (the server stays authoritative; keep this in sync with the
     * PHP). Returns 0 for an incomplete sweater, and +2 only for a complete one still holding an
     * unassigned patch (its run / Fad / icon bonuses land at round-end once the patch is assigned).
     */
    private buildPublicScore(cards: SweaterCard[], playerId: number, buildNo: number): number {
        const VP_SWEATER = 2, VP_RUN = 2, VP_FAD = 3, VP_NONFAD = 1; // == Material::VP_*

        const bySlot: { [slot: string]: SweaterCard } = {};
        cards.forEach((c) => {
            const slot = (c.slot as string) ?? faceOf(c, this.material).slot ?? null;
            if (slot) bySlot[slot] = c;
        });
        if (!bySlot.L || !bySlot.R || !bySlot.B) return 0; // not a completed L+R+B sweater
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
        if (values[1] === values[0] + 1 && values[2] === values[1] + 1) vp += VP_RUN;

        const allSameColor = new Set(colors).size === 1;
        const allSameIcon = !icons.includes(null) && new Set(icons).size === 1;

        const fad = this.fadForBuild(playerId, buildNo);
        if (fad && fad.clash) {
            // "Clash Is In": +3 when all three differ in BOTH colour and icon; any all-same still +1.
            const allDiffColor = new Set(colors).size === 3;
            const allDiffIcon = !icons.includes(null) && new Set(icons).size === 3;
            if (allDiffColor && allDiffIcon) vp += VP_FAD;
            if (allSameColor || allSameIcon) vp += VP_NONFAD;
        } else {
            let fadColor: string | null = null, fadIcon: string | null = null;
            (fad?.objectives ?? []).forEach((o: any) => {
                if (o.match === 'color') fadColor = o.value;
                if (o.match === 'icon') fadIcon = o.value;
            });
            if (fadColor !== null && allSameColor && colors[0] === fadColor) vp += VP_FAD;
            if (fadIcon !== null && allSameIcon && icons[0] === fadIcon) vp += VP_FAD;
            if ((allSameColor && colors[0] !== fadColor) || (allSameIcon && icons[0] !== fadIcon)) vp += VP_NONFAD;
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
    private renderKnitting(playerId: number, targetEl?: HTMLElement) {
        const zone = targetEl ?? document.getElementById(`ucs-knitting-${playerId}`);
        if (!zone) return;
        zone.innerHTML = '';

        const cards = this.cardArray(this.gamedatas.knitting).filter(
            (c) => Number(c.location_arg) === playerId
        );

        // Opponents' inline area: a compact read-out — each card is just a small colour+number chip (no
        // orientation letter / icon), each sweater a little cluster, all sweaters in a single left-to-
        // right row. (The click-to-enlarge popin — targetEl set — and my own area keep the full silhouette.)
        if (!targetEl && playerId !== this.myId) {
            this.renderKnittingCompact(zone, playerId, cards);
            return;
        }

        const sel = this.selectedDraftId != null ? this.gamedatas.draftpool[this.selectedDraftId] : null;
        const mine = playerId === this.myId && this.onDraftComplete != null && sel != null;
        const selPatch = mine ? isPatch(sel!, this.material) : false;
        const picked = mine ? this.pendingBuildNo : null; // chosen build (highlighted green)

        // A regular card is placed by clicking its (single) printed slot in my area; a patch is wild and
        // may be clicked into ANY L/R/B of any sweater (covering an occupied slot discards it). Either
        // way the targets stay clickable so the placement can be changed freely until Submit (the picked
        // cell shows green, the rest as options).
        const regularSlot = (mine && !selPatch) ? (faceOf(sel!, this.material).slot ?? null) : null;
        // A floating-patch orientation (chosen on the action bar when a 2nd card joins a sweater that
        // holds a floating patch) shows as green, non-clickable, so the player sees where it will land.
        const floatDest = (mine && this.pendingBuildNo != null && this.floatingPatchSlot)
            ? { buildNo: this.pendingBuildNo, slot: this.floatingPatchSlot } : null;

        if (!cards.length && regularSlot == null && !selPatch) {
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
                // Express: a sweater that has claimed a Fad is locked — it can't be altered, and the
                // claimed Fad is shown on it. Locked builds draw no draft targets (guards below).
                const claimedFad = this.claimedFadForBuild(playerId, buildNo);
                const locked = claimedFad != null;
                if (locked) build.classList.add('ucs-build-locked');
                const slotEls: { [slot: string]: HTMLElement } = {};
                builds[buildNo].forEach((card) => {
                    const el = createCardElement(card, this.material);
                    const slot = (card.slot as string) ?? faceOf(card, this.material).slot ?? null;
                    if (slot) {
                        el.style.gridArea = slot;
                        el.classList.add(`ucs-slot-${slot}`); // lets CSS rotate the B (hem) piece
                        slotEls[slot] = el;
                    } else {
                        el.classList.add('ucs-floating'); // a floating patch — orientation not set yet
                    }
                    if (Number(card.id) === this.assignQueue[0]) {
                        el.classList.add('ucs-assigning'); // the patch being assigned right now
                    }
                    this.attachTooltip(el, card);
                    build.appendChild(el);
                });
                // Slots occupied by a placed card, or (below) by a draft-target ghost — so the static
                // empty-slot placeholders don't double up on a slot already drawn.
                const takenSlots = new Set<string>(Object.keys(slotEls));
                // Apply a target/destination at `slot`: reuse the card el if present, else a ghost cell.
                // onClick omitted → a non-clickable (green, informational) destination.
                const cell = (slot: string, mode: 'option' | 'selected', onClick?: () => void) => {
                    takenSlots.add(slot);
                    if (slotEls[slot]) this.applyTarget(slotEls[slot], mode, onClick);
                    else build.appendChild(this.makeTargetGhost(slot, mode, onClick));
                };
                if (regularSlot && !locked) {
                    cell(regularSlot, picked === buildNo ? 'selected' : 'option', () => this.placeDraftTarget(buildNo));
                }
                if (selPatch && !locked) {
                    // Offer all three orientations; exclude the slot reserved for this sweater's floating
                    // patch (the two patches must land in different slots).
                    const reserved = (floatDest && floatDest.buildNo === buildNo) ? floatDest.slot : null;
                    (['L', 'R', 'B'] as const).forEach((s) => {
                        if (s === reserved) return;
                        const isSel = picked === buildNo && this.patchSlot === s;
                        cell(s, isSel ? 'selected' : 'option', () => this.placePatchTarget(buildNo, s));
                    });
                }
                if (floatDest && floatDest.buildNo === buildNo) cell(floatDest.slot, 'selected'); // green
                // Static silhouette: once a sweater holds a real (slotted) piece, draw every still-empty
                // L/R/B as a dotted placeholder, so a build occupies the same L+R/B footprint whether it
                // has 1 or 3 pieces. (A lone floating patch — no slotted piece yet — is left as-is.)
                if (Object.keys(slotEls).length > 0) {
                    (['L', 'R', 'B'] as const).forEach((s) => {
                        if (!takenSlots.has(s)) build.appendChild(this.makeEmptySlot(s));
                    });
                }
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
            // Draw the other two orientations as dotted (non-clickable) placeholders so a new sweater
            // reads as the full L/R-over-B silhouette, even though this card can only land in its one
            // printed slot. Matches the static footprint a started sweater already shows.
            (['L', 'R', 'B'] as const).forEach((s) => {
                if (s !== regularSlot) newBuild.appendChild(this.makeEmptySlot(s));
            });
            zone.appendChild(newBuild);
        } else if (selPatch) {
            const newBuild = document.createElement('div');
            newBuild.className = 'ucs-build ucs-build-new';
            newBuild.appendChild(this.makeFloatGhost(picked === 0 ? 'selected' : 'option', () => this.placePatchNew()));
            zone.appendChild(newBuild);
        }
    }

    /**
     * Compact opponent read-out of a knitting area: each card is a small colour+number chip (no
     * orientation letter / icon), laid out in the same L-R-over-B sweater silhouette as the full
     * area — a started sweater keeps its whole footprint, with still-empty L/R/B slots drawn as
     * dotted placeholders (matching `renderKnitting`), so an incomplete sweater reads as gaps in
     * the sweater shape rather than a shorter cluster. All sweaters sit in a single left-to-right
     * row. Inline opponents column only — the click-to-enlarge popin keeps the detailed silhouette.
     */
    private renderKnittingCompact(zone: HTMLElement, playerId: number, cards: SweaterCard[]) {
        zone.classList.add('ucs-knitting-compact');
        if (!cards.length) {
            zone.innerHTML = `<div class="ucs-empty">${_('No sweaters yet')}</div>`;
            return;
        }
        const builds: { [buildNo: number]: SweaterCard[] } = {};
        cards.forEach((c) => { const b = Number(c.buildNo ?? 0); (builds[b] ||= []).push(c); });
        Object.keys(builds).map(Number).sort((a, b) => a - b).forEach((buildNo) => {
            const group = document.createElement('div');
            group.className = 'ucs-mini-build';
            if (this.isBuildComplete(builds[buildNo])) group.classList.add('ucs-mini-build-complete');
            // Place each chip in its L/R/B grid slot; a floating patch (orientation not set yet) spans
            // the build. Grid position handles the read order, so the DOM order no longer matters.
            const takenSlots = new Set<string>();
            builds[buildNo].forEach((c) => {
                const slot = (c.slot as string) ?? faceOf(c, this.material).slot ?? null;
                const el = this.miniCardEl(c);
                if (slot) {
                    el.style.gridArea = slot;
                    takenSlots.add(slot);
                } else {
                    el.classList.add('ucs-mini-floating'); // a floating patch — no slot yet
                }
                group.appendChild(el);
            });
            // Static silhouette: once a sweater holds a real (slotted) piece, draw every still-empty
            // L/R/B as a dotted placeholder so the build keeps its full footprint whether it has 1 or
            // 3 pieces. A lone floating patch (0 slotted pieces) is left as-is, exactly as renderKnitting.
            if (takenSlots.size > 0) {
                (['L', 'R', 'B'] as const).forEach((s) => {
                    if (!takenSlots.has(s)) group.appendChild(this.makeMiniEmptySlot(s));
                });
            }
            zone.appendChild(group);
        });
    }

    /** A tiny dotted placeholder for a still-empty orientation in a started sweater (compact view). */
    private makeMiniEmptySlot(slot: string): HTMLElement {
        const cell = document.createElement('div');
        cell.className = `ucs-mini-card ucs-mini-empty`;
        cell.style.gridArea = slot;
        return cell;
    }

    /** A tiny colour+number chip (log-card style) for the compact opponent view; a patch shows ★/value. */
    private miniCardEl(card: SweaterCard): HTMLElement {
        const face = faceOf(card, this.material);
        const color = face?.color ?? String(card.type);
        const el = document.createElement('div');
        el.id = `ucs-mini-${card.id}`;
        el.className = `ucs-mini-card ucs-color-${color}`;
        if (face?.patch) el.classList.add('ucs-mini-patch');
        const wildValue = card.wildValue != null && card.wildValue !== '' ? Number(card.wildValue) : null;
        el.textContent = face?.patch
            ? (wildValue != null ? String(wildValue) : '★')
            : String(wildValue ?? face?.value ?? '?');
        this.attachTooltip(el, card);
        return el;
    }

    /** Style an existing piece as a placement target/destination; `onClick` (if given) makes it clickable. */
    private applyTarget(el: HTMLElement, mode: 'option' | 'selected', onClick?: () => void) {
        el.classList.add('ucs-target', mode === 'selected' ? 'ucs-target-selected' : 'ucs-target-option');
        if (onClick) el.addEventListener('click', onClick);
    }

    /** A non-interactive dotted placeholder for a still-empty orientation in a started sweater. */
    private makeEmptySlot(slot: string): HTMLElement {
        const cell = document.createElement('div');
        cell.className = `ucs-card ucs-ghost ucs-slot-empty ucs-slot-${slot}`;
        cell.style.gridArea = slot;
        cell.innerHTML = `<div class="ucs-ghost-label">${slot}</div>`;
        return cell;
    }

    /** A ghost cell at `slot`; `onClick` (if given) makes it clickable. */
    private makeTargetGhost(slot: string, mode: 'option' | 'selected', onClick?: () => void): HTMLElement {
        const ghost = document.createElement('div');
        ghost.className = `ucs-card ucs-ghost ucs-target ${mode === 'selected' ? 'ucs-target-selected' : 'ucs-target-option'} ucs-slot-${slot}`;
        ghost.style.gridArea = slot;
        ghost.innerHTML = `<div class="ucs-ghost-label">${slot}</div>`;
        if (onClick) ghost.addEventListener('click', onClick);
        return ghost;
    }

    /** A slot-less ghost for starting a NEW sweater with a floating patch; `onClick` makes it clickable. */
    private makeFloatGhost(mode: 'option' | 'selected', onClick?: () => void): HTMLElement {
        const ghost = document.createElement('div');
        ghost.className = `ucs-card ucs-ghost ucs-floating ucs-target ${mode === 'selected' ? 'ucs-target-selected' : 'ucs-target-option'}`;
        ghost.innerHTML = `<div class="ucs-ghost-label">${_('float')}</div>`;
        if (onClick) ghost.addEventListener('click', onClick);
        return ghost;
    }

    /**
     * A knitting target was clicked while drafting a REGULAR card: (re)choose that sweater. The choice
     * is freely changeable — re-render so the picked cell shows green and the action bar offers Submit
     * (or, if the target holds a floating patch, its orientation first). Nothing is sent until Submit.
     */
    private placeDraftTarget(buildNo: number) {
        if (this.pendingBuildNo !== buildNo) this.floatingPatchSlot = null; // re-picking clears the float choice
        this.pendingBuildNo = buildNo;
        this.renderPlacementPanel();
    }

    /**
     * A knitting slot was clicked while drafting a PATCH: choose that sweater AND the patch's own
     * orientation in one click (clicking an occupied slot covers it → discards the piece underneath).
     * Freely changeable until Submit.
     */
    private placePatchTarget(buildNo: number, slot: string) {
        if (this.pendingBuildNo !== buildNo) this.floatingPatchSlot = null; // re-picking a build clears the float choice
        this.pendingBuildNo = buildNo;
        this.patchSlot = slot;
        if (this.floatingPatchSlot === slot) this.floatingPatchSlot = null; // the two patches can't share a slot
        this.renderPlacementPanel();
    }

    /** The "new sweater (floats)" ghost was clicked while drafting a PATCH: start a new floating sweater. */
    private placePatchNew() {
        this.pendingBuildNo = 0;
        this.patchSlot = null;
        this.floatingPatchSlot = null;
        this.renderPlacementPanel();
    }

    private isBuildComplete(build: SweaterCard[]): boolean {
        const slots = new Set(build.map((c) => c.slot));
        return slots.has('L') && slots.has('R') && slots.has('B');
    }

    /**
     * Resync the fanned HandStock from gamedatas.hand. The hand is small, so a full clear+add is fine;
     * removeAll/addCards are async but their DOM ops apply in order and we don't need to await here.
     * (Selectable/disabled styling is driven by the stock's selection API — see enablePlayable.)
     */
    private renderHand() {
        if (this.bga.gameui.isSpectator || !this.handStock) return;
        const hand = this.cardArray(this.gamedatas.hand).sort(this.handSort.bind(this));
        this.handStock.removeAll();
        if (hand.length) this.handStock.addCards(hand);
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
        this.hidePanel();
        if (!this.handStock) return;
        this.handStock.setSelectionMode('single');
        const selectable = this.cardArray(this.gamedatas.hand).filter((c) => ids.includes(Number(c.id)));
        document.getElementById('ucs-my-hand')?.classList.add('ucs-hand-choosing');
        // setSelectableCards is sync but addCards (from a hand refill on state entry) is async — defer a
        // tick so the cards exist in the stock before we mark them selectable (bga-cards gotcha).
        setTimeout(() => this.handStock?.setSelectableCards(selectable), 0);
    }

    public disablePlayable() {
        this.cancelConfirm();
        this.playableIds = [];
        this.onPlay = null;
        this.clearPatchCopy();
        this.hidePanel();
        if (this.handStock) {
            this.handStock.setSelectionMode('none');
            this.handStock.unselectAll(true);
        }
        document.getElementById('ucs-my-hand')?.classList.remove('ucs-hand-choosing');
    }

    /** A hand card was selected in the stock — route to the existing play logic (ignore deselections). */
    private handSelectionChanged(selection: SweaterCard[], last: SweaterCard | null) {
        if (!this.onPlay || !last) return;
        if (!selection.some((c) => String(c.id) === String(last.id))) return;
        this.selectPlay(Number(last.id));
    }

    /** A hand card was clicked. A leading Patch needs a pool card to copy first; everything else plays now. */
    private selectPlay(cardId: number) {
        if (!this.onPlay) return;
        const card = this.gamedatas.hand[cardId];
        const leading = this.cardArray(this.gamedatas.trick).length === 0;
        if (card && isPatch(card, this.material) && leading) {
            this.selectedPlayId = cardId;
            this.renderPatchCopyPanel(cardId);
        } else {
            this.completePlay(cardId, 0);
        }
    }

    /** A card (and, for a leading patch, its copy source) has been chosen — gate it behind Confirm/Reset. */
    private completePlay(cardId: number, copyFromCardId: number) {
        this.selectedPlayId = cardId; // the stock keeps the pending card highlighted while confirming
        this.confirmAction(
            () => {
                const cb = this.onPlay;
                this.selectedPlayId = null;
                this.hidePanel();
                cb && cb(cardId, copyFromCardId);
            },
            () => {
                // Reset: clear the stock selection, back to choosing a card from hand.
                this.clearPatchCopy();
                this.hidePanel();
                this.handStock?.unselectAll(true);
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
     * Leading with a patch: choose which numbered draft-pool card it copies (value + icon) by
     * clicking that card in the Draft Pool (see renderDraftPool's copy-mode branch). The action bar
     * carries only the prompt and a Cancel.
     */
    private renderPatchCopyPanel(cardId: number) {
        const sb = this.bga.statusBar;
        sb.removeActionButtons();

        // Enter copy mode: the numbered Draft Pool cards become clickable copy sources.
        this.patchCopyPatchId = cardId;
        this.patchCopySourceId = null;
        this.renderDraftPool();

        sb.setTitle(_('Leading with a Patch — click a Draft Pool card to copy its value & icon'));
        sb.addActionButton(_('Cancel'), () => {
            this.clearPatchCopy();
            sb.removeActionButtons();
            sb.setTitle(_('${you} must play a card'));
            this.handStock?.unselectAll(true);
        }, { color: 'alert' });
    }

    /** A copy source (a numbered pool card) was chosen for the leading patch. */
    private chooseCopySource(sourceId: number) {
        const patchId = this.patchCopyPatchId;
        if (patchId == null) return;
        this.patchCopySourceId = sourceId; // highlight the chosen pool card while confirming
        this.renderDraftPool();
        this.completePlay(patchId, sourceId);
    }

    /** Leave patch-copy mode (chosen, cancelled, or state left) and drop the pool's copy highlighting. */
    private clearPatchCopy() {
        this.selectedPlayId = null;
        if (this.patchCopyPatchId == null && this.patchCopySourceId == null) return;
        this.patchCopyPatchId = null;
        this.patchCopySourceId = null;
        this.renderDraftPool();
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
            // Choosing the sweater: the (clickable, freely-changeable) targets in my area do it; the
            // action bar offers New + Cancel until a position is picked.
            if (this.pendingBuildNo == null) {
                if (buildNos.length === 0) {
                    this.pendingBuildNo = 0; // only option: new sweater — fall through to Submit
                } else {
                    sb.setTitle(_('Click a slot in your sweaters to place — or:'));
                    sb.addActionButton(_('+ New sweater'), () => this.placeDraftTarget(0), { color: 'primary' });
                    cancelBtn();
                    return;
                }
            }
            // A sweater was picked but it holds a floating patch → orient that patch first.
            const buildNo = this.pendingBuildNo!;
            const floatId = (buildNo in builds) ? floating[buildNo] : undefined;
            if (floatId !== undefined && this.floatingPatchSlot == null) {
                const cardSlot = faceOf(card, this.material).slot ?? null;
                const openForFloat = ['L', 'R', 'B'].filter((s) => !builds[buildNo].has(s) && s !== cardSlot);
                sb.setTitle(_('Orient the floating patch already in this sweater'));
                openForFloat.forEach((s) => sb.addActionButton(`${_('Patch')} ${s}`, () => {
                    this.floatingPatchSlot = s; this.renderPlacementPanel();
                }, { color: this.floatingPatchSlot === s ? 'primary' : 'secondary' }));
                cancelBtn();
                return;
            }
            // Ready: act immediately if the preference is "Off", else show Submit (position still editable).
            if (this.confirmMode() === 0) { this.submitDraft(buildNo); return; }
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
        if (this.pendingBuildNo == null && buildNos.length === 0) this.pendingBuildNo = 0;

        const buildNo = this.pendingBuildNo;
        const isNewBuild = buildNo === 0 || (buildNo != null && !(buildNo in builds));
        const occupied = (buildNo != null && !isNewBuild) ? builds[buildNo] : new Set<string>();
        const floatId = (buildNo != null && !isNewBuild) ? floating[buildNo] : undefined;
        // The patch's own slot: chosen on an existing sweater, null (floating) when starting a new one.
        const cardSlot = isNewBuild ? null : this.patchSlot;

        const changeCancel = () => {
            if (buildNos.length > 0 && this.pendingBuildNo != null) {
                sb.addActionButton(_('Change'), () => {
                    this.pendingBuildNo = null; this.patchSlot = null; this.floatingPatchSlot = null;
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
                this.floatingPatchSlot = s; this.renderPlacementPanel();
            }, { color: 'secondary' }));
            changeCancel();
            return;
        }

        // Ready: act immediately if the preference is "Off", else show Submit (the board stays editable).
        if (this.confirmMode() === 0) { this.submitDraft(buildNo); return; }
        sb.setTitle(_('Click a different slot to change, or submit'));
        sb.addActionButton(_('Submit'), () => this.submitDraft(buildNo), { color: 'primary' });
        changeCancel();
    }

    /** Send the draft with the chosen placement (no timer — the player has already clicked Submit, or
     *  the "act immediately" preference is on), then clear the local selection UI. */
    private submitDraft(buildNo: number) {
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
        // Only my own hand changes visually; slide the played card out of the fan (other players' plays
        // don't touch my stock). disablePlayable on state-leave clears any lingering selection.
        if (Number(args.player_id) === this.myId && this.handStock) {
            this.handStock.removeCard(args.card).catch(() => {});
        }
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

    /** The trick resolved into a draft order; show the order badges and deal the Draft Order cards. */
    async notif_draftOrder(args: NotifDraftOrder) {
        this.draftOrder = args.order.map(Number);
        // order[0] holds the "1" card and leads the next trick — track it for the leader marker.
        if (this.draftOrder.length) this.gamedatas.leaderId = this.draftOrder[0];
        this.gamedatas.players && Object.values(this.gamedatas.players).forEach(
            (p) => this.renderOrderBadge(Number(p.id))
        );
        this.dealDraftOrder(args.orderCards ?? []);
    }

    /** End of trick: the trade area becomes the new draft pool; counts resync. */
    async notif_trickCleanup(args: NotifTrickCleanup) {
        const pool: CardMapT = {};
        args.pool.forEach((c) => (pool[Number(c.id)] = c));
        this.gamedatas.draftpool = pool;
        this.gamedatas.trick = {};
        // For each opponent, the drop in pile count is how many cards they drew this refill — fly that
        // many card-backs from their pile to their panel. (My own draw animates via notif_handUpdate.)
        const before = this.gamedatas.counts ?? {};
        Object.values(this.gamedatas.players).forEach((p) => {
            const pid = Number(p.id);
            if (pid === this.myId) return;
            const drew = Math.max(0, (before[pid]?.pile ?? 0) - (args.counts[pid]?.pile ?? 0));
            for (let i = 0; i < drew; i++) this.animateOpponentDraw(pid);
        });
        this.gamedatas.counts = args.counts;
        this.draftOrder = [];
        this.renderDraftPool();
        this.renderTradeArea();
        this.renderPlayers();
        this.renderPiles();
        // Drafting is done: cards 2..N return to the stack; the "1" card parks by the leader (order[0],
        // tracked in notif_draftOrder) so everyone can see who leads the next trick.
        this.parkDraftOrderAtLeader();
    }

    /**
     * Private: my hand was refilled. Rather than re-deal the whole fan, slide in only the newly-drawn
     * card(s) from my draw pile (the stock's `sort` drops each into its correct spot). If nothing was
     * drawn (pile empty), the fan is left untouched. `hand` stays the authoritative model either way.
     */
    async notif_handUpdate(args: NotifHandUpdate) {
        const hand: CardMapT = {};
        args.hand.forEach((c) => (hand[Number(c.id)] = c));
        this.gamedatas.hand = hand;
        if (this.gamedatas.counts?.[this.myId]) {
            this.gamedatas.counts[this.myId].hand = args.hand.length;
        }
        this.renderPiles();
        if (!this.handStock) return;
        const drawn = args.drawn ?? [];
        if (!drawn.length) return; // pile empty / nothing drawn → hand stays as-is
        // addCards skips any card already in the stock, so a mid-refill F5 (where `hand` already
        // rebuilt the fan) won't double-add. The pile card-back is the slide origin.
        const from = document.querySelector('#ucs-my-pile .ucs-pile-card') as HTMLElement | null;
        this.handStock.addCards(drawn, from ? { fromElement: from } : undefined, 80);
    }

    /** A new round revealed fresh gameplay cards — refresh the round-parameter decks. */
    async notif_gameplayRevealed(args: NotifGameplayRevealed) {
        this.gamedatas.gameplay = args.gameplay;
        this.renderGameplay();
    }

    /**
     * Express: a player claimed a Fad. The Fad moves from the display onto their (now locked) sweater;
     * re-render the Fad display and that player's knitting. Their score updates via the framework's
     * score counter (server playerScore->inc), so no manual score bump is needed here.
     */
    async notif_fadClaimed(args: NotifFadClaimed) {
        this.gamedatas.gameplay = args.gameplay;
        this.renderGameplay();
        this.renderKnitting(args.player_id);
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
