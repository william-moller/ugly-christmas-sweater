<?php
/**
 *------
 * BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
 * Ugly Christmas Sweaters implementation : © Will Moller <will.moller@gmail.com>
 *
 * This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
 * See http://en.boardgamearena.com/#!doc/Studio for more information.
 * -----
 *
 * Game.php — main server-side game logic for Ugly Christmas Sweaters.
 *
 * STATUS (2026-06-17): setup + state-machine wiring. The control flow (Trade -> Resolve -> Draft ->
 * Knit -> round end -> scoring) is in place. Rule internals that need the (still-pending) card art
 * data — full trick resolution, scoring math, patch wild handling — are partially implemented and
 * marked TODO. The game can deal and run the trick loop structurally even before the art arrives.
 */
declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater;

use Bga\Games\UglyChristmasSweater\States\NewRound;
use Bga\Games\UglyChristmasSweater\States\PlayCard;

class Game extends \Bga\GameFramework\Table
{
    /** @var \Bga\GameFramework\Components\Deck\Deck Sweater deck (52 cards). */
    public $cards;
    /** @var \Bga\GameFramework\Components\Deck\Deck Perfect Fit / Trendy Yarn / Fad cards. */
    public $gameplayCards;
    /** @var \Bga\GameFramework\Components\Deck\Deck Secret Santa objectives. */
    public $secretSantas;

    // Card locations (see dbmodel.sql).
    const LOC_SOURCE    = 'deck';      // transient shuffle source during dealing
    const LOC_HAND      = 'hand';      // arg = player_id
    const LOC_DRAFTPOOL = 'draftpool'; // arg = slot 0..3
    const LOC_TRICK     = 'trick';     // arg = player_id (who played)
    const LOC_KNITTING  = 'knitting';  // arg = player_id
    const LOC_DISCARD   = 'discard';

    const HAND_SIZE = 9; // hand is refilled up to this each trick

    public function __construct()
    {
        parent::__construct();

        // Create the Deck components (createCards happens later, in setupNewGame).
        $this->cards         = $this->deckFactory->createDeck('card');
        $this->gameplayCards = $this->deckFactory->createDeck('gameplay_card');
        $this->secretSantas  = $this->deckFactory->createDeck('secret_santa');
    }

    // ===========================================================================================
    //  Player-count derived parameters
    // ===========================================================================================

    /** Cards dealt to each player at the start of a round: 4P=12, 3P=16, 2P=24. */
    public function perPlayerDeal(): int
    {
        return intdiv(48, $this->getPlayersNumber()); // 48 = 52 deck - 4 initial draft pool
    }

    /** Cards each player plays into the trick / drafts per trick: 2P=2, else 1. */
    public function cardsPerTurn(): int
    {
        return $this->getPlayersNumber() === 2 ? 2 : 1;
    }

    // ===========================================================================================
    //  Setup
    // ===========================================================================================

    protected function setupNewGame($players, $options = [])
    {
        // --- Create players with their colours (skeleton boilerplate) -------------------------
        $gameinfos = $this->getGameinfos();
        $default_colors = $gameinfos['player_colors'];

        $query_values = [];
        foreach ($players as $player_id => $player) {
            $query_values[] = vsprintf("(%s, '%s', '%s')", [
                $player_id,
                array_shift($default_colors),
                addslashes($player["player_name"]),
            ]);
        }
        static::DbQuery(sprintf(
            "INSERT INTO `player` (`player_id`, `player_color`, `player_name`) VALUES %s",
            implode(",", $query_values)
        ));
        $this->reattributeColorsBasedOnPreferences($players, $gameinfos["player_colors"]);
        $this->reloadPlayersBasicInfos();

        // --- Create all decks (once) ----------------------------------------------------------
        $this->cards->createCards(Material::sweaterDeckRows(), self::LOC_SOURCE);
        $this->ensureCardExtensions(); // the modern Deck auto-creates `card` with only the 5 standard
                                       // columns, so add our extension columns here (not via dbmodel.sql).
        $this->createGameplayCards();
        $this->createSecretSantas();

        // --- Globals --------------------------------------------------------------------------
        $playerIds = array_keys($players);
        $this->globals->set('roundNo', 1);
        $this->globals->set('leaderId', $playerIds[array_rand($playerIds)]); // random opening leader ("1" Draft card)
        $this->globals->set('trickIndex', 0);
        $this->globals->set('draftOrder', []);
        $this->globals->set('draftIndex', 0);

        // --- Stats (defined in stats.jsonc) ---------------------------------------------------
        // TODO: $this->initStats(...) once stats.jsonc is defined.

        // --- Deal the first round and start ---------------------------------------------------
        $this->setupRound();

        return PlayCard::class;
    }

