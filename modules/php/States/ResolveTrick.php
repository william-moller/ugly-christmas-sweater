<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\UglyChristmasSweater\Game;

/**
 * Resolve the trick into a draft order, assign the "1" Draft card (which also becomes the next leader),
 * and activate the first drafter.
 */
class ResolveTrick extends GameState
{
    function __construct(protected Game $game)
    {
        parent::__construct($game, id: 30, type: StateType::GAME);
    }

    function onEnteringState()
    {
        $order = $this->game->resolveTrickToDraftOrder(); // best-first player_ids
        if (empty($order)) {
            return EndTrickCleanup::class; // safety
        }

        // The top of the draft order holds the "1" card and leads the next trick.
        $this->game->globals->set('leaderId', $order[0]);
        $this->game->globals->set('draftIndex', 0);

        $this->notify->all('draftOrder', clienttranslate('Draft order determined'), [
            'order' => $order,
        ]);

        $this->game->gamestate->changeActivePlayer($order[0]);
        return DraftCard::class;
    }
}
