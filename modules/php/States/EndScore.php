<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\Games\UglyChristmasSweater\Game;

const ST_END_GAME = 99;

class EndScore extends \Bga\GameFramework\States\GameState
{

    function __construct(
        protected Game $game,
    ) {
        parent::__construct($game,
            id: 98,
            type: StateType::GAME,
        );
    }

    /**
     * Game state action, example content.
     *
     * The onEnteringState method of state `EndScore` is called just before the end of the game.
     */
    public function onEnteringState() {
        // Avid mode: a player who did not complete ALL 3 of their Secret Santas by game end does not
        // qualify — their FINAL score is set to 0 (the round scorepad already flagged them with an
        // asterisk + note). scoreRound tracks cumulative completion in the 'avidSSDone' global. Do this
        // BEFORE the tie-break fold below so zeroed players also sort to the bottom.
        if ($this->game->isAvid()) {
            $ssDone = (array) $this->game->globals->get('avidSSDone');
            foreach (array_keys($this->game->loadPlayersBasicInfos()) as $pid) {
                $pid = (int) $pid;
                if (count((array) ($ssDone[$pid] ?? [])) < Game::AVID_SECRET_SANTAS) {
                    static::DbQuery("UPDATE `player` SET `player_score` = 0 WHERE `player_id` = $pid");
                }
            }
        }

        // BGA ranks players by player_score, then player_score_aux only — it has no third sort column.
        // We want a TWO-level tie-break (gameinfos "tie_breaker_description"):
        //   #1 fewest unbuilt sweaters   (scoreRound accumulated -(unbuilt) into player_score_aux)
        //   #2 most total Fad points     (scoreRound accumulated player_fad_points)
        // Fold both into player_score_aux as a composite so higher = better on both keys at once:
        //   aux := (-unbuilt) * K + fadPoints,  where at this point aux already holds (-unbuilt).
        // K just needs to exceed any achievable Fad-point total (a few dozen), so #1 always dominates
        // #2 and #2 only separates players tied on #1.
        static::DbQuery(
            "UPDATE `player` SET `player_score_aux` = `player_score_aux` * " . Game::TIEBREAK_K . " + `player_fad_points`"
        );

        // On Studio, stop instead of ending so the finished table stays open for inspection.
        if ($this->game->preventEndGame) {
            return GameStopped::class;
        }
        return ST_END_GAME;
    }
}