    /** Create the Perfect Fit / Trendy Yarn / Fad cards from Material into their piles. */
    public function createGameplayCards(): void
    {
        $rows = [];
        foreach (Material::PERFECT_FIT as $i => $value) {
            $rows[] = ['type' => 'perfectfit', 'type_arg' => $value, 'nbr' => 1];
        }
        foreach (Material::TRENDY_YARN as $i => $color) {
            // store colour as an index so type_arg stays int
            $rows[] = ['type' => 'trendyyarn', 'type_arg' => array_search($color, Material::COLORS), 'nbr' => 1];
        }
        foreach (Material::fads() as $fad) {
            $rows[] = ['type' => 'fad', 'type_arg' => $fad['id'], 'nbr' => 1];
        }
        if ($rows) {
            $this->gameplayCards->createCards($rows, 'pile'); // each kind separated by card_type
        }
    }

    /** Create the 16 Secret Santa objective cards. */
    public function createSecretSantas(): void
    {
        $rows = [];
        foreach (Material::secretSantas() as $ss) {
            $rows[] = ['type' => 'ss', 'type_arg' => $ss['id'], 'nbr' => 1];
        }
        if ($rows) {
            $this->secretSantas->createCards($rows, 'box');
        }
    }

    /**
     * Add the extension columns to the Deck-managed `card` table.
     * The modern framework's Deck component creates the table with only the 5 standard columns
     * (card_id/type/type_arg/location/location_arg), ignoring extra columns in dbmodel.sql. So we add
     * trick_order / build_no / slot / wild_value / wild_icon here, once, after the table exists.
     * Guarded by a column-existence check so it is safe to call repeatedly.
     */
    public function ensureCardExtensions(): void
    {
        $cols = $this->getCollectionFromDb("SHOW COLUMNS FROM `card`");
        if (!array_key_exists('slot', $cols)) {
            static::DbQuery(
                "ALTER TABLE `card`
                   ADD COLUMN `trick_order` TINYINT UNSIGNED DEFAULT NULL,
                   ADD COLUMN `build_no` TINYINT UNSIGNED DEFAULT NULL,
                   ADD COLUMN `slot` CHAR(1) DEFAULT NULL,
                   ADD COLUMN `wild_value` TINYINT UNSIGNED DEFAULT NULL,
                   ADD COLUMN `wild_icon` VARCHAR(12) DEFAULT NULL"
            );
        }
    }

    /**
     * Deal/flip everything for the start of a round, and activate the leader.
     * Used by setupNewGame (round 1) and the NewRound state (rounds 2-3).
     */
    public function setupRound(): void
    {
        // 1) Gather every sweater card, shuffle. (Between rounds, the 4 carried-over draft pool
        //    cards should be kept aside per the rules — TODO: implement carry-over; for now reshuffle all.)
        $this->cards->moveAllCardsInLocation(null, self::LOC_SOURCE);
        $this->cards->shuffle(self::LOC_SOURCE);

        // 2) Four face-up cards to the draft pool.
        $pool = $this->cards->pickCardsForLocation(4, self::LOC_SOURCE, self::LOC_DRAFTPOOL);
        $slot = 0;
        foreach ($pool as $c) {
            $this->cards->moveCard($c['id'], self::LOC_DRAFTPOOL, $slot++);
        }

        // 3) Deal personal piles + draw opening hands.
        $perPlayer = $this->perPlayerDeal();
        foreach ($this->loadPlayersBasicInfos() as $pid => $info) {
            $this->cards->pickCardsForLocation($perPlayer, self::LOC_SOURCE, $this->pileLoc($pid));
            $this->cards->pickCards(self::HAND_SIZE, $this->pileLoc($pid), $pid); // pile -> hand
        }

        // 4) Flip the round's gameplay cards (Perfect Fit / Trendy Yarn / Fad).
        $this->flipGameplayCards();

        // 5) Deal one Secret Santa per player (Casual). TODO: Avid variant deals 3 at game start.
        $this->dealSecretSantas();

        // 6) Activate the leader to lead the first trick.
        $this->globals->set('trickIndex', 0);
        $this->gamestate->changeActivePlayer((int) $this->globals->get('leaderId'));
    }

