<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\UserException;
use Bga\Games\UglyChristmasSweater\Game;

/**
 * Draft phase. In draft order, the active player takes a card from the draft pool and places it into
 * their knitting area. In a 2-player game each player drafts 2 cards.
 */
class DraftCard extends GameState
{
    function __construct(protected Game $game)
    {
        parent::__construct($game,
            id: 40,
            type: StateType::ACTIVE_PLAYER,
            description: clienttranslate('${actplayer} must draft a sweater card'),
            descriptionMyTurn: clienttranslate('${you} must draft a sweater card'),
        );
    }

    public function getArgs(): array
    {
        $pool = $this->game->cards->getCardsInLocation(Game::LOC_DRAFTPOOL);
        return [
            'draftableIds' => array_map(fn($c) => (int) $c['id'], array_values($pool)),
        ];
    }

    #[PossibleAction]
    public function actDraftCard(int $card_id, int $activePlayerId, array $args)
    {
        if (!in_array($card_id, $args['draftableIds'])) {
            throw new UserException(clienttranslate('That card is not in the draft pool'));
        }

        $this->game->placeDraftedCard($card_id, $activePlayerId);

        // Includes build_no / slot set by placeDraftedCard so the client can render it into the build.
        $this->notify->all('cardDrafted', clienttranslate('${player_name} drafts a sweater card'), [
            'player_id'   => $activePlayerId,
            'player_name' => $this->game->getPlayerNameById($activePlayerId),
            'card_id'     => $card_id,
            'card'        => $this->game->cardForNotif($card_id),
        ]);

        // 2-player: draft a second card before passing.
        $plays = ((int) $this->game->globals->get('drafterPlays')) + 1;
        $this->game->globals->set('drafterPlays', $plays);
        if ($plays < $this->game->cardsPerTurn()) {
            return DraftCard::class;
        }
        return NextDrafter::class;
    }

    function zombie(int $playerId)
    {
        $args = $this->getArgs();
        if (empty($args['draftableIds'])) {
            return NextDrafter::class;
        }
        $choice = $this->getRandomZombieChoice($args['draftableIds']);
        return $this->actDraftCard($choice, $playerId, $args);
    }
}
