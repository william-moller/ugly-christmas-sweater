
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
-- The columns below are EXTENSIONS the Deck component does not manage — we maintain them via game SQL.
-- =====================================================================
CREATE TABLE IF NOT EXISTS `card` (
  `card_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `card_type` VARCHAR(8) NOT NULL,
  `card_type_arg` INT NOT NULL,
  `card_location` VARCHAR(16) NOT NULL,
  `card_location_arg` INT NOT NULL DEFAULT 0,

  -- Trade phase (trick): order this card was played within the current trick (1..N).
  -- Used for resolution tie-breaks ("later player wins") and Perfect-Fit "played later" priority.
  `trick_order` TINYINT UNSIGNED DEFAULT NULL,

  -- Knit phase (tableau): which sweater build in the owner's knitting area, and which L/R/B slot.
  -- (Owner is card_location_arg when card_location = 'knitting'.)
  `build_no` TINYINT UNSIGNED DEFAULT NULL,
  `slot` CHAR(1) DEFAULT NULL,                 -- 'L' | 'R' | 'B'

  -- Patch wild resolution (NULL for normal cards and for unresolved patches):
  --   trick : patch copies the value+icon of the previously played card
  --   knit  : the drafter chooses value+icon (orientation is recorded in `slot`)
  `wild_value` TINYINT UNSIGNED DEFAULT NULL,
  `wild_icon` VARCHAR(12) DEFAULT NULL,        -- see Material::ICONS

  PRIMARY KEY (`card_id`),
  KEY `idx_location` (`card_location`, `card_location_arg`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 AUTO_INCREMENT=1;


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
