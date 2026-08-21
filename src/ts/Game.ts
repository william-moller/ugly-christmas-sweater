import { PlayCard } from "./States/PlayCard";
import { DraftCard } from "./States/DraftCard";
import { RoundReview } from "./States/RoundReview";
import { AssignPatches } from "./States/AssignPatches";
import { BillyChoice } from "./States/BillyChoice";
import { TinaTink } from "./States/TinaTink";
import { createCardElement, cardTooltip, cardLogChip, faceOf, isPatch, cardFaceInner, faceSpriteClass, colourName, iconName, trendyLogChip, fadTooltip, secretSantaTooltip } from "./CardView";
import { BgaAnimations, BgaCards, BgaHelp } from "./libs";

type CardMapT = { [cardId: number]: SweaterCard };

export class Game {
    public bga: Bga<UglyChristmasSweaterPlayer, UglyChristmasSweaterGamedatas>;
    private gamedatas: UglyChristmasSweaterGamedatas;

    // Selection state for the active player (set by the PlayCard / DraftCard state handlers).
    private playableIds: number[] = [];
    private refreshingSelectable = false; // re-entrancy guard for refreshSelectable
    private handSync: Promise<void> = Promise.resolve(); // serialises HandStock resyncs — see renderHand
    private onPlay: ((cardId: number, copyFromCardId: number) => void) | null = null;
    private selectedPlayId: number | null = null;
    // The played card's on-screen rect captured at Confirm time (keyed by card id), so the trade-area
    // flight launches from exactly where the card sat when the user acted. Capturing later (in
    // notif_cardPlayed) is too late: by then disablePlayable has run and the floating hand has toggled
    // back to attached, moving the card — the flight would start from a stale, wrong spot.
    private playFromRect: { [cardId: number]: DOMRect } = {};
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

    // Round-end patch assignment (AssignPatches state): the patch card ids I still owe an assignment, in
    // the order they're worked through — [0] is the one glowing and holding the picker — plus the
    // in-progress value/icon choice per patch (keyed by card id; a choice survives until its Confirm).
    private onAssignPatch: ((cardId: number, value: number, icon: string) => void) | null = null;
    private assignPending: number[] = [];
    private assignSel: { [cardId: number]: { value: number | null; icon: string | null } } = {};

    // The narrow/wide boundary, built once from wideLayoutFloor() — see narrowMq().
    private narrowMqCache: MediaQueryList | null = null;

    // Round summary minimize/restore: the pending end-of-animation timer, so a fast minimize→restore
    // can't have the earlier click's timer land afterwards (see setRoundSummaryMinimized).
    private sheetAnimTimer: number | null = null;
    private static readonly SHEET_ANIM_MS = 220; // keep in step with $ucs-sheet-anim in Game.scss

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
        this.gamedatas = gamedatas;

        const playerCount = Object.keys(gamedatas.players).length;
        // Cards played into a trick before the draft = players × cards-each: each player plays 2 in a 2P
        // game, 1 otherwise (mirrors Game.php::cardsPerTurn), so 2P→4, 3P→3, 4P→4. The Trade Area frame is
        // drawn for exactly this many slots so it never grows as the trick fills (see #ucs-trade-area).
        const trickSize = playerCount === 2 ? 4 : playerCount;

