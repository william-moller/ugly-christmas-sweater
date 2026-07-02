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

    /**
     * When true, the game routes to the GameStopped dead-end instead of actually ending, so a finished
     * table stays open for inspection. Forced on in the Studio environment (see __construct); always
     * false in production. (Pattern borrowed from the "collect" reference game.)
     */
    public bool $preventEndGame = false;

    /** Difficulty game option (gameoptions.jsonc id 100): which round-parameter decks are revealed. */
    const OPT_DIFFICULTY = 100;
    const DIFF_BEGINNER  = 0; // Fads only
    const DIFF_NOVICE    = 1; // Fads + Trendy Yarn
    const DIFF_EXPERT    = 2; // all three (Fads + Trendy Yarn + Perfect Fit) — base game

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

        // On Studio, never truly end a table — keep it open to inspect final scoring/tableaus.
        if ($this->getBgaEnvironment() === 'studio') {
            $this->preventEndGame = true;
        }
    }

    // ===========================================================================================
    //  Player-count derived parameters
    // ===========================================================================================

    /** Cards dealt to each player at the start of a round: 4P=12, 3P=16, 2P=24. */
    public function perPlayerDeal(): int
    {
        return intdiv(48, $this->getPlayersNumber()); // 48 = 52 deck - 4 initial draft pool
    }

    /**
     * How many cards each player plays into the trick per round of the trade phase: 2P=2, else 1.
     * Only used to size the trade phase (trick target = players × cardsPerTurn). Drafting is NOT driven
     * by this — the draft order has one entry per card played, so each 2P player drafts twice by virtue
     * of appearing twice in that order (see resolveTrickToDraftOrder / NextDrafter).
     */
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
        $this->initStat('table', 'rounds', 0);
        foreach (array_keys($players) as $pid) {
            $this->initStat('player', 'sweaters_built', 0, (int) $pid);
            $this->initStat('player', 'runs_scored', 0, (int) $pid);
            $this->initStat('player', 'fad_objectives', 0, (int) $pid); // TODO: increment once Fad scoring is finalised
            $this->initStat('player', 'secret_santas', 0, (int) $pid);  // TODO: increment once Secret Santa is dealt/scored
        }

        // --- Deal the first round and start ---------------------------------------------------
        $this->setupRound();

        return PlayCard::class;
    }

    /** The three gameplay-card decks (each shuffled and revealed independently). */
    const GAMEPLAY_TYPES = ['perfectfit', 'trendyyarn', 'fad'];

    /** Face-down draw pile for a gameplay deck. */
    public function gpDeckLoc(string $type): string
    {
        return "deck_$type";
    }

    /** Revealed stack for a gameplay deck (cards accumulate; the highest location_arg is the current one). */
    public function gpSeenLoc(string $type): string
    {
        return "seen_$type";
    }

    /**
     * Create the Perfect Fit / Trendy Yarn / Fad cards from Material, each into its own face-down draw
     * pile, and shuffle each pile separately.
     */
    public function createGameplayCards(): void
    {
        $byType = ['perfectfit' => [], 'trendyyarn' => [], 'fad' => []];
        foreach (Material::PERFECT_FIT as $value) {
            $byType['perfectfit'][] = ['type' => 'perfectfit', 'type_arg' => $value, 'nbr' => 1];
        }
        foreach (Material::TRENDY_YARN as $color) {
            // store colour as an index so type_arg stays int
            $byType['trendyyarn'][] = ['type' => 'trendyyarn', 'type_arg' => array_search($color, Material::COLORS), 'nbr' => 1];
        }
        foreach (Material::fads() as $fad) {
            $byType['fad'][] = ['type' => 'fad', 'type_arg' => $fad['id'], 'nbr' => 1];
        }
        foreach (self::GAMEPLAY_TYPES as $type) {
            if ($byType[$type]) {
                $this->gameplayCards->createCards($byType[$type], $this->gpDeckLoc($type));
                $this->gameplayCards->shuffle($this->gpDeckLoc($type));
            }
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

    /** UPSERT dynamic per-card extras into card_meta. $fields = ['col' => int|string|null, ...]. */
    public function setCardMeta(int $cardId, array $fields): void
    {
        $cols = array_keys($fields);
        $insertCols = array_merge(['card_id'], $cols);
        $vals = [(string) $cardId];
        foreach ($cols as $c) {
            $vals[] = $this->sqlVal($fields[$c]);
        }
        $updates = array_map(fn($c) => "`$c` = VALUES(`$c`)", $cols);
        static::DbQuery(
            "INSERT INTO `card_meta` (`" . implode('`,`', $insertCols) . "`) VALUES (" . implode(',', $vals) . ")"
            . " ON DUPLICATE KEY UPDATE " . implode(',', $updates)
        );
    }

    private function sqlVal($v): string
    {
        if ($v === null) return 'NULL';
        if (is_int($v)) return (string) $v;
        return "'" . addslashes((string) $v) . "'";
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

        // 4) Reveal the round's gameplay cards (Perfect Fit / Trendy Yarn / Fad).
        $this->revealGameplayCards();

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

    /**
     * Reveal one new card from the top of each gameplay deck. The revealed card goes on top of that
     * deck's "seen" stack (its location_arg = stack index, so the highest is the current one); the
     * previous reveal stays underneath for the rest of the game (never returned to the deck).
     * Called once per round (round 1 in setup, later rounds in NewRound).
     * The Beginner/Novice/Expert difficulty option gates which decks reveal (Fad only / +Trendy Yarn /
     * +Perfect Fit). A deck that isn't revealed this round simply has no active card.
     */
    public function revealGameplayCards(): void
    {
        $allowed = $this->revealableGameplayTypes();
        foreach (self::GAMEPLAY_TYPES as $type) {
            if (!in_array($type, $allowed, true)) {
                continue; // suppressed by the difficulty option
            }
            if ($this->gameplayCards->getCardOnTop($this->gpDeckLoc($type)) === null) {
                continue; // deck exhausted (shouldn't happen within the 3 base rounds)
            }
            $nextArg = $this->gameplayCards->countCardInLocation($this->gpSeenLoc($type));
            $this->gameplayCards->pickCardForLocation($this->gpDeckLoc($type), $this->gpSeenLoc($type), $nextArg);
        }
    }

    /** Which gameplay decks are revealed this game, per the Difficulty option (Fad is always on). */
    public function revealableGameplayTypes(): array
    {
        // Default to Expert (the full base game = all three decks) when the option isn't set for this
        // table — e.g. an Express-started/training table, or a table created before the option existed.
        // Only a player who EXPLICITLY picks Beginner/Novice gets fewer decks.
        $raw = $this->bga->tableOptions->get(self::OPT_DIFFICULTY);
        $difficulty = $raw === null ? self::DIFF_EXPERT : (int) $raw;
        $types = ['fad'];                                   // Beginner: Fads only
        if ($difficulty >= self::DIFF_NOVICE) $types[] = 'trendyyarn'; // Novice: + Trendy Yarn
        if ($difficulty >= self::DIFF_EXPERT) $types[] = 'perfectfit'; // Expert:  + Perfect Fit
        return $types;
    }

    /** The current (most recently revealed) card of a gameplay deck, or null if none revealed yet. */
    public function activeGameplayCard(string $type): ?array
    {
        $best = null;
        foreach ($this->gameplayCards->getCardsInLocation($this->gpSeenLoc($type)) as $c) {
            if ($best === null || (int) $c['location_arg'] > (int) $best['location_arg']) {
                $best = $c;
            }
        }
        return $best;
    }

    /** Per-deck gameplay state for the client: the current face-up card + remaining/seen counts. */
    public function getGameplayState(): array
    {
        $out = [];
        foreach (self::GAMEPLAY_TYPES as $type) {
            $out[$type] = [
                'active'    => $this->activeGameplayCard($type),
                'deckCount' => $this->gameplayCards->countCardInLocation($this->gpDeckLoc($type)),
                'seenCount' => $this->gameplayCards->countCardInLocation($this->gpSeenLoc($type)),
            ];
        }
        return $out;
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
            "SELECT `player_id` AS `id`, `player_name` AS `name`, `player_color` AS `color`,
                    `player_score` AS `score`, `player_fad_points` AS `fadPoints` FROM `player`"
        );

        // Private: only the current player's hand and Secret Santa(s).
        $result["hand"] = $this->cards->getCardsInLocation(self::LOC_HAND, $currentPlayerId);
        $result["secretSanta"] = $this->secretSantas->getCardsInLocation(self::LOC_HAND, $currentPlayerId);

        // Public zones.
        $result["draftpool"] = $this->cards->getCardsInLocation(self::LOC_DRAFTPOOL);
        $result["trick"]     = $this->getCardsWithExtras(self::LOC_TRICK);
        $result["knitting"]  = $this->getCardsWithExtras(self::LOC_KNITTING);
        $result["gameplay"] = $this->getGameplayState();

        // Counts of hidden piles (for display) — per player.
        $result["counts"] = $this->publicCounts();

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

        // Studio-only client affordances (DEBUG button). Always false in production.
        $result["isStudio"] = $this->getBgaEnvironment() === 'studio';

        return $result;
    }

    /** Fetch cards in a location INCLUDING our extension columns (Deck only returns the 5 standard ones). */
    public function getCardsWithExtras(string $location, ?int $locationArg = null): array
    {
        $sql = "SELECT c.card_id id, c.card_type type, c.card_type_arg type_arg, c.card_location location,
                       c.card_location_arg location_arg, m.trick_order trickOrder, m.build_no buildNo,
                       m.slot slot, m.wild_value wildValue, m.wild_icon wildIcon
                FROM `card` c LEFT JOIN `card_meta` m ON m.card_id = c.card_id
                WHERE c.card_location = '" . addslashes($location) . "'";
        if ($locationArg !== null) {
            $sql .= " AND c.card_location_arg = " . ((int) $locationArg);
        }
        return $this->getCollectionFromDb($sql);
    }

    /**
     * A single card's public row (id/type/type_arg/location + card_meta extras) for notifications.
     * Played cards come from a hidden hand, so the face must travel with the notification for other
     * clients to render it.
     */
    public function cardForNotif(int $cardId): array
    {
        $card = $this->cards->getCard($cardId);
        $arg  = is_numeric($card['location_arg']) ? (int) $card['location_arg'] : null;
        $rows = $this->getCardsWithExtras($card['location'], $arg);
        return $rows[$cardId] ?? [
            'id' => $cardId, 'type' => $card['type'], 'type_arg' => $card['type_arg'],
            'location' => $card['location'], 'location_arg' => $card['location_arg'],
        ];
    }

    /**
     * Short public label identifying a card by colour + value, e.g. "Purple 9" — enough to identify
     * the exact card in play (icon + orientation can be inferred). A resolved patch shows its copied
     * value; an unresolved one falls back to "<Colour> Patch".
     * TODO: colour word is not translated here (alpha); revisit for i18n if needed.
     */
    public function cardLabel(int $cardId): string
    {
        $row   = $this->cardForNotif($cardId);
        $color = ucfirst((string) $row['type']);
        $value = $this->effectiveValue($row);
        return $value > 0 ? "$color $value" : "$color Patch";
    }

    /** Public per-player pile/hand counts (counts are public info; card identities are not). */
    public function publicCounts(): array
    {
        $counts = [];
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            $counts[$pid] = [
                'hand' => $this->cards->countCardInLocation(self::LOC_HAND, (int) $pid),
                'pile' => $this->cards->countCardInLocation($this->pileLoc((int) $pid)),
            ];
        }
        return $counts;
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

    /**
     * Trade-phase auto-play, allowed ONLY in the all-public final trick: when every player is down to
     * their last card (nobody holds 2+), the whole trick is forced and public, so the active player's
     * last card can be played for them with no hidden-information leak. Returns that card id, else null.
     *
     * We deliberately never auto-play a single *legal* card outside this case: doing so would reveal
     * that the player could not otherwise follow the led colour/icon, leaking their hand and removing
     * the bluff that they still had a choice between cards.
     */
    public function forcedFinalPlay(int $playerId): ?int
    {
        $hand = array_values($this->cards->getCardsInLocation(self::LOC_HAND, $playerId));
        if (count($hand) !== 1) {
            return null; // the active player isn't on their literal last card
        }
        // Only auto-play once nobody at the table still holds a real choice (2+ cards in hand).
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            if ($this->cards->countCardInLocation(self::LOC_HAND, (int) $pid) > 1) {
                return null;
            }
        }
        return (int) $hand[0]['id'];
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

    /** Does $card follow $led by colour OR icon (either satisfies the follow requirement)? */
    public function cardFollows(array $card, ?array $led): bool
    {
        if ($led === null) return true;
        // Colour never changes, even for a patch (card_type is the colour).
        if ($card['type'] === $led['type']) return true;
        // Icon match. A patch in hand has no icon yet (it stays undetermined until played), so it can
        // only ever follow by colour — handled above. A patch that LED carries a resolved wild_icon.
        $ci = $this->effectiveIcon($card);
        $li = $this->effectiveIcon($led);
        return $ci !== null && $li !== null && $ci === $li;
    }

    /**
     * A card's icon for trick purposes: a resolved patch carries its chosen icon in card_meta
     * (wild_icon); any other card uses its printed face icon (Material::FACES). An unresolved patch
     * (e.g. sitting in hand) has no icon.
     */
    public function effectiveIcon(array $card): ?string
    {
        if (isset($card['wildIcon']) && $card['wildIcon'] !== null && $card['wildIcon'] !== '') {
            return $card['wildIcon'];
        }
        $face = Material::sweaters()["{$card['type']}_{$card['type_arg']}"] ?? null;
        return $face['icon'] ?? null;
    }

    /**
     * A card's value for trick purposes: a resolved patch carries its copied/chosen value in card_meta
     * (wild_value); any other card uses its printed value (card_type_arg). An unresolved patch is 0.
     */
    public function effectiveValue(array $card): int
    {
        if (isset($card['wildValue']) && $card['wildValue'] !== null && $card['wildValue'] !== '') {
            return (int) $card['wildValue'];
        }
        return (int) $card['type_arg'];
    }

    /**
     * Resolve the completed trick into a draft order (array of player_ids best-first) and store it.
     * The full ranking honours the round's trump cards (these rules apply to draft order, not just a
     * single winner), best → worst:
     *   1. Perfect Fit (super-trump): any card whose value == the Perfect Fit number outranks everything.
     *      Within it, an "Ultimate Trump" (also the Trendy Yarn colour) beats a plain Perfect Fit
     *      regardless of play order; otherwise later-played wins.
     *   2. Trendy Yarn colour: any card of the trump colour outranks all non-trump-colour cards
     *      regardless of value; among them, higher value wins.
     *   3. Otherwise: higher value wins.
     * Ties at any tier are broken by play order — the later-played card ranks higher.
     * A card's COLOUR is always its own (a patch's wild only affects value/icon, never colour). When a
     * deck isn't active this round (difficulty), its trump simply doesn't apply.
     */
    public function resolveTrickToDraftOrder(): array
    {
        $trick = $this->getCardsWithExtras(self::LOC_TRICK);

        $pf = $this->activePerfectFit();   // ?int  — the super-trump value, or null
        $ty = $this->activeTrendyYarn();   // ?string — the trump colour, or null

        // Ranking key per card (compared descending): [tier, secondary, trickOrder].
        $rank = function (array $c) use ($pf, $ty): array {
            $value = $this->effectiveValue($c);
            $color = $c['type']; // a patch keeps its own colour
            $isPF  = $pf !== null && $value === $pf;
            $isTY  = $ty !== null && $color === $ty;
            if ($isPF) {
                return [3, $isTY ? 1 : 0, (int) $c['trickOrder']]; // Ultimate Trump (PF+TY) over plain PF
            }
            if ($isTY) {
                return [2, $value, (int) $c['trickOrder']];
            }
            return [1, $value, (int) $c['trickOrder']];
        };

        usort($trick, function ($a, $b) use ($rank) {
            $ra = $rank($a); $rb = $rank($b);
            if ($ra[0] !== $rb[0]) return $rb[0] <=> $ra[0]; // tier
            if ($ra[1] !== $rb[1]) return $rb[1] <=> $ra[1]; // ultimate-flag / value
            return $rb[2] <=> $ra[2];                        // later play ranks higher
        });

        $order = array_map(fn($c) => (int) $c['location_arg'], $trick); // location_arg = player who played
        $this->globals->set('draftOrder', $order);
        $this->globals->set('draftIndex', 0);
        return $order;
    }

    /**
     * Move a played card into the trick, recording play order and (for a Patch) resolving its wild
     * value + icon for trick resolution. A patch copies the value/icon of the card played immediately
     * before it; a patch that LEADS copies a player-chosen draft-pool card ($copyFromCardId). These
     * trade wilds are transient — they're cleared when the card later rotates into the draft pool.
     */
    public function moveCardToTrick(int $cardId, int $playerId, ?int $copyFromCardId = null): void
    {
        $card    = $this->cards->getCard($cardId);
        $isPatch = ((int) $card['type_arg']) === Material::PATCH_VALUE;

        // Resolve the patch's copied value/icon from the trick state BEFORE this card is added.
        $wildValue = null;
        $wildIcon  = null;
        if ($isPatch) {
            $trick = $this->getCardsWithExtras(self::LOC_TRICK);
            if (empty($trick)) {
                // Leading patch: copy a chosen numbered draft-pool card's value + icon.
                $pool   = $this->getCardsWithExtras(self::LOC_DRAFTPOOL);
                $source = $copyFromCardId !== null ? ($pool[$copyFromCardId] ?? null) : null;
                if ($copyFromCardId !== null && ($source === null || $this->effectiveIcon($source) === null)) {
                    throw new \Bga\GameFramework\UserException(
                        clienttranslate('Choose a numbered draft-pool card for the patch to copy')
                    );
                }
                // Fallback (zombie / missing choice): first numbered pool card.
                if ($source === null) {
                    foreach ($pool as $c) {
                        if ($this->effectiveIcon($c) !== null) { $source = $c; break; }
                    }
                }
                if ($source !== null) {
                    $wildValue = $this->effectiveValue($source);
                    $wildIcon  = $this->effectiveIcon($source);
                }
            } else {
                // Following patch: copy the card played immediately before it (highest trick_order).
                $prev = null;
                foreach ($trick as $c) {
                    if ($prev === null || (int) $c['trickOrder'] > (int) $prev['trickOrder']) {
                        $prev = $c;
                    }
                }
                if ($prev !== null) {
                    $wildValue = $this->effectiveValue($prev);
                    $wildIcon  = $this->effectiveIcon($prev);
                }
            }
        }

        $order = $this->cards->countCardInLocation(self::LOC_TRICK) + 1;
        $this->cards->moveCard($cardId, self::LOC_TRICK, $playerId);
        $this->setCardMeta($cardId, [
            'trick_order' => $order,
            'wild_value'  => $wildValue,
            'wild_icon'   => $wildIcon,
        ]);
    }

    /**
     * If the active drafter has no real choice this turn, return the card id to auto-draft; otherwise
     * null (prompt the player). "No choice" = exactly one card left in the pool AND the player has no
     * started sweater, so the only legal move is to begin a new sweater with it — a regular card at its
     * printed slot, or a Patch that simply floats (its value/icon/orientation are all deferred, so there
     * is nothing to choose). Any existing build (oriented or a floating patch) makes "new vs add /
     * place-over / orient" a real choice, so we prompt.
     */
    public function forcedDraft(int $playerId): ?int
    {
        $pool = array_values($this->cards->getCardsInLocation(self::LOC_DRAFTPOOL));
        if (count($pool) !== 1) {
            return null;
        }
        if ($this->cards->countCardInLocation(self::LOC_KNITTING, $playerId) > 0) {
            return null; // already has a started sweater → a real placement choice exists
        }
        return (int) $pool[0]['id'];
    }

    /**
     * Place a drafted card into the active player's knitting area. A regular card uses its PRINTED
     * orientation (Material::FACES). A **Patch** never picks its value/icon here — those stay wild until
     * round-end scoring (see the AssignPatches state). A Patch's orientation:
     *   - starting a NEW sweater → it "floats" (slot = null); orientation is deferred until a second
     *     card is added to that sweater;
     *   - added to an EXISTING sweater → the player picks an open orientation ($slot) now.
     * Whenever the placement adds a card to a sweater that already holds a floating patch, that floating
     * patch is oriented now to $floatingPatchSlot (which must differ from the placed card's slot).
     * The player also chooses which build to place into; filling a slot a build already holds REPLACES
     * the occupant (discarded — "place over"). $buildNo <= 0 / unknown starts a brand-new sweater.
     *
     * @return array{build_no:int,slot:?string,replaced_card_id:?int,floating_patch_id:?int,floating_patch_slot:?string}
     */
    public function placeDraftedCard(
        int $cardId, int $playerId, int $buildNo = 0,
        ?string $slot = null, ?string $floatingPatchSlot = null
    ): array {
        $card    = $this->cards->getCard($cardId);
        $isPatch = ((int) $card['type_arg']) === Material::PATCH_VALUE;

        // Group this player's knitting: oriented pieces per build, and any floating patch per build.
        $builds = [];          // buildNo => [slot => cardId]
        $floatingByBuild = []; // buildNo => floating patch cardId (slot = null)
        foreach ($this->getCardsWithExtras(self::LOC_KNITTING, $playerId) as $c) {
            $b = (int) $c['buildNo'];
            if ($c['slot'] !== null) {
                $builds[$b][$c['slot']] = (int) $c['id'];
            } else {
                $floatingByBuild[$b] = (int) $c['id'];
            }
        }
        $allBuildNos = array_unique(array_merge(array_keys($builds), array_keys($floatingByBuild)));

        // Target an existing build, or open a new one.
        $knownBuild  = $buildNo > 0 && in_array($buildNo, $allBuildNos, true);
        $targetBuild = $knownBuild ? $buildNo : (empty($allBuildNos) ? 1 : max($allBuildNos) + 1);

        // Resolve the drafted card's slot (value/icon are always deferred to scoring now).
        if ($isPatch) {
            if (!$knownBuild) {
                $resolvedSlot = null; // floating: orientation deferred until a 2nd card joins
            } else {
                if (!in_array($slot, Material::SLOTS, true)) {
                    throw new \Bga\GameFramework\UserException(clienttranslate('Choose an orientation (L, R or B) for the patch'));
                }
                $resolvedSlot = $slot;
            }
        } else {
            $face         = Material::sweater($card['type'], (int) $card['type_arg']);
            $resolvedSlot = $face['slot'];
        }

        // If the target build holds a floating patch, this placement is the second card that orients it.
        $floatingId       = $floatingByBuild[$targetBuild] ?? null;
        $floatingResolved = null;
        if ($floatingId !== null) {
            if (!in_array($floatingPatchSlot, Material::SLOTS, true)) {
                throw new \Bga\GameFramework\UserException(clienttranslate('Choose an orientation for your floating patch'));
            }
            if ($resolvedSlot !== null && $floatingPatchSlot === $resolvedSlot) {
                throw new \Bga\GameFramework\UserException(clienttranslate('The floating patch needs a different orientation from the card you are adding'));
            }
            if (isset($builds[$targetBuild][$floatingPatchSlot])) {
                throw new \Bga\GameFramework\UserException(clienttranslate('That orientation is already filled'));
            }
            $floatingResolved = $floatingPatchSlot;
        }

        // "Place over": if the drafted card has a concrete slot already filled in the build, discard it.
        $replacedId = $resolvedSlot !== null ? ($builds[$targetBuild][$resolvedSlot] ?? null) : null;
        if ($replacedId !== null) {
            $this->cards->moveCard($replacedId, self::LOC_DISCARD, 0);
            $this->setCardMeta($replacedId, [
                'build_no' => null, 'slot' => null, 'wild_value' => null, 'wild_icon' => null,
            ]);
        }

        // Orient the floating patch (if any) now that a second card joins its sweater.
        if ($floatingId !== null) {
            $this->setCardMeta($floatingId, ['slot' => $floatingResolved]);
        }

        $this->cards->moveCard($cardId, self::LOC_KNITTING, $playerId);
        $this->setCardMeta($cardId, [
            'build_no'   => $targetBuild,
            'slot'       => $resolvedSlot,
            'wild_value' => null, // a patch's value/icon are assigned at round-end scoring, not here
            'wild_icon'  => null,
        ]);

        return [
            'build_no'            => $targetBuild,
            'slot'                => $resolvedSlot,
            'replaced_card_id'    => $replacedId,
            'floating_patch_id'   => $floatingId,
            'floating_patch_slot' => $floatingResolved,
        ];
    }

    /**
     * Trade-area cards become the next trick's draft pool. A patch's trade-time wild value/icon do NOT
     * stick — once in the pool it is wild again (the drafter re-chooses on placement), so clear them
     * alongside trick_order.
     */
    public function rotateTrickToPool(): void
    {
        $this->cards->moveAllCardsInLocation(self::LOC_TRICK, self::LOC_DRAFTPOOL);
        static::DbQuery("UPDATE `card_meta` m JOIN `card` c ON c.card_id = m.card_id
                         SET m.trick_order = NULL, m.wild_value = NULL, m.wild_icon = NULL
                         WHERE c.card_location = '" . self::LOC_DRAFTPOOL . "'");
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

    /** The active Fad for the round (round-bonus parameter), or null if none is active. */
    public function activeFad(): ?array
    {
        $c = $this->activeGameplayCard('fad');
        return $c ? (Material::fads()[(int) $c['type_arg']] ?? null) : null;
    }

    /** The active Perfect Fit value (super-trump) this round, or null if that deck isn't revealed. */
    public function activePerfectFit(): ?int
    {
        $c = $this->activeGameplayCard('perfectfit');
        return $c ? (int) $c['type_arg'] : null; // type_arg holds the Perfect Fit value
    }

    /** The active Trendy Yarn colour (trump colour) this round, or null if that deck isn't revealed. */
    public function activeTrendyYarn(): ?string
    {
        $c = $this->activeGameplayCard('trendyyarn');
        // type_arg holds the colour's index into Material::COLORS (kept as an int so type_arg stays int).
        return $c ? (Material::COLORS[(int) $c['type_arg']] ?? null) : null;
    }

    // ===========================================================================================
    //  Patch assignment (round-end): a Patch's value + icon are chosen at scoring, not at placement
    // ===========================================================================================

    /** Card ids of this player's Patches that sit in a COMPLETED sweater but have no value/icon yet. */
    public function unassignedPatchesInCompletedSweaters(int $playerId): array
    {
        $builds = [];
        foreach ($this->getCardsWithExtras(self::LOC_KNITTING, $playerId) as $c) {
            if ($c['slot'] !== null) {
                $builds[(int) $c['buildNo']][$c['slot']] = $c;
            }
        }
        $ids = [];
        foreach ($builds as $bySlot) {
            if (!isset($bySlot[Material::SLOT_LEFT], $bySlot[Material::SLOT_RIGHT], $bySlot[Material::SLOT_BOTTOM])) {
                continue; // incomplete sweater → never scored, so its patch is never assigned
            }
            foreach ($bySlot as $c) {
                if (((int) $c['type_arg']) === Material::PATCH_VALUE
                    && ($c['wildValue'] === null || $c['wildValue'] === '' || $c['wildIcon'] === null || $c['wildIcon'] === '')) {
                    $ids[] = (int) $c['id'];
                }
            }
        }
        return $ids;
    }

    /** playerId => unassigned-patch card ids, for the players who have any (drives the AssignPatches state). */
    public function playersWithUnassignedPatches(): array
    {
        $out = [];
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            $ids = $this->unassignedPatchesInCompletedSweaters((int) $pid);
            if (!empty($ids)) {
                $out[(int) $pid] = $ids;
            }
        }
        return $out;
    }

    /** Assign a Patch's chosen value + icon at round-end (validates ownership + completed-sweater membership). */
    public function assignPatch(int $cardId, int $playerId, int $value, string $icon): void
    {
        if (!in_array($cardId, $this->unassignedPatchesInCompletedSweaters($playerId), true)) {
            throw new \Bga\GameFramework\UserException(clienttranslate('That patch cannot be assigned'));
        }
        if ($value < Material::VALUE_MIN || $value > Material::VALUE_MAX) {
            throw new \Bga\GameFramework\UserException(clienttranslate('Choose a value (1-12) for the patch'));
        }
        if (!in_array($icon, Material::ICONS, true)) {
            throw new \Bga\GameFramework\UserException(clienttranslate('Choose an icon for the patch'));
        }
        $this->setCardMeta($cardId, ['wild_value' => $value, 'wild_icon' => $icon]);
    }

    /**
     * Public (non-Secret-Santa) VP of ONE completed sweater, given its pieces keyed by slot and the
     * active Fad (or null). Covers everything visible to all players: the +2 build, +2 three-
     * consecutive-numbers, Fad objectives (+3 each), and the +1 all-matching-non-Fad bonus.
     * Secret Santa is hidden and is NOT scored here. Returns 0 for an incomplete build.
     */
    public function publicSweaterScore(array $bySlot, ?array $fad): int
    {
        if (!isset($bySlot[Material::SLOT_LEFT], $bySlot[Material::SLOT_RIGHT], $bySlot[Material::SLOT_BOTTOM])) {
            return 0;
        }
        $cards  = [$bySlot[Material::SLOT_LEFT], $bySlot[Material::SLOT_RIGHT], $bySlot[Material::SLOT_BOTTOM]];

        // A completed sweater containing a Patch whose value/icon aren't chosen yet (that happens at
        // round-end, see the AssignPatches state) can only be credited the +2 build for now — its run /
        // Fad / icon bonuses depend on the patch and are added once it's assigned (scoreRound re-scores).
        foreach ($cards as $c) {
            if (((int) $c['type_arg']) === Material::PATCH_VALUE
                && ($c['wildValue'] === null || $c['wildValue'] === '' || $c['wildIcon'] === null || $c['wildIcon'] === '')) {
                return Material::VP_SWEATER;
            }
        }

        $values = array_map(fn($c) => $this->effectiveValue($c), $cards);
        $colors = array_map(fn($c) => $c['type'], $cards);
        $icons  = array_map(fn($c) => $this->effectiveIcon($c), $cards);

        $vp = Material::VP_SWEATER; // +2: every completed L+R+B sweater

        // +2: three consecutive numbers (no wrap, e.g. 11-12-1 does not count).
        sort($values);
        if ($values[1] === $values[0] + 1 && $values[2] === $values[1] + 1) {
            $vp += Material::VP_RUN;
        }

        $allSameColor = count(array_unique($colors)) === 1;
        $allSameIcon  = !in_array(null, $icons, true) && count(array_unique($icons)) === 1;

        if ($fad !== null && !empty($fad['clash'])) {
            // "Clash Is In": +3 when all three pieces differ in BOTH colour and icon. Under Clash every
            // all-one-colour/icon sweater counts as a non-Fad match (+1).
            $allDiffColor = count(array_unique($colors)) === 3;
            $allDiffIcon  = !in_array(null, $icons, true) && count(array_unique($icons)) === 3;
            if ($allDiffColor && $allDiffIcon) {
                $vp += Material::VP_FAD;
            }
            if ($allSameColor || $allSameIcon) {
                $vp += Material::VP_NONFAD_MATCH;
            }
        } else {
            $fadColor = null;
            $fadIcon  = null;
            foreach ($fad['objectives'] ?? [] as $obj) {
                if ($obj['match'] === 'color') $fadColor = $obj['value'];
                if ($obj['match'] === 'icon')  $fadIcon  = $obj['value'];
            }
            // Fad objectives: +3 each; a single sweater can satisfy both colour and icon.
            if ($fadColor !== null && $allSameColor && $colors[0] === $fadColor) $vp += Material::VP_FAD;
            if ($fadIcon  !== null && $allSameIcon  && $icons[0]  === $fadIcon)  $vp += Material::VP_FAD;
            // +1: all one colour OR one icon that is NOT the active Fad (awarded once).
            if (($allSameColor && $colors[0] !== $fadColor) || ($allSameIcon && $icons[0] !== $fadIcon)) {
                $vp += Material::VP_NONFAD_MATCH;
            }
        }

        return $vp;
    }

    /** Total public (non-Secret-Santa) VP a player has earned from their completed sweaters so far. */
    public function livePublicScore(int $playerId): int
    {
        $fad    = $this->activeFad();
        $builds = [];
        foreach ($this->getCardsWithExtras(self::LOC_KNITTING, $playerId) as $c) {
            if ($c['slot'] !== null) {
                $builds[(int) $c['buildNo']][$c['slot']] = $c;
            }
        }
        $total = 0;
        foreach ($builds as $bySlot) {
            $total += $this->publicSweaterScore($bySlot, $fad);
        }
        return $total;
    }

    /**
     * Recompute a player's public score for the current round and apply the change to their total.
     * Called after every placement so the panel reflects completed sweaters' public value live (and
     * correctly drops it again if a "place over" later breaks/changes a scored sweater). We track the
     * amount already applied this round so the cross-round cumulative total stays correct; Secret
     * Santa is added separately at round end (see scoreRound) and is never part of this.
     */
    public function refreshPublicScore(int $playerId): void
    {
        // Stored as a JSON string (globals elsewhere only hold scalars) keyed by player id.
        $applied = json_decode($this->globals->get('appliedPublic') ?? '[]', true);
        $old     = (int) ($applied[$playerId] ?? 0);
        $new     = $this->livePublicScore($playerId);
        if ($new !== $old) {
            $this->bga->playerScore->inc($playerId, $new - $old);
            $applied[$playerId] = $new;
            $this->globals->set('appliedPublic', json_encode($applied));
        }
    }

    /**
     * End-of-round scoring. Public (non-Secret-Santa) points are already reflected live as sweaters
     * complete (see refreshPublicScore), so here we only add the hidden Secret Santa bonus, then clear
     * the live tracker so the next round starts fresh (its knitting area is wiped in NewRound).
     * TODO: Secret Santa scoring (+3 per satisfied objective) once Material::secretSantas() data and
     *       dealing are wired up — currently no Secret Santas are dealt, so this adds nothing.
     */
    public function scoreRound(): void
    {
        // Patches in completed sweaters have now been assigned (see AssignPatches), so re-score every
        // player's public total: livePublicScore now returns the full value (run / Fad / icon bonuses)
        // for patch sweaters that were only credited +2 live, and refreshPublicScore applies the delta.
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            $this->refreshPublicScore((int) $pid);
        }

        // Statistics: count this round's completed sweaters (and runs among them) per player. The
        // knitting area still holds the round's builds at this point (NewRound wipes it next).
        $this->tableStats->inc('rounds', 1);
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            $s = $this->roundSweaterStats((int) $pid);
            if ($s['sweaters'] > 0) $this->playerStats->inc('sweaters_built', $s['sweaters'], (int) $pid);
            if ($s['runs'] > 0)     $this->playerStats->inc('runs_scored',  $s['runs'],     (int) $pid);
        }

        // TODO: foreach player, add VP_SECRET_SANTA per completed sweater satisfying their Secret Santa
        //       (and inc the 'secret_santas' / 'fad_objectives' stats once that scoring is finalised).
        $this->globals->set('appliedPublic', '[]');
    }

    /**
     * Per-player summary of the round just played, for the between-round review screen (see the
     * RoundReview state). Must be called while the round's knitting builds are still in place (i.e. in
     * ScoreRound, before NewRound wipes them). `score` is the cumulative total after this round's
     * public + Secret-Santa points have been applied.
     *
     * @return list<array{player_id:int,player_name:string,sweaters:int,runs:int,score:int}>
     */
    public function roundBreakdown(): array
    {
        $scores = $this->getCollectionFromDb("SELECT `player_id`, `player_score` FROM `player`");
        $rows = [];
        foreach ($this->loadPlayersBasicInfos() as $pid => $info) {
            $s = $this->roundSweaterStats((int) $pid);
            $rows[] = [
                'player_id'   => (int) $pid,
                'player_name' => $info['player_name'],
                'sweaters'    => $s['sweaters'],
                'runs'        => $s['runs'],
                'score'       => (int) ($scores[$pid]['player_score'] ?? 0),
            ];
        }
        return $rows;
    }

    /** Completed-sweater stats for a player's current knitting area: count of sweaters and of runs. */
    public function roundSweaterStats(int $playerId): array
    {
        $builds = [];
        foreach ($this->getCardsWithExtras(self::LOC_KNITTING, $playerId) as $c) {
            if ($c['slot'] !== null) {
                $builds[(int) $c['buildNo']][$c['slot']] = $c;
            }
        }
        $sweaters = 0;
        $runs = 0;
        foreach ($builds as $bySlot) {
            if (!isset($bySlot[Material::SLOT_LEFT], $bySlot[Material::SLOT_RIGHT], $bySlot[Material::SLOT_BOTTOM])) {
                continue;
            }
            $sweaters++;
            $values = array_map(fn($c) => $this->effectiveValue($c), [
                $bySlot[Material::SLOT_LEFT], $bySlot[Material::SLOT_RIGHT], $bySlot[Material::SLOT_BOTTOM],
            ]);
            sort($values);
            if ($values[1] === $values[0] + 1 && $values[2] === $values[1] + 1) {
                $runs++;
            }
        }
        return ['sweaters' => $sweaters, 'runs' => $runs];
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

    /** Studio debug: jump straight to round scoring (handy for exercising the scoring/round-end UI). */
    public function debug_forceRoundOver()
    {
        $this->jumpToState(70); // ScoreRound
    }

    /** Studio debug: nudge a player's score (e.g. to reach the end-game path without playing it out). */
    public function debug_addScore(int $playerId, int $delta)
    {
        $this->bga->playerScore->inc($playerId, $delta);
    }
}
