<?php
/**
 *------
 * Ugly Christmas Sweaters implementation : © Will Moller <will.moller@gmail.com>
 *
 * Static game material for Ugly Christmas Sweaters. Per BGA guidelines, ALL static (non-changing)
 * data lives here, never in the database. The database (dbmodel.sql) stores only dynamic state
 * (card locations, sweater builds, patch wild resolutions, etc.).
 *
 * DRAFT (2026-06-17): structure complete; the per-card ICON and ORIENTATION (and the exact Fad /
 * Secret Santa / Perfect Fit / Trendy Yarn definitions) are printed on the physical cards and must be
 * transcribed from the art files. Search this file for "TODO" to find every gap.
 */
declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater;

class Material
{
    // ---- Colours (= card_type for sweater cards) -------------------------------------------------
    // Each colour also has a distinct on-card pattern for colour-blind accessibility — mirror in CSS.
    const COLOR_PURPLE = 'purple';
    const COLOR_RED    = 'red';
    const COLOR_GREEN  = 'green';
    const COLOR_YELLOW = 'yellow';
    const COLORS = [self::COLOR_PURPLE, self::COLOR_RED, self::COLOR_GREEN, self::COLOR_YELLOW];

    // ---- Icons -----------------------------------------------------------------------------------
    const ICON_SNOWMAN    = 'snowman';
    const ICON_CANDY_CANE = 'candycane';
    const ICON_BELL       = 'bell';
    const ICON_TREE       = 'tree';
    const ICONS = [self::ICON_SNOWMAN, self::ICON_CANDY_CANE, self::ICON_BELL, self::ICON_TREE];

    // ---- Orientation (which third of a sweater a piece is) ---------------------------------------
    const SLOT_LEFT   = 'L';
    const SLOT_RIGHT  = 'R';
    const SLOT_BOTTOM = 'B';
    const SLOTS = [self::SLOT_LEFT, self::SLOT_RIGHT, self::SLOT_BOTTOM];

    // ---- Card value range; patches use value 0 (wild) --------------------------------------------
    const VALUE_MIN  = 1;
    const VALUE_MAX  = 12;
    const PATCH_VALUE = 0;

    // ---- Scoring (Victory Points) ----------------------------------------------------------------
    const VP_SWEATER       = 2; // each completed sweater (L + R + B)
    const VP_RUN           = 2; // three consecutive numbers (no wrap)
    const VP_FAD           = 3; // per Fad objective met (a sweater can meet both objectives)
    const VP_NONFAD_MATCH  = 1; // sweater all-one-colour or all-one-icon that is NOT the active Fad
    const VP_SECRET_SANTA  = 3; // a completed sweater satisfying your Secret Santa

    // ==============================================================================================
    //  SWEATER DECK (52 cards = 48 numbered + 4 patches)
    // ==============================================================================================

