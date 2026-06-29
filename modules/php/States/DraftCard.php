<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\UserException;
use Bga\Games\UglyChristmasSweater\Game;
use Bga\Games\UglyChristmasSweater\Material;

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

    function onEnteringState(int $activePlayerId, array $args)
    {
        // Auto-resolve a fully-forced draft: if there's only one regular card left in the pool and the
        // player has no started sweater, the only legal move is to start a new sweater with it — so do
        // it for them and flow straight on, rather than prompting for a non-choice. The cardDrafted
        // notification still fires, so everyone sees what was drafted in the log + board.
        $forcedCardId = $this->game->forcedDraft($activePlayerId);
        if ($forcedCardId !== null) {
            // build_no 0 = new sweater; slot/value/icon are ignored for a regular printed card.
            return $this->actDraftCard($forcedCardId, 0, '', 0, '', $activePlayerId, $args);
        }

        // Reset the active player's clock each turn (standard BGA courtesy; pattern from crybaby).
        $this->game->giveExtraTime($activePlayerId);
    }

    public function getArgs(): array
    {
        $activePlayerId = (int) $this->game->getActivePlayerId();
        $pool = $this->game->cards->getCardsInLocation(Game::LOC_DRAFTPOOL);
        return [
            'draftableIds' => array_map(fn($c) => (int) $c['id'], array_values($pool)),
            // Skip the front-end "you must draft" prep/blink for a draft we auto-resolve on entering.
            '_no_notify' => $this->game->forcedDraft($activePlayerId) !== null,
        ];
    }

    #[PossibleAction]
    public function actDraftCard(
        int $card_id, int $build_no, string $slot, int $wild_value, string $wild_icon,
        int $activePlayerId, array $args
    ) {
        if (!in_array($card_id, $args['draftableIds'])) {
            throw new UserException(clienttranslate('That card is not in the draft pool'));
        }

        // Patch params are only meaningful for a patch; empty/zero means "not supplied".
        $placement = $this->game->placeDraftedCard(
            $card_id, $activePlayerId, $build_no,
            $slot !== '' ? $slot : null,
            $wild_value > 0 ? $wild_value : null,
            $wild_icon !== '' ? $wild_icon : null,
        );

        // The card row (incl. build_no / slot / wild value+icon) lets every client render the placement;
        // replaced_card_id (if any) tells them to drop the piece that was placed over.
        $this->notify->all('cardDrafted', clienttranslate('${player_name} drafts ${card_label}'), [
            'player_id'        => $activePlayerId,
            'player_name'      => $this->game->getPlayerNameById($activePlayerId),
            'card_id'          => $card_id,
            'card'             => $this->game->cardForNotif($card_id),
            'card_label'       => $this->game->cardLabel($card_id),
            'replaced_card_id' => $placement['replaced_card_id'],
        ]);

        // Update the player's live public score (a newly completed sweater is worth public points
        // immediately; a "place over" may also change/break an already-scored sweater).
        $this->game->refreshPublicScore($activePlayerId);

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
        // Abandoned player: any legal placement is fine. A new sweater always is; for a patch the
        // value/icon/slot below are valid (and ignored outright for a regular printed card).
        return $this->actDraftCard($choice, 0, Material::SLOT_LEFT, 1, Material::ICON_SNOWMAN, $playerId, $args);
    }
}
