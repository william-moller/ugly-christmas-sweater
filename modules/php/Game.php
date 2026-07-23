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
    /** @var \Bga\GameFramework\Components\Deck\Deck Bonus / Special Ability cards (optional expansion). */
    public $bonusCards;

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

    /** Game mode option (gameoptions.jsonc id 101): Casual = base 3-round game, Express = 1-round variant,
     *  Avid = full 3-round game with 3 must-complete Secret Santas dealt at game start. */
    const OPT_MODE     = 101;
    const MODE_CASUAL  = 0;
    const MODE_EXPRESS = 1;
    const MODE_AVID    = 2;
    const AVID_SECRET_SANTAS = 3; // Secret Santas dealt per player at game start in Avid mode

    /** Bonus cards option (gameoptions.jsonc id 102): deal 1 Special Ability card per player when On. */
    const OPT_BONUS  = 102;
    const BONUS_OFF  = 0;
    const BONUS_ON   = 1;
    const LOC_BONUS_BOX  = 'box';  // undealt bonus cards
    const LOC_BONUS_USED = 'used'; // a one-shot bonus card that has been spent (arg = owner)

    /** Displayed Fads (Express) live here in the gameplayCards deck; claimed ones move to `claimed_fad`. */
    const LOC_FAD_DISPLAY = 'seen_fad';   // reuse the seen stack as the Express fad display
    const LOC_FAD_CLAIMED = 'claimed_fad'; // arg = player who claimed it

    // Card locations (see dbmodel.sql).
    const LOC_SOURCE    = 'deck';      // transient shuffle source during dealing
    const LOC_HAND      = 'hand';      // arg = player_id
    const LOC_DRAFTPOOL = 'draftpool'; // arg = slot 0..3
    const LOC_TRICK     = 'trick';     // arg = player_id (who played)
    const LOC_KNITTING  = 'knitting';  // arg = player_id
    const LOC_DISCARD   = 'discard';

    const HAND_SIZE = 9; // hand is refilled up to this each trick

    // Multiplier used at game end to fold the two final tie-breakers into player_score_aux
    // (#1 fewest unbuilt sweaters, #2 most Fad points). Must exceed any achievable Fad-point total.
    // See EndScore::onEnteringState and scoreRound.
    const TIEBREAK_K = 1000;

    public function __construct()
    {
        parent::__construct();

        // Create the Deck components (createCards happens later, in setupNewGame).
        $this->cards         = $this->deckFactory->createDeck('card');
        $this->gameplayCards = $this->deckFactory->createDeck('gameplay_card');
        $this->secretSantas  = $this->deckFactory->createDeck('secret_santa');
        $this->bonusCards    = $this->deckFactory->createDeck('bonus_card');

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
    //  Game mode (Casual vs Express) derived parameters
    // ===========================================================================================

    /** True when the Express variant is selected (gameoptions.jsonc id 101). Defaults to Casual. */
    public function isExpress(): bool
    {
        return ((int) ($this->bga->tableOptions->get(self::OPT_MODE) ?? self::MODE_CASUAL)) === self::MODE_EXPRESS;
    }

    /** True when the Avid variant is selected (gameoptions.jsonc id 101): full 3-round game, but each
     *  player is dealt 3 Secret Santas at game start that must ALL be completed by game end. */
    public function isAvid(): bool
    {
        return ((int) ($this->bga->tableOptions->get(self::OPT_MODE) ?? self::MODE_CASUAL)) === self::MODE_AVID;
    }

    /** True when the Bonus / Special Ability cards option is On (gameoptions.jsonc id 102). Defaults Off. */
    public function bonusEnabled(): bool
    {
        return ((int) ($this->bga->tableOptions->get(self::OPT_BONUS) ?? self::BONUS_OFF)) === self::BONUS_ON;
    }

    /** Rounds in the game: Express = 1, Casual = 3. */
    public function totalRounds(): int
    {
        return $this->isExpress() ? 1 : 3;
    }

    /** Completed-sweater count that triggers round end: Express = 4, Casual = 3. */
    public function sweatersToEndRound(): int
    {
        return $this->isExpress() ? 4 : 3;
    }

    /** Express: rotate the Trendy Yarn card after every Nth trick — 2P every 3rd, else every 4th. */
    public function trendyRotateEvery(): int
    {
        return $this->getPlayersNumber() === 2 ? 3 : 4;
    }

    /** Express: number of Fad cards on display to be claimed (players + 1). */
    public function fadsOnDisplay(): int
    {
        return $this->getPlayersNumber() + 1;
    }

    /** Secret Santas dealt to each player: Avid = 3 (once, at game start), Express = 2, Casual = 1. */
    public function secretSantasPerPlayer(): int
    {
        if ($this->isAvid())    return self::AVID_SECRET_SANTAS;
        return $this->isExpress() ? 2 : 1;
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
        // Bonus / Special Ability cards (optional expansion): create + deal 1 face-up per player, once,
        // for the whole game. Only when the option is On.
        if ($this->bonusEnabled()) {
            $this->createBonusCards();
            $this->dealBonusCards(array_keys($players));
        }

        // --- Globals --------------------------------------------------------------------------
        $playerIds = array_keys($players);
        $this->globals->set('roundNo', 1);
        $this->globals->set('leaderId', $playerIds[array_rand($playerIds)]); // random opening leader ("1" Draft card)
        $this->globals->set('trickIndex', 0);
        $this->globals->set('draftOrder', []);
        $this->globals->set('draftOrderCards', []);
        $this->globals->set('draftIndex', 0);
        $this->globals->set('scorepad', 'null'); // cumulative end-of-round scorepad, appended per round
        // Avid mode: per-player set of Secret Santa card ids already satisfied (and scored) this game.
        // { pid => [ssCardId, …] }. Tracks cumulative completion across rounds (sweaters are torn down
        // each round) for the game-end "all 3 or your score is 0" gate. Empty/unused outside Avid.
        $this->globals->set('avidSSDone', []);

        // --- Stats (defined in stats.jsonc) ---------------------------------------------------
        $this->initStat('table', 'rounds', 0);
        foreach (array_keys($players) as $pid) {
            $this->initStat('player', 'tricks_won', 0, (int) $pid);          // incremented in ResolveTrick
            $this->initStat('player', 'sweaters_started', 0, (int) $pid);    // the rest are incremented in scoreRound
            $this->initStat('player', 'sweaters_built', 0, (int) $pid);
            $this->initStat('player', 'patches_scored', 0, (int) $pid);
            $this->initStat('player', 'points_sweaters', 0, (int) $pid);
            $this->initStat('player', 'points_runs', 0, (int) $pid);
            $this->initStat('player', 'points_fad', 0, (int) $pid);
            $this->initStat('player', 'points_secret_santa', 0, (int) $pid);
            $this->initStat('player', 'points_nonfad_color', 0, (int) $pid);
            $this->initStat('player', 'points_nonfad_icon', 0, (int) $pid);
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

    /** Create the 4 Bonus / Special Ability cards (optional expansion) into the box, shuffled. */
    public function createBonusCards(): void
    {
        $rows = [];
        foreach (Material::bonusCards() as $bonus) {
            $rows[] = ['type' => 'bonus', 'type_arg' => $bonus['id'], 'nbr' => 1];
        }
        if ($rows) {
            $this->bonusCards->createCards($rows, self::LOC_BONUS_BOX);
            $this->bonusCards->shuffle(self::LOC_BONUS_BOX);
        }
    }

    /** Deal one Bonus card face-up to each player (owned = location 'hand', arg = player_id). */
    public function dealBonusCards(array $playerIds): void
    {
        foreach ($playerIds as $pid) {
            // pickCards moves the top card of the box to this player's owned face-up slot.
            $this->bonusCards->pickCards(1, self::LOC_BONUS_BOX, (int) $pid);
        }
    }

    /** Every player's revealed Bonus card (public; owned face-up). [] when the option is Off. */
    public function bonusState(): array
    {
        $out = [];
        foreach ([self::LOC_HAND, self::LOC_BONUS_USED] as $loc) {
            foreach ($this->bonusCards->getCardsInLocation($loc) as $c) {
                $def = Material::bonusCards()[(int) $c['type_arg']] ?? null;
                $out[] = [
                    'id'       => (int) $c['id'],
                    'bonusId'  => (int) $c['type_arg'],
                    'owner'    => (int) $c['location_arg'],
                    'used'     => $loc === self::LOC_BONUS_USED,
                    'key'      => $def['key']  ?? null,
                    'name'     => $def['name'] ?? '',
                    'text'     => $def['text'] ?? '',
                    'kind'     => $def['kind'] ?? '',
                ];
            }
        }
        return $out;
    }

    /**
     * The (unused) holder of a bonus card type: ['cardId'=>int,'owner'=>int], or null if it was never
     * dealt (fewer players than cards, or the option is Off) or has already been spent.
     */
    public function bonusHolder(int $bonusId): ?array
    {
        foreach ($this->bonusCards->getCardsInLocation(self::LOC_HAND) as $c) {
            if ((int) $c['type_arg'] === $bonusId) {
                return ['cardId' => (int) $c['id'], 'owner' => (int) $c['location_arg']];
            }
        }
        return null;
    }

    /** The player holding an unused copy of $bonusId, or null. */
    public function bonusOwner(int $bonusId): ?int
    {
        return $this->bonusHolder($bonusId)['owner'] ?? null;
    }

    /** True when $playerId holds an unused $bonusId card. */
    public function hasBonus(int $playerId, int $bonusId): bool
    {
        return $this->bonusOwner($bonusId) === $playerId;
    }

    /** Mark a bonus card spent (move to 'used'); no-op if not held. The caller emits the notification. */
    public function markBonusUsed(int $bonusId): void
    {
        $h = $this->bonusHolder($bonusId);
        if ($h !== null) {
            $this->bonusCards->moveCard($h['cardId'], self::LOC_BONUS_USED, $h['owner']);
        }
    }

    /**
     * The Little Brothers Colour Coordinate objective: satisfied when the player has TWO distinct COMPLETED
     * sweaters this round — one of {1 green, 2 red} and another of {1 red, 2 green} (orientation and
     * value/icon ignored; a patch counts as its fixed colour). Worth VP_SECRET_SANTA (3 VP), once per game.
     */
    public function littleBrothersSatisfied(int $playerId): bool
    {
        $reqA = [Material::COLOR_GREEN, Material::COLOR_RED,   Material::COLOR_RED];   sort($reqA);
        $reqB = [Material::COLOR_RED,   Material::COLOR_GREEN, Material::COLOR_GREEN]; sort($reqB);

        $sweaters = []; // sorted colour triple for each completed sweater
        foreach ($this->playerBuilds($playerId) as $bySlot) {
            if (!isset($bySlot[Material::SLOT_LEFT], $bySlot[Material::SLOT_RIGHT], $bySlot[Material::SLOT_BOTTOM])) {
                continue;
            }
            $cols = [
                $bySlot[Material::SLOT_LEFT]['type'],
                $bySlot[Material::SLOT_RIGHT]['type'],
                $bySlot[Material::SLOT_BOTTOM]['type'],
            ];
            sort($cols);
            $sweaters[] = $cols;
        }
        // Need one sweater matching reqA and a DIFFERENT sweater matching reqB.
        foreach ($sweaters as $i => $a) {
            if ($a !== $reqA) continue;
            foreach ($sweaters as $j => $b) {
                if ($j !== $i && $b === $reqB) return true;
            }
        }
        return false;
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
        // 1) Carry-over: per the rules, the 4 most-recent Trade Area cards become the next round's Draft
        //    Pool (EndTrickCleanup already rotated them into LOC_DRAFTPOOL before the round ended, so
        //    whatever sits in the draft pool now IS the carry-over). Keep those cards; reshuffle everything
        //    else into the deal source. On round 1 (called from setupNewGame) the pool is empty, so this
        //    sweeps the whole deck and we deal a fresh pool below — the original behaviour.
        $carryIds = array_map(fn($c) => (int) $c['id'], $this->cards->getCardsInLocation(self::LOC_DRAFTPOOL));

        // Sweep EVERY other card back into the shuffle source: leftover HANDS (a round ends on the sweater
        // trigger, not hand exhaustion, so players are usually still holding cards), personal draw piles,
        // knitting builds and the discard all reshuffle together — nothing a player still held survives
        // into the new deal. Only the draft pool (the final trick's cards) is kept, re-seated below. We move
        // each location explicitly so none is silently missed, then a null catch-all mops up anything else.
        foreach ([self::LOC_HAND, self::LOC_KNITTING, self::LOC_TRICK, self::LOC_DISCARD] as $loc) {
            $this->cards->moveAllCardsInLocation($loc, self::LOC_SOURCE);
        }
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            $this->cards->moveAllCardsInLocation($this->pileLoc((int) $pid), self::LOC_SOURCE);
        }
        $this->cards->moveAllCardsInLocation(null, self::LOC_SOURCE); // catch-all incl. the carry pool (re-seated below)
        $this->cards->shuffle(self::LOC_SOURCE);

        // Wipe all per-card dynamic extras so last round's build/slot/wild data can't bleed into a
        // re-dealt card this round (e.g. a fresh floating patch inheriting a stale wild value). Rows are
        // re-created via setCardMeta as cards are played/placed. Carried pool cards need no meta.
        static::DbQuery('DELETE FROM `card_meta`');

        // 2) Seat the draft pool. Carry-over rounds re-seat the kept cards into slots 0..N; round 1 deals
        //    4 fresh face-up cards from the shuffled source.
        $slot = 0;
        if ($carryIds) {
            foreach ($carryIds as $cid) {
                $this->cards->moveCard($cid, self::LOC_DRAFTPOOL, $slot++);
            }
        } else {
            $pool = $this->cards->pickCardsForLocation(4, self::LOC_SOURCE, self::LOC_DRAFTPOOL);
            foreach ($pool as $c) {
                $this->cards->moveCard($c['id'], self::LOC_DRAFTPOOL, $slot++);
            }
        }

        // 3) Deal personal piles + draw opening hands.
        $perPlayer = $this->perPlayerDeal();
        foreach ($this->loadPlayersBasicInfos() as $pid => $info) {
            $this->cards->pickCardsForLocation($perPlayer, self::LOC_SOURCE, $this->pileLoc($pid));
            $this->cards->pickCards(self::HAND_SIZE, $this->pileLoc($pid), $pid); // pile -> hand
        }

        // 4) Reveal the round's gameplay cards (Perfect Fit / Trendy Yarn / Fad).
        $this->revealGameplayCards();

        // 5) Deal Secret Santas: 1/player in Casual, 2 in Express, 3 in Avid. In Avid they are dealt once
        //    (round 1) and persist all game — dealSecretSantas() no-ops on later rounds.
        $this->dealSecretSantas();

        // 6) Activate the leader to lead the first trick. No trick has resolved yet this round, so the
        //    Draft Order cards are unassigned (the leader just holds the "1" card).
        $this->globals->set('trickIndex', 0);
        $this->globals->set('draftOrderCards', []);
        // Fresh hand: the "last trick / draft phase" banner hasn't been announced yet this round.
        $this->globals->set('handEndAnnounced', 0);
        $this->globals->set('billyDiscardIndex', -1); // no Billy discard pending (bonus)
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
        if ($this->isExpress()) {
            $this->revealExpressGameplay();
            return;
        }
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

    /**
     * Express reveal (ignores the Difficulty option — all three systems are always on): a Fad DISPLAY of
     * players+1 distinct fads to be claimed during the round, plus one Trendy Yarn (rotates on a trick
     * cadence) and one Perfect Fit (replaced when matched). Also initialises the round's Express globals.
     */
    public function revealExpressGameplay(): void
    {
        $n = min($this->fadsOnDisplay(), $this->gameplayCards->countCardInLocation($this->gpDeckLoc('fad')));
        for ($i = 0; $i < $n; $i++) {
            $this->gameplayCards->pickCardForLocation($this->gpDeckLoc('fad'), self::LOC_FAD_DISPLAY, $i);
        }
        $this->globals->set('fadClaims', '{}');

        $this->gameplayCards->pickCardForLocation($this->gpDeckLoc('trendyyarn'), $this->gpSeenLoc('trendyyarn'), 0);
        $this->gameplayCards->pickCardForLocation($this->gpDeckLoc('perfectfit'), $this->gpSeenLoc('perfectfit'), 0);
        $this->globals->set('expressTrickNo', 0);
        $this->globals->set('pfMatched', 0);
    }

    /**
     * Express: advance a single-card gameplay deck (Trendy Yarn / Perfect Fit) to a fresh card. If the
     * draw pile is empty, first reshuffle ALL of that type's cards back into it (the Express "reset the
     * deck" rule), then reveal one on top of the seen stack (activeGameplayCard reads the highest
     * location_arg). Returns the new active card, or null if the type has no cards at all.
     */
    public function rotateGameplayDeck(string $type): ?array
    {
        if ($this->gameplayCards->countCardInLocation($this->gpDeckLoc($type)) === 0) {
            foreach ($this->gameplayCards->getCardsInLocation($this->gpSeenLoc($type)) as $c) {
                $this->gameplayCards->moveCard((int) $c['id'], $this->gpDeckLoc($type));
            }
            $this->gameplayCards->shuffle($this->gpDeckLoc($type));
        }
        if ($this->gameplayCards->getCardOnTop($this->gpDeckLoc($type)) === null) {
            return null;
        }
        $nextArg = $this->gameplayCards->countCardInLocation($this->gpSeenLoc($type));
        $this->gameplayCards->pickCardForLocation($this->gpDeckLoc($type), $this->gpSeenLoc($type), $nextArg);
        return $this->activeGameplayCard($type);
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
        if ($this->isExpress()) {
            // The Express Fad display (unclaimed) + the claimed fads and who/what they're locked to, plus
            // the Round Tracker state: how many tricks have completed (`trickNo`) and how often the Trendy
            // Yarn rotates (`rotateEvery`). The client marks the current round (trickNo + 1) and the
            // upcoming "draw a new Trendy Yarn" spaces (every `rotateEvery`th) from these two numbers.
            $out['express'] = [
                'fadDisplay'  => array_values($this->gameplayCards->getCardsInLocation(self::LOC_FAD_DISPLAY)),
                'fadClaimed'  => array_values($this->gameplayCards->getCardsInLocation(self::LOC_FAD_CLAIMED)),
                'fadClaims'   => $this->fadClaims(),
                'trickNo'     => (int) $this->globals->get('expressTrickNo'),
                'rotateEvery' => $this->trendyRotateEvery(),
            ];
        }
        return $out;
    }

    /** Express Fad claims: map of fadCardId => ['playerId' => int, 'buildNo' => int]. */
    public function fadClaims(): array
    {
        return json_decode($this->globals->get('fadClaims') ?? '{}', true) ?: [];
    }

    /** Deal each player their Secret Santa objective(s) for the round: Casual = 1, Express = 2. */
    public function dealSecretSantas(): void
    {
        // Avid: the 3 Secret Santas are dealt ONCE at game start and persist all game (they must all be
        // completed by game end). After round 1 there is nothing to do — never discard or re-deal them.
        if ($this->isAvid() && (int) $this->globals->get('roundNo') > 1) {
            return;
        }

        // Last round's Secret Santas are spent: DISCARD them out of the game — never back into 'box' — so a
        // Secret Santa someone already held can't be re-dealt later. Only the undealt 'box' is shuffled and
        // drawn from below. (No-op on round 1: no Secret Santas have been dealt yet.)
        $this->secretSantas->moveAllCardsInLocation(self::LOC_HAND, self::LOC_DISCARD);

        $n = $this->secretSantasPerPlayer();
        $this->secretSantas->shuffle('box');
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            if ($this->secretSantas->countCardInLocation('box') <= 0) {
                break; // ran out (shouldn't within a single game)
            }
            $this->secretSantas->pickCards($n, 'box', (int) $pid);
        }
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
        // Bonus / Special Ability cards (optional expansion): every player's revealed card ([] when Off).
        $result["bonus"] = $this->bonusEnabled() ? $this->bonusState() : [];
        // Avid: every player's PUBLICLY revealed satisfied Secret Santas ({} outside Avid). Grows as
        // players complete them; broadcast again on each roundScored notification.
        $result["avidRevealed"] = $this->avidRevealedSecretSantas();

        // Counts of hidden piles (for display) — per player.
        $result["counts"] = $this->publicCounts();

        // Static material (for client rendering + tooltips).
        $result["material"] = [
            "sweaters"     => Material::sweaters(),
            "fads"         => Material::fads(),
            "secretSantas" => Material::secretSantas(),
            "bonus"        => Material::bonusCards(),
            "colors"       => Material::COLORS,
            "icons"        => Material::ICONS,
        ];

        // Round info.
        $result["roundNo"]     = (int) $this->globals->get('roundNo');
        $result["leaderId"]    = (int) $this->globals->get('leaderId');
        // Ordered trade-card ids for the current trick's draft order (empty until a trick resolves) —
        // lets the client restore the Draft Order cards onto the right cards after an F5 mid-draft.
        $result["draftOrderCards"] = $this->globals->get('draftOrderCards') ?: [];
        $result["express"]     = $this->isExpress();
        $result["avid"]        = $this->isAvid();
        $result["totalRounds"] = $this->totalRounds();
        // True once this hand's end has been triggered (a player completed their Nth sweater, or hands
        // are exhausted): the client shows the "last trick & draft phase" banner. Live-computed so an F5
        // during the final draft phase restores it; falls back to false once the next round is dealt.
        $result["handEndTriggered"] = $this->isRoundOver();

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
     *
     * i18n: this composes the colour word server-side, so it is English-only — but it is NOT what the
     * player sees. Every notification that carries a `card_label` also carries the `card` row, and the
     * client's bgaFormatText swaps `card_label` for a translation-safe colour chip (see cardLogChip /
     * cardLogTitle, which use colourName()). This string is only the non-displayed fallback for the rare
     * case the client formatter doesn't run; keep any future notification's `card_label` paired with `card`.
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
                // Cast to int: the Deck component returns counts as strings, and a "0" is truthy on
                // the client — an exhausted pile must serialise as JSON 0 so the UI collapses it to empty.
                'hand' => (int) $this->cards->countCardInLocation(self::LOC_HAND, (int) $pid),
                'pile' => (int) $this->cards->countCardInLocation($this->pileLoc((int) $pid)),
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
        // The trade-area card ids in the same best-first rank order, so the client can lay the numbered
        // Draft Order cards onto the exact card each rank corresponds to (see the client draft-order UI).
        $orderCards = array_map(fn($c) => (int) $c['id'], $trick);
        $this->globals->set('draftOrder', $order);
        $this->globals->set('draftOrderCards', $orderCards);
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

        // Express: if this play matches the current Perfect Fit value, flag it so EndTrickCleanup draws
        // a replacement Perfect Fit at the end of this trick. A patch uses its just-copied wild value.
        if ($this->isExpress()) {
            $playedValue = $isPatch ? (int) $wildValue : (int) $card['type_arg'];
            $pf = $this->activePerfectFit();
            if ($pf !== null && $playedValue === $pf) {
                $this->globals->set('pfMatched', 1);
            }
        }
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
        ?string $slot = null, ?string $floatingPatchSlot = null, ?string $mariaSlot = null
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

        // Express: a sweater that has claimed a Fad is locked — it can never be added to or placed over.
        if ($knownBuild && $this->isExpress() && in_array($targetBuild, $this->lockedBuildsFor($playerId), true)) {
            throw new \Bga\GameFramework\UserException(
                clienttranslate('That sweater has claimed a Fad and can no longer be changed')
            );
        }

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
        } else if ($mariaSlot !== null) {
            // Mixed-up Maria (bonus): a regular card may be placed in ANY chosen orientation, ignoring
            // its printed slot. (Validity of $mariaSlot is enforced by the caller before we get here.)
            $resolvedSlot = $mariaSlot;
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
     * Tina Can Tink (bonus): relocate ONE placed piece to an empty (build, slot) in the player's knitting.
     * $targetBuild <= 0 opens a brand-new sweater. Orientation rules are relaxed here (the whole point of
     * the card is a free re-arrange before scoring); only "don't stack two pieces in one slot" is enforced.
     */
    public function tinaMove(int $playerId, int $cardId, int $targetBuild, string $targetSlot): void
    {
        $mine = $this->getCardsWithExtras(self::LOC_KNITTING, $playerId);
        $byId = [];
        foreach ($mine as $c) {
            $byId[(int) $c['id']] = $c;
        }
        if (!isset($byId[$cardId])) {
            throw new \Bga\GameFramework\UserException(clienttranslate('That is not one of your sweater pieces'));
        }
        if (!in_array($targetSlot, Material::SLOTS, true)) {
            throw new \Bga\GameFramework\UserException(clienttranslate('Choose an orientation (L, R or B)'));
        }
        $buildNos = array_map(fn($c) => (int) $c['buildNo'], $mine);
        $resolvedBuild = $targetBuild > 0 ? $targetBuild : (empty($buildNos) ? 1 : max($buildNos) + 1);

        foreach ($mine as $c) {
            if ((int) $c['id'] !== $cardId && (int) $c['buildNo'] === $resolvedBuild && $c['slot'] === $targetSlot) {
                throw new \Bga\GameFramework\UserException(clienttranslate('That orientation is already filled'));
            }
        }
        $this->setCardMeta($cardId, ['build_no' => $resolvedBuild, 'slot' => $targetSlot]);
    }

    /** Tina Can Tink (bonus): swap the (build, slot) of two placed pieces in the player's knitting. */
    public function tinaSwap(int $playerId, int $cardA, int $cardB): void
    {
        $mine = $this->getCardsWithExtras(self::LOC_KNITTING, $playerId);
        $byId = [];
        foreach ($mine as $c) {
            $byId[(int) $c['id']] = $c;
        }
        if ($cardA === $cardB || !isset($byId[$cardA], $byId[$cardB])) {
            throw new \Bga\GameFramework\UserException(clienttranslate('Choose two different sweater pieces to swap'));
        }
        $a = $byId[$cardA];
        $b = $byId[$cardB];
        $this->setCardMeta($cardA, ['build_no' => (int) $b['buildNo'], 'slot' => $b['slot']]);
        $this->setCardMeta($cardB, ['build_no' => (int) $a['buildNo'], 'slot' => $a['slot']]);
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

    /**
     * Refill every hand up to HAND_SIZE from each player's personal pile.
     * Returns the cards newly drawn per player ([pid => [card rows]]) so the client can animate just
     * those (drawing the top of the pile into the hand) instead of re-dealing the whole hand. A player
     * whose pile is empty draws nothing — their entry is an empty array and their hand is left untouched.
     */
    public function refillHands(): array
    {
        $drawn = [];
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            $pid = (int) $pid;
            $need = self::HAND_SIZE - $this->cards->countCardInLocation(self::LOC_HAND, $pid);
            $drawn[$pid] = $need > 0
                ? array_values($this->cards->pickCards($need, $this->pileLoc($pid), $pid))
                : [];
        }
        return $drawn;
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

    /** Round ends when a player completes the Nth sweater (Casual 3 / Express 4) or all hands are exhausted. */
    public function isRoundOver(): bool
    {
        if ($this->allHandsEmpty()) {
            return true;
        }
        $target = $this->sweatersToEndRound();
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            if ($this->countCompletedSweaters((int) $pid) >= $target) {
                return true;
            }
        }
        return false;
    }

    /** A player's knitting builds keyed buildNo => [slot => card row] (oriented pieces only; floats omitted). */
    public function playerBuilds(int $playerId): array
    {
        $builds = [];
        foreach ($this->getCardsWithExtras(self::LOC_KNITTING, $playerId) as $c) {
            if ($c['slot'] !== null) {
                $builds[(int) $c['buildNo']][$c['slot']] = $c;
            }
        }
        return $builds;
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
    //  Express Fad claiming (a displayed Fad is claimed by the sweater that first satisfies it)
    // ===========================================================================================

    /**
     * VP a completed sweater earns for a given Fad, +3 per objective met: a colour objective when all
     * three pieces share the Fad colour, an icon objective when all three share the Fad icon; a "Clash
     * Is In" Fad awards +3 when all three colours AND icons are distinct. Icons use effectiveIcon, so a
     * sweater with an unassigned patch scores its colour/clash part now and gains the icon part once the
     * patch is assigned at round-end. Returns 0 for an incomplete build or no match.
     */
    public function fadSweaterScore(array $bySlot, array $fad): int
    {
        if (!isset($bySlot[Material::SLOT_LEFT], $bySlot[Material::SLOT_RIGHT], $bySlot[Material::SLOT_BOTTOM])) {
            return 0;
        }
        $cards  = [$bySlot[Material::SLOT_LEFT], $bySlot[Material::SLOT_RIGHT], $bySlot[Material::SLOT_BOTTOM]];
        $colors = array_map(fn($c) => $c['type'], $cards);
        $icons  = array_map(fn($c) => $this->effectiveIcon($c), $cards);
        $allSameColor = count(array_unique($colors)) === 1;
        $allSameIcon  = !in_array(null, $icons, true) && count(array_unique($icons)) === 1;

        if (!empty($fad['clash'])) {
            $allDiffColor = count(array_unique($colors)) === 3;
            $allDiffIcon  = !in_array(null, $icons, true) && count(array_unique($icons)) === 3;
            return ($allDiffColor && $allDiffIcon) ? Material::VP_FAD : 0;
        }
        $vp = 0;
        foreach ($fad['objectives'] ?? [] as $obj) {
            if ($obj['match'] === 'color' && $allSameColor && $colors[0] === $obj['value']) $vp += Material::VP_FAD;
            if ($obj['match'] === 'icon'  && $allSameIcon  && $icons[0]  === $obj['value']) $vp += Material::VP_FAD;
        }
        return $vp;
    }

    /** Express: the buildNos of a player's sweaters that are locked by a claimed Fad (can't be altered). */
    public function lockedBuildsFor(int $playerId): array
    {
        $out = [];
        foreach ($this->fadClaims() as $claim) {
            if ((int) $claim['playerId'] === $playerId) {
                $out[] = (int) $claim['buildNo'];
            }
        }
        return $out;
    }

    /**
     * Express: after a placement, let the ACTING player claim any displayed Fad their tableau now
     * satisfies. Only the acting player is evaluated (their sweaters are the only ones that changed) and
     * this runs between each draft — so two players can never tie for the same Fad (the earlier-in-draft-
     * order player claims it first, and it leaves the display before later players act). A completed,
     * unlocked sweater claims EVERY displayed Fad it satisfies at once — a single sweater can satisfy (and
     * claim) more than one Fad, even two Fads that share the same objective (e.g. "All Trees" on two
     * cards). Each claimed Fad card moves onto that sweater (locking it) and the claim is recorded.
     * @return list<array{fad_id:int, build_no:int, type_arg:int}>
     */
    public function evaluateFadClaims(int $playerId): array
    {
        if (!$this->isExpress()) {
            return [];
        }
        $claims = $this->fadClaims();
        $locked = $this->lockedBuildsFor($playerId);
        $events = [];

        foreach ($this->playerBuilds($playerId) as $buildNo => $bySlot) {
            if (in_array((int) $buildNo, $locked, true)) {
                continue; // already locked by a claimed Fad in an earlier draft
            }
            foreach ($this->gameplayCards->getCardsInLocation(self::LOC_FAD_DISPLAY) as $fadCard) {
                $fad = Material::fads()[(int) $fadCard['type_arg']] ?? null;
                if ($fad === null || $this->fadSweaterScore($bySlot, $fad) <= 0) {
                    continue;
                }
                $fadId = (int) $fadCard['id'];
                $claims[$fadId] = ['playerId' => $playerId, 'buildNo' => (int) $buildNo];
                $this->gameplayCards->moveCard($fadId, self::LOC_FAD_CLAIMED, $playerId);
                $events[] = ['fad_id' => $fadId, 'build_no' => (int) $buildNo, 'type_arg' => (int) $fadCard['type_arg']];
                // No break: this sweater claims every displayed Fad it satisfies, not just the first.
            }
            $locked[] = (int) $buildNo; // this build is now locked → skip it in future evaluations
        }

        if (!empty($events)) {
            $this->globals->set('fadClaims', json_encode($claims));
        }
        return $events;
    }

    /**
     * Express: map of a player's locked buildNo => LIST of the Fad definitions (Material::fads entries)
     * claimed on it. A sweater may claim more than one Fad, so each build maps to a list. Feeding a build's
     * claimed Fads into publicSweaterScore / sweaterParts reuses the "Fad +3 per objective, no +1 non-Fad
     * for a matched attribute" logic — so a claimed monochrome sweater scores +3 (Fad), not +3 and +1.
     * Unlocked builds are absent (callers default to [] — a plain non-Fad +1 per matching attribute).
     */
    public function claimedFadByBuild(int $playerId): array
    {
        $out = [];
        foreach ($this->fadClaims() as $fadId => $claim) {
            if ((int) $claim['playerId'] !== $playerId) {
                continue;
            }
            $fadCard = $this->gameplayCards->getCard((int) $fadId);
            $fad = $fadCard ? (Material::fads()[(int) $fadCard['type_arg']] ?? null) : null;
            if ($fad !== null) {
                $out[(int) $claim['buildNo']][] = $fad;
            }
        }
        return $out;
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
     * Fad + non-Fad VP breakdown for a COMPLETED sweater, given its colours/icons and the list of active
     * Fads. Casual passes the single round Fad wrapped in a one-element list; Express passes every Fad the
     * sweater has CLAIMED — a sweater can claim (and score) more than one. Each Fad objective met is +3
     * (summed across all Fads); an attribute (colour / icon) that is all-one AND matched by NO Fad earns
     * the +1 non-Fad bonus, independently for colour and icon. A "Clash Is In" Fad scores +3 for all-
     * different colour+icon and matches no single attribute, so an all-one attribute under Clash still
     * earns the non-Fad +1. An empty list = no active Fad (every all-one attribute is a non-Fad match).
     * @return array{fad:int, nonfad_color:int, nonfad_icon:int}
     */
    private function fadParts(array $colors, array $icons, array $fads): array
    {
        $allSameColor = count(array_unique($colors)) === 1;
        $allSameIcon  = !in_array(null, $icons, true) && count(array_unique($icons)) === 1;
        $allDiffColor = count(array_unique($colors)) === 3;
        $allDiffIcon  = !in_array(null, $icons, true) && count(array_unique($icons)) === 3;

        $fad = 0;
        $colorIsFad = false; // this sweater's (all-one) colour is claimed by a Fad → not a non-Fad match
        $iconIsFad  = false;
        foreach ($fads as $f) {
            if (!empty($f['clash'])) {
                if ($allDiffColor && $allDiffIcon) $fad += Material::VP_FAD;
                continue; // a Clash Fad matches no single colour/icon attribute
            }
            foreach ($f['objectives'] ?? [] as $obj) {
                if ($obj['match'] === 'color' && $allSameColor && $colors[0] === $obj['value']) { $fad += Material::VP_FAD; $colorIsFad = true; }
                if ($obj['match'] === 'icon'  && $allSameIcon  && $icons[0]  === $obj['value']) { $fad += Material::VP_FAD; $iconIsFad  = true; }
            }
        }
        return [
            'fad'          => $fad,
            'nonfad_color' => ($allSameColor && !$colorIsFad) ? Material::VP_NONFAD_MATCH : 0,
            'nonfad_icon'  => ($allSameIcon  && !$iconIsFad)  ? Material::VP_NONFAD_MATCH : 0,
        ];
    }

    /**
     * Public (non-Secret-Santa) VP of ONE completed sweater, given its pieces keyed by slot and the list
     * of active Fads (see fadParts). Covers everything visible to all players: the +2 build, +2 three-
     * consecutive-numbers, Fad objectives (+3 each), and the +1 all-matching-non-Fad bonus (per attribute).
     * Secret Santa is hidden and is NOT scored here. Returns 0 for an incomplete build.
     */
    public function publicSweaterScore(array $bySlot, array $fads): int
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

        $fp = $this->fadParts($colors, $icons, $fads);
        return $vp + $fp['fad'] + $fp['nonfad_color'] + $fp['nonfad_icon'];
    }

    /** Total public (non-Secret-Santa) VP a player has earned from their completed sweaters so far. */
    public function livePublicScore(int $playerId): int
    {
        // Casual scores every sweater against the single round Fad. Express has no single round Fad — each
        // sweater is scored against the Fad it CLAIMED (locked builds), or null (a monochrome sweater that
        // claimed nothing still earns the +1 non-Fad match). Passing the claimed Fad reuses the base
        // scorer's +3-vs-+1 exclusivity, so there's no double count.
        $express        = $this->isExpress();
        $roundFad       = $express ? null : $this->activeFad();
        $roundFads      = $roundFad !== null ? [$roundFad] : [];
        $claimedByBuild = $express ? $this->claimedFadByBuild($playerId) : [];

        $total = 0;
        foreach ($this->playerBuilds($playerId) as $buildNo => $bySlot) {
            $fads = $express ? ($claimedByBuild[(int) $buildNo] ?? []) : $roundFads;
            $total += $this->publicSweaterScore($bySlot, $fads);
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
     */
    public function scoreRound(): void
    {
        // Patches in completed sweaters have now been assigned (see AssignPatches), so re-score every
        // player's public total: livePublicScore now returns the full value (run / Fad / icon bonuses)
        // for patch sweaters that were only credited +2 live, and refreshPublicScore applies the delta.
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            $this->refreshPublicScore((int) $pid);
        }

        // Per-player build statistics (sweaters started/completed, patches scored, and points by source)
        // are accumulated in the Fad/tie-break loop below, which already walks this round's builds with the
        // right Fad per build. The knitting area still holds the round's builds at this point (NewRound
        // wipes it next). Secret-Santa points are added in the Secret Santa loop just below.
        $this->tableStats->inc('rounds', 1);

        // Secret Santa: +VP_SECRET_SANTA per Secret Santa card whose colour+icon request is met by at
        // least one COMPLETED sweater (scores once per card, not per sweater). Hidden all round; revealed
        // and applied now (the summary shows the yes/no + which sweater satisfied it).
        //   Casual/Express — each card is fresh this round (re-dealt/claimed), so "once" means once this
        //     round: satisfied → +3.
        //   Avid — the same 3 cards persist all game, so "once" means once per GAME. We track which cards
        //     have already been satisfied+scored (globals 'avidSSDone') and only award a card the first
        //     round it is met; a card met again in a later round is skipped (no double-score). The game-end
        //     "all 3 or your score is 0" gate reads the same tracked set (EndScore::onEnteringState).
        $avid      = $this->isAvid();
        $ssDone    = (array) $this->globals->get('avidSSDone');
        $awardThis = []; // Avid: SS cards NEWLY satisfied+scored this round, per pid (for the scorepad + reveal)
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            $pid = (int) $pid;
            $builds   = $this->playerBuilds($pid); // completed-orientation pieces, keyed buildNo => slot => card
            $doneThis = array_map('intval', (array) ($ssDone[$pid] ?? []));

            // Only Secret Santas still open score this round; a single sweater can satisfy at most one, so a
            // maximum matching between the open cards and this round's completed sweaters decides which score.
            $eligible = [];
            foreach ($this->playerSecretSantas($pid) as $ss) {
                if ($avid && in_array((int) $ss['id'], $doneThis, true)) {
                    continue; // already satisfied+scored in an earlier round (Avid: score once per game)
                }
                $eligible[] = $ss;
            }
            foreach ($this->matchSecretSantas($eligible, $builds) as $ssId) {
                $this->bga->playerScore->inc($pid, Material::VP_SECRET_SANTA);
                $this->playerStats->inc('points_secret_santa', Material::VP_SECRET_SANTA, $pid);
                if ($avid) {
                    $doneThis[]        = $ssId;
                    $awardThis[$pid][] = $ssId; // newly revealed this round
                }
            }
            if ($avid) {
                $ssDone[$pid] = $doneThis;
            }
        }
        if ($avid) {
            $this->globals->set('avidSSDone', $ssDone);
            // roundScorepad() reads this to show the correct per-round Secret Santa VP (score-once-per-game
            // means an SS met again in a later round must NOT re-count in that round's column).
            $this->globals->set('avidSSRoundAward', $awardThis);
        }

        // Tie-breaker, Fad tracking + per-source statistics. Per player, walk this round's builds and
        // accumulate:
        //   - player_fad_points : total Fad VP scored (final tie-break #2 = most Fad points)
        //   - player_score_aux  : -(unbuilt sweaters this round), accumulated across rounds
        //                         (final tie-break #1 = fewest unbuilt sweaters). An "unbuilt sweater"
        //                         is any build a player started but did not complete (incl. a lone patch).
        //   - statistics        : sweaters started/completed, patches scored, and points by source
        //                         (build, run, Fad, non-Fad colour, non-Fad icon). Secret-Santa points
        //                         are handled in the Secret Santa loop above; runs/Fad/non-Fad are read
        //                         straight off sweaterParts so the stats match the scored VP exactly.
        $express   = $this->isExpress();
        $roundFad  = $express ? null : $this->activeFad();
        $roundFads = $roundFad !== null ? [$roundFad] : [];
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            $pid = (int) $pid;
            $claimedByBuild = $express ? $this->claimedFadByBuild($pid) : [];

            $byBuild = [];
            foreach ($this->getCardsWithExtras(self::LOC_KNITTING, $pid) as $c) {
                $byBuild[(int) $c['buildNo']][] = $c;
            }

            $fadVp = 0;
            $unbuilt = 0;
            $started = count($byBuild);
            $completed = 0;
            $patches = 0;
            $ptsSweaters = 0;
            $ptsRuns = 0;
            $ptsNonfadColor = 0;
            $ptsNonfadIcon = 0;
            foreach ($byBuild as $buildNo => $cards) {
                $bySlot = [];
                foreach ($cards as $c) {
                    if ($c['slot'] !== null) $bySlot[$c['slot']] = $c;
                }
                if (!isset($bySlot[Material::SLOT_LEFT], $bySlot[Material::SLOT_RIGHT], $bySlot[Material::SLOT_BOTTOM])) {
                    $unbuilt++;
                    continue;
                }
                $fads  = $express ? ($claimedByBuild[$buildNo] ?? []) : $roundFads;
                $parts = $this->sweaterParts($bySlot, $fads);
                $completed++;
                $ptsSweaters    += $parts['build'];
                $ptsRuns        += $parts['run'];
                $fadVp          += $parts['fad'];
                $ptsNonfadColor += $parts['nonfad_color'];
                $ptsNonfadIcon  += $parts['nonfad_icon'];
                foreach ($bySlot as $c) {
                    if (((int) $c['type_arg']) === Material::PATCH_VALUE) $patches++;
                }
            }

            if ($fadVp > 0) {
                static::DbQuery("UPDATE `player` SET `player_fad_points` = `player_fad_points` + $fadVp WHERE `player_id` = $pid");
            }
            if ($unbuilt > 0) {
                static::DbQuery("UPDATE `player` SET `player_score_aux` = `player_score_aux` - $unbuilt WHERE `player_id` = $pid");
            }

            if ($started > 0)        $this->playerStats->inc('sweaters_started', $started, $pid);
            if ($completed > 0)      $this->playerStats->inc('sweaters_built', $completed, $pid);
            if ($patches > 0)        $this->playerStats->inc('patches_scored', $patches, $pid);
            if ($ptsSweaters > 0)    $this->playerStats->inc('points_sweaters', $ptsSweaters, $pid);
            if ($ptsRuns > 0)        $this->playerStats->inc('points_runs', $ptsRuns, $pid);
            if ($fadVp > 0)          $this->playerStats->inc('points_fad', $fadVp, $pid);
            if ($ptsNonfadColor > 0) $this->playerStats->inc('points_nonfad_color', $ptsNonfadColor, $pid);
            if ($ptsNonfadIcon > 0)  $this->playerStats->inc('points_nonfad_icon', $ptsNonfadIcon, $pid);
        }

        // Bonus objective — The Little Brothers Colour Coordinate (+3 VP, once per game). Awarded the first
        // round its two-sweater colour requirement is met by completed sweaters, then the card is spent.
        if ($this->bonusEnabled()) {
            $lbOwner = $this->bonusOwner(Material::BONUS_LITTLE_BROTHERS);
            if ($lbOwner !== null && $this->littleBrothersSatisfied($lbOwner)) {
                $this->bga->playerScore->inc($lbOwner, Material::VP_BONUS_OBJECTIVE);
                $this->markBonusUsed(Material::BONUS_LITTLE_BROTHERS);
            }
        }

        $this->globals->set('appliedPublic', '[]');
    }

    /** A player's revealed Secret Santa objectives: [['id'=>int,'name'=>str,'needs'=>[3 requirements]]]. */
    public function playerSecretSantas(int $playerId): array
    {
        $out = [];
        foreach ($this->secretSantas->getCardsInLocation(self::LOC_HAND, $playerId) as $c) {
            $def = Material::secretSantas()[(int) $c['type_arg']] ?? null;
            if ($def) {
                $out[] = ['id' => (int) $c['type_arg'], 'name' => $def['name'], 'needs' => $def['needs']];
            }
        }
        return $out;
    }

    /**
     * Avid: the Secret Santas each player has satisfied so far this game, made PUBLIC (revealed face-up in
     * that player's area as they are completed at round scoring). Keyed by pid → [{id,name,needs}]. Empty
     * outside Avid. Sourced from the cumulative 'avidSSDone' set that scoreRound maintains, so it survives a
     * page refresh via getAllDatas and is re-broadcast on each roundScored notification.
     */
    public function avidRevealedSecretSantas(): array
    {
        if (!$this->isAvid()) {
            return [];
        }
        $ssDone = (array) $this->globals->get('avidSSDone');
        $out = [];
        foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
            $pid = (int) $pid;
            $out[$pid] = [];
            foreach (array_map('intval', (array) ($ssDone[$pid] ?? [])) as $ssId) {
                $def = Material::secretSantas()[$ssId] ?? null;
                if ($def) {
                    $out[$pid][] = ['id' => $ssId, 'name' => $def['name'], 'needs' => $def['needs']];
                }
            }
        }
        return $out;
    }

    /** True when a piece satisfies a single Secret Santa requirement ("color:x" / "icon:y"); orientation ignored. */
    private function pieceMatchesNeed(array $card, string $need): bool
    {
        [$kind, $val] = array_pad(explode(':', $need, 2), 2, '');
        if ($kind === 'color') return $card['type'] === $val;
        if ($kind === 'icon')  return $this->effectiveIcon($card) === $val;
        return false;
    }

    /**
     * True when a completed sweater's 3 pieces cover all 3 Secret Santa needs — a perfect matching where
     * each distinct piece satisfies one distinct need (each piece may count toward EITHER its colour or
     * its icon). Brute-forces the 3! assignments.
     */
    public function sweaterMatchesNeeds(array $three, array $needs): bool
    {
        if (count($three) !== 3 || count($needs) !== 3) return false;
        foreach ([[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] as $p) {
            $ok = true;
            for ($i = 0; $i < 3; $i++) {
                if (!$this->pieceMatchesNeed($three[$p[$i]], $needs[$i])) { $ok = false; break; }
            }
            if ($ok) return true;
        }
        return false;
    }

    /**
     * Which of the given Secret Santa cards a player can satisfy, given their builds — a SINGLE completed
     * sweater may satisfy AT MOST ONE Secret Santa (even if it meets several), so this is a maximum
     * bipartite matching between the Secret Santa cards and the player's completed sweaters (each sweater
     * used once), maximised so the player scores as many as legitimately possible. Returns the matched
     * Secret Santa ids. Incomplete sweaters never satisfy anything.
     * @param array $secretSantas list of ['id'=>int,'needs'=>[3]]
     * @param array $builds       buildNo => slot => card (from playerBuilds)
     * @return list<int> matched Secret Santa ids
     */
    public function matchSecretSantas(array $secretSantas, array $builds): array
    {
        // Completed sweaters only, as buildNo => [L, R, B].
        $sweaters = [];
        foreach ($builds as $buildNo => $bySlot) {
            if (isset($bySlot[Material::SLOT_LEFT], $bySlot[Material::SLOT_RIGHT], $bySlot[Material::SLOT_BOTTOM])) {
                $sweaters[(int) $buildNo] = [$bySlot[Material::SLOT_LEFT], $bySlot[Material::SLOT_RIGHT], $bySlot[Material::SLOT_BOTTOM]];
            }
        }

        // Adjacency: each Secret Santa (by index) → the buildNos it satisfies.
        $adj = [];
        foreach ($secretSantas as $i => $ss) {
            $adj[$i] = [];
            foreach ($sweaters as $buildNo => $three) {
                if ($this->sweaterMatchesNeeds($three, $ss['needs'])) {
                    $adj[$i][] = $buildNo;
                }
            }
        }

        // Kuhn's algorithm: augment one Secret Santa at a time onto a free / re-assignable sweater.
        $matchBuild = []; // buildNo => Secret Santa index currently holding it
        $matched    = [];
        foreach ($secretSantas as $i => $ss) {
            $seen = [];
            if ($this->augmentSecretSanta($i, $adj, $matchBuild, $seen)) {
                $matched[] = (int) $ss['id'];
            }
        }
        return $matched;
    }

    /** Kuhn augmenting-path step for matchSecretSantas: try to seat Secret Santa $i on some sweater. */
    private function augmentSecretSanta(int $i, array $adj, array &$matchBuild, array &$seen): bool
    {
        foreach ($adj[$i] as $buildNo) {
            if (!empty($seen[$buildNo])) continue;
            $seen[$buildNo] = true;
            if (!isset($matchBuild[$buildNo])
                || $this->augmentSecretSanta($matchBuild[$buildNo], $adj, $matchBuild, $seen)) {
                $matchBuild[$buildNo] = $i;
                return true;
            }
        }
        return false;
    }

    /**
     * Decompose a completed sweater's public VP into its components for the scoring summary:
     * ['build'=>+2, 'run'=>+2 consecutive, 'fad'=>+3 per Fad objective met, 'nonfad_color'=>+1 all-one-
     * non-Fad colour, 'nonfad_icon'=>+1 all-one-non-Fad icon, 'nonfad'=> their sum]. $fads is the list of
     * active Fads (see fadParts) — one for Casual, the sweater's claimed Fads for Express. Mirrors
     * publicSweaterScore exactly, so build+run+fad+nonfad always sum to that total. All zeros if incomplete.
     */
    public function sweaterParts(array $bySlot, array $fads): array
    {
        // 'nonfad' stays as the combined colour+icon total (the scorepad shows one non-Fad row);
        // 'nonfad_color' / 'nonfad_icon' split it for the per-source statistics.
        $parts = ['build' => 0, 'run' => 0, 'fad' => 0, 'nonfad' => 0, 'nonfad_color' => 0, 'nonfad_icon' => 0];
        if (!isset($bySlot[Material::SLOT_LEFT], $bySlot[Material::SLOT_RIGHT], $bySlot[Material::SLOT_BOTTOM])) {
            return $parts; // incomplete sweater never scores
        }
        $cards  = [$bySlot[Material::SLOT_LEFT], $bySlot[Material::SLOT_RIGHT], $bySlot[Material::SLOT_BOTTOM]];
        $parts['build'] = Material::VP_SWEATER;

        $values = array_map(fn($c) => $this->effectiveValue($c), $cards);
        sort($values);
        if ($values[1] === $values[0] + 1 && $values[2] === $values[1] + 1) {
            $parts['run'] = Material::VP_RUN;
        }

        $colors = array_map(fn($c) => $c['type'], $cards);
        $icons  = array_map(fn($c) => $this->effectiveIcon($c), $cards);
        $fp = $this->fadParts($colors, $icons, $fads);
        $parts['fad']          = $fp['fad'];
        $parts['nonfad_color'] = $fp['nonfad_color'];
        $parts['nonfad_icon']  = $fp['nonfad_icon'];
        $parts['nonfad']       = $fp['nonfad_color'] + $fp['nonfad_icon'];
        return $parts;
    }

    /**
     * Full end-of-round scoring detail for the summary overlay (RoundReview / final round). For every
     * player: cumulative score, each sweater they STARTED (complete or not) with a per-component
     * breakdown + whether it satisfies their Secret Santa (gold border), and their revealed Secret
     * Santa(s) with satisfied yes/no + points. Call at scoring time — knitting still in place, patches
     * already assigned. Knitting is public and Secret Santas are revealed at round end, so this is safe.
     */
    /**
     * Cumulative scorepad payload for the end-of-round summary — modelled on the printed ScorePad sheet:
     * category rows × (per player, per round) columns. Called once per round from ScoreRound AFTER
     * scoreRound() has applied the round to player_score. Appends this round's per-player category totals
     * to the persisted `scorepad` global (so prior rounds' columns survive into later rounds and a page
     * refresh) and returns the full accumulated grid.
     *
     * Category rows mirror the pad: Each Sweater Built (+2 each), Three Consecutive Numbers (+2), Fads
     * (+3 each), All Matching Non-Fad Colours & Icons (+1 each), Secret Santa (+3 each). A `bonus` delta
     * per player absorbs anything not captured by those rows (e.g. the Little Brothers bonus objective)
     * so each round's TOTAL always reconciles cumulatively to player_score. Two informational footer
     * counts travel too: unfinished sweaters and Fads completed.
     */
    public function roundScorepad(): array
    {
        $round     = (int) $this->globals->get('roundNo');
        $express   = $this->isExpress();
        $avid      = $this->isAvid();
        $avidAward = $avid ? (array) $this->globals->get('avidSSRoundAward') : [];
        $roundFad  = $express ? null : $this->activeFad();
        $roundFads = $roundFad !== null ? [$roundFad] : [];
        $scores    = $this->getCollectionFromDb("SELECT `player_id`, `player_score` FROM `player`");

        // Prior payload (if any) carries the rounds already recorded; append this round to its history.
        $prev    = json_decode($this->globals->get('scorepad') ?? 'null', true);
        $history = is_array($prev['rounds'] ?? null) ? $prev['rounds'] : [];

        // Cumulative TOTAL per player across already-recorded rounds — lets us derive this round's bonus
        // delta as (score - priorCumulative - thisRoundCategoryTotal).
        $priorCum = [];
        foreach ($history as $entry) {
            foreach (($entry['players'] ?? []) as $pid => $cat) {
                $priorCum[(int) $pid] = ($priorCum[(int) $pid] ?? 0) + (int) ($cat['total'] ?? 0);
            }
        }

        $playersMeta  = [];
        $roundPlayers = [];
        foreach ($this->loadPlayersBasicInfos() as $pid => $info) {
            $pid = (int) $pid;
            $playersMeta[] = [
                'player_id'   => $pid,
                'player_name' => $info['player_name'],
                'color'       => $info['player_color'] ?? '',
            ];

            $claimedByBuild = $express ? $this->claimedFadByBuild($pid) : [];

            $byBuild = [];
            foreach ($this->getCardsWithExtras(self::LOC_KNITTING, $pid) as $c) {
                $byBuild[(int) $c['buildNo']][] = $c;
            }
            ksort($byBuild);

            $built = $run = $fad = $nonfad = 0;
            $unfinished = 0;
            $fadsCompleted = 0;
            foreach ($byBuild as $buildNo => $cards) {
                $bySlot = [];
                foreach ($cards as $c) {
                    if ($c['slot'] !== null) $bySlot[$c['slot']] = $c;
                }
                if (!isset($bySlot[Material::SLOT_LEFT], $bySlot[Material::SLOT_RIGHT], $bySlot[Material::SLOT_BOTTOM])) {
                    $unfinished++;
                    continue;
                }
                $fads    = $express ? ($claimedByBuild[$buildNo] ?? []) : $roundFads;
                $parts   = $this->sweaterParts($bySlot, $fads);
                $built  += $parts['build'];
                $run    += $parts['run'];
                $fad    += $parts['fad'];
                $nonfad += $parts['nonfad'];
                if ($parts['fad'] > 0) $fadsCompleted += intdiv($parts['fad'], Material::VP_FAD);
            }

            // Secret Santa: +VP_SECRET_SANTA per satisfied card.
            //   Casual/Express — each card is fresh this round, so recompute against this round's builds.
            //   Avid — cards persist and score once per GAME, so mirror scoreRound: count only the cards
            //     newly awarded this round (globals 'avidSSRoundAward'), else the column double-counts an
            //     SS met in more than one round and the bonus delta absorbs a phantom mismatch.
            if ($avid) {
                $ss = count((array) ($avidAward[$pid] ?? [])) * Material::VP_SECRET_SANTA;
            } else {
                // Mirror scoreRound: a sweater satisfies at most one Secret Santa, so use the same matching.
                $ss = count($this->matchSecretSantas($this->playerSecretSantas($pid), $this->playerBuilds($pid)))
                    * Material::VP_SECRET_SANTA;
            }

            $categoryTotal = $built + $run + $fad + $nonfad + $ss;
            $score = (int) ($scores[$pid]['player_score'] ?? 0);
            $bonus = $score - ($priorCum[$pid] ?? 0) - $categoryTotal; // absorbs bonus objectives / any remainder

            $roundPlayers[$pid] = [
                'built'         => $built,
                'run'           => $run,
                'fad'           => $fad,
                'nonfad'        => $nonfad,
                'ss'            => $ss,
                'bonus'         => $bonus,
                'total'         => $categoryTotal + $bonus, // == this round's contribution to player_score
                'cumulative'    => $score,                  // running grand total after this round
                'unfinished'    => $unfinished,
                'fadsCompleted' => $fadsCompleted,
            ];
        }

        $history[] = ['round' => $round, 'players' => $roundPlayers];

        $payload = [
            'round'       => $round,
            'totalRounds' => $this->totalRounds(),
            'fad'         => $roundFad,
            'bonus'       => $this->bonusEnabled(),
            'avid'        => $avid,
            'players'     => $playersMeta,
            'rounds'      => $history, // each: { round, players: { pid: {built,run,fad,nonfad,ss,bonus,total,...} } }
        ];
        if ($avid) {
            // Publicly revealed satisfied Secret Santas per player (grows across rounds) — shown face-up in
            // each player's area. On the FINAL round, list players who failed to complete all 3 (their final
            // score is zeroed in EndScore): the summary flags them with an asterisk + note.
            $payload['avidRevealed'] = $this->avidRevealedSecretSantas();
            if ($round >= $this->totalRounds()) {
                $ssDone = (array) $this->globals->get('avidSSDone');
                $dq = [];
                foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
                    $pid = (int) $pid;
                    if (count((array) ($ssDone[$pid] ?? [])) < self::AVID_SECRET_SANTAS) {
                        $dq[] = $pid;
                    }
                }
                $payload['disqualified'] = $dq;
            }
        }
        $this->globals->set('scorepad', json_encode($payload));
        return $payload;
    }

    public function getGameProgression()
    {
        // Express is a single round — track progress by the leading player's sweaters toward the round-end
        // trigger (4). Casual tracks by completed rounds out of 3.
        if ($this->isExpress()) {
            $max = 0;
            foreach (array_keys($this->loadPlayersBasicInfos()) as $pid) {
                $max = max($max, $this->countCompletedSweaters((int) $pid));
            }
            return min(100, (int) floor(($max / $this->sweatersToEndRound()) * 100));
        }
        $round = (int) $this->globals->get('roundNo');
        return min(100, (int) floor((($round - 1) / $this->totalRounds()) * 100));
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