        this.bga.gameArea.getElement().insertAdjacentHTML('beforeend', `
            <div id="ucs-table" class="ucs-players-${playerCount}${gamedatas.express ? ' ucs-express' : ''}${gamedatas.avid ? ' ucs-avid' : ''}" style="--ucs-players:${playerCount};--ucs-trick-size:${trickSize}">
                <div id="ucs-hand-end-banner" class="ucs-hand-end-banner" style="display:none">
                    ${_('Last trick and draft phase of this hand — the round ends after this draft.')}
                </div>
                <!-- Upper region (see #ucs-upper in Game.scss): a left board strip, the centre trick, and
                     the right column (#ucs-right-col: the opponents, with the Round Tracker stacked over
                     them in 3P Express — see layoutNarrowSidebar). The board strip stacks a single row of
                     round-parameter cards — Fads then Perfect Fit + Trendy Yarn, all one size
                     (renderGameplay) — over my Secret Santa. My full-width Knitting Area sits in
                     #ucs-lower beneath it all, alongside the Round Tracker in every other game.
                     On a narrow window these stack into one column. NB no backticks in
                     here - this is a template literal. -->
                <div id="ucs-upper">
                    <div id="ucs-board-strip">
                        <div id="ucs-gameplay" class="ucs-zone"></div>
                        <div id="ucs-secret-santa" class="ucs-zone ucs-secret-santa" style="display:none"></div>
                        <div id="ucs-my-santa" class="ucs-my-santa" style="display:none"></div>
                    </div>
                    <div id="ucs-center-stack">
                        <div id="ucs-draft-pool" class="ucs-zone"></div>
                        <div id="ucs-trade-area" class="ucs-zone"></div>
                    </div>
                    <div id="ucs-right-col"><div id="ucs-opponents"></div></div>
                </div>
                <div id="ucs-lower">
                    <div id="ucs-rt-col"></div>
                    <div id="ucs-my-area" class="ucs-zone"></div>
                </div>
                <div id="ucs-placement" class="ucs-zone" style="display:none"></div>
                <div id="ucs-my-hand-wrap" class="ucs-zone">
                    <div class="ucs-zone-label" id="ucs-hand-label">${_('Your hand')}</div>
                    <div id="ucs-my-hand-row">
                        <div id="ucs-my-pile" class="ucs-draw-pile ucs-my-pile"></div>
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
                    <div class="ucs-avid-revealed" id="ucs-avid-ss-${player.id}" style="display:none"></div>
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

        // Expose the client for console diagnosis (`ucs.debugHand()`). The alternative is pasting long
        // probes into a console that may be pointed at the lobby page, where every lookup silently
        // returns null — this is always reachable from the board itself. Matches the existing
        // "DEBUG: dump state" affordance; harmless read-only handle.
        (window as any).ucs = this;

        this.renderAll();

        // Express narrow-view: relocate the Round Tracker + opponents into a right-hand sidebar beside the
        // parameter row on small screens (see layoutNarrowSidebar). Runs after renderAll so the containers
        // are populated; it moves the containers, not their contents.
        this.setupNarrowSidebar();

        // Draft Order: markers are drawn into the Trade Area cards themselves, so there's nothing to
        // place here. The active state's handler (PlayCard / DraftCard onEnteringState, which fires
        // right after setup — including on an F5) syncs them to the correct idle/dealt picture.
        this.draftOrderCardIds = (gamedatas.draftOrderCards ?? []).map(Number);
        this.draftOrderMode = 'idle';

        // Restore the "last trick & draft phase" banner if this hand's end is already triggered (e.g. an
        // F5 mid-final-draft). Live-computed server-side, so it's absent again once the next round deals.
        this.showHandEndBanner(!!gamedatas.handEndTriggered);

        // Re-lay the hand fan live when the "Hand sort order" preference (102) changes — it is not
        // needReload. Card size (101) IS needReload, so BGA re-runs setup wholesale for it and it needs
        // no live handler; the confirm gate (100) is read on demand at action time, likewise none.
        if (this.bga.userPreferences) {
            this.bga.userPreferences.onChange = (prefId: number) => {
                if (Number(prefId) === 102) this.renderHand();
            };
        }

        this.setupNotifications();
        this.maybeAddDebugButton();
        this.setupHelpButton();

        // Draw-pile tooltip via BGA's system (the container persists across renderPiles() refreshes,
        // so one attach holds). Replaces the old native title= so it matches every other UCS tooltip.
        this.addTip('ucs-my-pile', `<b>${_('Your draw pile')}</b><br>`
            + _('Your personal face-down deck. After each trick you draw back up to a full hand from here. Once it runs out, your hand starts to shrink.'));
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
    /** Multiplier for the HAND's card frame, keyed off the "Card size" preference (gamepreferences 101).
     *  It tracks the preference but is capped BELOW the tabletop's Large (1.4 against cardSizeScale's
     *  1.5): the fanned hand floats at the BOTTOM of the viewport, so the taller the frame the closer it
     *  runs to the bottom edge, where it looks cropped. That gap is the cap, not a copy that drifted —
     *  do NOT collapse this into cardSizeScale(). Both read cardSizePref(), so neither can be caught by
     *  a not-yet-applied html.ucs-cards-* class.
     *
     *  Only consulted above 700px. Below that handCardWidth derives the frame from the viewport instead,
     *  for the same reason every other narrow zone is preference-independent — see there. */
    private handSizeScale(): number {
        const size = this.cardSizePref();
        return size === 'large' ? 1.4 : size === 'small' ? 0.95 : 1;
    }

    /**
     * The fanned hand's card width.
     *
     * Wide viewports keep the tuned 96px base times the Card-size preference (handSizeScale). At phone
     * widths the fan spans the WHOLE viewport — the floating stock is pinned left and right, and the
     * library packs all HAND_SIZE cards into whatever box that leaves — so the width stops being a
     * preference and becomes a derivation from how much of each card must stay uncovered:
     *
     *     step = (band - W) / (HAND_SIZE - 1)
     *
     * The identifying strip on the printed art — the value numeral with the two orientation bulbs under
     * it — ends at ~22.4% of the card face (measured off the sprite: the numeral spans 8-22% and the
     * bulbs 13-22%). Requiring `step >= 0.224 W + 2` (that strip plus the card's own border) and
     * solving with HAND_SIZE = 9 gives
     *
     *     W <= (band - 24) / 2.8
     *
     * Capped at 144px ($card-w * 1.8). The hand gets its own ceiling rather than the Draft Pool's 128,
     * because it is the one zone you choose from under time pressure and the only one handed the full
     * width — it is *meant* to be the biggest card on a phone.
     *
     * `band` is MEASURED off the holder, not taken from window.innerWidth, and deliberately so. The
     * attached (in-flow) fan gets the holder — the table's content width — while the floating one gets
     * the viewport, so the holder is the narrower of the two states and sizing off it keeps the strip
     * uncovered in both. Measuring also means the number cannot disagree with the layout the way a
     * viewport-relative length can when the page has been stretched (see the max-width note at the top
     * of the .ucs-narrow block in Game.scss).
     *
     * Deliberately PREFERENCE-INDEPENDENT below 700px, like every other narrow zone (responsive.md,
     * "Upper caps"): at Large the old 96 * 1.4 = 134px puts the step at 19% of the card, which clips the
     * numeral off every card but the last — the preference would make the hand *less* readable, not more.
     *
     * The band is the full viewport on purpose. Reserving width for the bottom-corner buttons instead is
     * the wrong lever: taking ~176px out of a 411px band costs card width faster (W <= band/3.4) than it
     * buys clearance. The buttons are cleared vertically instead — see fanLift.
     */
    private handCardWidth(): number {
        if (window.innerWidth > 700) return Math.round(96 * this.handSizeScale());
        // The holder is in flow and full-width, so it measures the table's content width. Guard against
        // a not-yet-laid-out box (it would collapse the hand to nothing) by falling back to the viewport.
        const holder = document.getElementById('ucs-my-hand')?.getBoundingClientRect().width ?? 0;
        const band = Math.min(window.innerWidth, holder > 200 ? holder : Infinity);
        return Math.min(144, Math.floor((band - 24) / 2.8));
    }

    private setupHandStock() {
        // One integer size for BOTH the library's card frame (cardWidth/cardHeight below) and the CSS face
        // sprite (#ucs-my-hand-wrap's --ucs-card-w/h, set here). Driving them from the same rounded value
        // guarantees they match exactly — any px mismatch places the sprite in a differently-sized frame.
        const handW = this.handCardWidth();
        const handH = Math.round(handW * 149 / 96); // the tuned base frame's ratio
        const handWrap = document.getElementById('ucs-my-hand-wrap');
        if (handWrap) {
            handWrap.style.setProperty('--ucs-card-w', `${handW}px`);
            handWrap.style.setProperty('--ucs-card-h', `${handH}px`);
        }
        this.animationManager = new BgaAnimations.Manager({
            animationsActive: () => this.bga.gameui.bgaAnimationsActive(),
        });
        this.cardsManager = new BgaCards.Manager({
            animationManager: this.animationManager,
            type: 'ucs-sweater',
            // The hand is the primary interaction on a desktop table, so its cards run larger than the
            // 64/90 used elsewhere. Base 96/149, grown by the "Card size" preference on a wide viewport
            // and derived from the viewport itself on a phone — see handCardWidth. handW/handH also drive
            // #ucs-my-hand-wrap's --ucs-card-w/h so the sprite face and this frame stay the same size; a
            // mismatch places the sprite in a differently-sized frame and clips it. A CSS transform on the
            // holder is still forbidden — it breaks the floating (position:fixed) hand (see #ucs-my-hand).
            // updateCardPositions overlaps the fan harder when it would exceed the stock width, so one
            // size fits every window with no per-width shrink.
            cardWidth: handW,
            cardHeight: handH, // bridge ratio 0.643 + #ucs-my-hand-wrap's --ucs-card-h
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
            // This is a MINIMUM overlap (the widest the fan may spread), not a fixed one — the library
            // tightens it on its own when the cards would not fit. So it does not need lowering for
            // narrow windows; forcing a bigger value there only wasted space when there was room.
            cardOverlap: 30,
            emptyHandMessage: _('Hand is empty'),
            // Lift the floating (position:fixed) hand above the Draft Order overlay (z-index 50) so the
            // dealt rank cards never paint over the player's fanned hand. Stays below the popin (1000).
            // 900 rather than 100: BGA's own bottom-corner controls (the "?" help button, chat, replay)
            // sit in that strip on a narrow window, and anything of theirs stacking above the fan
            // swallows the clicks on it — the cards look fine and simply don't respond.
            floatZIndex: 900,
            // Zero on purpose, twice over. These do not pad a centred fan — the library left-pins the
            // stock at floatLeftMargin, so a non-zero value simply shoves the whole hand right (measured:
            // a 40px margin put the stock's left edge at x=39); placeFan re-centres it instead. And the
            // fan WANTS the whole viewport on a phone: these two options are what its width math reads,
            // so reserving the bottom-corner buttons here would shrink every card to protect the two end
            // ones (see handCardWidth). The buttons are cleared vertically, by fanLift.
            floatLeftMargin: 0,
            floatRightMargin: 0,
            // Keep the fan sorted (colour then value) so a card drawn on refill slides into its correct
            // position rather than tacking onto the end — see notif_handUpdate's incremental addCards.
            sort: this.handSort.bind(this),
        });
        this.handStock.setSelectionMode('none');
        this.handStock.onSelectionChange = (selection: SweaterCard[], last: SweaterCard | null) =>
            this.handSelectionChanged(selection, last);

        // bga-cards' fanned HandStock settles each card at its add-time angle (a lopsided ramp), and its
        // own updateCardPositions() re-layout doesn't correct it for our populate flow. Chain our
        // symmetric re-lay (applySymmetricFan) onto that method so it runs right after every library
        // re-layout — add, remove, and the float-toggle that fires while scrolling — so the arc is
        // correct in every state. Idempotent + guarded: a future lib rename simply skips the patch.
        const stock: any = this.handStock;
        if (typeof stock.updateCardPositions === 'function' && !stock.__ucsFanPatched) {
            const original = stock.updateCardPositions.bind(stock);
            // Also the hook that renews the selectable marking after a refill — see refreshSelectable.
            stock.updateCardPositions = () => { original(); this.applySymmetricFan(); this.refreshSelectable(); };
            stock.__ucsFanPatched = true;
        }
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
        this.renderAvidRevealed();
        this.renderDraftPool();
        this.renderTradeArea();
        this.renderPlayers();
        this.renderPiles();
        this.renderHand();
    }

    /**
     * Avid: each player's publicly revealed satisfied Secret Santas, shown face-up in their area. A Secret
     * Santa is revealed the round its colour+icon request is first met by a completed sweater. OPPONENTS
     * ONLY — it's the only way to see what they've done, but for me it would repeat what my own Secret
     * Santa row already shows, where a completed one is ticked instead (see renderSecretSanta). Fed by
     * gamedatas.avidRevealed; hidden entirely outside Avid.
     */
    private renderAvidRevealed() {
        const revealed = this.gamedatas.avidRevealed ?? {};
        Object.values(this.gamedatas.players).forEach((player) => {
            const zone = document.getElementById(`ucs-avid-ss-${player.id}`);
            if (!zone) return;
            const list = revealed[Number(player.id)] ?? [];
            const mine = Number(player.id) === this.myId;
            if (mine || !this.gamedatas.avid || !list.length) { zone.style.display = 'none'; zone.innerHTML = ''; return; }
            zone.style.display = '';
            zone.innerHTML = `<span class="ucs-avid-revealed-label">${_('Completed Secret Santas')}</span>`;
            const row = document.createElement('div');
            row.className = 'ucs-avid-revealed-cards';
            list.forEach((ss) => {
                // A slot reserves the rotated (landscape) footprint so turned cards don't overlap — same
                // pattern as renderSecretSanta.
                const slot = document.createElement('div');
                slot.className = 'ucs-santa-slot';
                const el = document.createElement('div');
                el.className = `ucs-card ucs-santa-card ucs-avid-santa ucs-art2 ucs-santa-${ss.id}`;
                el.id = `ucs-avid-ss-${player.id}-${ss.id}`;
                // secretSantaTooltip wants a Material::secretSantas() entry; the revealed payload has the
                // same shape ({name, needs}) so it renders identically.
                this.addTip(el.id, secretSantaTooltip(ss));
                slot.appendChild(el);
                row.appendChild(slot);
            });
            zone.appendChild(row);
        });
    }

    /** My own Secret Santa objective(s) — 1 in Casual, 2 in Express, 3 in Avid (private; hidden from others).
     *  Casual/Avid render into the top `santa` grid slot; Express hands that slot to the Fad display and
     *  instead centres the Secret Santa card(s) in a row directly over my Knitting Area (#ucs-my-santa).
     *  Avid: one I've completed gets a green tick, which is the whole of my completion read-out — the
     *  knitting-area "Completed Secret Santas" block is opponents-only (see renderAvidRevealed). */
    private renderSecretSanta() {
        const express = !!this.gamedatas.express;
        const mySanta = document.getElementById('ucs-my-santa');
        const santaSlot = document.getElementById('ucs-secret-santa');
        // In Express the top slot belongs to the Fad display (see renderGameplay), so only touch #ucs-my-santa;
        // otherwise #ucs-my-santa is unused, so keep it hidden.
        if (!express && mySanta) { mySanta.style.display = 'none'; mySanta.innerHTML = ''; }
        const zone = express ? mySanta : santaSlot;
        if (!zone) return;
        const cards = Object.values(this.gamedatas.secretSanta ?? {});
        if (!cards.length) { zone.style.display = 'none'; return; }
        zone.style.display = '';
        zone.innerHTML = `<div class="ucs-zone-label" id="ucs-label-secretsanta">${_('Your Secret Santa')}</div>`;
        this.addTip('ucs-label-secretsanta', `<b>${_('Your Secret Santa')}</b><br>`
            + _('Hidden objective(s) only you can see. Build the pieces each one lists into your sweaters to score it at the end of the round.'));
        // Avid: which of mine are done. The revealed payload's `id` is the Material::secretSantas() index,
        // the same number as a card's type_arg — so they key against each other directly.
        const done = new Set((this.gamedatas.avidRevealed?.[this.myId] ?? []).map((ss) => Number(ss.id)));
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
            // The tick goes on the slot, not the card: the card is rotate(90deg) for the landscape art, and
            // anything inside it turns with it. The slot already reserves that landscape footprint upright.
            if (done.has(arg)) slot.appendChild(this.santaDoneTick());
            row.appendChild(slot);
        });
        zone.appendChild(row);
    }

    /** The green "completed" tick laid over one of my Secret Santa cards (Avid). */
    private santaDoneTick(): HTMLElement {
        const tick = document.createElement('div');
        tick.className = 'ucs-santa-done';
        tick.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true">`
            + `<circle class="ucs-santa-done-disc" cx="16" cy="16" r="14"/>`
            + `<path class="ucs-santa-done-mark" d="M9.5 16.4 L14 20.9 L22.5 11.6"/>`
            + `</svg>`;
        tick.setAttribute('aria-label', _('Completed'));
        return tick;
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
        // One row of same-size round-parameter faces: the Fads first, then the revealed Perfect Fit and
        // Trendy Yarn cards. No draw piles — the revealed card art carries its own printed title, so the
        // face-down decks (and their "N left" counts) are dropped to keep the strip a single tidy row.
        if (this.gamedatas.express) {
            const fadEl = this.fadDisplayEl(gp?.express); // the claimable Fad display (3+ cards under one label)
            fadEl.id = 'ucs-fad-zone'; // hook the round-end assignment dim keys off
            row.appendChild(fadEl);
        } else {
            // Casual/Avid: a single revealed Fad card in the same row.
            const fadEl = this.gameplayFaceEl('fad', gp?.fad?.active ?? null);
            fadEl.id = 'ucs-fad-zone';
            row.appendChild(fadEl);
        }
        // Perfect Fit + Trendy Yarn share a wrapper so the narrow-sidebar layout can stack them (Trendy
        // below Perfect Fit) in 3–4 player games; everywhere else the wrapper is a transparent flex row and
        // they read exactly as before (side by side after the Fads).
        const pftr = document.createElement('div');
        pftr.className = 'ucs-gp-pftr';
        pftr.appendChild(this.gameplayFaceEl('perfectfit', gp?.perfectfit?.active ?? null));
        pftr.appendChild(this.gameplayFaceEl('trendyyarn', gp?.trendyyarn?.active ?? null));
        row.appendChild(pftr);
        zone.appendChild(row);
        this.renderRoundTracker(this.gamedatas.express ? gp?.express : undefined);
    }