    /**
     * Per-card face data: the printed ICON and ORIENTATION for each of the 48 numbered cards.
     * Key = "<color>_<value>". Transcribed from the physical card faces (2026-06-22).
     *
     * Orientation is a PRINTED property of the card (not player-chosen) — only Patches let the player
     * pick the slot. Note the deck's regular structure (a useful integrity check):
     *   - Orientation by value 1..12 is the same for every colour: L R B  B R L  L R B  B R L
     *     (so each colour has exactly 4 of each slot, and 3 cards of each icon).
     *   - Icons run in blocks of three (values 1-3, 4-6, 7-9, 10-12); the block order rotates per colour:
     *     green = bell, snowman, candycane, tree | red = tree, bell, snowman, candycane
     *     yellow = snowman, candycane, tree, bell | purple = candycane, tree, bell, snowman.
     * Anything absent from this map resolves to icon=null / slot=null in sweaters() (flags a gap).
     */
    const FACES = [
        // ----- green_1 .. green_12 -----
        'green_1'   => ['icon' => self::ICON_BELL,       'slot' => self::SLOT_LEFT],
        'green_2'   => ['icon' => self::ICON_BELL,       'slot' => self::SLOT_RIGHT],
        'green_3'   => ['icon' => self::ICON_BELL,       'slot' => self::SLOT_BOTTOM],
        'green_4'   => ['icon' => self::ICON_SNOWMAN,    'slot' => self::SLOT_BOTTOM],
        'green_5'   => ['icon' => self::ICON_SNOWMAN,    'slot' => self::SLOT_RIGHT],
        'green_6'   => ['icon' => self::ICON_SNOWMAN,    'slot' => self::SLOT_LEFT],
        'green_7'   => ['icon' => self::ICON_CANDY_CANE, 'slot' => self::SLOT_LEFT],
        'green_8'   => ['icon' => self::ICON_CANDY_CANE, 'slot' => self::SLOT_RIGHT],
        'green_9'   => ['icon' => self::ICON_CANDY_CANE, 'slot' => self::SLOT_BOTTOM],
        'green_10'  => ['icon' => self::ICON_TREE,       'slot' => self::SLOT_BOTTOM],
        'green_11'  => ['icon' => self::ICON_TREE,       'slot' => self::SLOT_RIGHT],
        'green_12'  => ['icon' => self::ICON_TREE,       'slot' => self::SLOT_LEFT],
        // ----- red_1 .. red_12 -----
        'red_1'     => ['icon' => self::ICON_TREE,       'slot' => self::SLOT_LEFT],
        'red_2'     => ['icon' => self::ICON_TREE,       'slot' => self::SLOT_RIGHT],
        'red_3'     => ['icon' => self::ICON_TREE,       'slot' => self::SLOT_BOTTOM],
        'red_4'     => ['icon' => self::ICON_BELL,       'slot' => self::SLOT_BOTTOM],
        'red_5'     => ['icon' => self::ICON_BELL,       'slot' => self::SLOT_RIGHT],
        'red_6'     => ['icon' => self::ICON_BELL,       'slot' => self::SLOT_LEFT],
        'red_7'     => ['icon' => self::ICON_SNOWMAN,    'slot' => self::SLOT_LEFT],
        'red_8'     => ['icon' => self::ICON_SNOWMAN,    'slot' => self::SLOT_RIGHT],
        'red_9'     => ['icon' => self::ICON_SNOWMAN,    'slot' => self::SLOT_BOTTOM],
        'red_10'    => ['icon' => self::ICON_CANDY_CANE, 'slot' => self::SLOT_BOTTOM],
        'red_11'    => ['icon' => self::ICON_CANDY_CANE, 'slot' => self::SLOT_RIGHT],
        'red_12'    => ['icon' => self::ICON_CANDY_CANE, 'slot' => self::SLOT_LEFT],
        // ----- yellow_1 .. yellow_12 -----
        'yellow_1'  => ['icon' => self::ICON_SNOWMAN,    'slot' => self::SLOT_LEFT],
        'yellow_2'  => ['icon' => self::ICON_SNOWMAN,    'slot' => self::SLOT_RIGHT],
        'yellow_3'  => ['icon' => self::ICON_SNOWMAN,    'slot' => self::SLOT_BOTTOM],
        'yellow_4'  => ['icon' => self::ICON_CANDY_CANE, 'slot' => self::SLOT_BOTTOM],
        'yellow_5'  => ['icon' => self::ICON_CANDY_CANE, 'slot' => self::SLOT_RIGHT],
        'yellow_6'  => ['icon' => self::ICON_CANDY_CANE, 'slot' => self::SLOT_LEFT],
        'yellow_7'  => ['icon' => self::ICON_TREE,       'slot' => self::SLOT_LEFT],
        'yellow_8'  => ['icon' => self::ICON_TREE,       'slot' => self::SLOT_RIGHT],
        'yellow_9'  => ['icon' => self::ICON_TREE,       'slot' => self::SLOT_BOTTOM],
        'yellow_10' => ['icon' => self::ICON_BELL,       'slot' => self::SLOT_BOTTOM],
        'yellow_11' => ['icon' => self::ICON_BELL,       'slot' => self::SLOT_RIGHT],
        'yellow_12' => ['icon' => self::ICON_BELL,       'slot' => self::SLOT_LEFT],
        // ----- purple_1 .. purple_12 -----
        'purple_1'  => ['icon' => self::ICON_CANDY_CANE, 'slot' => self::SLOT_LEFT],
        'purple_2'  => ['icon' => self::ICON_CANDY_CANE, 'slot' => self::SLOT_RIGHT],
        'purple_3'  => ['icon' => self::ICON_CANDY_CANE, 'slot' => self::SLOT_BOTTOM],
        'purple_4'  => ['icon' => self::ICON_TREE,       'slot' => self::SLOT_BOTTOM],
        'purple_5'  => ['icon' => self::ICON_TREE,       'slot' => self::SLOT_RIGHT],
        'purple_6'  => ['icon' => self::ICON_TREE,       'slot' => self::SLOT_LEFT],
        'purple_7'  => ['icon' => self::ICON_BELL,       'slot' => self::SLOT_LEFT],
        'purple_8'  => ['icon' => self::ICON_BELL,       'slot' => self::SLOT_RIGHT],
        'purple_9'  => ['icon' => self::ICON_BELL,       'slot' => self::SLOT_BOTTOM],
        'purple_10' => ['icon' => self::ICON_SNOWMAN,    'slot' => self::SLOT_BOTTOM],
        'purple_11' => ['icon' => self::ICON_SNOWMAN,    'slot' => self::SLOT_RIGHT],
        'purple_12' => ['icon' => self::ICON_SNOWMAN,    'slot' => self::SLOT_LEFT],
    ];

