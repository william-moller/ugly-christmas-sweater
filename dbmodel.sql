
-- ------
-- BGA framework: Gregory Isabelli & Emmanuel Colin & BoardGameArena
-- UglyChristmasSweater implementation : © Will Moller <will.moller@gmail.com>
--
-- This code has been produced on the BGA studio platform for use on http://boardgamearena.com.
-- See http://en.boardgamearena.com/#!doc/Studio for more information.
-- -----

-- Database schema for Ugly Christmas Sweaters.
-- The standard tables ("global", "stats", "gamelog", "player") already exist and must not be re-created.
-- Note: the schema is (re)built from this file only when a new game starts.
--
-- DRAFT (2026-06-17): structure first. Card *values* are filled from Material.php; the per-card
-- icon/orientation data is pending the art files. See CLAUDE.md "Implementation Notes".


-- =====================================================================
-- card : the 52-card sweater deck (48 numbered + 4 patches)
-- Managed by the BGA "Deck" component:  $this->cards = $this->deckFactory->createDeck('card');
--   card_type      = colour ('purple' | 'red' | 'green' | 'yellow')         [static, see Material::COLORS]
--   card_type_arg  = value 1..12  (0 = patch / wild)                        [static]
--   card_location  = 'deck' | 'hand' | 'draftpool' | 'trick' | 'knitting' | 'discard'
--   card_location_arg = player_id for deck/hand/trick/knitting ; slot index 0..3 for draftpool
-- NOTE: each player has their own face-down 'deck' pile (location_arg = player_id), plus a 'hand'.
-- IMPORTANT (modern framework): the Deck component AUTO-CREATES this table with the 5 standard columns,
-- ignoring extra columns added here. So our dynamic per-card extras live in a SEPARATE table
-- (card_meta, below) which dbmodel.sql creates normally. Keep this table to the standard 5 columns.
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
-- One row per card (card_id matches `card`.card_id). Maintained via game SQL (UPSERT).
--   trick_order : play order within the current trick (resolution tie-breaks; Perfect-Fit "later wins")
--   build_no    : which sweater build in the owner's knitting area
--   slot        : 'L' | 'R' | 'B' — orientation slot occupied when placed in a build
--   wild_value / wild_icon : patch resolution (trick = copied; knit = chosen; orientation in slot)
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
--   card_type      = 'perfectfit' | 'trendyyarn' | 'fad'
--   card_type_arg  = id of the specific card within its set (maps to Material::PERFECT_FIT / TRENDY_YARN / FADS)
--   card_location  = 'pile_perfectfit' | 'pile_trendyyarn' | 'pile_fad' | 'active' | 'discard'
--   card_location_arg = 0 (or claim order). In Express, multiple Fads may be 'active' at once.
-- Base game: one of each is flipped to 'active' per round. Express: cycles via draw/discard.
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
--   card_type_arg  = secret santa card id (maps to Material::SECRET_SANTA)
--   card_location  = 'box' (unused) | 'hand' (held by a player) | 'completed'
--   card_location_arg = owning player_id when 'hand' or 'completed'
-- Casual: 1 dealt per player per round (discarded after scoring).
-- Avid: 3 dealt per player at game start; must all be completed by game end.
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
--   card_location  = 'box' (undealt) | 'hand' (owned, face-up) | 'used' (one-shot spent)
--   card_location_arg = owning player_id when 'hand' or 'used'
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
-- player_score_aux  (built-in) = tie-break #1, set at game end = -(unbuilt sweaters)  [higher is better]
-- player_fad_points (below)    = tie-break #2 = total Fad points scored across the game
-- =====================================================================
ALTER TABLE `player` ADD `player_fad_points` INT UNSIGNED NOT NULL DEFAULT 0;


-- =====================================================================
-- Global game state values (stored in the framework `global` table; declared in PHP, not here).
-- Planned globals:
--   round_no            1..3   (Casual) / 1 (Express)
--   leader_player_id    holder of the "1" Draft Order card (leads the next trick)
-- Active Perfect Fit value / Trendy Yarn colour / Fad(s) are derivable from gameplay_card @ 'active'
-- joined with Material; cache as globals if convenient.
-- Variant flags (Casual/Avid, Express, player count, bonus cards) come from gameoptions.jsonc.
-- =====================================================================
