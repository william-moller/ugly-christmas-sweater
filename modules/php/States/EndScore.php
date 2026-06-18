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
        // Final tie-breakers (gameinfos "tie_breaker_description"):
        //   #1 fewest unbuilt sweaters  -> player_score_aux
        //   #2 most total Fad points    -> player_fad_points (already tracked per round)
        // TODO: track unbuilt-sweater counts across rounds and set player_score_aux here.
        //   e.g. UPDATE player SET player_score_aux = -(total unbuilt sweaters)

        return ST_END_GAME;
    }
}