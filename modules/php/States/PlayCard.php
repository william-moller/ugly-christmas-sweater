<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\UserException;
use Bga\Games\UglyChristmasSweater\Game;

/**
 * Trade phase. The active player plays a card to the trick (must follow the led colour or icon if able).
 * In a 2-player game each player plays 2 cards (the action repeats for the same player).
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

    public function getArgs(): array
    {
        $activePlayerId = (int) $this->game->getActivePlayerId();
        return [
            'playableCardsIds' => $this->game->getPlayableCardIds($activePlayerId),
        ];
    }

    #[PossibleAction]
    public function actPlayCard(int $card_id, int $activePlayerId, array $args)
    {
        if (!in_array($card_id, $args['playableCardsIds'])) {
            throw new UserException(clienttranslate('You cannot play that card'));
        }

        $this->game->moveCardToTrick($card_id, $activePlayerId);

        $this->notify->all('cardPlayed', clienttranslate('${player_name} plays a card'), [
            'player_id'   => $activePlayerId,
            'player_name' => $this->game->getPlayerNameById($activePlayerId),
            'card_id'     => $card_id,
        ]);

        // In a 2-player game the player plays a second card before the turn passes.
        $myCardsInTrick = $this->game->cards->countCardInLocation(Game::LOC_TRICK, $activePlayerId);
        if ($myCardsInTrick < $this->game->cardsPerTurn()) {
            return PlayCard::class; // same player plays again
        }
        return NextInTrick::class;
    }

    function zombie(int $playerId)
    {
        $args = $this->getArgs();
        $choice = $this->getRandomZombieChoice($args['playableCardsIds']);
        return $this->actPlayCard($choice, $playerId, $args);
    }
}
