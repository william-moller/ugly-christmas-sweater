<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\UglyChristmasSweater\Game;

/**
 * End-of-trick cleanup: the trade-area cards become the next draft pool, hands refill to 9, then either
 * the round ends (someone completed their 3rd sweater, or hands are empty) or the leader leads again.
 */
class EndTrickCleanup extends GameState
{
    function __construct(protected Game $game)
    {
        parent::__construct($game, id: 60, type: StateType::GAME, updateGameProgression: true);
    }

    function onEnteringState()
    {
        $this->game->rotateTrickToPool();
        $this->game->refillHands();

        // Public: the new draft pool (was the trade area) and resynced hand/pile counts.
        $this->notify->all(
            'trickCleanup',
            clienttranslate('The trick is collected; the trade area becomes the next draft pool'),
            [
                'pool'   => array_values($this->game->cards->getCardsInLocation(Game::LOC_DRAFTPOOL)),
                'counts' => $this->game->publicCounts(),
            ]
        );

        // Private: each player's refilled hand (card identities are hidden from others).
        foreach (array_keys($this->game->loadPlayersBasicInfos()) as $pid) {
            $this->game->notify->player((int) $pid, 'handUpdate', '', [
                'hand' => array_values($this->game->cards->getCardsInLocation(Game::LOC_HAND, (int) $pid)),
            ]);
        }

        if ($this->game->isRoundOver()) {
            return ScoreRound::class;
        }

        // The "1" Draft card holder leads the next trick.
        $this->game->globals->set('trickIndex', 0);
        $this->game->gamestate->changeActivePlayer((int) $this->game->globals->get('leaderId'));
        return PlayCard::class;
    }
}
