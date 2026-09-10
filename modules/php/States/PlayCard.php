<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweaters\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\UserException;
use Bga\Games\UglyChristmasSweaters\Game;

/**
 * Trade phase. The active player plays a card to the trick (must follow the led color or icon if able).
 * In a 2-player game each player plays 2 cards, but play ALTERNATES (P1, P2, P1, P2) — see actPlayCard.
 */
class PlayCard extends GameState
{
    function __construct(protected Game $game)
    {
        parent::__construct($game,
            id: 10,
            type: StateType::ACTIVE_PLAYER,
            description: clienttranslate('${actplayer} must play a card'),
            descriptionMyTurn: clienttranslate('${you} must play a card'),
        );
    }

    function onEnteringState(int $activePlayerId, array $args)
    {
        // Auto-play ONLY in the all-public final trick (every player down to their last card): playing
        // it then leaks no hand info. We never auto-play a single legal card otherwise — that would
        // reveal the player couldn't follow, destroying the bluff that they had a choice.
        $cardId = $this->game->forcedFinalPlay($activePlayerId);
        if ($cardId !== null) {
            return $this->actPlayCard($cardId, 0, $activePlayerId, $args);
        }

        // Reset the active player's clock each turn (standard BGA courtesy; pattern from crybaby).
        $this->game->giveExtraTime($activePlayerId);
    }

    public function getArgs(): array
    {
        $activePlayerId = (int) $this->game->getActivePlayerId();
        return [
            'playableCardsIds' => $this->game->getPlayableCardIds($activePlayerId),
            // Skip the front-end "you must play a card" prep/blink for a play we auto-resolve on entering.
            '_no_notify' => $this->game->forcedFinalPlay($activePlayerId) !== null,
        ];
    }

    #[PossibleAction]
    public function actPlayCard(int $card_id, int $copy_from_card_id, int $activePlayerId, array $args)
    {
        if (!in_array($card_id, $args['playableCardsIds'])) {
            throw new UserException(clienttranslate('You cannot play that card'));
        }

        // copy_from_card_id only matters for a LEADING patch (the pool card it copies); 0 = not supplied.
        $this->game->moveCardToTrick($card_id, $activePlayerId, $copy_from_card_id > 0 ? $copy_from_card_id : null);

        // Draw back up to 9 IMMEDIATELY, not after the draft — every player count, every variant (see
        // Game::refillHand). Done before the notifies so the counts they carry are already the post-draw
        // ones and no seat briefly shows a hand of 8.
        $drawn = $this->game->refillHand($activePlayerId);

        // The card came from a hidden hand, so other clients need its face to render it: send the row.
        // `counts` rides along because the play AND the draw both moved cards — every seat needs to see
        // the pile shrink while the hand returns to 9. The drawn card's identity is private, so it goes
        // in the per-player notify below instead.
        $this->notify->all('cardPlayed', clienttranslate('${player_name} plays ${card_label}'), [
            'player_id'   => $activePlayerId,
            'player_name' => $this->game->getPlayerNameById($activePlayerId),
            'card_id'     => $card_id,
            'card'        => $this->game->cardForNotif($card_id),
            'card_label'  => $this->game->cardLabel($card_id),
            'counts'      => $this->game->publicCounts(),
        ]);

        // Private: only the drawing player learns what they drew. `drawn` is empty once their pile runs
        // out, which the client treats as "hand unchanged".
        if (!empty($drawn)) {
            $this->game->notify->player($activePlayerId, 'handUpdate', '', [
                'hand'  => array_values($this->game->cards->getCardsInLocation(Game::LOC_HAND, $activePlayerId)),
                'drawn' => $drawn,
            ]);
        }

        // Always hand off to NextInTrick, which advances to the next player or resolves once the trick
        // is full (target = players × cardsPerTurn). In 2-player each player plays 2 cards, but play
        // ALTERNATES (P1, P2, P1, P2) rather than one player playing both — so we pass after every
        // single card and let NextInTrick's activeNextPlayer + target-size check drive the alternation.
        return NextInTrick::class;
    }

    function zombie(int $playerId)
    {
        $args = $this->getArgs();
        if (empty($args['playableCardsIds'])) {
            // Empty hand (unreachable under the lockstep invariant — see NextInTrick's docblock).
            // Safe to bounce back: NextInTrick skips empty hands and resolves when none can play.
            return NextInTrick::class;
        }
        $choice = $this->getRandomZombieChoice($args['playableCardsIds']);
        // copy_from = 0: a leading patch falls back to the first numbered pool card server-side.
        return $this->actPlayCard($choice, 0, $playerId, $args);
    }
}
