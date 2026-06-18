<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\UglyChristmasSweater\Game;

/**
 * Start of a round (rounds 2-3; round 1 is handled in setupNewGame).
 * Deals piles/hands, flips gameplay cards, deals Secret Santas, activates the leader.
 */
class NewRound extends GameState
{
    function __construct(protected Game $game)
    {
        parent::__construct($game, id: 5, type: StateType::GAME, updateGameProgression: true);
    }

    function onEnteringState()
    {
        $this->game->setupRound();
        return PlayCard::class;
    }
}
