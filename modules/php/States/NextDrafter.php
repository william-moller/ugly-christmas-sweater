<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\UglyChristmasSweater\Game;

/** Advance to the next drafter in draft order, or clean up the trick once all have drafted. */
class NextDrafter extends GameState
{
    function __construct(protected Game $game)
    {
        parent::__construct($game, id: 50, type: StateType::GAME);
    }

    function onEnteringState()
    {
        $order = (array) $this->game->globals->get('draftOrder');
        $index = ((int) $this->game->globals->get('draftIndex')) + 1;

        // NOTE (3P): only 3 of the 4 pool cards are drafted — falls out naturally since each of the
        // 3 players drafts once and 1 card remains in the pool for next trick.
        if ($index >= count($order)) {
            return EndTrickCleanup::class;
        }

        $this->game->globals->set('draftIndex', $index);
        $this->game->globals->set('drafterPlays', 0);
        $this->game->gamestate->changeActivePlayer($order[$index]);
        return DraftCard::class;
    }
}
