<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\Games\UglyChristmasSweater\Game;

/**
 * Between-round pause: every player reviews the round's scoring summary and clicks Continue; once all
 * have, the next round is dealt (NewRound). A MULTIPLE_ACTIVE_PLAYER acknowledgement gate — order does
 * not matter, everyone acts simultaneously. (Pattern from the crybaby reference game's ShowBets state.)
 *
 * Entered from ScoreRound (which has already applied the round's scores, stashed the cumulative scorepad
 * in the `scorepad` global, and set all players multiactive). Not entered after the final round — that
 * goes straight to EndScore.
 */
class RoundReview extends GameState
{
    function __construct(protected Game $game)
    {
        parent::__construct($game,
            id: 75,
            type: StateType::MULTIPLE_ACTIVE_PLAYER,
            description: clienttranslate('Other players are reviewing the round results'),
            descriptionMyTurn: clienttranslate('Review the round results, then click to continue'),
        );
    }

    /** Re-served on refresh so the review screen (built from the stashed scorepad) survives an F5. */
    public function getArgs(): array
    {
        $pad = json_decode($this->game->globals->get('scorepad') ?? 'null', true);
        return is_array($pad) ? $pad : ['round' => 0, 'totalRounds' => 0, 'players' => [], 'rounds' => []];
    }

    #[PossibleAction]
    public function actContinueRound()
    {
        $playerId = (int) $this->game->getCurrentPlayerId();
        $this->game->gamestate->setPlayerNonMultiactive($playerId, NewRound::class);
    }

    function zombie(int $playerId)
    {
        $this->game->gamestate->setPlayerNonMultiactive($playerId, NewRound::class);
    }
}
