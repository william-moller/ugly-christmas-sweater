<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\UglyChristmasSweater\Game;

/** Score the round, then start the next round or end the game after round 3. */
class ScoreRound extends GameState
{
    const TOTAL_ROUNDS = 3; // TODO: 1 for the Express variant (read from game options)

    function __construct(protected Game $game)
    {
        parent::__construct($game, id: 70, type: StateType::GAME);
    }

    function onEnteringState()
    {
        $this->game->scoreRound();

        $this->notify->all('roundScored', clienttranslate('Round scored'), [
            // TODO: per-player breakdown for the scoring display.
        ]);

        $round = (int) $this->game->globals->get('roundNo');
        if ($round < self::TOTAL_ROUNDS) {
            $this->game->globals->set('roundNo', $round + 1);
            return NewRound::class;
        }
        return EndScore::class;
    }
}
