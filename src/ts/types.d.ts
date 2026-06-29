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

interface GameplayState {
    perfectfit: GameplayPile;
    trendyyarn: GameplayPile;
    fad: GameplayPile;
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

/** Placement choices submitted alongside a draft (slot/value/icon only meaningful for a patch). */
interface DraftPlacement {
    build_no: number;   // 0 = start a new sweater; otherwise an existing build number
    slot: string;       // L / R / B — the patch's chosen orientation (ignored server-side for printed cards)
    wild_value: number; // patch's chosen value (0 when not a patch)
    wild_icon: string;  // patch's chosen icon ('' when not a patch)
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
    replaced_card_id: number | null; // a "placed over" piece that was discarded, if any
}

interface NotifDraftOrder {
    order: number[]; // player ids, best-first
}

interface NotifTrickCleanup {
    pool: SweaterCard[];
    counts: { [playerId: number]: PlayerCounts };
}

interface NotifHandUpdate {
    hand: SweaterCard[]; // the receiving player's refilled hand
}

interface NotifGameplayRevealed {
    gameplay: GameplayState; // the round-parameter decks after revealing the new round's cards
}

interface NotifRoundScored {
    round: number;
    breakdown: RoundResultRow[];
}