    /** Express: (re)draw the Round Tracker into #ucs-rt-col, wherever layoutNarrowSidebar has parked that
     *  column. Cleared for Casual/Avid, which have no tracker. */
    private renderRoundTracker(express: ExpressGameplay | undefined) {
        const col = document.getElementById('ucs-rt-col');
        if (!col) return;
        col.innerHTML = '';
        if (express) col.appendChild(this.roundTrackerEl(express));
    }

    /** Wire the narrow-view Round-Tracker sidebar (Express only — Casual/Avid have no tracker): lay it out
     *  now and again whenever the viewport crosses the 1000px boundary. Card size (gamepreferences 101) is
     *  needReload, so it can't change mid-session — width is the only live input, and a matchMedia listener
     *  covers it (no general resize handler needed). */
    private setupNarrowSidebar() {
        this.narrowMq().addEventListener('change', () => this.layoutNarrowSidebar());
        this.layoutNarrowSidebar();
    }

    /**
     * Viewport width at which this game's WIDE (three-column) layout becomes viable, from the formula in
     * .claude/responsive.md:
     *
     *     viewport = CARD × scale + FIXED + 263      (263 = BGA's own player-panel column + margins)
     *
     * Both inputs are fixed for the session — the content shape is the variant plus player count, and the
     * card-size preference is needReload — so this is ONE width per game, not a set of breakpoints. That
     * is what lets the narrow layout be a class rather than a media query, with the floors living here
     * only instead of being restated in Game.scss.
     *
     * Replaces a hardcoded 1000px that was below every shape's real floor (the cheapest, Casual at Small,
     * needs 1278), so the band above it rendered the wide layout squeezed — #ucs-board-strip is
     * flex: 0 0 auto, so #ucs-center-stack was what gave.
     *
     * CARD/FIXED per shape come from responsive.md's "Every shape, totalled". Avid uses the STACKED-Santa
     * numbers, which are what its wide layout costs when it first becomes viable — the unscaled Santa row
     * is an upgrade applied further up, at $avid-santa-row-floors in Game.scss. Express 3P likewise uses
     * its Santa-row cost, not the Santa-column fold ($santa-column-floors).
     *
     * CARD is now 320 (the Draft Pool, 4 x 80) for EVERY shape, because the board strip stopped reading
     * --ucs-card-scale: the round parameters and both Secret Santa zones are reference art you never
     * click, so they are pinned and moved wholesale from CARD into FIXED (see the #ucs-board-strip note
     * in Game.scss). Each shape's strip term, now part of FIXED:
     *
     *     Casual / Avid  parameter row 3 x 90                = 270  ->  FIXED 454 + 270 = 724
     *     Express 2P     parameter row 5 x 90                = 450  ->  FIXED 466 + 450 = 916
     *     Express 3P     Santa pair 2 x 188 (beats params)   = 376  ->  FIXED 388 + 376 = 764
     *     Express 4P     Santa pair 2 x 188 (beats params)   = 376  ->  FIXED 442 + 376 = 818
     *
     * Only the strip term moved; every other term is untouched, so this inherits whatever accuracy the
     * original table had rather than being a fresh derivation. Resulting floors, Small / Medium / Large:
     *
     *     Casual · Avid  1291 / 1307 / 1467      (was 1278 / 1307 / 1602)
     *     Express 2P     1483 / 1499 / 1659      (was 1461 / 1499 / 1884)
     *     Express 3P     1331 / 1347 / 1507      (was 1312 / 1347 / 1695)
     *     Express 4P     1385 / 1401 / 1561      (was 1366 / 1401 / 1749)
     *
     * Medium is unchanged by construction (scale 1 moves nothing), Small rises slightly — the strip no
     * longer shrinks below 90px — and Large drops 135-225px, which is the point: three of the four shapes
     * now reach the wide layout on a 1366-1536px laptop at Large, where before none did.
     */
    private wideLayoutFloor(): number {
        const scale = this.cardSizeScale();
        const count = Object.keys(this.gamedatas.players).length;
        const card = 320;                                     // Draft Pool, 4 x 80 — the only scaled term
        let fixed = 724;                                      // Casual, and Avid with its Santas stacked
        if (this.gamedatas.express) {
            if (count <= 2)       { fixed = 916; }             // 3 Fads → a five-card parameter row
            else if (count === 3) { fixed = 764; }
            else                  { fixed = 818; }
        }
        return Math.round(card * scale + fixed + 263);
    }

    /**
     * The Card-size preference (gamepreferences 101) as a size name. EVERY read of the card size goes
     * through here; callers map the name to their own multiplier.
     *
     * Read from the PREFERENCE, never from the html.ucs-cards-* class. That class is a `cssPref`, which
     * BGA applies on its own schedule, and it was NOT yet on <html> when setup() first called
     * wideLayoutFloor() — so a Large session computed the MEDIUM floor (1307), cached it in narrowMq()
     * for the whole session, and left the wide layout running below its real floor (1602) with no way to
     * recover. Symptom: at 1536px the Draft Pool wrapped to two rows, because #ucs-board-strip is
     * flex: 0 0 auto and #ucs-center-stack was what gave (529.6px against the 532px four Large cards
     * need). The CSS variable was unaffected — the cards were correctly Large — which is what made it
     * look like crowding rather than a boundary that never fired.
     *
     * handSizeScale() read the class directly and had the same hazard for the same reason: a Large
     * session whose class landed after setupHandStock() sized the fanned hand's frame for Medium (1.0)
     * and kept it all game, because the frame px are handed to bga-cards once at construction.
     *
     * The preference value arrives with the page from the server, so it has no such ordering hazard.
     * The class check stays as a fallback for any path where userPreferences isn't readable.
     */
    private cardSizePref(): 'small' | 'medium' | 'large' {
        const pref = Number(this.bga.userPreferences?.get?.(101));
        if (pref === 3) return 'large';
        if (pref === 2) return 'medium';
        if (pref === 1) return 'small';
        const c = document.documentElement.classList;
        return c.contains('ucs-cards-large') ? 'large' : c.contains('ucs-cards-small') ? 'small' : 'medium';
    }

    /** The TABLETOP card scale — the preference as its --ucs-card-scale multiplier. The hand runs on its
     *  own capped scale; see handSizeScale(). */
    private cardSizeScale(): number {
        const size = this.cardSizePref();
        return size === 'large' ? 1.5 : size === 'small' ? 0.95 : 1;
    }

    /** The narrow/wide boundary as a media query, built once from wideLayoutFloor(). */
    private narrowMq(): MediaQueryList {
        return (this.narrowMqCache ??= window.matchMedia(`(max-width: ${this.wideLayoutFloor() - 1}px)`));
    }

    /**
     * Express · viewport ≤ 1000px, at EVERY card size: tuck #ucs-rt-col (Round Tracker) and #ucs-opponents
     * into a right-hand #ucs-sidebar beside the parameter row (styled by the .ucs-narrow grid in
     * Game.scss), so the row stops spanning full width and the vertical stack shortens. Outside that mode,
     * return both containers to their wide-layout homes: the opponents to #ucs-right-col, and the Round
     * Tracker either above them there (3P Express, see rtTopRight) or bottom-left in #ucs-lower. Moves the
     * CONTAINERS by id, so renderRoundTracker() (targets #ucs-rt-col) and the opponent tables (appended
     * into #ucs-opponents) keep working wherever the containers currently live. Idempotent — safe to call
     * on every breakpoint change.
     */
    private layoutNarrowSidebar() {
        const table = document.getElementById('ucs-table');
        const upper = document.getElementById('ucs-upper');
        const rt = document.getElementById('ucs-rt-col');
        const oppo = document.getElementById('ucs-opponents');
        const santa = document.getElementById('ucs-my-santa');        // Express: my 2 objectives
        const santaOne = document.getElementById('ucs-secret-santa'); // Casual: 1 · Avid: 3
        const count = Object.keys(this.gamedatas.players).length;
        if (!table || !upper || !rt || !oppo) return;

        // Every variant and every card size. Two former exclusions, both policy rather than arithmetic:
        // Large (the sidebar sizes its cards off container queries — 100cqi in Game.scss — not off
        // --ucs-card-scale, so the preference never changed what fits), and Casual/Avid (which have no
        // Round Tracker to park, but do have opponents, and were left on the untuned vertical stack).
        const active = this.narrowMq().matches;

        // Which Secret Santa zone wants a full-width row rather than the parameter column: Express at
        // 3-4P (two landscape cards) and Avid (three). Casual's single card fits the column.
        const wideSanta = this.gamedatas.express ? santa : (this.gamedatas.avid ? santaOne : null);

        if (active) {
            let sidebar = document.getElementById('ucs-sidebar');
            if (!sidebar) {
                sidebar = document.createElement('div');
                sidebar.id = 'ucs-sidebar';
                upper.appendChild(sidebar);
            }
            sidebar.appendChild(rt);   // Round Tracker on top (empty in Casual/Avid — they have none)
            sidebar.appendChild(oppo); // opponents directly beneath it
            // Casual's single landscape Secret Santa goes in the sidebar too, under the opponents. Its
            // own row in the strip was a row for one card, and the sidebar column — derived in Game.scss
            // as whatever the parameter row leaves — is otherwise just a short opponent chip above a lot
            // of nothing. Express parks its pair differently (below) and Avid's three take a full-width
            // row of their own, so this is Casual only.
            if (!this.gamedatas.express && !this.gamedatas.avid && santaOne) sidebar.appendChild(santaOne);
            // Lift the wide Secret Santa zone out of the board strip so it can take a full-width grid row
            // of its own (grid-area: santa). The sidebar ends above this row, so left in the strip those
            // landscape cards wasted a sidebar's width of space. Express 2P and Casual keep theirs in the
            // strip — one settled layout, one single card.
            const lift = this.gamedatas.express ? (count >= 3 ? wideSanta : null) : wideSanta;
            if (lift && lift.parentElement !== upper) upper.appendChild(lift);
            table.classList.add('ucs-narrow');
        } else {
            // Restore the wide layout: opponents back into the right column, and the Round Tracker either
            // above them (3P Express) or bottom-left in #ucs-lower, before my Knitting Area.
            const right = document.getElementById('ucs-right-col');
            const lower = document.getElementById('ucs-lower');
            const myArea = document.getElementById('ucs-my-area');
            const strip = document.getElementById('ucs-board-strip');
            if (right && oppo.parentElement !== right) right.appendChild(oppo);
            // Secret Santa zones back into the board strip, in their original order: #ucs-gameplay,
            // #ucs-secret-santa, #ucs-my-santa. Appending #ucs-my-santa first gives the other one a
            // reference node to insert before, so the order holds however many were lifted.
            if (santa && strip && santa.parentElement !== strip) strip.appendChild(santa);
            if (santaOne && strip && santaOne.parentElement !== strip) strip.insertBefore(santaOne, santa);
            if (this.rtTopRight()) {
                if (right && rt.parentElement !== right) right.insertBefore(rt, oppo);
            } else if (lower && myArea && rt.parentElement !== lower) {
                lower.insertBefore(rt, myArea);
            }
            table.classList.remove('ucs-narrow');
            const sidebar = document.getElementById('ucs-sidebar');
            if (sidebar && sidebar.childElementCount === 0) sidebar.remove();
        }
    }

