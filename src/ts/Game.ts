import { PlayCard } from "./States/PlayCard";
import { DraftCard } from "./States/DraftCard";
import { RoundReview } from "./States/RoundReview";
import { AssignPatches } from "./States/AssignPatches";
import { BillyChoice } from "./States/BillyChoice";
import { TinaTink } from "./States/TinaTink";
import { createCardElement, cardTooltip, cardLogChip, faceOf, isPatch, cardFaceInner, faceSpriteClass, colourName, fadTooltip, secretSantaTooltip } from "./CardView";
import { BgaAnimations, BgaCards, BgaHelp } from "./libs";

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

    // Mixed-up Maria (bonus): when active, a regular card is placed via a self-contained action-bar
    // sub-flow (pick target build + any orientation) rather than its printed slot.
    private mariaActive = false;
    private mariaBuildNo: number | null = null;
    private mariaSlot: string | null = null;

    // Tina Can Tink (bonus, round end): move one piece or swap two. Mode + click selections.
    private onTinaMove: ((cardId: number, buildNo: number, slot: string) => void) | null = null;
    private onTinaSwap: ((cardA: number, cardB: number) => void) | null = null;
    private onTinaSkip: (() => void) | null = null;
    private tinaMode: 'move' | 'swap' | null = null;
    private tinaSelA: number | null = null;
    private tinaSelB: number | null = null;
    private tinaBuildNo: number | null = null;
    private tinaSlot: string | null = null;

    // Round-end patch assignment (AssignPatches state): the patch card ids I still owe an assignment
    // (each glows and gets its own inline value/icon picker beside it), plus the in-progress value/icon
    // choice per patch (keyed by card id — several patches can be pending at once).
    private onAssignPatch: ((cardId: number, value: number, icon: string) => void) | null = null;
    private assignPending: number[] = [];
    private assignSel: { [cardId: number]: { value: number | null; icon: string | null } } = {};

    // Confirm/Reset gate: a pending play/draft waits for the player to confirm (or auto-confirms via
    // the action button's countdown). The abort controller cancels that countdown on Reset / leave.
    private confirmAbort: AbortController | null = null;
    private confirming = false; // true while a play/draft is awaiting Confirm (hides draft targets)

    // Draft Order (the numbers 1..N, N = player count, marking pick order). While a trick's order is
    // live each number is drawn as a small badge in the corner of the Trade Area card it ranks; there
    // is no stack and nothing exists between orders. `draftOrderCardIds` is the current trick's
    // trade-card ids in rank order (rank k → the k-th id).
    private draftOrderCardIds: number[] = [];
    private draftOrderMode: 'idle' | 'dealt' = 'idle';

    // Left-to-right order the Draft Pool should render in, so cards collected from the Trade Area keep
    // their trade positions and slide straight up (the server nulls trick_order on the way to the pool,
    // so there's no ordering key left in the data — see notif_trickCleanup). Null = fall back to slot.
    private poolRenderOrder: number[] | null = null;

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
        this.bga.states.register('BillyChoice', new BillyChoice(this, bga));
        this.bga.states.register('TinaTink', new TinaTink(this, bga));
    }

    /*
        setup: build the game UI from current game state ("gamedatas" = the result of Game::getAllDatas).
        Called on game start and on every page refresh (F5).
    */
    setup(gamedatas: UglyChristmasSweaterGamedatas) {
        console.log("Starting game setup");
        this.gamedatas = gamedatas;

        this.bga.gameArea.getElement().insertAdjacentHTML('beforeend', `
            <div id="ucs-table" style="--ucs-players:${Object.keys(gamedatas.players).length}">
                <div id="ucs-hand-end-banner" class="ucs-hand-end-banner" style="display:none">
                    ${_('Last trick and draft phase of this hand — the round ends after this draft.')}
                </div>
                <div id="ucs-upper">
                    <div id="ucs-gameplay" class="ucs-zone"></div>
                    <div id="ucs-secret-santa" class="ucs-zone ucs-secret-santa" style="display:none"></div>
                    <div id="ucs-center-stack">
                        <div id="ucs-draft-pool" class="ucs-zone"></div>
                        <div id="ucs-trade-area" class="ucs-zone"></div>
                    </div>
                    <div id="ucs-opponents"></div>
                    <div id="ucs-my-area" class="ucs-zone"></div>
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
                        <span class="ucs-player-name">${mine ? _('Your Knitting Area') : player.name}</span>
                        <span class="ucs-bonus-card" id="ucs-bonus-${player.id}"></span>
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

        // Draft Order: markers are drawn into the Trade Area cards themselves, so there's nothing to
        // place here. The active state's handler (PlayCard / DraftCard onEnteringState, which fires
        // right after setup — including on an F5) syncs them to the correct idle/dealt picture.
        this.draftOrderCardIds = (gamedatas.draftOrderCards ?? []).map(Number);
        this.draftOrderMode = 'idle';

        // Restore the "last trick & draft phase" banner if this hand's end is already triggered (e.g. an
        // F5 mid-final-draft). Live-computed server-side, so it's absent again once the next round deals.
        this.showHandEndBanner(!!gamedatas.handEndTriggered);

        this.setupNotifications();
        this.maybeAddDebugButton();
        this.setupHelpButton();
        console.log("Ending game setup");
    }

    /**
     * The lower-left "?" help button — a fixed round button that opens a popin showing the printed
     * End-of-Round Scoring reference (img/scoreref.png). Uses the bga-help dojo module (see libs.ts /
     * _reference/castlecombo): HelpManager appends its #bga-help_buttons container to the BGA-standard
     * #left-side element; the button itself is position:fixed, so we defensively create #left-side if a
     * given skin lacks it (the fixed button still anchors to the viewport corner either way).
     */
    private setupHelpButton() {
        if (!document.getElementById('left-side')) {
            const ls = document.createElement('div');
            ls.id = 'left-side';
            document.body.appendChild(ls);
        }
        new BgaHelp.HelpManager(this, {
            buttons: [
                new BgaHelp.BgaHelpPopinButton({
                    title: _('End of Round Scoring'),
                    html: `<img class="ucs-help-scoreref" src="${g_gamethemeurl}img/scoreref.png" alt="${_('End of Round Scoring reference')}">`,
                    buttonBackground: '#8b0f03', // the game's festive red (matches the log/patch accent)
                }),
            ],
        });
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
            cardHeight: 149, // bridge ratio 0.643 (bleed-trimmed art) + #ucs-my-hand-wrap's --ucs-card-h
            getId: (c: SweaterCard) => `ucs-hand-${c.id}`,
            isCardVisible: () => true,
            setupFrontDiv: (c: SweaterCard, div: HTMLElement) => {
                // Note: we deliberately do NOT add the `.ucs-card` sizing class here — the stock's own
                // card-side element handles sizing/positioning; we only paint colour + face.
                const face = faceOf(c, this.material);
                div.classList.add('ucs-card-face', 'ucs-face', faceSpriteClass(c));
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
            // Lift the floating (position:fixed) hand above the Draft Order overlay (z-index 50) so the
            // dealt rank cards never paint over the player's fanned hand. Stays below the popin (1000).
            floatZIndex: 100,
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

    /**
     * Draft Pool cards in the order they should render. After a trick collect, poolRenderOrder holds the
     * Trade Area's left-to-right order so cards keep their spots and slide straight up; otherwise (a
     * freshly dealt or carried-over pool) fall back to the draft slot (location_arg). Cards absent from
     * poolRenderOrder (shouldn't happen mid-trick) sort after the ordered ones, by slot.
     */
    private poolCardsInDisplayOrder(): SweaterCard[] {
        const order = this.poolRenderOrder;
        const rank = (c: SweaterCard): number => {
            const i = order ? order.indexOf(Number(c.id)) : -1;
            return i >= 0 ? i : 1000 + Number(c.location_arg);
        };
        return this.cardArray(this.gamedatas.draftpool).sort((a, b) => rank(a) - rank(b));
    }

    private renderAll() {
        this.renderGameplay();
        this.renderSecretSanta();
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
            const arg = Number((c as any).type_arg);
            const el = document.createElement('div');
            el.className = `ucs-card ucs-santa-card ucs-art2 ucs-santa-${arg}`;
            el.id = `ucs-santa-el-${arg}`;
            // secretSantaTooltip translates the (clienttranslate-marked) name and lists the 3 required
            // pieces; deferred via addTip since el is appended below, after this call.
            this.addTip(el.id, secretSantaTooltip(ss));
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
        zone.innerHTML = ''; // no zone label: each parameter carries its own (Perfect Fit / Trendy Yarn / Fads)
        const row = document.createElement('div');
        row.className = 'ucs-gameplay-row';
        const gp = this.gamedatas.gameplay;
        row.appendChild(this.gameplayPileEl('perfectfit', _('Perfect Fit'), gp?.perfectfit));
        row.appendChild(this.gameplayPileEl('trendyyarn', _('Trendy Yarn'), gp?.trendyyarn));
        // Express shows a DISPLAY of claimable Fads (players+1); Casual shows the single revealed Fad.
        const fadEl = this.gamedatas.express
            ? this.fadDisplayEl(gp?.express)
            : this.gameplayPileEl('fad', _('Fads'), gp?.fad);
        fadEl.id = 'ucs-fad-zone'; // hook for the round-end assignment dim (kept readable above the overlay)
        row.appendChild(fadEl);
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

        const cards = document.createElement('div');
        cards.className = 'ucs-gp-cards';

        // The face-down draw pile + how many cards remain — shown on the LEFT. The deck's name is written
        // OVER the pile back (not a separate label row above) to save vertical space.
        const deck = document.createElement('div');
        deck.className = 'ucs-gp-deck';
        const remaining = pile?.deckCount ?? 0;
        deck.innerHTML =
            `<div class="ucs-gp-backwrap">`
            + `<div class="ucs-card ucs-art2 ucs-gp-${type}-back ucs-gp-back ${remaining ? '' : 'ucs-gp-empty'}"></div>`
            + `<div class="ucs-gp-label">${label}</div>`
            + `</div>`
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

    /** A revealed gameplay card, drawn with its real publisher art (sprite via .ucs-art2). */
    private gameplayCardEl(type: string, card: GameplayCard | null): HTMLElement {
        const el = document.createElement('div');
        el.className = 'ucs-card ucs-gp-card';
        if (!card) {
            el.classList.add('ucs-gp-none');
            el.innerHTML = `<div class="ucs-gp-face">—</div>`;
            return el;
        }
        const arg = Number(card.type_arg);
        el.classList.add('ucs-art2');
        if (type === 'perfectfit') {
            el.classList.add(`ucs-gp-perfectfit-${arg}`);
            this.addTip(this.gpId(el), `<strong>${_('Perfect Fit')} ${arg}</strong><br>${_('Cards of this value are the super-trump this round.')}`);
        } else if (type === 'trendyyarn') {
            const color = this.material.colors[arg] ?? String(arg);
            el.classList.add(`ucs-gp-trendyyarn-${color}`);
            this.addTip(this.gpId(el), `<strong>${_('Trendy Yarn')}: ${colourName(color)}</strong><br>${_('This colour is the trump colour this round.')}`);
        } else {
            const fad = this.material.fads[arg];
            el.classList.add('ucs-gp-fad', `ucs-gp-fad-${arg}`); // ucs-gp-fad = styling/hook; -${arg} = sprite face
            this.addTip(this.gpId(el), fadTooltip(fad));
        }
        return el;
    }

    /** Ensure an element has an id (so a tooltip can attach), and return it. */
    private gpId(el: HTMLElement): string {
        if (!el.id) el.id = `ucs-gp-${++this.gpSeq}`;
        return el.id;
    }

    /**
     * Attach an HTML tooltip to an element by id, DOM-safely. BGA's addTooltipHtml binds its hover
     * handler to the element *at call time*, so attaching to a not-yet-appended node silently never
     * fires (the card renders, but hovering shows nothing). Our zones build their cards detached and
     * append them later within the same synchronous render, so we defer the attach to the next frame —
     * by which point the element is in the live DOM — guarding in case it was removed/replaced meanwhile.
     * (Hand cards go through bga-cards' stock, which appends before attaching, so they never needed this.)
     */
    private addTip(id: string, html: string) {
        if (!id) return;
        const gameui = this.bga.gameui as any;
        requestAnimationFrame(() => {
            if (document.getElementById(id)) gameui.addTooltipHtml?.(id, html);
        });
    }

    private renderDraftPool() {
        const zone = document.getElementById('ucs-draft-pool')!;
        zone.innerHTML = `<div class="ucs-zone-label">${_('Draft Pool')}</div>`;
        const row = document.createElement('div');
        row.className = 'ucs-card-row';
        // While leading with a patch, the numbered pool cards are clickable copy sources (a patch can't
        // copy another patch). Otherwise, during the Draft phase they're clickable draft picks.
        const copying = this.patchCopyPatchId != null;
        this.poolCardsInDisplayOrder().forEach((card) => {
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
        zone.innerHTML = `<div class="ucs-zone-label">${_('Trade Area (this trick)')}</div>`;
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
            // Draft Order marker: the k-th ranked card wears its number in its own top-right corner.
            const rank = this.draftOrderRankOf(Number(card.id));
            if (rank) {
                el.insertAdjacentHTML('beforeend',
                    `<div class="ucs-draftorder-badge ucs-art2 ucs-draftorder-${rank}"></div>`);
            }
            wrap.appendChild(el);
            row.appendChild(wrap);
        });
        if (!cards.length) {
            row.innerHTML = `<div class="ucs-empty">${_('No cards played yet')}</div>`;
        }
        zone.appendChild(row);
    }

    /** Draft Order rank (1..N) marking this Trade Area card, or 0 when the order isn't live. */
    private draftOrderRankOf(cardId: number): number {
        if (this.draftOrderMode !== 'dealt') return 0;
        return this.draftOrderCardIds.indexOf(cardId) + 1;
    }

    private renderPlayers() {
        Object.values(this.gamedatas.players).forEach((player) => {
            this.renderKnitting(Number(player.id));
            this.renderOppoSummary(Number(player.id));
            this.renderBonus(Number(player.id));
        });
    }

    /**
     * A player's revealed Bonus / Special Ability card (optional expansion). Placeholder chip: the card's
     * name with its rules text as a tooltip, greyed once a one-shot has been spent. Empty when the option
     * is Off or this player has no bonus card. (Effects are implemented separately; this is display only.)
     */
    private renderBonus(playerId: number) {
        const el = document.getElementById(`ucs-bonus-${playerId}`);
        if (!el) return;
        const card = (this.gamedatas.bonus ?? []).find((b) => b.owner === playerId);
        if (!card) { el.style.display = 'none'; el.innerHTML = ''; return; }
        el.style.display = '';
        el.classList.toggle('ucs-bonus-used', !!card.used);
        // card.name / card.text are marked with clienttranslate server-side (Material::bonusCards);
        // translate for display.
        const name = card.name ? _(card.name) : '';
        el.innerHTML = `<span class="ucs-bonus-icon">🎁</span><span class="ucs-bonus-name">${name}</span>`;
        // Tooltip carries the full publisher card art (sized via inline --ucs-card-w/h) beneath the text.
        const art = `<div class="ucs-art2 ucs-bonus-${card.bonusId}" style="--ucs-card-w:150px;--ucs-card-h:233px;width:150px;height:233px;border-radius:6px;margin:6px auto 0"></div>`;
        (this.bga.gameui as any).addTooltipHtml?.(el.id, `<b>${name}</b>${card.text ? `<br>${_(card.text)}` : ''}${art}`);
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
     * My own draw pile (beside the hand, with a remaining count): a card-back while it holds cards, an
     * empty slot once exhausted. Opponents no longer show a draw pile — it conveyed nothing useful.
     */
    private renderPiles() {
        const my = document.getElementById('ucs-my-pile');
        if (!my) return;
        // Coerce to a number: the pile count arrives from the PHP Deck component as a STRING
        // ("0"), and a non-empty string is truthy — so an exhausted pile would otherwise fall into
        // the card-back "0 left" branch instead of collapsing to empty.
        const n = Number(this.gamedatas.counts?.[this.myId]?.pile ?? 0);
        my.innerHTML = n
            ? `<div class="ucs-pile-card ucs-card-back"></div><div class="ucs-pile-count">${n} ${_('left')}</div>`
            : `<div class="ucs-pile-card ucs-pile-empty"></div><div class="ucs-pile-count ucs-pile-count-empty">${_('empty')}</div>`;
    }

    /**
     * FLIP-move a card element into place from a source rectangle: the destination element is already
     * rendered at its final spot, so we offset it back to `from` (translate + scale, transform-origin
     * top-left) then transition to identity — it appears to fly in from `from`. Deltas are divided by
     * the tabletop scale (same as animateTradeToPool) so it's correct under any transform BGA applies;
     * the scale factors are viewport ratios (scale-independent). Resolves when the motion ends (or
     * immediately when animations are off), so a promise notification can await the flight.
     */
    private flipCardFrom(
        el: HTMLElement | null,
        from: { left: number; top: number; width: number; height: number } | null,
        durationSec: number,
    ): Promise<void> {
        if (!el || !from || !this.bga.gameui.bgaAnimationsActive?.()) return Promise.resolve();
        const table = document.getElementById('ucs-table');
        const tScale = (table && table.offsetWidth) ? table.getBoundingClientRect().width / table.offsetWidth : 1;
        const now = el.getBoundingClientRect();
        if (!now.width || !from.width) return Promise.resolve();
        const dx = (from.left - now.left) / tScale;
        const dy = (from.top - now.top) / tScale;
        const sx = from.width / now.width;
        const sy = from.height / now.height;
        // Nothing meaningful to animate (e.g. an F5 left the card already in place) — skip.
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.03 && Math.abs(sy - 1) < 0.03) {
            return Promise.resolve();
        }
        el.style.transformOrigin = 'top left';
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
        el.style.zIndex = '300'; // ride above sibling cards while in flight (below the popin at 1000)
        void el.offsetWidth; // force reflow so the starting transform takes effect before the transition
        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                el.style.transition = `transform ${durationSec}s ease`;
                el.style.transform = '';
            });
            setTimeout(() => {
                el.style.transition = ''; el.style.transform = '';
                el.style.transformOrigin = ''; el.style.zIndex = '';
                resolve();
            }, durationSec * 1000 + 60);
        });
    }

    /** A card-sized source rect centred on a host element (used to launch a card out of a player panel). */
    private cardRectAtCenter(host: HTMLElement, w: number, h: number) {
        const r = host.getBoundingClientRect();
        return { left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - h / 2, width: w, height: h };
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

    // ===================================================================================
    //  Draft Order markers (the numbers 1..N marking pick order — see the fields above)
    // ===================================================================================
    // No stack and no overlay: renderTradeArea draws each number straight into the corner of the card
    // it ranks (see draftOrderRankOf), so a marker only exists while an order is live. These methods
    // move that state and re-render.

    /** Draft order resolved: the numbers appear on the ranked Trade Area cards. */
    public dealDraftOrder(orderCards: number[]) {
        this.draftOrderCardIds = orderCards.map(Number);
        this.gamedatas.draftOrderCards = this.draftOrderCardIds; // keep the model fresh for a later F5 sync
        this.draftOrderMode = 'dealt';
        this.renderTradeArea();
    }

    /** The order is spent (drafting done, or the round ended) — the markers go with it. */
    public hideDraftOrder() {
        // Forget the resolved order too, so the next round's opening leader shows no stale marker.
        this.gamedatas.draftOrderCards = [];
        this.draftOrderCardIds = [];
        this.draftOrderMode = 'idle';
        this.renderTradeArea();
    }

    /**
     * Snap the markers to a state's picture — called from the PlayCard / DraftCard handlers for every
     * player. On an F5 reload this is what restores the right view.
     */
    public syncDraftOrder(mode: 'dealt' | 'idle') {
        const ids = (this.gamedatas.draftOrderCards ?? []).map(Number);
        // 'dealt' only holds while a trick's order is live (markers on the trade area); once it's spent
        // (draftOrderCards cleared on cleanup) fall back to 'idle' and the markers go.
        const effective: 'idle' | 'dealt' = (mode === 'dealt' && ids.length) ? 'dealt' : 'idle';
        this.draftOrderCardIds = effective === 'dealt' ? ids : [];
        this.draftOrderMode = effective;
        this.renderTradeArea();
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
            zone.innerHTML = `<div class="ucs-empty">${_('No sweaters yet')}</div>`;
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
                build.id = `ucs-build-${playerId}-${buildNo}`;
                build.dataset.buildNo = String(buildNo);
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
                    // Round-end assignment: every patch I still owe an assignment glows (a value/icon
                    // picker is attached beside it below).
                    if (this.assignPending.includes(Number(card.id))) el.classList.add('ucs-assign-glow');
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
                // A live VP counter on each sweater (public info). Always shown in my own area; for an
                // opponent it's shown in the enlarged click-to-view popin (targetEl set), not the small
                // inline read-out (that path uses renderKnittingCompact and returns earlier).
                if (playerId === this.myId || targetEl != null) {
                    const badge = document.createElement('div');
                    badge.className = 'ucs-build-score';
                    badge.textContent = `${this.buildPublicScore(builds[buildNo], playerId, buildNo)} VP`;
                    badge.title = _('Current VP this sweater scores');
                    build.appendChild(badge);
                }
                // Round-end: attach an inline value/icon picker beside each patch in this sweater that I
                // still owe an assignment (no action-bar buttons — the choice sits right by the glowing
                // patch). Only in my own live area (not the opponent popin / compact read-out).
                if (playerId === this.myId && !targetEl && this.onAssignPatch) {
                    let pickerIdx = 0;
                    builds[buildNo].forEach((card) => {
                        if (this.assignPending.includes(Number(card.id))) {
                            build.appendChild(this.makeAssignPicker(Number(card.id), pickerIdx++));
                        }
                    });
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
        // gameui.addTooltipHtml works on an element id; ours are unique (ucs-card-<id>). Deferred via
        // addTip because callers build the card detached and append it after this call (see addTip).
        this.addTip(el.id, cardTooltip(card, this.material));
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
        this.mariaActive = false;
        this.mariaBuildNo = null;
        this.mariaSlot = null;
    }

    /** True when I hold an unused bonus card of the given key ('littlebrothers'|'tina'|'maria'|'billy'). */
    public myUnusedBonus(key: string): boolean {
        return (this.gamedatas.bonus ?? []).some((b) => b.owner === this.myId && b.key === key && !b.used);
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
        // Mixed-up Maria (bonus): offer to place a regular card in any orientation via its own sub-flow.
        const mariaToggle = () => {
            if (!patch && this.myUnusedBonus('maria')) {
                sb.addActionButton(_('Use Mixed-up Maria'), () => {
                    this.mariaActive = true; this.mariaBuildNo = null; this.mariaSlot = null;
                    this.renderPlacementPanel();
                }, { color: 'secondary' });
            }
        };

        // ---- Regular card: placement is driven by the in-area click targets (renderKnitting). ----
        if (!patch) {
            if (this.mariaActive) { this.renderMariaPanel(card); return; }
            const { builds, floating, buildNos } = this.myBuilds();
            // Choosing the sweater: the (clickable, freely-changeable) targets in my area do it; the
            // action bar offers New + Cancel until a position is picked.
            if (this.pendingBuildNo == null) {
                if (buildNos.length === 0) {
                    this.pendingBuildNo = 0; // only option: new sweater — fall through to Submit
                } else {
                    sb.setTitle(_('Click a slot in your sweaters to place — or:'));
                    sb.addActionButton(_('+ New sweater'), () => this.placeDraftTarget(0), { color: 'primary' });
                    mariaToggle();
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
            if (this.confirmMode() === 0 && !this.myUnusedBonus('maria')) { this.submitDraft(buildNo); return; }
            sb.setTitle(_('Click a different slot to change, or submit'));
            sb.addActionButton(_('Submit'), () => this.submitDraft(buildNo), { color: 'primary' });
            mariaToggle();
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
    //  Bonus / Special Ability cards — Mixed-up Maria (placement), Billy's a Brute, Tina Can Tink
    // ===================================================================================

    /** Mixed-up Maria: a self-contained action-bar sub-flow to place a regular card in any orientation. */
    private renderMariaPanel(card: SweaterCard) {
        const sb = this.bga.statusBar;
        sb.removeActionButtons();
        this.renderKnitting(this.myId);
        sb.setTitle(_('Mixed-up Maria: choose a sweater and any orientation'));
        const { buildNos } = this.myBuilds();
        sb.addActionButton(_('+ New sweater'), () => { this.mariaBuildNo = 0; this.renderPlacementPanel(); },
            { color: this.mariaBuildNo === 0 ? 'primary' : 'secondary' });
        buildNos.forEach((b) => sb.addActionButton(`${_('Sweater')} ${b}`, () => { this.mariaBuildNo = b; this.renderPlacementPanel(); },
            { color: this.mariaBuildNo === b ? 'primary' : 'secondary' }));
        ['L', 'R', 'B'].forEach((s) => sb.addActionButton(s, () => { this.mariaSlot = s; this.renderPlacementPanel(); },
            { color: this.mariaSlot === s ? 'primary' : 'secondary' }));
        if (this.mariaBuildNo != null && this.mariaSlot) {
            sb.addActionButton(_('Submit'), () => this.submitMariaDraft(), { color: 'primary' });
        }
        sb.addActionButton(_('Cancel Maria'), () => {
            this.mariaActive = false; this.mariaBuildNo = null; this.mariaSlot = null; this.renderPlacementPanel();
        }, { color: 'alert' });
    }

    private submitMariaDraft() {
        if (this.selectedDraftId == null || !this.onDraftComplete || this.mariaBuildNo == null || !this.mariaSlot) return;
        const placement: DraftPlacement = {
            build_no: this.mariaBuildNo,
            slot: this.mariaSlot,          // the chosen (any) orientation for this regular card
            floating_patch_slot: '',
            use_maria: 1,
        };
        const id = this.selectedDraftId;
        const cb = this.onDraftComplete;
        this.clearDraftSelection();
        this.renderDraftPool();
        this.bga.statusBar.removeActionButtons();
        this.renderKnitting(this.myId);
        cb(id, placement);
    }

    /** Billy's a Brute: two-button prompt for the owner to draft-and-discard first, or pass. */
    public beginBillyChoice(onActivate: () => void, onPass: () => void) {
        const sb = this.bga.statusBar;
        sb.removeActionButtons();
        sb.setTitle(_('Play Billy\'s a Brute to draft (and discard) first, or pass'));
        sb.addActionButton(_('Play Billy\'s a Brute'), () => onActivate(), { color: 'primary' });
        sb.addActionButton(_('Pass'), () => onPass(), { color: 'secondary' });
    }

    public endBillyChoice() {
        this.bga.statusBar.removeActionButtons();
    }

    /** Tina Can Tink: begin the round-end move/swap flow (owner only). */
    public beginTinaTink(
        onMove: (cardId: number, buildNo: number, slot: string) => void,
        onSwap: (cardA: number, cardB: number) => void,
        onSkip: () => void,
    ) {
        this.onTinaMove = onMove;
        this.onTinaSwap = onSwap;
        this.onTinaSkip = onSkip;
        this.tinaMode = null;
        this.tinaSelA = null; this.tinaSelB = null;
        this.tinaBuildNo = null; this.tinaSlot = null;
        this.renderTinaPanel();
    }

    public endTinaTink() {
        this.onTinaMove = null; this.onTinaSwap = null; this.onTinaSkip = null;
        this.tinaMode = null;
        this.tinaSelA = null; this.tinaSelB = null;
        this.tinaBuildNo = null; this.tinaSlot = null;
        this.clearTinaSelectableUI();
        this.bga.statusBar.removeActionButtons();
    }

    private renderTinaPanel() {
        const sb = this.bga.statusBar;
        sb.removeActionButtons();
        this.renderKnitting(this.myId);

        if (this.tinaMode === null) {
            sb.setTitle(_('Play Tina Can Tink: move a piece, swap two pieces, or pass'));
            sb.addActionButton(_('Move a piece'), () => { this.tinaMode = 'move'; this.tinaSelA = null; this.renderTinaPanel(); }, { color: 'primary' });
            sb.addActionButton(_('Swap two pieces'), () => { this.tinaMode = 'swap'; this.tinaSelA = null; this.tinaSelB = null; this.renderTinaPanel(); }, { color: 'primary' });
            sb.addActionButton(_('Pass'), () => this.onTinaSkip?.(), { color: 'secondary' });
            return;
        }

        this.attachTinaClickHandlers();

        if (this.tinaMode === 'move') {
            if (this.tinaSelA == null) {
                sb.setTitle(_('Click the piece to move'));
            } else {
                sb.setTitle(_('Choose where to move it'));
                const { buildNos } = this.myBuilds();
                sb.addActionButton(_('+ New sweater'), () => { this.tinaBuildNo = 0; this.renderTinaPanel(); }, { color: this.tinaBuildNo === 0 ? 'primary' : 'secondary' });
                buildNos.forEach((b) => sb.addActionButton(`${_('Sweater')} ${b}`, () => { this.tinaBuildNo = b; this.renderTinaPanel(); }, { color: this.tinaBuildNo === b ? 'primary' : 'secondary' }));
                ['L', 'R', 'B'].forEach((s) => sb.addActionButton(s, () => { this.tinaSlot = s; this.renderTinaPanel(); }, { color: this.tinaSlot === s ? 'primary' : 'secondary' }));
                if (this.tinaBuildNo != null && this.tinaSlot) {
                    sb.addActionButton(_('Confirm move'), () => this.onTinaMove?.(this.tinaSelA!, this.tinaBuildNo!, this.tinaSlot!), { color: 'primary' });
                }
            }
        } else { // swap
            if (this.tinaSelA == null) sb.setTitle(_('Click the first piece to swap'));
            else if (this.tinaSelB == null) sb.setTitle(_('Click the second piece to swap'));
            else {
                sb.setTitle(_('Swap these two pieces?'));
                sb.addActionButton(_('Confirm swap'), () => this.onTinaSwap?.(this.tinaSelA!, this.tinaSelB!), { color: 'primary' });
            }
        }
        sb.addActionButton(_('Back'), () => {
            this.tinaMode = null; this.tinaSelA = null; this.tinaSelB = null; this.tinaBuildNo = null; this.tinaSlot = null;
            this.renderTinaPanel();
        }, { color: 'secondary' });
    }

    /** Make my placed knitting pieces clickable for Tina selection (highlight the chosen one/two). */
    private attachTinaClickHandlers() {
        this.clearTinaSelectableUI();
        this.cardArray(this.gamedatas.knitting)
            .filter((c) => Number(c.location_arg) === this.myId)
            .forEach((c) => {
                const el = document.getElementById(`ucs-card-${c.id}`);
                if (!el) return;
                el.classList.add('ucs-tina-selectable');
                if (Number(c.id) === this.tinaSelA || Number(c.id) === this.tinaSelB) el.classList.add('ucs-tina-chosen');
                (el as HTMLElement).onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.tinaClickPiece(Number(c.id)); };
            });
    }

    private tinaClickPiece(id: number) {
        if (this.tinaMode === 'move') {
            this.tinaSelA = id;
        } else if (this.tinaMode === 'swap') {
            if (this.tinaSelA == null) this.tinaSelA = id;
            else if (id === this.tinaSelA) this.tinaSelA = null;
            else this.tinaSelB = id;
        }
        this.renderTinaPanel();
    }

    private clearTinaSelectableUI() {
        document.querySelectorAll('.ucs-tina-selectable').forEach((el) => {
            el.classList.remove('ucs-tina-selectable', 'ucs-tina-chosen');
            (el as HTMLElement).onclick = null;
        });
    }

    // ===================================================================================
    //  Round-end patch assignment — called by the AssignPatches state handler
    // ===================================================================================

    /** Begin assigning value+icon to my patches that sit in completed sweaters (round-end). */
    public beginAssignPatches(cardIds: number[], onAssign: (cardId: number, value: number, icon: string) => void) {
        this.onAssignPatch = onAssign;
        this.assignPending = [...cardIds];
        this.assignSel = {};
        this.renderKnitting(this.myId); // draws the glow + an inline picker beside each pending patch
        this.updateAssignTitle();
    }

    public endAssignPatches() {
        this.onAssignPatch = null;
        this.assignPending = [];
        this.assignSel = {};
        this.bga.statusBar.removeActionButtons();
        this.renderKnitting(this.myId); // drop the pickers / glow
    }

    /** Status-bar title for the assignment phase (no action buttons — the pickers are on the board). */
    private updateAssignTitle() {
        const sb = this.bga.statusBar;
        sb.removeActionButtons();
        if (!this.onAssignPatch) return;
        sb.setTitle(this.assignPending.length > 0
            ? _('Assign a value and icon to each of your patch cards')
            : _('Waiting for other players…'));
    }

    /**
     * The inline value/icon picker attached beside a pending patch (round-end). A row of values 1-12 and
     * a row of the four icons; each remembers its choice in `assignSel[cardId]`. Once both are chosen a
     * Confirm sends `actAssignPatch`, drops the patch from the pending set, and re-renders. `index`
     * offsets stacked pickers when one sweater holds more than one pending patch.
     */
    private makeAssignPicker(cardId: number, index: number): HTMLElement {
        const sel = (this.assignSel[cardId] ??= { value: null, icon: null });
        const pop = document.createElement('div');
        pop.className = 'ucs-assign-pop';
        if (index > 0) pop.style.top = `${index * 132}px`;

        const valRow = document.createElement('div');
        valRow.className = 'ucs-assign-row';
        for (let v = 1; v <= 12; v++) {
            const b = document.createElement('button');
            b.className = 'ucs-assign-opt' + (sel.value === v ? ' ucs-assign-chosen' : '');
            b.textContent = String(v);
            b.onclick = () => { sel.value = v; this.renderKnitting(this.myId); };
            valRow.appendChild(b);
        }

        const iconRow = document.createElement('div');
        iconRow.className = 'ucs-assign-row';
        this.material.icons.forEach((ic) => {
            const b = document.createElement('button');
            b.className = 'ucs-assign-opt ucs-assign-icon' + (sel.icon === ic ? ' ucs-assign-chosen' : '');
            b.innerHTML = `<span class="ucs-icon ucs-icon-${ic}"></span>`;
            b.title = ic;
            b.onclick = () => { sel.icon = ic; this.renderKnitting(this.myId); };
            iconRow.appendChild(b);
        });

        pop.appendChild(valRow);
        pop.appendChild(iconRow);

        if (sel.value != null && sel.icon != null) {
            const v = sel.value, ic = sel.icon, cb = this.onAssignPatch!;
            const confirm = document.createElement('button');
            confirm.className = 'ucs-assign-confirm';
            confirm.textContent = _('Confirm');
            confirm.onclick = () => {
                this.assignPending = this.assignPending.filter((id) => id !== cardId);
                delete this.assignSel[cardId];
                cb(cardId, v, ic);
                this.renderKnitting(this.myId);
                this.updateAssignTitle();
            };
            pop.appendChild(confirm);
        }

        return pop;
    }

    // ===================================================================================
    //  Round review (between-round pause) — called by the RoundReview state handler
    // ===================================================================================

    /**
     * Show the end-of-round scoring summary as a modal overlay (like the opponent-knitting popin), to
     * EVERY player simultaneously (RoundReview makes everyone active). Per player: each started sweater
     * (complete or not) with its per-component breakdown, plus their revealed Secret Santa(s) yes/no. The
     * Okay button acknowledges — once all players click, the next round deals. Rendered from the state
     * args, so it survives a refresh. A player who already acknowledged (non-active, e.g. F5 while
     * waiting) doesn't see it again.
     */
    public showRoundReview(detail: RoundReviewArgs, isCurrentPlayerActive: boolean, onContinue: () => void) {
        if (!isCurrentPlayerActive) { this.hideRoundSummary(); return; }
        this.bga.statusBar.removeActionButtons();
        this.renderRoundSummary(detail, () => {
            this.hideRoundSummary();
            this.bga.statusBar.setTitle(_('Waiting for other players…'));
            onContinue();
        });
    }

    /** Tear down the summary overlay when leaving RoundReview (next round is about to be dealt). */
    public endRoundReview() {
        this.bga.statusBar.removeActionButtons();
        this.hideRoundSummary();
    }

    private hideRoundSummary() {
        document.getElementById('ucs-score-popin')?.remove();
    }

    /**
     * Build the end-of-round scoring summary — an HTML recreation of the printed ScorePad: category rows
     * × (per player, per round) columns, filled cumulatively as rounds are scored. `onOkay` (if given)
     * wires the Okay button; without it the button just closes the overlay (used for the final round,
     * which has no RoundReview acknowledgement gate).
     */
    private renderRoundSummary(detail: Scorepad, onOkay?: () => void) {
        this.hideRoundSummary();
        const overlay = document.createElement('div');
        overlay.id = 'ucs-score-popin';
        overlay.className = 'ucs-popin ucs-score-popin';

        const backdrop = document.createElement('div');
        backdrop.className = 'ucs-popin-backdrop';
        overlay.appendChild(backdrop);

        const box = document.createElement('div');
        box.className = 'ucs-popin-box ucs-score-box';

        const fadTitle = detail.fad?.title ? ` · ${_('Fad')}: ${detail.fad.title}` : '';
        box.innerHTML =
            `<div class="ucs-scorepad-head">`
            + `<div class="ucs-scorepad-tree" role="presentation"></div>`
            + `<div class="ucs-scorepad-titles">`
            + `<div class="ucs-scorepad-title">${_('Ugly Christmas Sweaters Scoring')}</div>`
            + `<div class="ucs-scorepad-sub">${_('Round')} ${detail.round}${fadTitle}</div>`
            + `</div></div>`;

        const scroll = document.createElement('div');
        scroll.className = 'ucs-scorepad-scroll';
        scroll.appendChild(this.buildScorepadTable(detail));
        box.appendChild(scroll);

        const foot = document.createElement('div');
        foot.className = 'ucs-score-foot';
        const okay = document.createElement('button');
        okay.className = 'ucs-score-okay';
        okay.textContent = _('Okay');
        okay.onclick = () => { if (onOkay) onOkay(); else this.hideRoundSummary(); };
        foot.appendChild(okay);
        box.appendChild(foot);

        overlay.appendChild(box);
        this.bga.gameArea.getElement().appendChild(overlay);
    }

    /** The scorepad grid table: category rows down the left, per-player × per-round columns across. */
    private buildScorepadTable(detail: Scorepad): HTMLElement {
        const players = detail.players || [];
        const rounds = detail.rounds || [];
        const nRounds = Math.max(1, detail.totalRounds || 1);
        const cur = detail.round; // the round just scored — highlight its column

        // round number → recorded cell for a player (undefined = a round not yet scored → blank cell)
        const cellOf = (pid: number, r: number): ScorepadCell | undefined =>
            rounds.find((x) => x.round === r)?.players[pid];

        // Scoring-category rows (top block); `sum` totals the category across every recorded round.
        const cats: { key: keyof ScorepadCell; label: string; vp: string }[] = [
            { key: 'built', label: _('Each Sweater Built'), vp: '+2 VP' },
            { key: 'run', label: _('Three Consecutive Numbers'), vp: '+2 VP' },
            { key: 'fad', label: _('Fads'), vp: '+? VP' },
            { key: 'nonfad', label: _("All Matching 'Non-Fad' Colours and Icons"), vp: '+1 VP' },
            { key: 'ss', label: _('Secret Santa'), vp: '+3 VP' },
        ];
        if (detail.bonus) cats.push({ key: 'bonus', label: _('Bonus'), vp: '+3 VP' });

        const sumCat = (pid: number, key: keyof ScorepadCell): number =>
            rounds.reduce((acc, x) => acc + (Number(x.players[pid]?.[key]) || 0), 0);

        const roundCols = Array.from({ length: nRounds }, (_v, i) => i + 1);

        // ---- header: player group row, then per-player Round 1..N + Total sub-columns ----
        let html = '<table class="ucs-scorepad"><thead>';
        html += `<tr class="ucs-sp-players"><th class="ucs-sp-cat" rowspan="2"></th>`;
        players.forEach((p, i) => {
            html += `<th class="ucs-sp-pname ${i % 2 === 0 ? 'ucs-sp-alt' : ''}" colspan="${nRounds + 1}" `
                + `style="--player-color:${p.color ? '#' + p.color : '#555'}">${p.player_name}</th>`;
        });
        html += '</tr><tr class="ucs-sp-rounds">';
        players.forEach((p, i) => {
            roundCols.forEach((r) => {
                const c = ['ucs-sp-rc', i % 2 === 0 ? 'ucs-sp-alt' : '', r === cur ? 'ucs-sp-cur' : ''].join(' ');
                html += `<th class="${c}">${_('R')}${r}</th>`;
            });
            html += `<th class="ucs-sp-total-h ${i % 2 === 0 ? 'ucs-sp-alt' : ''}">${_('Total')}</th>`;
        });
        html += '</tr></thead><tbody>';

        // ---- scoring rows ----
        const cell = (v: number | undefined, extra = '') =>
            `<td class="ucs-sp-num ${extra}">${v === undefined ? '' : v}</td>`;
        cats.forEach((cat) => {
            html += `<tr class="ucs-sp-row"><th class="ucs-sp-cat"><span class="ucs-sp-lbl">${cat.label}</span>`
                + `<span class="ucs-sp-vp">${cat.vp}</span></th>`;
            players.forEach((p, i) => {
                roundCols.forEach((r) => {
                    const rec = cellOf(p.player_id, r);
                    const cls = [i % 2 === 0 ? 'ucs-sp-alt' : '', r === cur ? 'ucs-sp-cur' : ''].join(' ');
                    html += cell(rec ? Number(rec[cat.key]) : undefined, cls);
                });
                html += cell(sumCat(p.player_id, cat.key), `ucs-sp-total ${i % 2 === 0 ? 'ucs-sp-alt' : ''}`);
            });
            html += '</tr>';
        });

        // ---- TOTALS row: per-round contribution, Total column = running grand total (cumulative) ----
        html += `<tr class="ucs-sp-row ucs-sp-totals"><th class="ucs-sp-cat"><span class="ucs-sp-lbl">${_('TOTALS')}</span></th>`;
        players.forEach((p, i) => {
            let lastCum = 0;
            roundCols.forEach((r) => {
                const rec = cellOf(p.player_id, r);
                if (rec) lastCum = rec.cumulative;
                const cls = [i % 2 === 0 ? 'ucs-sp-alt' : '', r === cur ? 'ucs-sp-cur' : ''].join(' ');
                html += cell(rec ? rec.total : undefined, cls);
            });
            html += cell(lastCum, `ucs-sp-total ${i % 2 === 0 ? 'ucs-sp-alt' : ''}`);
        });
        html += '</tr>';

        // ---- informational footer counts (not summed into VP) ----
        const foot: { key: keyof ScorepadCell; label: string }[] = [
            { key: 'unfinished', label: _('# of Unfinished Sweaters') },
            { key: 'fadsCompleted', label: _('# of Fads Completed') },
        ];
        foot.forEach((f) => {
            html += `<tr class="ucs-sp-row ucs-sp-foot"><th class="ucs-sp-cat"><span class="ucs-sp-lbl">${f.label}</span></th>`;
            players.forEach((p, i) => {
                roundCols.forEach((r) => {
                    const rec = cellOf(p.player_id, r);
                    const cls = [i % 2 === 0 ? 'ucs-sp-alt' : '', r === cur ? 'ucs-sp-cur' : ''].join(' ');
                    html += cell(rec ? Number(rec[f.key]) : undefined, cls);
                });
                html += cell(sumCat(p.player_id, f.key), `ucs-sp-total ${i % 2 === 0 ? 'ucs-sp-alt' : ''}`);
            });
            html += '</tr>';
        });

        html += '</tbody></table>';
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        return wrap.firstElementChild as HTMLElement;
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
        const mine = Number(args.player_id) === this.myId;
        // Capture where the card starts BEFORE any DOM changes: my own play launches from its card in
        // the hand fan; an opponent's play launches from their on-table player panel on the right.
        const handEl = mine ? document.getElementById(`ucs-hand-${id}-front`) : null;
        const fromMine = handEl ? handEl.getBoundingClientRect() : null;

        this.gamedatas.trick[id] = args.card;
        // If it left my hand, drop it; either way the player's hand count decreases.
        delete this.gamedatas.hand[id];
        if (this.gamedatas.counts?.[args.player_id]) {
            this.gamedatas.counts[args.player_id].hand = Math.max(
                0, this.gamedatas.counts[args.player_id].hand - 1
            );
        }
        // Only my own hand changes visually; slide the played card out of the fan (other players' plays
        // don't touch my stock). disablePlayable on state-leave clears any lingering selection.
        if (mine && this.handStock) {
            this.handStock.removeCard(args.card).catch(() => {});
        }
        this.renderTradeArea();

        // Animate the freshly-rendered Trade Area card in from its origin.
        const el = document.getElementById(`ucs-card-${id}`);
        let from: { left: number; top: number; width: number; height: number } | null = fromMine;
        if (!from && el) {
            const panel = document.getElementById(`ucs-player-${args.player_id}`);
            if (panel) {
                const now = el.getBoundingClientRect();
                from = this.cardRectAtCenter(panel, now.width, now.height);
            }
        }
        await this.flipCardFrom(el, from, 0.5);
    }

    /** A card was drafted from the pool into a player's knitting area (possibly placed over a piece). */
    async notif_cardDrafted(args: NotifCardDrafted) {
        const id = Number(args.card_id);
        // Capture the card's spot in the Draft Pool BEFORE the re-render — the flight origin.
        const poolEl = document.getElementById(`ucs-card-${id}`);
        const from = poolEl ? poolEl.getBoundingClientRect() : null;

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

        // Fly the card from the pool into its knitting slot: my own area renders it full-size
        // (`ucs-card-<id>`); an opponent's inline area renders a compact chip (`ucs-mini-<id>`).
        const dest = document.getElementById(`ucs-card-${id}`) ?? document.getElementById(`ucs-mini-${id}`);
        await this.flipCardFrom(dest, from, 0.5);
    }

    /** Round-end: a player set a patch's value + icon — re-render it with its chosen face. */
    async notif_patchAssigned(args: NotifPatchAssigned) {
        const id = Number(args.card_id);
        this.gamedatas.knitting[id] = args.card;
        this.renderKnitting(args.player_id);
    }

    /** The trick resolved into a draft order; deal the Draft Order cards onto the Trade Area. */
    async notif_draftOrder(args: NotifDraftOrder) {
        this.dealDraftOrder(args.orderCards ?? []);
    }

    /** End of trick: the trade area becomes the new draft pool; counts resync. */
    async notif_trickCleanup(args: NotifTrickCleanup) {
        // Capture where the cards sit NOW (trade area + any leftover pool card) so we can slide them from
        // there up into the new Draft Pool after the re-render (FLIP animation below).
        const oldRects: { [id: number]: DOMRect } = {};
        [...this.cardArray(this.gamedatas.trick), ...this.cardArray(this.gamedatas.draftpool)].forEach((c) => {
            const el = document.getElementById(`ucs-card-${c.id}`);
            if (el) oldRects[Number(c.id)] = el.getBoundingClientRect();
        });
        // Render the new pool in the Trade Area's left-to-right order, so each card lands directly below
        // where it sat and the FLIP below is a straight vertical slide (the server dropped trick_order).
        this.poolRenderOrder = Object.keys(oldRects)
            .map(Number)
            .sort((a, b) => oldRects[a].left - oldRects[b].left);

        const pool: CardMapT = {};
        args.pool.forEach((c) => (pool[Number(c.id)] = c));
        this.gamedatas.draftpool = pool;
        this.gamedatas.trick = {};
        this.gamedatas.counts = args.counts;
        this.renderDraftPool();
        this.renderTradeArea();
        this.renderPlayers();
        this.renderPiles();
        // Slide the collected cards from the Trade Area up into their new Draft Pool spots (~2s, together).
        this.animateTradeToPool(oldRects);
        // Drafting is done: the order is spent, so its markers go.
        this.hideDraftOrder();
    }

    /**
     * FLIP-animate the just-collected cards from their old (Trade Area) positions to their new Draft Pool
     * positions. The pool has already been re-rendered, so each `ucs-card-<id>` is at its final spot; we
     * offset it back to where it was via a transform, then transition that transform to 0 over ~2s so
     * they all glide up together. Deltas are divided by the tabletop scale (same as the Draft Order
     * overlay) so it's correct under any transform BGA applies.
     */
    private animateTradeToPool(oldRects: { [id: number]: DOMRect }) {
        if (!this.bga.gameui.bgaAnimationsActive?.()) return;
        const table = document.getElementById('ucs-table');
        const scale = (table && table.offsetWidth)
            ? table.getBoundingClientRect().width / table.offsetWidth : 1;
        Object.keys(oldRects).forEach((key) => {
            const el = document.getElementById(`ucs-card-${key}`);
            if (!el) return; // card isn't in the new pool (shouldn't happen) — skip
            const now = el.getBoundingClientRect();
            const old = oldRects[Number(key)];
            const dx = (old.left - now.left) / scale, dy = (old.top - now.top) / scale;
            if (!dx && !dy) return;
            el.style.transition = 'none';
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            void el.offsetWidth; // force reflow so the starting transform takes effect
            requestAnimationFrame(() => {
                el.style.transition = 'transform 2s ease';
                el.style.transform = '';
            });
            setTimeout(() => { el.style.transition = ''; el.style.transform = ''; }, 2100);
        });
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
     * Public: a new round (2-3) was dealt. Replace the public board wholesale from the fresh deal — new
     * draft pool, revealed parameters, resynced counts, and a wiped knitting area — then re-render. The
     * receiving player's own hand + Secret Santa arrive privately in notif_newRoundPrivate.
     */
    async notif_newRound(args: NotifNewRound) {
        const pool: CardMapT = {};
        args.pool.forEach((c) => (pool[Number(c.id)] = c));
        this.gamedatas.draftpool = pool;
        this.gamedatas.trick = {};
        const knit: CardMapT = {};
        args.knitting.forEach((c) => (knit[Number(c.id)] = c));
        this.gamedatas.knitting = knit;
        this.gamedatas.gameplay = args.gameplay;
        this.gamedatas.counts = args.counts;
        this.gamedatas.roundNo = args.round;
        this.gamedatas.leaderId = args.leaderId;
        this.gamedatas.draftOrderCards = [];
        this.poolRenderOrder = null; // carry-over pool: order by draft slot, not the last trick's layout
        this.showHandEndBanner(false);
        this.hideDraftOrder();
        this.renderAll();
    }

    /** Private: my new hand + freshly dealt Secret Santa(s) for the new round. */
    async notif_newRoundPrivate(args: NotifNewRoundPrivate) {
        const hand: CardMapT = {};
        args.hand.forEach((c) => (hand[Number(c.id)] = c));
        this.gamedatas.hand = hand;
        const ss: CardMapT = {};
        args.secretSanta.forEach((c) => (ss[Number(c.id)] = c));
        this.gamedatas.secretSanta = ss;
        this.renderHand();
        this.renderSecretSanta();
    }

    /** Re-render every player's Bonus card chip from gamedatas.bonus. */
    private refreshBonusChips() {
        Object.values(this.gamedatas.players).forEach((p) => this.renderBonus(Number(p.id)));
    }

    /** A bonus card was spent (Maria / Billy / Tina) or an objective scored (Little Brothers). */
    async notif_bonusUsed(args: NotifBonusUsed) {
        this.gamedatas.bonus = args.bonus ?? this.gamedatas.bonus;
        this.refreshBonusChips();
    }

    /** Round scoring may have spent the Little Brothers objective — refresh the chips. */
    async notif_bonusUpdate(args: NotifBonusUsed) {
        this.gamedatas.bonus = args.bonus ?? this.gamedatas.bonus;
        this.refreshBonusChips();
    }

    /** Billy's a Brute: a drafted card was discarded — drop it from the pool. */
    async notif_cardDiscarded(args: NotifCardDiscarded) {
        delete this.gamedatas.draftpool[Number(args.card_id)];
        this.renderDraftPool();
    }

    /** Tina Can Tink: a player re-arranged their knitting — replace their pieces and re-render. */
    async notif_tinaResolved(args: NotifTinaResolved) {
        // Drop this player's existing knitting entries, then load the fresh ones.
        Object.values(this.gamedatas.knitting)
            .filter((c) => Number(c.location_arg) === Number(args.player_id))
            .forEach((c) => { delete this.gamedatas.knitting[Number(c.id)]; });
        args.knitting.forEach((c) => (this.gamedatas.knitting[Number(c.id)] = c));
        this.gamedatas.bonus = args.bonus ?? this.gamedatas.bonus;
        this.renderKnitting(Number(args.player_id));
        this.renderBonus(Number(args.player_id));
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
     * A round was scored. Non-final rounds show the scoring-summary overlay from the RoundReview state
     * (all players, Okay = acknowledge → next round). The FINAL round has no RoundReview state, so show
     * the summary here with a close-only Okay before the game moves to the end screen.
     */
    async notif_roundScored(args: NotifRoundScored) {
        // The draft phase is over and we're moving on — the "last trick" banner is spent.
        this.showHandEndBanner(false);
        if (args.round >= this.gamedatas.totalRounds) {
            this.renderRoundSummary(args); // final round: no acknowledgement gate, Okay just closes it
        }
    }

    /** The hand's end was triggered mid-draft (a player completed their Nth sweater): show the banner
     * for the remaining drafts of this last trick. It's hidden again on notif_roundScored / a new round. */
    async notif_handEnding(_args: unknown) {
        this.showHandEndBanner(true);
    }

    /** Toggle the red "last trick & draft phase of this hand" banner across the top of the table. */
    private showHandEndBanner(show: boolean) {
        const el = document.getElementById('ucs-hand-end-banner');
        if (el) el.style.display = show ? 'block' : 'none';
    }
}
