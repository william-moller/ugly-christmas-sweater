<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\UglyChristmasSweater\Game;

/** Score the round, then start the next round or end the game after the last round (Casual 3 / Express 1). */
class ScoreRound extends GameState
{
    function __construct(protected Game $game)
    {
        parent::__construct($game, id: 70, type: StateType::GAME);
    }

    function onEnteringState()
    {
        $this->game->scoreRound();

        $round = (int) $this->game->globals->get('roundNo');

        // Per-player summary of the round just played (built while the round's knitting builds are
        // still in place). Stashed in globals so the review screen survives a page refresh (it is
        // re-served via RoundReview::getArgs), and sent now for the immediate render + log line.
        $breakdown = $this->game->roundBreakdown();
        $this->game->globals->set('roundResult', ['round' => $round, 'breakdown' => $breakdown]);

        $this->notify->all('roundScored', clienttranslate('Round ${round} scored'), [
            'round'     => $round,
            'breakdown' => $breakdown,
        ]);

        // After the final round, end the game (Express: after its single round). Otherwise pause on a
        // shared round-review screen — every player clicks Continue before the next round is dealt.
        // (Pattern from the crybaby ShowBets state.)
        if ($round >= $this->game->totalRounds()) {
            return EndScore::class;
        }
        $this->game->globals->set('roundNo', $round + 1);
        $this->game->gamestate->setAllPlayersMultiactive();
        return RoundReview::class;
    }
}
