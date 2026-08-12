<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweaters\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\Games\UglyChristmasSweaters\Game;

/**
 * Advance to the next player in the trick, or resolve once everyone has played.
 *
 * The trick's only natural exit is a FULL trick (players × cardsPerTurn), which is reachable only
 * while every player still holds a card to contribute. That holds today because hands deplete in
 * lockstep:
 *   - piles start equal — perPlayerDeal() is intdiv(48, N), exact for the supported N = 2, 3, 4;
 *   - every player plays exactly cardsPerTurn() per trick (the N × c target is reached by N × c
 *     round-robin activeNextPlayer() hops from the leader, so each seat is hit c times);
 *   - refillHands() tops every hand back to HAND_SIZE from that player's OWN pile;
 *   - nothing else moves cards into or out of a hand — drafting is pool → knitting or pool →
 *     discard, and Billy's a Brute reorders the draft order only.
 * The 2P tail is the only one where a hand could go short mid-trick, and it doesn't: the pile runs
 * 15 → 1 at 2/trick, leaving hand 8, which then walks 8 → 6 → 4 → 2 → 0 on trick boundaries.
 *
 * Break any of those — a bonus card that discards from hand, an unequal deal, a rules variant — and
 * a hand can empty part-way through a trick, making the target permanently unreachable. So the exit
 * below is "trick full OR nobody can play" rather than "trick full": a total condition that cannot
 * cycle, instead of one that relies on the invariant above staying true.
 */
class NextInTrick extends GameState
{
    function __construct(protected Game $game)
    {
        parent::__construct($game, id: 20, type: StateType::GAME);
    }

    function onEnteringState()
    {
        $target = $this->game->getPlayersNumber() * $this->game->cardsPerTurn();
        if ($this->game->cards->countCardInLocation(Game::LOC_TRICK) >= $target) {
            return ResolveTrick::class;
        }

        // Hand off to the next player who can actually act. Under the invariant above that is always
        // the very next seat, so this costs one hop; the loop only does more work in the broken case.
        // Skipping an empty hand also keeps a LIVE player out of a PlayCard turn with no legal move
        // and nothing to click — the zombie path would at least bounce back here, a human just sits.
        for ($i = 0; $i < $this->game->getPlayersNumber(); $i++) {
            $this->game->activeNextPlayer();
            $pid = (int) $this->game->getActivePlayerId();
            if ($this->game->cards->countCardInLocation(Game::LOC_HAND, $pid) > 0) {
                return PlayCard::class;
            }
        }

        // Nobody holds a card: the trick can never fill. Resolve what was played — ResolveTrick ranks
        // whatever is in LOC_TRICK and routes an empty trick to EndTrickCleanup, which ends the round.
        return ResolveTrick::class;
    }
}
