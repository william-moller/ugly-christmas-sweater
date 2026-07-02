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

        // One draft per order entry, and the order has one entry per card played this trick. So the
        // number of drafts always equals the trick size: 4P → 4 (pool emptied), 2P → 4 (2 per player,
        // pool emptied), 3P → 3 (each of 3 players once) so 1 of the 4 pool cards is left for next trick.
        if ($index >= count($order)) {
            return EndTrickCleanup::class;
        }

        $this->game->globals->set('draftIndex', $index);
        $this->game->gamestate->changeActivePlayer($order[$index]);
        return DraftCard::class;
    }
}