    /**
     * Does the Round Tracker belong in the top-right column (over the opponents) rather than bottom-left?
     * 3- and 4-player Express: there the board strip is folded into a compact block (Fads to a grid,
     * Perfect Fit under Trendy Yarn — see the .ucs-players-3 / -4 rules in Game.scss), and the tracker
     * fills the space that opens up beside the Draft Pool. It costs the right column no width — even at
     * Large it is narrower than an opponents panel. 2P Express keeps the tracker in #ucs-lower: its
     * parameter row is unfolded and already narrow, so there is no corner to reclaim.
     */
    private rtTopRight(): boolean {
        const count = Object.keys(this.gamedatas.players).length;
        return !!this.gamedatas.express && (count === 3 || count === 4);
    }

    /** A revealed round-parameter card on its own (no draw pile), for the single-row board strip. Wrapped
     *  so it lines up with the multi-card Fad display beside it. */
    private gameplayFaceEl(type: string, card: GameplayCard | null): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'ucs-gp-pile';
        const cards = document.createElement('div');
        cards.className = 'ucs-gp-cards';
        // Stable per-type id: this row holds exactly one face of each type, so `ucs-gp-face-<type>` is
        // unique and survives the innerHTML rebuild in renderGameplay.
        cards.appendChild(this.gameplayCardEl(type, card, `ucs-gp-face-${type}`));
        wrap.appendChild(cards);
        return wrap;
    }

    /**
     * Express Round Tracker: the printed 1–12 tracker card with an overlay that marks the current round
     * (a glowing halo ring on that wreath, `expressTrickNo + 1`) and pins a yarn badge on every wreath
     * where a new Trendy Yarn is drawn (every `rotateEvery`th — 3/6/9/12 in 2P, 4/8/12 in 3–4P). Wreath
     * centres are percentages of the (bleed-trimmed) card face, validated against the art.
     */
    private roundTrackerEl(express: ExpressGameplay | undefined): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'ucs-gp-pile ucs-rt-pile';
        wrap.innerHTML = `<div class="ucs-gp-label">${_('Round Tracker')}</div>`;

        const card = document.createElement('div');
        card.className = 'ucs-card ucs-art2 ucs-roundtracker ucs-rt-card';
        card.id = 'ucs-round-tracker';

        const rotateEvery = express?.rotateEvery ?? (Object.keys(this.gamedatas.players).length === 2 ? 3 : 4);
        const current = Math.min(Math.max((express?.trickNo ?? 0) + 1, 1), 12); // current round = completed + 1

        // Wreath centres as % of the card face (3 columns × 4 rows), matching the printed 1..12 grid.
        const colX = [22.3, 50.6, 79.5];
        const rowY = [26.8, 46.6, 66.4, 86.3];
        const overlay = document.createElement('div');
        overlay.className = 'ucs-rt-overlay';
        for (let n = 1; n <= 12; n++) {
            const cell = document.createElement('div');
            cell.className = 'ucs-rt-cell';
            cell.style.left = `${colX[(n - 1) % 3]}%`;
            cell.style.top = `${rowY[Math.floor((n - 1) / 3)]}%`;
            if (n === current) cell.classList.add('ucs-rt-now');
            else if (n < current) cell.classList.add('ucs-rt-past');
            if (n % rotateEvery === 0) {
                const yarn = document.createElement('div');
                yarn.className = 'ucs-rt-yarn';
                yarn.textContent = '🧶';
                cell.appendChild(yarn);
            }
            overlay.appendChild(cell);
        }
        card.appendChild(overlay);
        wrap.appendChild(card);

        this.addTip('ucs-round-tracker', `<b>${_('Round Tracker')}</b><br>`
            + _('The glowing wreath is the current round. A new Trendy Yarn card is revealed after every round marked with a yarn (🧶) — then the marker keeps moving.'));
        return wrap;
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

    /** A revealed gameplay card, drawn with its real publisher art (sprite via .ucs-art2).
     *  `domId` pins a stable element id (see gameplayFaceEl) so revealChangedParameters can find this
     *  face again after a re-render. It must be set BEFORE addTip: gpId() only generates an id when the
     *  element hasn't got one, and the tooltip binds by the id it was handed. Omitted for the Express Fad
     *  display, where several cards of one type share the row and no id would be unique. */
    private gameplayCardEl(type: string, card: GameplayCard | null, domId?: string): HTMLElement {
        const el = document.createElement('div');
        el.className = 'ucs-card ucs-gp-card';
        if (domId) el.id = domId;
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
        zone.innerHTML = `<div class="ucs-zone-label" id="ucs-label-draftpool">${_('Draft Pool')}</div>`;
        this.addTip('ucs-label-draftpool', `<b>${_('Draft Pool')}</b><br>`
            + _('The face-up cards up for grabs this trick. On your turn in Draft Order, take one and place it into your Knitting Area.'));
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
        zone.innerHTML = `<div class="ucs-zone-label" id="ucs-label-tradearea">${_('Trade Area (this trick)')}</div>`;
        this.addTip('ucs-label-tradearea', `<b>${_('Trade Area')}</b><br>`
            + _('The cards everyone played into the current trick. When it resolves they are ranked into Draft Order (the numbered badges), then rotate over to become the next Draft Pool.'));
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
                const badgeId = `ucs-do-badge-${card.id}`;
                el.insertAdjacentHTML('beforeend',
                    `<div class="ucs-draftorder-badge ucs-art2 ucs-draftorder-${rank}" id="${badgeId}"></div>`);
                this.addTip(badgeId, `<b>${_('Draft Order')}: ${rank}</b><br>`
                    + _('Once the trick resolves, players draft from the pool in this numbered order — lower numbers pick first.'));
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
            this.renderPanelTally(Number(player.id));
        });
    }

    /**
     * Per-player knitting tally injected into the BGA player board (playerPanels.getElement): one
     * valueless swatch for each sweater colour, then one chip for each icon, each carrying a running
     * count of how many cards that player currently has in their knitting area of that colour / icon.
     * A numbered card contributes +1 to its colour AND +1 to its icon. A patch has a colour but no
     * printed icon, so it contributes +1 to its colour only, and flags that colour's swatch with a
     * capital 'P' so everyone can see at a glance who has knitted which patches. All colours / icons
     * always show (0 when none), so the panel reads as a stable grid. Rebuilt from gamedatas.knitting
     * each render pass, so it stays live as cards are knitted (renderPlayers runs on setup and after
     * every knitting change).
     */
    private renderPanelTally(playerId: number) {
        const host = this.bga.playerPanels?.getElement(playerId);
        if (!host) return; // no panel (e.g. spectator view of a since-removed player) — nothing to do
        // Create the container once, then only refresh its contents on later passes.
        let box = document.getElementById(`ucs-panel-tally-${playerId}`);
        if (!box) {
            box = document.createElement('div');
            box.id = `ucs-panel-tally-${playerId}`;
            box.className = 'ucs-panel-tally';
            host.appendChild(box);
        }
        const colorCounts: { [c: string]: number } = {};
        const iconCounts: { [i: string]: number } = {};
        const patchColors = new Set<string>(); // colours this player holds at least one patch of
        this.cardArray(this.gamedatas.knitting)
            .filter((c) => Number(c.location_arg) === playerId)
            .forEach((c) => {
                const face = faceOf(c, this.material);
                if (!face || !face.color) return;
                colorCounts[face.color] = (colorCounts[face.color] ?? 0) + 1;
                if (face.patch) { patchColors.add(face.color); return; } // patch: colour only, no icon
                if (face.icon) iconCounts[face.icon] = (iconCounts[face.icon] ?? 0) + 1;
            });
        const colorRow = this.material.colors.map((col) => {
            const n = colorCounts[col] ?? 0;
            const hasPatch = patchColors.has(col);
            const title = hasPatch ? `${colourName(col)}: ${n} (${_('includes Patch')})` : `${colourName(col)}: ${n}`;
            return `<span class="ucs-tally-chip" title="${title}">`
                + `<span class="ucs-tally-swatch ucs-color-${col}">${hasPatch ? '<span class="ucs-tally-patch">P</span>' : ''}</span>`
                + `<span class="ucs-tally-count">${n}</span></span>`;
        }).join('');
        const iconRow = this.material.icons.map((ic) => {
            const n = iconCounts[ic] ?? 0;
            return `<span class="ucs-tally-chip" title="${iconName(ic)}: ${n}">`
                + `<span class="ucs-tally-icon"><span class="ucs-icon ucs-icon-${ic}"></span></span>`
                + `<span class="ucs-tally-count">${n}</span></span>`;
        }).join('');
        box.innerHTML = `<div class="ucs-tally-row">${colorRow}</div><div class="ucs-tally-row">${iconRow}</div>`;
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

    /**
     * "This card just changed" — an in-place reveal for a round parameter (Perfect Fit / Trendy Yarn, and
     * the single Fad face in Casual/Avid).
     *
     * A HALF flip, not a full one, and deliberately so: gameplayFaceEl draws the revealed card on its own
     * with no draw pile beside it, so there is nothing on screen to fly from and no old face left to turn
     * away — renderGameplay has already replaced the row wholesale by the time we run. The new face turns
     * in from edge-on and carries a brief glow (.ucs-gp-revealing in Game.scss), which is enough to stop a
     * mid-round rotation reading as a silent swap between two renders.
     *
     * Resolves when the motion ends so a promise notification can await it — Trendy Yarn and Perfect Fit
     * can both rotate on the same trick, and their two gameplayRevealed notifications must play in
     * sequence rather than on top of each other.
     */
    private revealFlip(el: HTMLElement | null, durationSec = 0.5): Promise<void> {
        if (!el || !this.bga.gameui.bgaAnimationsActive?.()) return Promise.resolve();
        el.style.setProperty('--ucs-gp-reveal', `${durationSec}s`);
        el.classList.add('ucs-gp-revealing');
        el.style.transition = 'none';
        el.style.transform = 'perspective(600px) rotateY(90deg)';
        void el.offsetWidth; // force reflow so the edge-on start takes effect before the transition
        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                el.style.transition = `transform ${durationSec}s ease`;
                el.style.transform = '';
            });
            setTimeout(() => {
                el.style.transition = ''; el.style.transform = '';
                el.style.removeProperty('--ucs-gp-reveal');
                el.classList.remove('ucs-gp-revealing');
                resolve();
            }, durationSec * 1000 + 60);
        });
    }

    /** The active card id per single-face parameter deck, as the model currently holds it. Snapshot this
     *  BEFORE a re-render and hand it to revealChangedParameters afterwards. */
    private gpActiveIds(): { [type: string]: string | null } {
        const gp = this.gamedatas.gameplay;
        const out: { [type: string]: string | null } = {};
        (['perfectfit', 'trendyyarn', 'fad'] as const).forEach((t) => {
            const active = gp?.[t]?.active;
            out[t] = active ? String(active.id) : null;
        });
        return out;
    }

    /**
     * Flip whichever parameter faces changed identity since `before`. Diffing the active card id covers
     * every path that can swap one — the mid-round Trendy Yarn / Perfect Fit rotations in Express and the
     * fresh reveal at a round boundary — without each notification having to know which decks it touched.
     *
     * In Express the Fads render as a multi-card display rather than a single face, so `ucs-gp-face-fad`
     * doesn't exist there; the lookup returns null and revealFlip no-ops, which is why claiming a Fad
     * doesn't flash the row.
     */
    private async revealChangedParameters(before: { [type: string]: string | null }) {
        const after = this.gpActiveIds();
        const changed = Object.keys(after).filter((t) => after[t] && before[t] !== after[t]);
        if (!changed.length) return;
        await Promise.all(
            changed.map((t) => this.revealFlip(document.getElementById(`ucs-gp-face-${t}`))),
        );
    }

    /**
     * Shrink-and-fade a card out of existence, for a card that leaves the table without arriving anywhere
     * the player can see (Billy's a Brute discards a drafted card straight to LOC_DISCARD, and no discard
     * pile is drawn). Run this BEFORE dropping the card from the model — it animates the element that is
     * still on screen, so there is no clone to position.
     */
    private fadeCardOut(el: HTMLElement | null, durationSec = 0.4): Promise<void> {
        if (!el || !this.bga.gameui.bgaAnimationsActive?.()) return Promise.resolve();
        el.style.transformOrigin = 'center';
        el.style.zIndex = '300'; // ride above its neighbours on the way out
        void el.offsetWidth;
        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                el.style.transition = `transform ${durationSec}s ease, opacity ${durationSec}s ease`;
                el.style.transform = 'scale(0.55) rotate(-8deg)';
                el.style.opacity = '0';
            });
            setTimeout(resolve, durationSec * 1000 + 60); // element is removed by the caller's re-render
        });
    }

    /**
     * The on-screen rect of a card in my hand fan, via the stock's own element lookup. We must NOT build
     * the id ourselves: bga-cards prefixes every card element with the manager `type`, so the real id is
     * `ucs-sweater-ucs-hand-<id>` (and the front face `…-front`), not the `ucs-hand-<id>` our getId
     * returns. getCardElement hides that. Returns null if the card isn't in the stock.
     */
    private handCardRect(card: SweaterCard): DOMRect | null {
        try {
            const el = this.handStock?.getCardElement?.(card) as HTMLElement | undefined;
            return el ? el.getBoundingClientRect() : null;
        } catch {
            return null;
        }
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

    /** Express: the type_args (fad ids in Material::fads) of the Fads locking playerId's build — a sweater
     *  can claim more than one Fad, so this is a list (empty = unlocked). */
    private claimedFadsForBuild(playerId: number, buildNo: number): number[] {
        const claims = this.expressClaims();
        const out: number[] = [];
        for (const fadId of Object.keys(claims)) {
            const c = claims[Number(fadId)];
            if (Number(c.playerId) === playerId && Number(c.buildNo) === buildNo) {
                const card = (this.gamedatas.gameplay?.express?.fadClaimed ?? [])
                    .find((f) => Number(f.id) === Number(fadId));
                if (card) out.push(Number(card.type_arg));
            }
        }
        return out;
    }

    /** The Fad definitions scoring a build: Casual's active round Fad (a list of ≤1), or Express's claimed
     *  Fads (a build may have claimed several). Empty = no active Fad for this build. */
    private fadsForBuild(playerId: number, buildNo: number): any[] {
        if (this.gamedatas.express) {
            return this.claimedFadsForBuild(playerId, buildNo)
                .map((t) => this.material.fads[t])
                .filter((f) => f != null);
        }
        const active = this.gamedatas.gameplay?.fad?.active;
        const f = active ? (this.material.fads[Number(active.type_arg)] ?? null) : null;
        return f ? [f] : [];
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

        // Mirrors the server's fadParts: +3 per Fad objective met (summed across every Fad the sweater
        // has claimed), and +1 for an all-one colour / icon that NO Fad matched — independently for colour
        // and icon (designer's BGG ruling). A Clash Fad scores +3 for all-different and matches no single
        // attribute. Keep in sync with the PHP.
        const fads = this.fadsForBuild(playerId, buildNo);
        const allDiffColor = new Set(colors).size === 3;
        const allDiffIcon = !icons.includes(null) && new Set(icons).size === 3;
        let colorIsFad = false, iconIsFad = false;
        for (const f of fads) {
            if (f.clash) {
                if (allDiffColor && allDiffIcon) vp += VP_FAD;
                continue;
            }
            (f.objectives ?? []).forEach((o: any) => {
                if (o.match === 'color' && allSameColor && colors[0] === o.value) { vp += VP_FAD; colorIsFad = true; }
                if (o.match === 'icon' && allSameIcon && icons[0] === o.value) { vp += VP_FAD; iconIsFad = true; }
            });
        }
        if (allSameColor && !colorIsFad) vp += VP_NONFAD;
        if (allSameIcon && !iconIsFad) vp += VP_NONFAD;
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
                // Express: a sweater that has claimed a Fad is locked — it can't be altered, and every
                // claimed Fad is shown on it (a sweater may claim more than one). Locked builds draw no
                // draft targets (guards below).
                const claimedFads = this.claimedFadsForBuild(playerId, buildNo);
                const locked = claimedFads.length > 0;
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
                    // Round-end assignment: the patch being assigned right now glows (its value/icon
                    // picker is attached beside the sweater below). Patches still queued behind it get a
                    // static marker — they glow in turn, one at a time.
                    if (Number(card.id) === this.assignPending[0]) el.classList.add('ucs-assign-glow');
                    else if (this.assignPending.includes(Number(card.id))) el.classList.add('ucs-assign-queued');
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
                claimedFads.forEach((t) => {
                    const fad = this.material.fads[t];
                    const chip = document.createElement('div');
                    chip.className = 'ucs-build-fad';
                    chip.textContent = fad?.title ?? _('Fad');
                    build.appendChild(chip);
                });
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
                // Round-end: attach the inline value/icon picker beside the patch being assigned, if it
                // lives in this sweater (no action-bar buttons — the choice sits right by the glowing
                // patch). One picker at a time: the popover floats over the neighbouring sweaters, so
                // showing every pending patch's menu at once hid the very cards still to be assigned.
                // Only in my own live area (not the opponent popin / compact read-out).
                if (playerId === this.myId && !targetEl && this.onAssignPatch) {
                    const current = this.assignPending[0];
                    if (builds[buildNo].some((card) => Number(card.id) === current)) {
                        build.appendChild(this.makeAssignPicker(current));
                    }
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
     * the sweater shape rather than a shorter cluster. Sweaters flow left-to-right and wrap onto
     * further rows within the fixed-width opponents column, so any number stays inside the panel.
     * Inline opponents column only — the click-to-enlarge popin keeps the detailed silhouette.
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
     * Resync the fanned HandStock from gamedatas.hand (full clear + add; the hand is small).
     *
     * removeAll() and addCards() both return promises and MUST be sequenced. Firing them back to back
     * without awaiting used to leave the stock in a state where the DOM held every card but the stock's
     * own card list was EMPTY: addCards populated the list synchronously, then removeAll's deferred
     * completion cleared it again, while the elements addCards had just created survived because
     * removeAll never knew about them. Everything downstream that asks the stock about its cards then
     * silently no-ops — setSelectableCards matches nothing, so the hand renders perfectly and cannot be
     * clicked (no bga-cards_selectable-card AND no bga-cards_unselectable-card on any card).
     *
     * Resyncs are chained rather than merely awaited, so two overlapping calls can't interleave into
     * the same corruption. The selectable marking is re-applied once the stock has settled.
     */
    private renderHand(dealFrom?: HTMLElement | null) {
        if (this.bga.gameui.isSpectator || !this.handStock) return;
        const hand = this.cardArray(this.gamedatas.hand).sort(this.handSort.bind(this));
        this.handSync = this.handSync
            .then(async () => {
                await this.handStock.removeAll();
                // `dealFrom` set → deal the fan in from that element (the draw pile at a new round), the
                // same slide notif_handUpdate gives a mid-round refill. Left undefined by every other
                // caller, which are resyncs (setup, F5, stock repair) where cards should just be there.
                if (hand.length) {
                    await this.handStock.addCards(
                        hand, dealFrom ? { fromElement: dealFrom } : undefined, dealFrom ? 80 : undefined,
                    );
                }
                this.refreshSelectable();
            })
            .catch(() => { /* a rejected animation must not wedge the chain for every later resync */ });
    }

    /**
     * Re-lay the fanned hand symmetrically. bga-cards' own updateCardPositions() leaves each card at
     * the add-time angle it had when it was the newest card in the stock — a lopsided monotonic ramp
     * rather than a symmetric arc — and calling its version again doesn't fix it (confirmed live). So
     * we overwrite the two CSS variables it drives the fan with, computed from the true centre. This
     * mirrors the shipped 1.x getCardTransform math exactly: middleIndex = index - (N-1)/2 for every
     * card, angle grows linearly with it, y with its square. Set up as a post-hook on the stock's
     * updateCardPositions (see setupHandStock) so it re-runs after every library re-layout — add,
     * remove, and the float-toggle on scroll — keeping the arc correct in every state.
     */
    private applySymmetricFan() {
        const fan = document.querySelector('#ucs-my-hand .hand-stock') as HTMLElement | null;
        if (!fan) return;
        const cards = Array.from(fan.querySelectorAll(':scope > .bga-cards_card')) as HTMLElement[];
        const n = cards.length;
        if (!n) return;
        const middle = (n - 1) / 2;
        cards.forEach((el, i) => {
            const mid = i - middle;
            const y = 2 * mid * mid;
            const a = mid * (10 + Math.min(10, n)) / (n / 2);
            el.style.setProperty('--bga-cards_hand-stock-card-y', `${y}px`);
            el.style.setProperty('--bga-cards_hand-stock-card-a', `${a}deg`);
        });
        this.placeFan(fan, cards);
    }

    /**
     * Position the fan: centred horizontally on the viewport, and raised just clear of the bottom-corner
     * buttons vertically. Both corrections ride on ONE transform on the stock element.
     *
     * ---- Horizontal ----
     * The library centres the cards within its stock element, but that element is shrink-to-fit and gets
     * left-pinned (measured: a 276px stock at x=39 inside a full-width 462px holder, so the fan sat at
     * 177 against a viewport centre of 250). Rather than model where it decides to put that box — which
     * differs between the attached and floating states — measure where the cards actually landed and
     * correct the difference. Self-correcting: the next pass measures the shifted result and converges
     * on ~0, and it re-runs on every library re-layout, so resize and float toggles fix themselves.
     *
     * The correction is a transform, which is layout-neutral. A margin would not be: the shipped CSS
     * gives the floating stock BOTH `left` and `right` (from floatLeft/RightMargin), so a margin shifts
     * and *shrinks* it at once, the cards re-centre in the narrower box, and each pass only halves the
     * error. Transforming THIS element is safe — the "no transform" rule is about *ancestors* of a
     * position:fixed element, and the stock is the fixed element itself, not an ancestor of one.
     *
     * ---- Vertical ----
     * See fanLift. Unlike the horizontal shift that one is exact in a single pass rather than iterative,
     * because a card's measured top moves 1:1 with the lift already applied.
     */
    private placeFan(fan: HTMLElement, cards: HTMLElement[]) {
        let left = Infinity;
        let right = -Infinity;
        cards.forEach((el) => {
            const b = el.getBoundingClientRect();
            if (!b.width) return; // hidden / mid-teardown: contributes no geometry
            left = Math.min(left, b.left);
            right = Math.max(right, b.right);
        });
        if (!isFinite(left) || !isFinite(right)) return;
        const previousShift = parseFloat(fan.dataset.ucsShift ?? '') || 0;
        const delta = window.innerWidth / 2 - (left + right) / 2;
        // Under 2px the horizontal pass has converged; keep the shift rather than churning on jitter.
        const shift = Math.abs(delta) < 2 ? previousShift : previousShift + delta;
        const lift = this.fanLift(cards, parseFloat(fan.dataset.ucsLift ?? '') || 0);
        fan.dataset.ucsShift = String(shift);
        fan.dataset.ucsLift = String(lift);
        fan.style.transform = `translate(${shift}px, ${-lift}px)`;
    }

    /**
     * How far to raise the fan so the bottom-corner buttons stop hiding the cards under them.
     *
     * The floating fan hangs off the viewport bottom, and the arc pushes each outer card a further
     * `2 * mid^2` px down — straight into the band our "?" strip (plus the round-summary restore chip
     * beside it) and BGA's own replay / chat controls occupy. Those controls are z-index 949 against the
     * fan's 900, so they both paint over the cards AND swallow the taps on them: on a 411px phone the
     * leftmost card sat entirely behind the "?" and the two rightmost behind BGA's pair.
     *
     * Reserving that width horizontally is the wrong lever — see handCardWidth: with HAND_SIZE cards
     * sharing the band, the ~176px those buttons want costs card width faster than it buys clearance. So
     * the fan keeps the full width and moves UP instead, by exactly enough that every card's identifying
     * strip — the value numeral and the orientation bulbs under it, the top ~42% of the printed face —
     * clears the buttons. The lower halves stay covered, which is what the art can afford to lose: the
     * sweater illustration repeats what the numeral and bulbs already say.
     *
     * 0.55 of the MEASURED box rather than 0.42 of the card, because these cards are rotated: an outer
     * card sits in a bounding box ~15% taller than itself, with its own top-left corner well below the
     * box's top. Running the worst case (the ±17° outermost card of a 9-card fan) through the rotation
     * puts its info strip at 0.515 of the box height; 0.55 is that rounded up, and over-lifting is the
     * cheap direction to be wrong in.
     *
     * Only cards that actually reach into a corner constrain the lift, so a fan narrower than the
     * viewport — every desktop width, and the attached (non-floating) state — computes 0 and nothing
     * moves. Deliberately not gated on `.ucs-narrow`: the buttons are position:fixed at every width, so
     * the question is always geometric rather than a breakpoint's to answer.
     */
    private fanLift(cards: HTMLElement[], currentLift: number): number {
        // Our own lower-left strip, measured rather than assumed: it holds the "?" and, once a round has
        // been scored, the round-summary restore chip beside it, so its width is not a constant.
        const strip = document.getElementById('bga-help_buttons')?.getBoundingClientRect();
        const haveStrip = !!strip && strip.width > 0 && strip.height > 0;
        // BGA's lower-RIGHT controls (replay + chat) carry no id we can rely on across skins. 120px is
        // what that pair measured on a Pixel 8 at 411px, and their top matched our own strip's. If they
        // ever clip the cards again this is the one number to raise — the previous 56px guess (a mirror
        // of our own button's width) was 64px short, which is how they came to cover two cards.
        const rightEdge = window.innerWidth - 120;
        const leftEdge = (haveStrip ? strip!.right : 56) + 6;
        const bandTop = (haveStrip ? strip!.top : window.innerHeight - 56) - 6;

        let lowest = -Infinity;
        cards.forEach((el) => {
            const b = el.getBoundingClientRect();
            if (!b.width) return; // hidden / mid-teardown: contributes no geometry
            if (b.left >= leftEdge && b.right <= rightEdge) return; // clear of both corners
            lowest = Math.max(lowest, b.top + b.height * 0.55);
        });
        if (!isFinite(lowest)) return 0; // nothing reaches a corner — sit where the library put us
        return Math.max(0, currentLift + (lowest - bandTop));
    }

    /** Hand fan order, from the "Hand sort order" game preference (gamepreferences 102). */
    private handSortMode(): 1 | 2 | 3 {
        try {
            const raw = Number(this.bga.userPreferences?.get?.(102));
            return (raw === 1 || raw === 3) ? raw : 2; // default: by colour
        } catch (e) {
            // Reading the preference can throw if it isn't loaded for this table; fall back to the
            // classic colour sort rather than leaving the hand unordered.
            return 2;
        }
    }

    /**
     * Comparator for the fanned hand, honouring the "Hand sort order" preference (102):
     *   1 Draw order — by card id (deal/draw order); the fan doesn't regroup as you draw;
     *   2 By colour  — colour (type) then ascending value (type_arg); the tidy default;
     *   3 By icon    — printed icon, then colour, then value; patches (no icon) sort last.
     * Total & stable in every mode, so a card drawn on refill drops into a deterministic slot
     * rather than tacking onto the end (see notif_handUpdate's incremental addCards).
     */
    private handSort(a: SweaterCard, b: SweaterCard): number {
        const mode = this.handSortMode();
        if (mode === 1) return Number(a.id) - Number(b.id);
        if (mode === 3) {
            const ia = faceOf(a, this.material)?.icon ?? '';
            const ib = faceOf(b, this.material)?.icon ?? '';
            if (ia !== ib) {
                // Patches carry no icon — send them to the end instead of grouping under ''.
                if (!ia) return 1;
                if (!ib) return -1;
                return ia < ib ? -1 : 1;
            }
            // same icon — fall through to the colour/value tail-break below.
        }
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
        // An active player with no playable card is not a legal position (getPlayableCardIds falls back
        // to the whole hand), so an empty list here means the args never arrived in the shape we expect
        // — and the symptom is a hand that renders perfectly and cannot be clicked. Say so loudly.
        if (!ids.length) {
            console.warn('[UCS] enablePlayable got NO playable ids — the hand will be unclickable.', ids);
        }
        this.playableIds = ids;
        this.onPlay = onPlay;
        this.selectedPlayId = null;
        this.hidePanel();
        if (!this.handStock) return;
        this.handStock.setSelectionMode('single');
        document.getElementById('ucs-my-hand')?.classList.add('ucs-hand-choosing');
        this.refreshSelectable();
    }

    /**
     * Push the current playable set onto the stock. bga-cards only marks cards that are IN the stock at
     * the moment of the call, and on state entry the hand may still be filling: notif_handUpdate slides
     * refilled cards in via addCards with an ~80ms animation each, so a card that arrives afterwards is
     * never marked and the whole hand ends up unclickable (stock shows bga-cards_selectable-stock, no
     * card shows bga-cards_selectable-card). A one-tick setTimeout used to "handle" this and lost the
     * race whenever a refill preceded the play phase.
     *
     * So it is re-applied from the patched updateCardPositions instead, which the library calls after
     * every add/remove/float re-layout — whenever the card set changes, the marking is renewed. Reading
     * the stock's OWN cards (not gamedatas.hand) also keeps it right if the two ever drift.
     */
    private refreshSelectable() {
        if (!this.handStock || !this.playableIds.length || this.refreshingSelectable) return;
        this.refreshingSelectable = true; // setSelectableCards can re-enter via updateCardPositions
        try {
            const ids = this.playableIds.map(Number);
            const selectable = (this.handStock.getCards() as SweaterCard[])
                .filter((c) => ids.includes(Number(c.id)));
            this.handStock.setSelectableCards(selectable);
        } finally {
            this.refreshingSelectable = false;
        }
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

    /**
     * Console diagnostic for the hand: `ucs.debugHand()`. Reports the two things that separate the ways
     * a hand can be unclickable — whether the playable ids ever reached the client, and whether the
     * stock actually marked any card selectable — plus the geometry behind the fan's centring.
     */
    public debugHand() {
        const holder = document.getElementById('ucs-my-hand');
        const stock = holder?.querySelector('.hand-stock') as HTMLElement | null;
        const cards = Array.from(holder?.querySelectorAll('.bga-cards_card') ?? []) as HTMLElement[];
        const rect = (el: HTMLElement | null) => {
            if (!el) return 'none';
            const r = el.getBoundingClientRect();
            return `${Math.round(r.left)}..${Math.round(r.right)} (w${Math.round(r.width)})`;
        };
        console.log('[UCS] state          :', this.gamedatas.gamestate?.name,
            '| active?', (this.bga.gameui as any).isCurrentPlayerActive?.());
        console.log('[UCS] state args     :', JSON.stringify(this.gamedatas.gamestate?.args));
        console.log('[UCS] playableIds    :', JSON.stringify(this.playableIds));
        console.log('[UCS] hand in stock  :', this.handStock?.getCards?.().map((c: SweaterCard) => Number(c.id)));
        console.log('[UCS] selectable     :', cards.filter((c) => c.className.includes('bga-cards_selectable-card')).length,
            '| unselectable:', cards.filter((c) => c.className.includes('bga-cards_unselectable-card')).length,
            '| total:', cards.length);
        console.log('[UCS] holder classes :', holder?.className);
        console.log('[UCS] stock classes  :', stock?.className);
        console.log('[UCS] viewport w     :', window.innerWidth);
        console.log('[UCS] holder rect    :', rect(holder), '| stock rect:', rect(stock));
        console.log('[UCS] pile rect      :', rect(document.getElementById('ucs-my-pile')));
        if (cards.length) {
            const l = Math.min(...cards.map((c) => c.getBoundingClientRect().left));
            const r = Math.max(...cards.map((c) => c.getBoundingClientRect().right));
            console.log('[UCS] fan span       :', Math.round(l), '..', Math.round(r),
                '| fan centre:', Math.round((l + r) / 2), '| viewport centre:', Math.round(window.innerWidth / 2));
        }
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
                // Snapshot where the card sits RIGHT NOW — still in the hand, exactly where the user
                // sees it — so notif_cardPlayed can fly the trade card in from here (see playFromRect).
                const card = this.gamedatas.hand[cardId];
                const rect = card ? this.handCardRect(card) : null;
                if (rect) this.playFromRect[cardId] = rect;
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

    /** Status-bar title for the assignment phase (no action buttons — the picker is on the board). */
    private updateAssignTitle() {
        const sb = this.bga.statusBar;
        sb.removeActionButtons();
        if (!this.onAssignPatch) return;
        const left = this.assignPending.length;
        if (left === 0) sb.setTitle(_('Waiting for other players…'));
        else if (left === 1) sb.setTitle(_('Assign a value and icon to your patch card'));
        // Patches are assigned one at a time, so say how many are still queued behind this one.
        else sb.setTitle(_('Assign a value and icon to your patch card (${left} to go)'), { left });
    }

    /**
     * The inline value/icon picker attached beside the patch currently being assigned (round-end). Values
     * 1-12 as a 4-wide keypad and the four icons on the same four columns; each remembers its choice in
     * `assignSel[cardId]`. Once both are chosen a Confirm sends `actAssignPatch`, drops the patch from the
     * pending set, and re-renders — which brings up the next patch's picker.
     */
    private makeAssignPicker(cardId: number): HTMLElement {
        const sel = (this.assignSel[cardId] ??= { value: null, icon: null });
        const pop = document.createElement('div');
        pop.className = 'ucs-assign-pop';

        const valGrid = document.createElement('div');
        valGrid.className = 'ucs-assign-grid';
        for (let v = 1; v <= 12; v++) {
            const b = document.createElement('button');
            b.className = 'ucs-assign-opt' + (sel.value === v ? ' ucs-assign-chosen' : '');
            b.textContent = String(v);
            b.onclick = () => { sel.value = v; this.renderKnitting(this.myId); };
            valGrid.appendChild(b);
        }

        const iconGrid = document.createElement('div');
        iconGrid.className = 'ucs-assign-grid';
        this.material.icons.forEach((ic) => {
            const b = document.createElement('button');
            b.className = 'ucs-assign-opt ucs-assign-icon' + (sel.icon === ic ? ' ucs-assign-chosen' : '');
            b.innerHTML = `<span class="ucs-icon ucs-icon-${ic}"></span>`;
            b.title = ic;
            b.onclick = () => { sel.icon = ic; this.renderKnitting(this.myId); };
            iconGrid.appendChild(b);
        });

        pop.appendChild(valGrid);
        pop.appendChild(iconGrid);

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
     *
     * The same acknowledgement is offered twice: the sheet's Okay, and a Continue button in the action
     * bar. The action bar is the one that's always reachable — the sheet can be minimized, which puts its
     * Okay behind a restore click — and the state's descriptionMyTurn already tells the player to
     * continue, so until now it named a button that wasn't there.
     */
    public showRoundReview(detail: RoundReviewArgs, isCurrentPlayerActive: boolean, onContinue: () => void) {
        if (!isCurrentPlayerActive) { this.hideRoundSummary(); return; }
        const sb = this.bga.statusBar;
        sb.removeActionButtons();
        const acknowledge = () => {
            this.hideRoundSummary(); // takes the restore chip with it, minimized or not
            sb.removeActionButtons();
            sb.setTitle(_('Waiting for other players…'));
            onContinue();
        };
        this.renderRoundSummary(detail, acknowledge);
        sb.addActionButton(_('Continue'), acknowledge, { color: 'primary' });
    }

    /** Tear down the summary overlay when leaving RoundReview (next round is about to be dealt). */
    public endRoundReview() {
        this.bga.statusBar.removeActionButtons();
        this.hideRoundSummary();
    }

    private hideRoundSummary() {
        // Kill any in-flight minimize: its timer would otherwise fire against a dismissed sheet and
        // leave a restore chip on screen with nothing behind it.
        if (this.sheetAnimTimer !== null) { clearTimeout(this.sheetAnimTimer); this.sheetAnimTimer = null; }
        document.getElementById('ucs-score-popin')?.remove();
        document.getElementById('ucs-score-restore')?.remove();
    }

    /**
     * Minimize / restore the summary. Minimizing is **not** Okay: the overlay and its backdrop get out
     * of the way so the knitting areas underneath can be read and clicked, but the round is not
     * acknowledged and the state doesn't advance. A restore chip parked beside the "?" help button
     * brings the sheet straight back.
     *
     * The sheet animates to/from that corner, so `display: none` can only be applied once the shrink has
     * played — hence the timer. Duration lives in SHEET_ANIM_MS and must match `$ucs-sheet-anim` in
     * Game.scss; a timer rather than `animationend` so a browser that suppresses the animation (reduced
     * motion, background tab) still ends up in the right state.
     */
    private setRoundSummaryMinimized(min: boolean) {
        const overlay = document.getElementById('ucs-score-popin');
        if (!overlay) return;
        if (this.sheetAnimTimer !== null) { clearTimeout(this.sheetAnimTimer); this.sheetAnimTimer = null; }
        overlay.classList.remove('ucs-popin-closing', 'ucs-popin-opening');
        void overlay.offsetWidth; // reflow: re-adding a class in the same frame won't restart its animation

        if (min) {
            overlay.classList.add('ucs-popin-closing');
            this.sheetAnimTimer = window.setTimeout(() => {
                this.sheetAnimTimer = null;
                overlay.classList.remove('ucs-popin-closing');
                overlay.classList.add('ucs-popin-minimized');
                this.showRoundSummaryChip();
            }, Game.SHEET_ANIM_MS);
            return;
        }

        document.getElementById('ucs-score-restore')?.remove();
        overlay.classList.remove('ucs-popin-minimized');
        overlay.classList.add('ucs-popin-opening');
        this.sheetAnimTimer = window.setTimeout(() => {
            this.sheetAnimTimer = null;
            overlay.classList.remove('ucs-popin-opening');
        }, Game.SHEET_ANIM_MS);
    }

    /** The lower-left chip that brings a minimized summary back. */
    private showRoundSummaryChip() {
        if (document.getElementById('ucs-score-restore')) return;
        const chip = document.createElement('button');
        chip.id = 'ucs-score-restore';
        chip.className = 'ucs-score-restore';
        chip.title = _('Show the round summary');
        chip.setAttribute('aria-label', _('Show the round summary'));
        chip.innerHTML = `<svg class="ucs-score-restore-art" viewBox="0 0 24 24" aria-hidden="true">`
            + `<path class="ucs-sr-body" d="M7 4 H10 C10 7 14 7 14 4 H17 L22 8.2 L19 11.6 L17 10 V21 H7 V10 L5 11.6 L2 8.2 Z"/>`
            + `<path class="ucs-sr-stripe" d="M7.6 13.4 L12 16 L16.4 13.4"/>`
            + `</svg>`;
        chip.onclick = () => this.setRoundSummaryMinimized(false);
        // Park it in bga-help's fixed lower-left strip: we inherit its pinning and its flex gap, so the
        // chip can never land on top of the "?" button. Without that container we'd have no way back to
        // the sheet, so pin ourselves instead (.ucs-score-restore-solo).
        const host = document.getElementById('bga-help_buttons');
        if (host) {
            host.appendChild(chip);
        } else {
            chip.classList.add('ucs-score-restore-solo');
            this.bga.gameArea.getElement().appendChild(chip);
        }
    }

    /**
     * Build the end-of-round scoring summary — an HTML recreation of the printed ScorePad: category rows
     * × (per player, per round) columns, filled cumulatively as rounds are scored. `onOkay` (if given)
     * wires the Okay button; without it the button just closes the overlay (used for the final round,
     * which has no RoundReview acknowledgement gate).
     */
    private renderRoundSummary(detail: Scorepad, onOkay?: () => void, modal = true) {
        this.hideRoundSummary();
        const overlay = document.createElement('div');
        overlay.id = 'ucs-score-popin';
        overlay.className = 'ucs-popin ucs-score-popin' + (modal ? '' : ' ucs-popin-modeless');

        if (modal) {
            const backdrop = document.createElement('div');
            backdrop.className = 'ucs-popin-backdrop';
            // Clicking away from the sheet minimizes rather than dismisses — it's the natural gesture for
            // "let me see the board", and unlike Okay it costs nothing (the sheet is one click away).
            backdrop.onclick = () => this.setRoundSummaryMinimized(true);
            overlay.appendChild(backdrop);
        }

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

        // Avid: explain the asterisk on any zeroed (disqualified) grand total.
        if (detail.disqualified && detail.disqualified.length) {
            const names = detail.disqualified
                .map((pid) => detail.players.find((p) => Number(p.player_id) === Number(pid))?.player_name)
                .filter(Boolean)
                .join(', ');
            const note = document.createElement('div');
            note.className = 'ucs-scorepad-dq-note';
            note.innerHTML = `<span class="ucs-sp-dq-mark">*</span> `
                + _('${players} did not complete all 3 Secret Santas — final score is 0.').replace('${players}', names);
            box.appendChild(note);
        }

        const foot = document.createElement('div');
        foot.className = 'ucs-score-foot';
        // Minimize sits before Okay: in RoundReview, Okay acknowledges and lets the next round deal, so
        // it's the one-way door. Anyone wanting a look at the board should reach the reversible one first.
        const minimize = document.createElement('button');
        minimize.className = 'ucs-score-min';
        minimize.textContent = _('Minimize');
        minimize.title = _('Look at the board — the summary stays available');
        minimize.onclick = () => this.setRoundSummaryMinimized(true);
        foot.appendChild(minimize);
        const okay = document.createElement('button');
        okay.className = 'ucs-score-okay';
        // Only the RoundReview sheet acknowledges anything; the final-round one just goes away.
        okay.textContent = onOkay ? _('Okay') : _('Close');
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
            { key: 'nonfad', label: _("All Matching 'Non-Fad' Colours and Icons"), vp: '+1 VP each' },
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
        // Avid: a player who failed to complete all 3 Secret Santas forfeits their game — the server zeroed
        // their score in EndScore. Show their grand total as 0 with an asterisk (footnote below the table).
        const disqualified = new Set((detail.disqualified ?? []).map(Number));
        html += `<tr class="ucs-sp-row ucs-sp-totals"><th class="ucs-sp-cat"><span class="ucs-sp-lbl">${_('TOTALS')}</span></th>`;
        players.forEach((p, i) => {
            let lastCum = 0;
            roundCols.forEach((r) => {
                const rec = cellOf(p.player_id, r);
                if (rec) lastCum = rec.cumulative;
                const cls = [i % 2 === 0 ? 'ucs-sp-alt' : '', r === cur ? 'ucs-sp-cur' : ''].join(' ');
                html += cell(rec ? rec.total : undefined, cls);
            });
            const dq = disqualified.has(Number(p.player_id));
            const grand = dq ? `0<span class="ucs-sp-dq-mark">*</span>` : String(lastCum);
            html += `<td class="ucs-sp-num ucs-sp-total ${i % 2 === 0 ? 'ucs-sp-alt' : ''} ${dq ? 'ucs-sp-dq' : ''}">${grand}</td>`;
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
                // Express: tint the new Trendy Yarn colour name in the log ("New Trendy Yarn: Purple").
                if (args.trendy_color) {
                    args.trendy_color = trendyLogChip(args.trendy_color);
                }
                // Express: re-translate a claimed Fad's title from our own material (the server sends the
                // raw title as a fallback so the ${fad_label} placeholder always resolves).
                if (args.fad_type !== undefined) {
                    const fad = this.material?.fads?.[Number(args.fad_type)];
                    if (fad?.title) args.fad_label = _(fad.title);
                }
            }
        } catch (e) {
            console.error('bgaFormatText', log, args, e);
        }
        return { log, args };
    }

    setupNotifications() {
        // Promise notifications are auto-wired from the `notif_*` methods below.
        this.bga.notifications.setupPromiseNotifications({
            // logger: console.log
        });
    }

    /** A card was played into the trade area (its face travels with the notification). */
    async notif_cardPlayed(args: NotifCardPlayed) {
        const id = Number(args.card_id);
        const mine = Number(args.player_id) === this.myId;
        // Where the card starts: my own play launches from its card in the hand fan; an opponent's play
        // launches from their on-table player panel on the right. For my play we use the rect captured
        // at Confirm time (playFromRect) — the card was exactly where I saw it then. Re-querying the hand
        // element here is too late: disablePlayable has run and the floating hand has re-attached, so the
        // card has moved and the flight would jump from the wrong spot. Fall back to a live query only if
        // the snapshot is missing (e.g. auto-confirm-off edge, or an F5 mid-flight).
        let fromMine = mine ? (this.playFromRect[id] ?? null) : null;
        delete this.playFromRect[id];
        if (mine && !fromMine) {
            // Snapshot missing (e.g. F5 mid-flight): the card is still in the stock here (removeCard
            // runs below), so read it live.
            fromMine = this.handCardRect(args.card);
        }

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
        // Express: the refreshed tracker state advances the Round Tracker marker (and any yarn draw this
        // trick). Re-render the params column so the halo moves to the new current round.
        if (args.express && this.gamedatas.gameplay) {
            this.gamedatas.gameplay.express = args.express;
            this.renderGameplay();
        }
    }

    /**
     * FLIP-animate the just-collected cards from their old (Trade Area) positions to their new Draft Pool
     * positions. The pool has already been re-rendered, so each `ucs-card-<id>` is at its final spot; we
     * offset it back to where it was via a transform, then transition that transform to 0 over ~2s so
     * they all glide up together. Deltas are divided by the tabletop scale (same as the Draft Order
     * overlay) so it's correct under any transform BGA applies.
     */
    private animateTradeToPool(oldRects: { [id: number]: DOMRect }) {
        this.flipFromRects(oldRects, 2);
    }

    /**
     * Batch FLIP: given where a set of cards sat BEFORE a re-render, slide each from there to wherever it
     * has just been drawn. The caller re-renders first, so every element is already at its final spot; we
     * offset it back by the delta and transition that away. Deltas are divided by the tabletop scale so
     * they stay correct under any transform BGA applies.
     *
     * Cards are looked up as `ucs-card-<id>` and then `ucs-mini-<id>`, the same pair notif_cardDrafted
     * uses — my own zones draw full-size cards, an opponent's inline knitting draws compact chips. A card
     * that isn't on screen after the re-render is skipped, which is what makes this safe for the Tina
     * rearrange, where a piece can be covered rather than moved.
     */
    private flipFromRects(oldRects: { [id: number]: DOMRect }, durationSec: number) {
        if (!this.bga.gameui.bgaAnimationsActive?.()) return;
        const table = document.getElementById('ucs-table');
        const scale = (table && table.offsetWidth)
            ? table.getBoundingClientRect().width / table.offsetWidth : 1;
        Object.keys(oldRects).forEach((key) => {
            const el = document.getElementById(`ucs-card-${key}`) ?? document.getElementById(`ucs-mini-${key}`);
            if (!el) return; // card isn't on the table after the re-render (covered / discarded) — skip
            const now = el.getBoundingClientRect();
            const old = oldRects[Number(key)];
            const dx = (old.left - now.left) / scale, dy = (old.top - now.top) / scale;
            if (!dx && !dy) return;
            el.style.transition = 'none';
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            void el.offsetWidth; // force reflow so the starting transform takes effect
            requestAnimationFrame(() => {
                el.style.transition = `transform ${durationSec}s ease`;
                el.style.transform = '';
            });
            setTimeout(() => {
                el.style.transition = ''; el.style.transform = '';
            }, durationSec * 1000 + 100);
        });
    }

    /** Where every card of `playerId`'s knitting area sits right now, keyed by card id — the "before" half
     *  of a flipFromRects pass across a rearrangement. */
    private knittingRects(playerId: number): { [id: number]: DOMRect } {
        const rects: { [id: number]: DOMRect } = {};
        Object.values(this.gamedatas.knitting)
            .filter((c) => Number(c.location_arg) === Number(playerId))
            .forEach((c) => {
                const el = document.getElementById(`ucs-card-${c.id}`)
                    ?? document.getElementById(`ucs-mini-${c.id}`);
                if (el) rects[Number(c.id)] = el.getBoundingClientRect();
            });
        return rects;
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
        // Queued on the same chain as renderHand: a refill landing while a resync is still in flight is
        // exactly the interleaving that empties the stock's card list (see renderHand).
        const from = document.querySelector('#ucs-my-pile .ucs-pile-card') as HTMLElement | null;
        this.handSync = this.handSync
            .then(async () => {
                await this.handStock.addCards(drawn, from ? { fromElement: from } : undefined, 80);
                this.refreshSelectable();
            })
            .catch(() => {});
        await this.handSync;
    }

    /**
     * A round parameter was revealed — either a fresh round's deal, or a mid-round rotation in Express:
     * Trendy Yarn every trendyRotateEvery() tricks, Perfect Fit whenever a matching card was played
     * (EndTrickCleanup). Flip whichever face actually changed, so the swap isn't silent. Awaited, so two
     * rotations landing on the same trick play one after the other.
     */
    async notif_gameplayRevealed(args: NotifGameplayRevealed) {
        const before = this.gpActiveIds();
        this.gamedatas.gameplay = args.gameplay;
        this.renderGameplay();
        await this.revealChangedParameters(before);
    }

    /**
     * Public: a new round (2-3) was dealt. Replace the public board wholesale from the fresh deal — new
     * draft pool, revealed parameters, resynced counts, and a wiped knitting area — then re-render. The
     * receiving player's own hand + Secret Santa arrive privately in notif_newRoundPrivate.
     */
    async notif_newRound(args: NotifNewRound) {
        const beforeParams = this.gpActiveIds();
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
        // The round's fresh parameters are the one part of this board-wide replacement that gets marked;
        // the pool/knitting deal is still instant (deferred — see backlog.md).
        await this.revealChangedParameters(beforeParams);
    }

    /** Private: my new hand + freshly dealt Secret Santa(s) for the new round. */
    async notif_newRoundPrivate(args: NotifNewRoundPrivate) {
        const hand: CardMapT = {};
        args.hand.forEach((c) => (hand[Number(c.id)] = c));
        this.gamedatas.hand = hand;
        const ss: CardMapT = {};
        args.secretSanta.forEach((c) => (ss[Number(c.id)] = c));
        this.gamedatas.secretSanta = ss;
        // Deal the new hand in from the draw pile rather than having it appear — the same slide a
        // mid-round refill gets (notif_handUpdate). The public newRound notify runs first (NewRound.php
        // sends it before the per-player privates), so renderAll has already drawn the pile; if it
        // somehow hasn't, renderHand falls back to its instant path.
        this.renderHand(document.querySelector('#ucs-my-pile .ucs-pile-card') as HTMLElement | null);
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

    /** Billy's a Brute: a drafted card was discarded — fade it out of the pool, then drop it. The server
     *  moved it to LOC_DISCARD, which isn't drawn anywhere, so there's no destination to fly to. The
     *  fade runs before the model changes, while the card is still on screen. */
    async notif_cardDiscarded(args: NotifCardDiscarded) {
        await this.fadeCardOut(document.getElementById(`ucs-card-${Number(args.card_id)}`));
        delete this.gamedatas.draftpool[Number(args.card_id)];
        this.renderDraftPool();
    }

    /** Tina Can Tink: a player re-arranged their knitting — replace their pieces and re-render, sliding
     *  each piece from where it was so the rearrangement is visible rather than a jump. */
    async notif_tinaResolved(args: NotifTinaResolved) {
        const before = this.knittingRects(Number(args.player_id));
        // Drop this player's existing knitting entries, then load the fresh ones.
        Object.values(this.gamedatas.knitting)
            .filter((c) => Number(c.location_arg) === Number(args.player_id))
            .forEach((c) => { delete this.gamedatas.knitting[Number(c.id)]; });
        args.knitting.forEach((c) => (this.gamedatas.knitting[Number(c.id)] = c));
        this.gamedatas.bonus = args.bonus ?? this.gamedatas.bonus;
        this.renderKnitting(Number(args.player_id));
        this.renderBonus(Number(args.player_id));
        this.flipFromRects(before, 0.6);
    }

    /**
     * Express: a player claimed a Fad. Nothing travels — the Fad card STAYS in the display and is
     * re-styled as claimed (.ucs-fad-claimed: dimmed, tagged with the owner), while their sweater picks
     * up its locked treatment; both come out of the re-renders below. Their score updates via the
     * framework's score counter (server playerScore->inc), so no manual score bump is needed here.
     */
    async notif_fadClaimed(args: NotifFadClaimed) {
        this.gamedatas.gameplay = args.gameplay;
        this.renderGameplay();
        this.renderKnitting(args.player_id);
    }

    /**
     * A round was scored. Non-final rounds show the scoring-summary overlay from the RoundReview state
     * (all players, Okay = acknowledge → next round). The FINAL round has no RoundReview state — ScoreRound
     * goes straight to EndScore — so nothing here gates anything; the sheet is shown modeless so the end
     * screen underneath stays usable, and closing it is optional.
     */
    async notif_roundScored(args: NotifRoundScored) {
        // The draft phase is over and we're moving on — the "last trick" banner is spent.
        this.showHandEndBanner(false);
        // Avid: Secret Santas satisfied this round are now public — refresh every player's revealed row.
        if (args.avidRevealed) {
            this.gamedatas.avidRevealed = args.avidRevealed;
            this.renderAvidRevealed();
            this.renderSecretSanta(); // my own completion read-out is the tick on my Secret Santa cards
        }
        if (args.round >= this.gamedatas.totalRounds) {
            this.renderRoundSummary(args, undefined, false); // modeless: never in the way of the end screen
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
