/*
 * Client-side type definitions for Ugly Christmas Sweaters.
 * Mirrors the shapes returned by Game::getAllDatas and the notification payloads.
 */

/** A sweater card row as returned by the Deck component (+ card_meta extras for trick/knitting). */
interface SweaterCard {
    id: number | string;
    type: string;                 // card_type = colour
    type_arg: number | string;    // card_type_arg = value (0 = patch)
    location: string;
    location_arg: number | string;
    // card_meta extras (present for trick / knitting cards):
    trickOrder?: number | string | null;
    buildNo?: number | string | null;
    slot?: string | null;
    wildValue?: number | string | null;
    wildIcon?: string | null;
}

/** Static per-card face from Material::sweaters(), keyed by "<colour>_<value>". */
interface CardFace {
    color: string;
    value: number;
    icon: string | null;   // null until the art data is transcribed into Material::FACES
    slot: string | null;   // L / R / B — null until art data lands
    patch: boolean;
}

interface UcsMaterial {
    sweaters: { [key: string]: CardFace };
    fads: { [id: number]: any };
    secretSantas: { [id: number]: any };
    bonus: { [id: number]: any };   // the 4 Bonus / Special Ability cards (optional expansion)
    colors: string[];
    icons: string[];
}

/** A player's revealed Bonus / Special Ability card (optional expansion; public). */
interface BonusCardState {
    id: number;          // deck card id
    bonusId: number;     // which of the 4 (Material::bonusCards / BONUS_* constant)
    owner: number;       // owning player id
    used: boolean;       // a one-shot that has been spent
    key: string | null;  // 'littlebrothers' | 'tina' | 'maria' | 'billy'
    name: string;
    text: string;
    kind: string;        // 'objective' | 'oneshot'
}

interface UglyChristmasSweaterPlayer extends Player {
    fadPoints: number; // total Fad points scored (tie-break #2)
}

/** One revealed gameplay card (Perfect Fit / Trendy Yarn / Fad). */
interface GameplayCard {
    id: number | string;
    type: string;               // 'perfectfit' | 'trendyyarn' | 'fad'
    type_arg: number | string;  // value / colour index / fad id
    location: string;
    location_arg: number | string;
}

/** A gameplay deck: the current face-up card plus how many cards remain / have been revealed. */
interface GameplayPile {
    active: GameplayCard | null;
    deckCount: number;
    seenCount: number;
}

/** Express: one entry per claimed Fad — which player claimed it and which of their builds it locks. */
interface FadClaim {
    playerId: number;
    buildNo: number;
}

/** Express-only gameplay state: the claimable Fad display, the claimed Fads, and the claim map. */
interface ExpressGameplay {
    fadDisplay: GameplayCard[];                 // unclaimed Fads on display
    fadClaimed: GameplayCard[];                 // claimed Fad cards (location_arg = owner)
    fadClaims: { [fadId: number]: FadClaim };   // fadId -> {playerId, buildNo}
}

interface GameplayState {
    perfectfit: GameplayPile;
    trendyyarn: GameplayPile;
    fad: GameplayPile;
    express?: ExpressGameplay; // present only in the Express variant
}

/** A map keyed by card id, as PHP getCollectionFromDb / Deck::getCardsInLocation return. */
type CardMap = { [cardId: number]: SweaterCard };

interface PlayerCounts {
    hand: number;
    pile: number;
}

interface UglyChristmasSweaterGamedatas extends Gamedatas<UglyChristmasSweaterPlayer> {
    hand: CardMap;                 // current player's hand only
    secretSanta: CardMap;          // current player's Secret Santa(s)
    draftpool: CardMap;
    trick: CardMap;                // cards played this trick
    knitting: CardMap;             // all players' knitting-area cards (location_arg = player id)
    gameplay: GameplayState;       // the three round-parameter decks (Perfect Fit / Trendy Yarn / Fad)
    bonus: BonusCardState[];       // each player's revealed Bonus card (optional expansion; [] when Off)
    counts: { [playerId: number]: PlayerCounts };
    material: UcsMaterial;
    roundNo: number;
    leaderId: number;
    draftOrderCards: number[];     // trade-card ids in rank order for the current trick (empty until resolved)
    express: boolean;              // true in the Express variant (single round, claimable Fads, etc.)
    totalRounds: number;           // 3 (Casual) or 1 (Express)
    handEndTriggered: boolean;     // hand's end triggered (Nth sweater done / hands empty) → last-trick banner
    isStudio: boolean;             // true only on the Studio environment (gates the DEBUG button)
}

/*
 * State arg types
 */
interface PlayCardArgs {
    playableCardsIds: number[];
}

interface DraftCardArgs {
    draftableIds: number[];
}

/** Per-component public VP for one completed sweater (parts sum to its public total). */
interface SweaterScoreParts {
    build: number;   // +2 completed
    run: number;     // +2 three consecutive values
    fad: number;     // +3 per Fad objective met (0/3/6)
    nonfad: number;  // +1 all one colour/icon that is NOT the Fad
}