    /** A player's personal face-down pile location. */
    public function pileLoc(int $playerId): string
    {
        return "pile_$playerId";
    }

    /** Flip the top of each gameplay pile to 'active'. TODO: difficulty/options + Express cycling. */
    public function flipGameplayCards(): void
    {
        foreach (['perfectfit', 'trendyyarn', 'fad'] as $type) {
            // move any currently-active card of this type to discard, then flip a new one
            // (no-op until Material data exists)
            // TODO: respect Beginner/Novice/Expert (only flip Fad / +Trendy Yarn / +Perfect Fit).
        }
    }

    /** Deal one Secret Santa to each player for the round. */
    public function dealSecretSantas(): void
    {
        // TODO: implement once Material::secretSantas() is populated.
    }

    // ===========================================================================================
    //  getAllDatas — full state for the requesting player (hidden info filtered out)
    // ===========================================================================================

    protected function getAllDatas(int $currentPlayerId): array
    {
        $result = [];

        $result["players"] = $this->getCollectionFromDb(
            "SELECT `player_id` AS `id`, `player_score` AS `score`, `player_fad_points` AS `fadPoints` FROM `player`"
        );

        // Private: only the current player's hand and Secret Santa(s).
        $result["hand"] = $this->cards->getCardsInLocation(self::LOC_HAND, $currentPlayerId);
        $result["secretSanta"] = $this->secretSantas->getCardsInLocation(self::LOC_HAND, $currentPlayerId);

        // Public zones.
        $result["draftpool"] = $this->cards->getCardsInLocation(self::LOC_DRAFTPOOL);
        $result["trick"]     = $this->getCardsWithExtras(self::LOC_TRICK);
        $result["knitting"]  = $this->getCardsWithExtras(self::LOC_KNITTING);
        $result["activeGameplay"] = $this->gameplayCards->getCardsInLocation('active');

        // Counts of hidden piles (for display) — per player.
        $result["counts"] = [];
        foreach (array_keys($result["players"]) as $pid) {
            $result["counts"][$pid] = [
                "hand" => $this->cards->countCardInLocation(self::LOC_HAND, $pid),
                "pile" => $this->cards->countCardInLocation($this->pileLoc((int) $pid)),
            ];
        }

        // Static material (for client rendering + tooltips).
        $result["material"] = [
            "sweaters"     => Material::sweaters(),
            "fads"         => Material::fads(),
            "secretSantas" => Material::secretSantas(),
            "colors"       => Material::COLORS,
            "icons"        => Material::ICONS,
        ];

        // Round info.
        $result["roundNo"]  = (int) $this->globals->get('roundNo');
        $result["leaderId"] = (int) $this->globals->get('leaderId');

        return $result;
    }

    /** Fetch cards in a location INCLUDING our extension columns (Deck only returns the 5 standard ones). */
    public function getCardsWithExtras(string $location, ?int $locationArg = null): array
    {
        $sql = "SELECT card_id id, card_type type, card_type_arg type_arg, card_location location,
                       card_location_arg location_arg, trick_order trickOrder, build_no buildNo,
                       slot, wild_value wildValue, wild_icon wildIcon
                FROM card WHERE card_location = '" . addslashes($location) . "'";
        if ($locationArg !== null) {
            $sql .= " AND card_location_arg = " . ((int) $locationArg);
        }
        return $this->getCollectionFromDb($sql);
    }

    // ===========================================================================================
    //  Trick / draft helpers (used by the state classes)
    // ===========================================================================================

    /** Players in clockwise play order starting from the leader. */
    public function getTrickPlayerOrder(): array
    {
        $leaderId = (int) $this->globals->get('leaderId');
        return $this->getPlayersInOrderStartingFrom($leaderId);
    }

