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
            'order'      => $order,
            // The trade-area card ids in rank order, so the client lays Draft Order card #k onto the
            // card ranked k-th (offset so the card's own top-left value/icon stays visible).
            'orderCards' => $this->game->globals->get('draftOrderCards') ?: [],
        ]);

        // Route through BillyChoice (bonus): it lets a Billy owner draft-and-discard first, then begins
        // the draft. When the option is Off / no trigger, it passes straight through to DraftCard.
        $this->game->gamestate->changeActivePlayer($order[0]);
        return BillyChoice::class;
    }
}
