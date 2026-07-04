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
    colors: string[];
    icons: string[];
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
    counts: { [playerId: number]: PlayerCounts };
    material: UcsMaterial;
    roundNo: number;
    leaderId: number;
    express: boolean;              // true in the Express variant (single round, claimable Fads, etc.)
    totalRounds: number;           // 3 (Casual) or 1 (Express)
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

/** One player's line on the between-round review screen. */
interface RoundResultRow {
    player_id: number;
    player_name: string;
    sweaters: number; // completed sweaters this round
    runs: number;     // of those, how many were three-consecutive-number runs
    score: number;    // cumulative total after this round
}

/** RoundReview state args (re-served on refresh from the `roundResult` global). */
interface RoundReviewArgs {
    round: number;
    breakdown: RoundResultRow[];
}

/** Placement choices submitted alongside a draft. A patch's value/icon are NOT chosen here. */
interface DraftPlacement {
    build_no: number;            // 0 = start a new sweater; otherwise an existing build number
    slot: string;                // patch added to an existing sweater: its chosen orientation; else ''
    floating_patch_slot: string; // orientation for a floating patch already in the target sweater, else ''
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
    order: number[]; // player ids, best-first
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

interface NotifRoundScored {
    round: number;
    breakdown: RoundResultRow[];
}

interface NotifFadClaimed {
    player_id: number;
    player_name: string;
    fad_id: number;
    build_no: number;
    gameplay: GameplayState; // refreshed gameplay state (the fad has moved from display to claimed)
}
