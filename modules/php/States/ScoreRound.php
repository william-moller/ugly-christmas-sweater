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

        // Bonus cards: a scored Little Brothers objective was just spent — refresh the chips.
        if ($this->game->bonusEnabled()) {
            $this->notify->all('bonusUpdate', '', ['bonus' => $this->game->bonusState()]);
        }

        $round = (int) $this->game->globals->get('roundNo');

        // Full per-player, per-sweater scoring detail for the summary overlay (built while the round's
        // knitting builds are still in place, after patches are assigned). Stashed in globals so the
        // review screen survives a page refresh (re-served via RoundReview::getArgs), and sent now for
        // the immediate render + the round-scored log line.
        $detail = $this->game->roundScoreDetail();
        $this->game->globals->set('roundResult', $detail);

        $this->notify->all('roundScored', clienttranslate('Round ${round} scored'), $detail);

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
