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
    activeGameplay: CardMap;
    counts: { [playerId: number]: PlayerCounts };
    material: UcsMaterial;
    roundNo: number;
    leaderId: number;
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
