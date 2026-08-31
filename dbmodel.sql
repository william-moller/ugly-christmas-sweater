
-- ------
-- BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
-- UglyChristmasSweater implementation : © Will Moller <will.moller@gmail.com>
--
-- This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
-- See http://en.boardgamearena.com/#!doc/Studio for more information.
-- -----

-- Database schema for Ugly Christmas Sweaters.
-- The standard tables ("global", "stats", "gamelog", "player") already exist and must not be re-created.
-- The schema is (re)built from this file only when a new game starts.
--
-- Only DYNAMIC state lives here. Static card data (faces, fad/Secret Santa/bonus definitions, VP values)
-- lives in modules/php/Material.php, per the BGA guideline.


-- =====================================================================
-- card : the 52-card sweater deck (48 numbered + 4 patches)
-- Managed by the BGA "Deck" component:  $this->cards = $this->deckFactory->createDeck('card');
--   card_type      = colour ('purple' | 'red' | 'green' | 'yellow')         [static, see Material::COLORS]
--   card_type_arg  = value 1..12  (0 = patch / wild)                        [static]
--   card_location  = see the Game::LOC_* constants:
--                      'deck'       transient shuffle source while dealing  (Game::LOC_SOURCE)
--                      'pile_<pid>' a player's personal face-down pile      (Game::pileLoc)
--                      'hand'       arg = player_id                         (LOC_HAND)
--                      'draftpool'  arg = slot 0..3                         (LOC_DRAFTPOOL)
--                      'trick'      arg = player_id who played it           (LOC_TRICK)
--                      'knitting'   arg = player_id                         (LOC_KNITTING)
--                      'discard'                                            (LOC_DISCARD)
-- A Deck-backed table takes its NAME from createDeck(), but its COLUMNS must always be the five
-- card_* ones below — the component's own SQL selects them by those names regardless of table name.
-- Our dynamic per-card extras therefore live in a separate table (card_meta, below).
-- =====================================================================
CREATE TABLE IF NOT EXISTS `card` (
  `card_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `card_type` VARCHAR(8) NOT NULL,
  `card_type_arg` INT NOT NULL,
  `card_location` VARCHAR(16) NOT NULL,
  `card_location_arg` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`card_id`),
  KEY `idx_location` (`card_location`, `card_location_arg`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 AUTO_INCREMENT=1;

-- =====================================================================
-- card_meta : dynamic per-card extras that the Deck component does not manage.
-- One row per card (card_id matches `card`.card_id). Maintained via Game::setCardMeta (UPSERT), and
-- read back by Game::getCardsWithExtras, which LEFT JOINs it onto `card`.
--   trick_order : play order within the current trick (resolution tie-breaks; Perfect-Fit "later wins")
--   build_no    : which sweater build in the owner's knitting area
--   slot        : 'L' | 'R' | 'B' — orientation slot occupied when placed in a build (NULL = floating patch)
--   wild_value / wild_icon : patch resolution (in a trick = copied; in knitting = chosen at round end)
-- Wiped wholesale at the start of each round (Game::setupRound) so last round's build data cannot
-- bleed into a re-dealt card.
-- =====================================================================
CREATE TABLE IF NOT EXISTS `card_meta` (
  `card_id` INT UNSIGNED NOT NULL,
  `trick_order` TINYINT UNSIGNED DEFAULT NULL,
  `build_no` TINYINT UNSIGNED DEFAULT NULL,
  `slot` CHAR(1) DEFAULT NULL,
  `wild_value` TINYINT UNSIGNED DEFAULT NULL,
  `wild_icon` VARCHAR(12) DEFAULT NULL,
  PRIMARY KEY (`card_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =====================================================================
-- gameplay_card : Perfect Fit / Trendy Yarn / Fad cards (the round parameters)
-- A second Deck:  $this->gameplayCards = $this->deckFactory->createDeck('gameplay_card');
--   card_type      = 'perfectfit' | 'trendyyarn' | 'fad'                    (Game::GAMEPLAY_TYPES)
--   card_type_arg  = Perfect Fit value / index into Material::COLORS / Fad id
--   card_location  = 'deck_<type>'   face-down draw pile per type           (Game::gpDeckLoc)
--                    'seen_<type>'   revealed stack, arg = stack index      (Game::gpSeenLoc)
--                                    the HIGHEST arg is the active card     (Game::activeGameplayCard)
--                    'claimed_fad'   Express only, arg = claiming player_id (LOC_FAD_CLAIMED)
--   NB 'seen_fad' doubles as the Express Fad DISPLAY (Game::LOC_FAD_DISPLAY), arg = display slot.
-- Casual/Avid: one card per revealed type flips per round, older reveals stay under it. Express:
-- Trendy Yarn rotates on a trick cadence and Perfect Fit is replaced when matched, each reshuffling
-- its own seen stack back into the draw pile when it empties (Game::rotateGameplayDeck).
-- =====================================================================
CREATE TABLE IF NOT EXISTS `gameplay_card` (
  `card_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `card_type` VARCHAR(12) NOT NULL,
  `card_type_arg` INT NOT NULL,
  `card_location` VARCHAR(20) NOT NULL,
  `card_location_arg` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`card_id`),
  KEY `idx_gp_location` (`card_location`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 AUTO_INCREMENT=1;


-- =====================================================================
-- secret_santa : per-player hidden objective cards (16 total)
-- A Deck:  $this->secretSantas = $this->deckFactory->createDeck('secret_santa');
--   card_type_arg  = Secret Santa card id (maps to Material::secretSantas)
--   card_location  = 'box' (undealt) | 'hand' (held, arg = player_id) | 'discard' (spent, out of play)
-- Casual: 1 dealt per player per round. Express: 2. Both discard last round's before re-dealing, so a
-- card someone has held cannot come back. Avid: 3 dealt per player at game start, never re-dealt; they
-- must ALL be completed by game end (tracked in the 'avidSSDone' global, gated in States/EndScore).
-- =====================================================================
CREATE TABLE IF NOT EXISTS `secret_santa` (
  `card_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `card_type` VARCHAR(8) NOT NULL DEFAULT 'ss',
  `card_type_arg` INT NOT NULL,
  `card_location` VARCHAR(12) NOT NULL DEFAULT 'box',
  `card_location_arg` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`card_id`),
  KEY `idx_ss_owner` (`card_location`, `card_location_arg`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 AUTO_INCREMENT=1;


-- =====================================================================
-- bonus_card : the 4 "Special Ability" cards (optional Kickstarter expansion, gameoptions id 102)
-- A Deck:  $this->bonusCards = $this->deckFactory->createDeck('bonus_card');
--   card_type_arg  = bonus card id 1..4 (maps to Material::bonusCards / BONUS_* constants)
--   card_location  = 'box' (undealt) | 'hand' (owned face-up, arg = player_id) | 'used' (one-shot spent)
-- Dealt 1 face-up per player at game start when the option is On; persist for the whole game.
-- =====================================================================
CREATE TABLE IF NOT EXISTS `bonus_card` (
  `card_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `card_type` VARCHAR(8) NOT NULL DEFAULT 'bonus',
  `card_type_arg` INT NOT NULL,
  `card_location` VARCHAR(12) NOT NULL DEFAULT 'box',
  `card_location_arg` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`card_id`),
  KEY `idx_bonus_owner` (`card_location`, `card_location_arg`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 AUTO_INCREMENT=1;


-- =====================================================================
-- player table extensions
-- player_score      (built-in) = cumulative VP across rounds (the winner metric)
-- player_score_aux  (built-in) = accumulates -(unbuilt sweaters) per round, then is folded at game end
--                                into the composite -(unbuilt) * Game::TIEBREAK_K + player_fad_points
--                                (States/EndScore; gameinfos "tie_breaker_split" splits it for display)
-- player_fad_points (below)    = total Fad VP scored across the game — tie-break #2
--
-- ⚠️ INT UNSIGNED here is load-bearing in the wrong direction: MySQL evaluates a whole expression as
-- BIGINT UNSIGNED if ANY operand is unsigned, and the EndScore fold multiplies a deliberately NEGATIVE
-- player_score_aux. That fold therefore CASTs this column AS SIGNED. Keep the cast if you touch it.
-- =====================================================================
ALTER TABLE `player` ADD `player_fad_points` INT UNSIGNED NOT NULL DEFAULT 0;


-- =====================================================================
-- Globals live in the framework `global` table and are declared in PHP, not here — see
-- Game::setupNewGame / setupRound for the authoritative list (roundNo, leaderId, trickIndex,
-- draftOrder, draftOrderCards, draftIndex, scorepad, appliedPublic, handEndAnnounced,
-- billyDiscardIndex, avidSSDone, avidSSRoundAward, and the Express set: fadClaims, expressTrickNo,
-- pfMatched). The active round parameters are not globals — they are derived from gameplay_card's
-- 'seen_<type>' stacks (Game::activeGameplayCard). Variant flags come from gameoptions.jsonc.
-- =====================================================================