/** One started sweater in the round-score summary (complete or not). */
interface SweaterScore {
    buildNo: number;
    complete: boolean;
    cards: SweaterCard[];   // the placed pieces (for rendering the silhouette)
    parts: SweaterScoreParts;
    total: number;          // public total for this sweater
    ss: boolean;            // satisfies this player's Secret Santa (→ gold border)
}

/** One of a player's revealed Secret Santa objectives at round end. */
interface SecretSantaResult {
    id: number;
    name: string;
    needs: string[];        // 3 requirements, "color:x" / "icon:y"
    satisfied: boolean;
    points: number;         // 3 if satisfied, else 0
}

/** One player's full breakdown in the round-score summary. */
interface PlayerScoreDetail {
    player_id: number;
    player_name: string;
    color: string;
    score: number;          // cumulative total after this round
    roundTotal: number;     // points earned this round (public + Secret Santa)
    sweaters: SweaterScore[];
    secretSantas: SecretSantaResult[];
}

/** Full end-of-round scoring detail — RoundReview state args (re-served on refresh) and roundScored notif. */
interface RoundScoreDetail {
    round: number;
    fad: { title?: string; objectives?: any[]; clash?: boolean } | null;
    players: PlayerScoreDetail[];
}

type RoundReviewArgs = RoundScoreDetail;

/** Placement choices submitted alongside a draft. A patch's value/icon are NOT chosen here. */
interface DraftPlacement {
    build_no: number;            // 0 = start a new sweater; otherwise an existing build number
    slot: string;                // patch added to an existing sweater: its chosen orientation; else ''
    floating_patch_slot: string; // orientation for a floating patch already in the target sweater, else ''
    use_maria?: number;          // 1 = Mixed-up Maria: place this regular card in `slot` (any orientation)
}

/** BillyChoice state args — the Billy owner deciding whether to draft-and-discard first. */
interface BillyChoiceArgs {
    // no server args needed; the client reads the owner + bonus state from gamedatas
}

/** TinaTink state args — the Tina owner deciding whether to move/swap a piece before scoring. */
interface TinaTinkArgs {
    owner: number | null;
}

interface AssignPatchesArgs {
    assignable: { [playerId: number]: number[] }; // unassigned-patch card ids per player (round-end)
}

/*
 * Notification payload types
 */
interface NotifCardPlayed {
    player_id: number;
    player_name: string;
    card_id: number;
    card: SweaterCard;
}

interface NotifCardDrafted {
    player_id: number;
    player_name: string;
    card_id: number;
    card: SweaterCard;
    replaced_card_id: number | null;     // a "placed over" piece that was discarded, if any
    floating_patch: SweaterCard | null;  // a floating patch this placement just oriented, if any
}

interface NotifPatchAssigned {
    player_id: number;
    card_id: number;
    card: SweaterCard; // the patch row now carrying its chosen wildValue / wildIcon
}

interface NotifDraftOrder {
    order: number[];      // player ids, best-first
    orderCards: number[]; // trade-area card ids in the same best-first rank order
}

interface NotifTrickCleanup {
    pool: SweaterCard[];
    counts: { [playerId: number]: PlayerCounts };
}

interface NotifHandUpdate {
    hand: SweaterCard[];   // the receiving player's full refilled hand (authoritative model)
    drawn?: SweaterCard[]; // only the cards just drawn from the pile this refill (for the draw animation)
}

interface NotifGameplayRevealed {
    gameplay: GameplayState; // the round-parameter decks after revealing the new round's cards
}

/** Public start-of-round deal (rounds 2-3): the freshly reshuffled board. Knitting is wiped (empty). */
interface NotifNewRound {
    round: number;
    pool: SweaterCard[];                                 // the new draft pool (carry-over cards + fresh)
    gameplay: GameplayState;                             // this round's revealed parameters
    counts: { [playerId: number]: PlayerCounts };        // resynced hidden-pile/hand counts
    knitting: SweaterCard[];                             // all players' knitting — empty at round start
    leaderId: number;                                    // holder of the "1" card, leads the first trick
}

/** Private start-of-round deal: the receiving player's new hand + freshly dealt Secret Santa(s). */
interface NotifNewRoundPrivate {
    hand: SweaterCard[];
    secretSanta: SweaterCard[];
}

/** A bonus card was spent / an objective scored — carries the refreshed public bonus state. */
interface NotifBonusUsed {
    player_id?: number;
    player_name?: string;
    bonus: BonusCardState[];
}

/** Billy's a Brute: a drafted card was discarded (removed from the pool) instead of kept. */
interface NotifCardDiscarded {
    player_id: number;
    player_name: string;
    card_id: number;
    card_label: string;
}

/** Tina Can Tink: a player re-arranged their knitting — carries their full new knitting + bonus state. */
interface NotifTinaResolved {
    player_id: number;
    player_name: string;
    knitting: SweaterCard[];
    bonus: BonusCardState[];
}

type NotifRoundScored = RoundScoreDetail;

interface NotifFadClaimed {
    player_id: number;
    player_name: string;
    fad_id: number;
    build_no: number;
    gameplay: GameplayState; // refreshed gameplay state (the fad has moved from display to claimed)
}
