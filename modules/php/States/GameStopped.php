<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\UglyChristmasSweater\Game;

/**
 * Dead-end state used ONLY on Studio (when Game::$preventEndGame is set) in place of actually ending
 * the game, so a finished table stays open for inspecting final scoring and tableaus. Production never
 * enters this state. (Pattern borrowed from the "collect" reference game's FakePlayer state.)
 */
class GameStopped extends GameState
{
    function __construct(protected Game $game)
    {
        parent::__construct($game,
            id: 97,
            type: StateType::ACTIVE_PLAYER,
            description: clienttranslate('Game stopped (Studio) — end-game suppressed for inspection'),
            descriptionMyTurn: clienttranslate('Game stopped (Studio) — end-game suppressed for inspection'),
        );
    }

    function zombie(int $playerId)
    {
        // No-op: there is intentionally no way out of this state.
    }
}
