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
     *
     * TODO: transcribe from the art files. Key = "<color>_<value>".
     *       Format: 'red_7' => ['icon' => self::ICON_SNOWMAN, 'slot' => self::SLOT_LEFT],
     * Anything absent from this map resolves to icon=null / slot=null in sweaters() (flags the gap).
     */
    const FACES = [
        // ----- purple_1 .. purple_12 -----
        // 'purple_1'  => ['icon' => self::ICON_, 'slot' => self::SLOT_],
        // ----- red_1 .. red_12 -----
        // 'red_7'     => ['icon' => self::ICON_SNOWMAN, 'slot' => self::SLOT_LEFT],   // (example only)
        // ----- green_1 .. green_12 -----
        // ----- yellow_1 .. yellow_12 -----
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
                    'icon'  => $face['icon'], // TODO (from art)
                    'slot'  => $face['slot'], // TODO (from art)
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
     * TODO: confirm the 6 printed numbers from the art (values 1..12).
     * @var int[]
     */
    const PERFECT_FIT = [/* TODO e.g. 4, 5, ... (6 values) */];

    /**
     * TRENDY YARN (4 cards) — trump colour for the round. Almost certainly one card per colour.
     * TODO: confirm against the art (each entry is a Material::COLOR_*).
     * @var string[]
     */
    const TRENDY_YARN = self::COLORS; // assumption: one per colour — verify

    /**
     * FADS (10 cards) — round bonus scoring. Each fad lists up to two objectives, each worth VP_FAD.
     * A sweater scores an objective if it is entirely that colour OR entirely that icon.
     * The special "Clash Is In" fad scores when all three pieces are different colours AND icons.
     *
     * Format per fad:
     *   ['id' => int, 'objectives' => [ ['match'=>'color','value'=>COLOR_*], ['match'=>'icon','value'=>ICON_*] ]]
     *   or ['id' => int, 'clash' => true]
     * TODO: transcribe all 10 from the art. Examples below are from the rulebook.
     */
    public static function fads(): array
    {
        return [
            // 1 => ['id'=>1, 'objectives'=>[['match'=>'color','value'=>self::COLOR_RED],   ['match'=>'icon','value'=>self::ICON_CANDY_CANE]]], // "All Red / All Candy Canes"
            // 2 => ['id'=>2, 'objectives'=>[['match'=>'color','value'=>self::COLOR_GREEN], ['match'=>'icon','value'=>self::ICON_TREE]]],       // "All Green / All Trees"
            // 3 => ['id'=>3, 'clash'=>true], // "Clash Is In"
            // ... TODO remaining fads (10 total)
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
     * TODO: transcribe all 16 from the art. Examples below are from the rulebook.
     */
    public static function secretSantas(): array
    {
        return [
            // 1 => ['id'=>1, 'name'=>clienttranslate('Auntie Jaimie'),
            //       'needs'=>['icon:candycane','icon:candycane','color:purple']],     // 2 Candy Canes + 1 Purple
            // 2 => ['id'=>2, 'name'=>clienttranslate('Rambunctious Sister Rain'),
            //       'needs'=>['icon:snowman','icon:snowman','color:yellow']],          // 2 Snowmen + 1 Yellow
            // ... TODO remaining (16 total)
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