    /**
     * The full 52-card sweater deck.
     * @return array<string, array{color:string,value:int,icon:?string,slot:?string,patch:bool}>
     *         keyed by "<color>_<value>" (value 0 = patch).
     */
    public static function sweaters(): array
    {
        $cards = [];
        foreach (self::COLORS as $color) {
            // One patch per colour — colour is fixed; value/icon/orientation are wild (resolved in DB).
            $cards["{$color}_0"] = [
                'color' => $color, 'value' => self::PATCH_VALUE,
                'icon' => null, 'slot' => null, 'patch' => true,
            ];
            for ($v = self::VALUE_MIN; $v <= self::VALUE_MAX; $v++) {
                $key  = "{$color}_{$v}";
                $face = self::FACES[$key] ?? ['icon' => null, 'slot' => null];
                $cards[$key] = [
                    'color' => $color, 'value' => $v,
                    'icon'  => $face['icon'], // printed face (Material::FACES)
                    'slot'  => $face['slot'], // printed orientation (Material::FACES)
                    'patch' => false,
                ];
            }
        }
        return $cards; // 4 + 48 = 52
    }

    /**
     * Deck setup rows for $this->cards->createCards(self::sweaterDeckRows(), 'deck').
     * Each physical card is unique → nbr 1. card_type = colour, card_type_arg = value (0 = patch).
     * @return list<array{type:string,type_arg:int,nbr:int}>
     */
    public static function sweaterDeckRows(): array
    {
        $rows = [];
        foreach (self::sweaters() as $c) {
            $rows[] = ['type' => $c['color'], 'type_arg' => $c['value'], 'nbr' => 1];
        }
        return $rows; // 52 rows
    }

    // ==============================================================================================
    //  GAMEPLAY CARDS (round parameters)
    // ==============================================================================================

    /**
     * PERFECT FIT (6 cards) — "super trump": a sweater card whose value matches takes the trick.
     * Confirmed 2026-06-24: one card per value 1..6.
     * @var int[]
     */
    const PERFECT_FIT = [1, 2, 3, 4, 5, 6];

    /**
     * TRENDY YARN (4 cards) — trump colour for the round. One card per colour.
     * Confirmed 2026-06-24: exactly one card for each of the four sweater colours.
     * @var string[]
     */
    const TRENDY_YARN = self::COLORS;

    /**
     * FADS (10 cards) — round bonus scoring. Each fad lists up to two objectives, each worth VP_FAD.
     * A sweater scores an objective if it is entirely that colour OR entirely that icon.
     * The special "Clash Is In" fad scores when all three pieces are different colours AND icons.
     *
     * Format per fad:
     *   ['id'=>int, 'title'=>clienttranslate('...'),
     *    'objectives' => [ ['match'=>'color','value'=>COLOR_*], ['match'=>'icon','value'=>ICON_*] ]]
     *   or ['id'=>int, 'title'=>clienttranslate('...'), 'clash'=>true]
     *
     * ⚠️ DECK DISTRIBUTION UNRESOLVED (2026-06-24): the physical Fad deck has **10** cards, but it is
     * not yet confirmed whether that is 2 copies of each of these 5 types, or a different mix (there
     * may be further types not yet transcribed). The 5 types below ARE confirmed; note they form a
     * tidy complete-looking set — one colour⇄icon fad per colour (red⇄candycane, green⇄tree,
     * yellow⇄bell, purple⇄snowman) plus Clash Is In — which hints at "2× each" but is NOT verified.
     * Until the distribution is confirmed the deck is built from these 5 unique fads
     * (gameplayDeckRows keys card_type_arg off 'id'); revisit when the full 10-card list is known.
     */
    public static function fads(): array
    {
        return [
            1 => ['id'=>1, 'title'=>clienttranslate('Clash Is In'), 'clash'=>true], // no matching colours or icons
            2 => ['id'=>2, 'title'=>clienttranslate('All Red / All Candy Canes'),
                  'objectives'=>[['match'=>'color','value'=>self::COLOR_RED],    ['match'=>'icon','value'=>self::ICON_CANDY_CANE]]],
            3 => ['id'=>3, 'title'=>clienttranslate('All Green / All Trees'),
                  'objectives'=>[['match'=>'color','value'=>self::COLOR_GREEN],  ['match'=>'icon','value'=>self::ICON_TREE]]],
            4 => ['id'=>4, 'title'=>clienttranslate('All Yellow / All Bells'),
                  'objectives'=>[['match'=>'color','value'=>self::COLOR_YELLOW], ['match'=>'icon','value'=>self::ICON_BELL]]],
            5 => ['id'=>5, 'title'=>clienttranslate('All Purple / All Snowmen'),
                  'objectives'=>[['match'=>'color','value'=>self::COLOR_PURPLE], ['match'=>'icon','value'=>self::ICON_SNOWMAN]]],
            // TODO: remaining cards to reach 10 physical fads — distribution unresolved (see note above).
        ];
    }

