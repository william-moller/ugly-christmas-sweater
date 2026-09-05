<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweaters\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\UglyChristmasSweaters\Game;

/**
 * Start of a round (rounds 2-3; round 1 is handled in setupNewGame).
 * Deals piles/hands, flips gameplay cards, deals Secret Santas, activates the leader.
 */
class NewRound extends GameState
{
    function __construct(protected Game $game)
    {
        parent::__construct($game, id: 5, type: StateType::GAME, updateGameProgression: true);
    }

    function onEnteringState()
    {
        $this->game->setupRound();
        $round = (int) $this->game->globals->get('roundNo');

        // Push the freshly dealt board to every client. setupRound() reshuffled and re-dealt everything
        // (new draft pool incl. the carried-over cards, refilled hands, wiped knitting, new Secret Santas,
        // revealed round parameters); without this the clients would keep showing last round's board until
        // an F5. Public zones go to everyone; each player's hand + Secret Santa(s) are private.
        $this->notify->all('newRound', clienttranslate('Round ${round} begins'), [
            'round'    => $round,
            'pool'     => array_values($this->game->cards->getCardsInLocation(Game::LOC_DRAFTPOOL)),
            'gameplay' => $this->game->getGameplayState(),
            'counts'   => $this->game->publicCounts(),
            'knitting' => array_values($this->game->getCardsWithExtras(Game::LOC_KNITTING)),
            'leaderId' => (int) $this->game->globals->get('leaderId'),
            // Outside Avid setupRound just dropped last round's reveal; send the (now empty) map so the
            // opponents' areas clear instead of keeping headshots for cards that have been discarded.
            'santaReveal' => $this->game->secretSantaReveal(),
        ]);

        foreach (array_keys($this->game->loadPlayersBasicInfos()) as $pid) {
            $pid = (int) $pid;
            $this->game->notify->player($pid, 'newRoundPrivate', '', [
                'hand'        => array_values($this->game->cards->getCardsInLocation(Game::LOC_HAND, $pid)),
                'secretSanta' => array_values($this->game->secretSantas->getCardsInLocation(Game::LOC_HAND, $pid)),
                // Knitting was wiped, so nothing is satisfied any more (Avid keeps what it banked).
                'santaDone'   => $this->game->satisfiedSecretSantas($pid),
            ]);
        }

        return PlayCard::class;
    }
}
