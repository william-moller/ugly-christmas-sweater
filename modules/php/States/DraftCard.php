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
 * their knitting area. The draft order has one entry per card played this trick (owner = who played it),
 * so a 2-player player who played 2 cards appears twice and drafts twice — see actDraftCard.
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
            // build_no 0 = new sweater; a regular card uses its printed slot, a patch simply floats.
            return $this->actDraftCard($forcedCardId, 0, '', '', 0, $activePlayerId, $args);
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
        int $card_id, int $build_no, string $slot, string $floating_patch_slot, int $use_maria,
        int $activePlayerId, array $args
    ) {
        if (!in_array($card_id, $args['draftableIds'])) {
            throw new UserException(clienttranslate('That card is not in the draft pool'));
        }

        // Billy's a Brute (bonus): this drafter's turn is the "draft first & discard" one — the chosen
        // pool card is discarded (reshuffled next round) instead of entering their knitting area.
        $billyDiscardIndex = (int) $this->game->globals->get('billyDiscardIndex');
        if ($billyDiscardIndex >= 0 && (int) $this->game->globals->get('draftIndex') === $billyDiscardIndex) {
            $label = $this->game->cardLabel($card_id);
            $this->game->cards->moveCard($card_id, Game::LOC_DISCARD, 0);
            $this->game->setCardMeta($card_id, [
                'trick_order' => null, 'build_no' => null, 'slot' => null, 'wild_value' => null, 'wild_icon' => null,
            ]);
            $this->game->globals->set('billyDiscardIndex', -1); // consumed
            $this->notify->all('cardDiscarded', clienttranslate('${player_name} drafts and discards ${card_label} (Billy\'s a Brute)'), [
                'player_id'   => $activePlayerId,
                'player_name' => $this->game->getPlayerNameById($activePlayerId),
                'card_id'     => $card_id,
                'card_label'  => $label,
            ]);
            return NextDrafter::class;
        }

        // Mixed-up Maria (bonus): a regular card may be placed in any orientation ($slot), ignoring its
        // printed one. Validate ownership + that it's a numbered card + a real slot; consume after placing.
        $mariaSlot = null;
        if ($use_maria === 1) {
            if (!$this->game->hasBonus($activePlayerId, Material::BONUS_MARIA)) {
                throw new UserException(clienttranslate('You do not have Mixed-up Maria to use'));
            }
            $card = $this->game->cards->getCard($card_id);
            if (((int) $card['type_arg']) === Material::PATCH_VALUE) {
                throw new UserException(clienttranslate('Mixed-up Maria only applies to a numbered card'));
            }
            if (!in_array($slot, Material::SLOTS, true)) {
                throw new UserException(clienttranslate('Choose an orientation (L, R or B) for the card'));
            }
            $mariaSlot = $slot;
        }

        // $slot = the drafted card's orientation (only used for a patch added to an existing sweater,
        // or as the Maria-chosen orientation for a regular card); $floating_patch_slot = the orientation
        // to give a floating patch already in the target sweater. '' = not supplied. A patch never picks
        // value/icon here (deferred to scoring).
        $placement = $this->game->placeDraftedCard(
            $card_id, $activePlayerId, $build_no,
            $slot !== '' ? $slot : null,
            $floating_patch_slot !== '' ? $floating_patch_slot : null,
            $mariaSlot,
        );

        // The card row lets every client render the placement; replaced_card_id tells them to drop a
        // placed-over piece; floating_patch (if any) is the now-oriented patch row to re-render.
        $this->notify->all('cardDrafted', clienttranslate('${player_name} drafts ${card_label}'), [
            'player_id'        => $activePlayerId,
            'player_name'      => $this->game->getPlayerNameById($activePlayerId),
            'card_id'          => $card_id,
            'card'             => $this->game->cardForNotif($card_id),
            'card_label'       => $this->game->cardLabel($card_id),
            'replaced_card_id' => $placement['replaced_card_id'],
            'floating_patch'   => $placement['floating_patch_id'] !== null
                ? $this->game->cardForNotif($placement['floating_patch_id']) : null,
        ]);

        // Mixed-up Maria: consume the card now that the off-orientation placement succeeded.
        if ($mariaSlot !== null) {
            $this->game->markBonusUsed(Material::BONUS_MARIA);
            $this->notify->all('bonusUsed', clienttranslate('${player_name} uses Mixed-up Maria'), [
                'player_id'   => $activePlayerId,
                'player_name' => $this->game->getPlayerNameById($activePlayerId),
                'bonus'       => $this->game->bonusState(),
            ]);
        }

        // Update the player's live public score (a newly completed sweater is worth public points
        // immediately; a "place over" may also change/break an already-scored sweater).
        $this->game->refreshPublicScore($activePlayerId);

        // Express: evaluated between each draft — the active player claims any displayed Fad their tableau
        // now satisfies (locking that sweater). Only they can claim now, so there's never a tie. Re-score
        // afterwards so the claimed Fad's points land immediately.
        foreach ($this->game->evaluateFadClaims($activePlayerId) as $claim) {
            $this->notify->all('fadClaimed', clienttranslate('${player_name} claims a Fad'), [
                'player_id'   => $activePlayerId,
                'player_name' => $this->game->getPlayerNameById($activePlayerId),
                'fad_id'      => $claim['fad_id'],
                'build_no'    => $claim['build_no'],
                'gameplay'    => $this->game->getGameplayState(),
            ]);
            $this->game->refreshPublicScore($activePlayerId);
        }

        // If this placement just triggered the end of the hand (someone completed their Nth sweater —
        // Casual 3 / Express 4), announce it ONCE so every client shows the "last trick & draft phase"
        // banner for the remaining drafts. It's cleared when the next round is dealt (setupRound).
        if ($this->game->isRoundOver()
            && (int) $this->game->globals->get('handEndAnnounced') !== 1
        ) {
            $this->game->globals->set('handEndAnnounced', 1);
            $this->notify->all('handEnding', '', []);
        }

        // Each draft-order entry is exactly ONE pick. The order ranks the CARDS played this trick (one
        // entry per card, owner = who played it — see Game::resolveTrickToDraftOrder), so a player who
        // played 2 cards in a 2-player trick simply appears twice: they may end up drafting twice in a
        // row, first-and-last, or split, purely by where their two cards ranked. So always advance.
        return NextDrafter::class;
    }

    function zombie(int $playerId)
    {
        $args = $this->getArgs();
        if (empty($args['draftableIds'])) {
            return NextDrafter::class;
        }
        $choice = $this->getRandomZombieChoice($args['draftableIds']);
        // Abandoned player: starting a new sweater (build_no 0) is always legal — a regular card lands
        // at its printed slot, a patch floats; no floating-patch orientation is needed for a new build.
        // use_maria = 0: never spend a bonus on a zombie's forced move.
        return $this->actDraftCard($choice, 0, '', '', 0, $playerId, $args);
    }
}