    // ==============================================================================================
    //  SECRET SANTA (16 hidden objectives)
    // ==============================================================================================

    /**
     * Each Secret Santa is a family member requesting a specific 3-piece build, worth VP_SECRET_SANTA.
     * Requirement = exactly 3 tokens the completed sweater must satisfy; each card may count toward
     * EITHER its colour or its icon (orientation is ignored).
     *
     * Format: ['id'=>int, 'name'=>clienttranslate('...'), 'needs'=>['<kind>:<value>', x3]]
     *   where <kind> is 'color' or 'icon'.  e.g. ['icon:candycane','icon:candycane','color:purple'].
     *   'needs' is an unordered multiset of exactly 3 requirements (a completed sweater's 3 pieces
     *   must cover them; each piece counts toward EITHER its colour or its icon, orientation ignored).
     *
     * ⚠️ PARTIAL / UNRESOLVED (2026-06-24): 15 of 16 transcribed; the colour/icon REQUIREMENTS are the
     * trusted data. The 16th card is missing, and TITLES are deliberately NOT recorded here — they vary
     * by game edition, so the publisher art is the source of truth for the exact names, the missing
     * card, and any requirement corrections. 'name' below is a generated placeholder (the requirement
     * spelled out), to be replaced once the art lands.
     *
     * Strong hypothesis for the missing #16 (flagged for verification, NOT yet added): the 15 known
     * cards use 15 distinct (colour, icon) pairs out of the 16 possible — the only absent pair is
     * **purple + candy cane**. Each colour and each icon is otherwise balanced 2×"2-of" + 2×"1-of",
     * which is only completed if #16 is **1 Purple + 2 Candy Canes**. Confirm against the art.
     */
    public static function secretSantas(): array
    {
        return [
            1  => ['id'=>1,  'name'=>clienttranslate('1 Green + 2 Trees'),
                   'needs'=>['color:green', 'icon:tree', 'icon:tree']],
            2  => ['id'=>2,  'name'=>clienttranslate('2 Red + 1 Candy Cane'),
                   'needs'=>['color:red', 'color:red', 'icon:candycane']],
            3  => ['id'=>3,  'name'=>clienttranslate('1 Red + 2 Snowmen'),
                   'needs'=>['color:red', 'icon:snowman', 'icon:snowman']],
            4  => ['id'=>4,  'name'=>clienttranslate('1 Purple + 2 Bells'),
                   'needs'=>['color:purple', 'icon:bell', 'icon:bell']],
            5  => ['id'=>5,  'name'=>clienttranslate('1 Yellow + 2 Candy Canes'),
                   'needs'=>['color:yellow', 'icon:candycane', 'icon:candycane']],
            6  => ['id'=>6,  'name'=>clienttranslate('2 Yellow + 1 Bell'),
                   'needs'=>['color:yellow', 'color:yellow', 'icon:bell']],
            7  => ['id'=>7,  'name'=>clienttranslate('2 Green + 1 Candy Cane'),
                   'needs'=>['color:green', 'color:green', 'icon:candycane']],
            8  => ['id'=>8,  'name'=>clienttranslate('2 Purple + 1 Snowman'),
                   'needs'=>['color:purple', 'color:purple', 'icon:snowman']],
            9  => ['id'=>9,  'name'=>clienttranslate('1 Green + 2 Bells'),
                   'needs'=>['color:green', 'icon:bell', 'icon:bell']],
            10 => ['id'=>10, 'name'=>clienttranslate('2 Green + 1 Snowman'),
                   'needs'=>['color:green', 'color:green', 'icon:snowman']],
            11 => ['id'=>11, 'name'=>clienttranslate('1 Yellow + 2 Snowmen'),
                   'needs'=>['color:yellow', 'icon:snowman', 'icon:snowman']],
            12 => ['id'=>12, 'name'=>clienttranslate('1 Red + 2 Trees'),
                   'needs'=>['color:red', 'icon:tree', 'icon:tree']],
            13 => ['id'=>13, 'name'=>clienttranslate('2 Purple + 1 Tree'),
                   'needs'=>['color:purple', 'color:purple', 'icon:tree']],
            14 => ['id'=>14, 'name'=>clienttranslate('2 Red + 1 Bell'),
                   'needs'=>['color:red', 'color:red', 'icon:bell']],
            15 => ['id'=>15, 'name'=>clienttranslate('2 Yellow + 1 Tree'),
                   'needs'=>['color:yellow', 'color:yellow', 'icon:tree']],
            // 16 => MISSING — likely 1 Purple + 2 Candy Canes (see hypothesis above); add once art confirms.
        ];
    }

