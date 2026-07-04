<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\UglyChristmasSweater\Game;

/**
 * End-of-trick cleanup: the trade-area cards become the next draft pool, hands refill to 9, then either
 * the round ends (someone completed their Nth sweater — Casual 3 / Express 4 — or hands are empty) or the
 * leader leads again. In Express, the Trendy Yarn and Perfect Fit parameters may also rotate here.
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
        $drawn = $this->game->refillHands();

        // Public: the new draft pool (was the trade area) and resynced hand/pile counts.
        $this->notify->all(
            'trickCleanup',
            clienttranslate('The trick is collected; the trade area becomes the next draft pool'),
            [
                'pool'   => array_values($this->game->cards->getCardsInLocation(Game::LOC_DRAFTPOOL)),
                'counts' => $this->game->publicCounts(),
            ]
        );

        // Private: each player's refilled hand (card identities are hidden from others). `drawn` carries
        // only the cards just taken from the pile, so the client animates those into the fan rather than
        // re-dealing the whole hand; `hand` remains the authoritative full hand for the client's model.
        foreach (array_keys($this->game->loadPlayersBasicInfos()) as $pid) {
            $pid = (int) $pid;
            $this->game->notify->player($pid, 'handUpdate', '', [
                'hand'  => array_values($this->game->cards->getCardsInLocation(Game::LOC_HAND, $pid)),
                'drawn' => $drawn[$pid] ?? [],
            ]);
        }

        // Express: rotate this trick's round parameters. Trendy Yarn changes every trendyRotateEvery()
        // tricks (2P → 3rd, else 4th); Perfect Fit is replaced if a matching card was played this trick.
        // Both reshuffle their deck when it empties (see Game::rotateGameplayDeck).
        if ($this->game->isExpress()) {
            $trickNo = ((int) $this->game->globals->get('expressTrickNo')) + 1;
            $this->game->globals->set('expressTrickNo', $trickNo);

            $rotated = false;
            if ($trickNo % $this->game->trendyRotateEvery() === 0) {
                $this->game->rotateGameplayDeck('trendyyarn');
                $rotated = true;
            }
            if ((int) $this->game->globals->get('pfMatched') === 1) {
                $this->game->rotateGameplayDeck('perfectfit');
                $this->game->globals->set('pfMatched', 0);
                $rotated = true;
            }
            if ($rotated) {
                $this->notify->all('gameplayRevealed', clienttranslate('Round parameters updated'), [
                    'gameplay' => $this->game->getGameplayState(),
                ]);
            }
        }

        if ($this->game->isRoundOver()) {
            // Patches in completed sweaters get their value/icon assigned (AssignPatches) before scoring;
            // that state skips straight to ScoreRound when there are none.
            return AssignPatches::class;
        }

        // The "1" Draft card holder leads the next trick.
        $this->game->globals->set('trickIndex', 0);
        $this->game->gamestate->changeActivePlayer((int) $this->game->globals->get('leaderId'));
        return PlayCard::class;
    }
}