    /** Build a player_id list in natural table order, rotated to start at $startId. */
    public function getPlayersInOrderStartingFrom(int $startId): array
    {
        $order = array_keys($this->loadPlayersBasicInfos()); // table order (player_no)
        // NOTE: loadPlayersBasicInfos isn't guaranteed ordered by player_no; sort explicitly.
        $rows = $this->getCollectionFromDb("SELECT player_id id, player_no no FROM player ORDER BY player_no");
        $order = array_map(fn($r) => (int) $r['id'], array_values($rows));
        $i = array_search($startId, $order);
        if ($i === false) return $order;
        return array_merge(array_slice($order, $i), array_slice($order, 0, $i));
    }

    /**
     * Whether a card may legally follow the led card: same COLOUR or same ICON (rules), else any card
     * is allowed only if the player can't follow. Returns the set of legally-playable card ids in hand.
     * TODO: needs card icon data (Material::FACES) to evaluate icon-following; until then only colour
     * matching is considered (safe but permissive).
     */
    public function getPlayableCardIds(int $playerId): array
    {
        $hand = $this->cards->getCardsInLocation(self::LOC_HAND, $playerId);
        $trick = $this->cards->getCardsInLocation(self::LOC_TRICK);
        if (empty($trick)) {
            return array_map(fn($c) => (int) $c['id'], array_values($hand)); // leader: anything
        }
        $led = $this->getLedCard();
        $matching = [];
        foreach ($hand as $c) {
            if ($this->cardFollows($c, $led)) {
                $matching[] = (int) $c['id'];
            }
        }
        // If the player can follow, they must; otherwise they may play anything.
        if (!empty($matching)) {
            return $matching;
        }
        return array_map(fn($c) => (int) $c['id'], array_values($hand));
    }

    /** The card led this trick (lowest trick_order), or null. */
    public function getLedCard(): ?array
    {
        $trick = $this->getCardsWithExtras(self::LOC_TRICK);
        $led = null;
        foreach ($trick as $c) {
            if ($led === null || (int) $c['trickOrder'] < (int) $led['trickOrder']) {
                $led = $c;
            }
        }
        return $led;
    }

    /** Does $card follow $led by colour or icon? */
    public function cardFollows(array $card, ?array $led): bool
    {
        if ($led === null) return true;
        if ($card['type'] === $led['type']) return true; // same colour (card_type)
        // TODO: icon match — requires Material::FACES icon data; patches keep colour only.
        $cf = Material::sweaters()["{$card['type']}_{$card['type_arg']}"] ?? null;
        $lf = Material::sweaters()["{$led['type']}_{$led['type_arg']}"] ?? null;
        if ($cf && $lf && $cf['icon'] !== null && $cf['icon'] === $lf['icon']) return true;
        return false;
    }

    /**
     * Resolve the completed trick into a draft order (array of player_ids best-first) and store it.
     * Priority: Perfect Fit (super trump, later player wins; "Ultimate Trump" = PF + Trendy-Yarn colour)
     *           -> Trendy Yarn colour (highest value) -> raw value. Ties: later player wins.
     * TODO: full Perfect Fit / Trendy Yarn / Ultimate-Trump logic (needs active gameplay cards).
     *       Current implementation ranks by value then play order — a correct fallback when no
     *       Perfect Fit / Trendy Yarn is active.
     */
    public function resolveTrickToDraftOrder(): array
    {
        $trick = $this->getCardsWithExtras(self::LOC_TRICK);

        $effValue = function (array $c): int {
            // patches use wild_value when resolved, else their copied/own value
            return $c['wildValue'] !== null ? (int) $c['wildValue'] : (int) $c['type_arg'];
        };

        // Sort best-first: higher value wins; tie -> later trick_order wins.
        usort($trick, function ($a, $b) use ($effValue) {
            $va = $effValue($a); $vb = $effValue($b);
            if ($va !== $vb) return $vb <=> $va;
            return (int) $b['trickOrder'] <=> (int) $a['trickOrder'];
        });

        $order = array_map(fn($c) => (int) $c['location_arg'], $trick); // location_arg = player who played
        $this->globals->set('draftOrder', $order);
        $this->globals->set('draftIndex', 0);
        return $order;
    }

