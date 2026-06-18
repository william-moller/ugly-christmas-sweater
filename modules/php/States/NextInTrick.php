<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\UglyChristmasSweater\Game;

/** Advance to the next player in the trick, or resolve once everyone has played. */
class NextInTrick extends GameState
{
    function __construct(protected Game $game)
    {
        parent::__construct($game, id: 20, type: StateType::GAME);
    }

    function onEnteringState()
    {
        $target = $this->game->getPlayersNumber() * $this->game->cardsPerTurn();
        if ($this->game->cards->countCardInLocation(Game::LOC_TRICK) >= $target) {
            return ResolveTrick::class;
        }
        $this->game->activeNextPlayer();
        return PlayCard::class;
    }
}