    // ==============================================================================================
    //  BONUS / SPECIAL ABILITY CARDS (4 — optional Kickstarter mini-expansion)
    // ==============================================================================================

    /**
     * The 4 Special Ability cards. One is dealt face-up to each player at game start (2-4 players → 2-4
     * of the 4 used); they persist for the whole game. Each is either an 'objective' (a passive VP bonus,
     * like a Secret Santa) or a 'oneshot' (a once-per-game triggered effect, discarded after use).
     *
     * ⚠️ RULES / TEXT PENDING (2026-07-09): 'name' and 'text' below are working placeholders from the
     * CLAUDE.md summary — the publisher's exact card wording is being confirmed. The EFFECTS are not yet
     * implemented; this table only backs the option, deal/reveal, and client display. In particular the
     * Little Brothers objective CONDITION is unknown ('objectiveNeeds' left null until confirmed).
     *
     * Format: ['id'=>int, 'key'=>string, 'name'=>clienttranslate('...'), 'kind'=>'objective'|'oneshot',
     *          'text'=>clienttranslate('...'), 'objectiveNeeds'=>mixed|null (objective cards only)].
     */
    const BONUS_LITTLE_BROTHERS = 1;
    const BONUS_TINA            = 2;
    const BONUS_MARIA           = 3;
    const BONUS_BILLY           = 4;

    public static function bonusCards(): array
    {
        return [
            self::BONUS_LITTLE_BROTHERS => [
                'id' => self::BONUS_LITTLE_BROTHERS, 'key' => 'littlebrothers', 'kind' => 'objective',
                'name' => clienttranslate('The Little Brothers Colour Coordinate'),
                'text' => clienttranslate('Objective (3 VP). Colour-coordination requirement — exact condition pending.'),
                'objectiveNeeds' => null, // TODO: fill in once the publisher confirms the exact condition
            ],
            self::BONUS_TINA => [
                'id' => self::BONUS_TINA, 'key' => 'tina', 'kind' => 'oneshot',
                'name' => clienttranslate('Tina Can Tink'),
                'text' => clienttranslate('One-time: at round end, before scoring, move or swap one placed piece.'),
            ],
            self::BONUS_MARIA => [
                'id' => self::BONUS_MARIA, 'key' => 'maria', 'kind' => 'oneshot',
                'name' => clienttranslate('Mixed-up Maria'),
                'text' => clienttranslate('One-time: place a card into a slot that does not match its orientation.'),
            ],
            self::BONUS_BILLY => [
                'id' => self::BONUS_BILLY, 'key' => 'billy', 'kind' => 'oneshot',
                'name' => clienttranslate("Billy's a Brute"),
                'text' => clienttranslate('One-time: when another player tops the draft order, you draft first and the contested card is discarded.'),
            ],
        ];
    }

    // ==============================================================================================
    //  Helpers
    // ==============================================================================================

    /** Look up a sweater card's static face by colour + value (value 0 = patch). */
    public static function sweater(string $color, int $value): ?array
    {
        return self::sweaters()["{$color}_{$value}"] ?? null;
    }

    /** True if (colour,value) is a patch card. */
    public static function isPatch(int $value): bool
    {
        return $value === self::PATCH_VALUE;
    }
}