    /** Move a played card into the trick, recording play order. */
    public function moveCardToTrick(int $cardId, int $playerId): void
    {
        $order = $this->cards->countCardInLocation(self::LOC_TRICK) + 1;
        $this->cards->moveCard($cardId, self::LOC_TRICK, $playerId);
        static::DbQuery("UPDATE card SET trick_order = $order WHERE card_id = $cardId");
        // TODO: if the card is a patch, resolve wild_value/wild_icon (lead = chosen; otherwise copy the
        //       previously played card). Needs the patch UI + card icon data.
    }

    /**
     * Place a drafted card into the active player's knitting area.
     * Default: start a new build, slot = the card's printed orientation.
     * TODO: let the player choose the build, slot and (for patches) value/icon/orientation; "place over".
     */
    public function placeDraftedCard(int $cardId, int $playerId): void
    {
        $maxBuild = 0;
        foreach ($this->getCardsWithExtras(self::LOC_KNITTING, $playerId) as $c) {
            $maxBuild = max($maxBuild, (int) $c['buildNo']);
        }
        $build = $maxBuild + 1;
        $card = $this->cards->getCard($cardId);
        $face = Material::sweaters()["{$card['type']}_{$card['type_arg']}"] ?? null;
        $slot = $face['slot'] ?? Material::SLOT_LEFT;
        $this->cards->moveCard($cardId, self::LOC_KNITTING, $playerId);
        static::DbQuery("UPDATE card SET build_no = $build, slot = '" . addslashes((string) $slot) . "' WHERE card_id = $cardId");
    }

    /** Trade-area cards become the next trick's draft pool. */
    public function rotateTrickToPool(): void
    {
        $this->cards->moveAllCardsInLocation(self::LOC_TRICK, self::LOC_DRAFTPOOL);
        static::DbQuery("UPDATE card SET trick_order = NULL WHERE card_location = '" . self::LOC_DRAFTPOOL . "'");
    }

    /** Refill every hand up to HAND_SIZE from each player's personal pile. */
    public function refillHands(): void
    {
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            $need = self::HAND_SIZE - $this->cards->countCardInLocation(self::LOC_HAND, (int) $pid);
            if ($need > 0) {
                $this->cards->pickCards($need, $this->pileLoc((int) $pid), (int) $pid);
            }
        }
    }

    public function allHandsEmpty(): bool
    {
        return $this->cards->countCardInLocation(self::LOC_HAND) === 0;
    }

    /** Count completed sweaters (a build holding an L, R and B piece) in a player's knitting area. */
    public function countCompletedSweaters(int $playerId): int
    {
        $byBuild = [];
        foreach ($this->getCardsWithExtras(self::LOC_KNITTING, $playerId) as $c) {
            $byBuild[(int) $c['buildNo']][$c['slot']] = true;
        }
        $done = 0;
        foreach ($byBuild as $slots) {
            if (isset($slots[Material::SLOT_LEFT], $slots[Material::SLOT_RIGHT], $slots[Material::SLOT_BOTTOM])) {
                $done++;
            }
        }
        return $done;
    }

    /** Round ends when a player completes their 3rd sweater (base) or all hands are exhausted. */
    public function isRoundOver(): bool
    {
        if ($this->allHandsEmpty()) {
            return true;
        }
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            if ($this->countCompletedSweaters((int) $pid) >= 3) {
                return true;
            }
        }
        return false;
    }

    /**
     * Score the round into player_score.
     * TODO: full scoring — sweater build (+2), three consecutive numbers (+2), Fad (+3 per objective),
     *       non-Fad colour/icon match (+1), Secret Santa (+3). Needs card icon data + active Fad.
     *       For now only the completed-sweater base points are awarded.
     */
    public function scoreRound(): void
    {
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            $vp = $this->countCompletedSweaters((int) $pid) * Material::VP_SWEATER;
            if ($vp > 0) {
                $this->bga->playerScore->inc((int) $pid, $vp);
            }
        }
    }

    public function getGameProgression()
    {
        $round = (int) $this->globals->get('roundNo');
        return min(100, (int) floor((($round - 1) / 3) * 100));
    }

    public function upgradeTableDb($from_version) {}

    // ===========================================================================================
    //  Debug helpers
    // ===========================================================================================

    public function debug_goToState(int $state = 10)
    {
        $this->gamestate->jumpToState($state);
    }
}
