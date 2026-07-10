<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\Games\UglyChristmasSweater\Game;
use Bga\Games\UglyChristmasSweater\Material;

/**
 * Billy's a Brute (bonus) decision point, between resolving the trick and drafting. If another player
 * leads the resulting draft order, the (unused) Billy owner may activate — they jump to the FRONT of the
 * draft order and draft first, but that card is DISCARDED (reshuffled next round) instead of kept.
 * Passes straight through to drafting when the option is Off, no Billy owner remains, or the owner
 * themselves already lead. The trick's resolution ranking / next leader are unchanged — only the drafting
 * sequence shifts.
 */
class BillyChoice extends GameState
{
    function __construct(protected Game $game)
    {
        parent::__construct($game,
            id: 35,
            type: StateType::ACTIVE_PLAYER,
            description: clienttranslate('${actplayer} may play Billy\'s a Brute'),
            descriptionMyTurn: clienttranslate('Play Billy\'s a Brute to draft (and discard) first, or pass'),
        );
    }

    function onEnteringState()
    {
        $this->game->globals->set('billyDiscardIndex', -1); // reset every trick
        $order = array_values(array_map('intval', (array) $this->game->globals->get('draftOrder')));

        if ($this->willPrompt()) {
            $this->game->gamestate->changeActivePlayer((int) $this->game->bonusOwner(Material::BONUS_BILLY));
            return null; // wait for actBillyActivate / actBillySkip
        }
        return $this->beginDrafting($order);
    }

    public function getArgs(): array
    {
        // Skip the front-end prep/blink when we pass straight through to drafting (no Billy prompt).
        return ['_no_notify' => !$this->willPrompt()];
    }

    /** True when another player leads the draft and an unused Billy owner could jump in. */
    private function willPrompt(): bool
    {
        if (!$this->game->bonusEnabled()) {
            return false;
        }
        $order = array_values(array_map('intval', (array) $this->game->globals->get('draftOrder')));
        $owner = $this->game->bonusOwner(Material::BONUS_BILLY);
        return $owner !== null && !empty($order) && $order[0] !== $owner && in_array($owner, $order, true);
    }

    /** Start the draft phase at the front of the (possibly reordered) draft order. */
    private function beginDrafting(array $order): string
    {
        $this->game->globals->set('draftIndex', 0);
        $this->game->gamestate->changeActivePlayer((int) $order[0]);
        return DraftCard::class;
    }

    #[PossibleAction]
    public function actBillyActivate()
    {
        $owner = (int) $this->game->getActivePlayerId();
        $order = array_values(array_map('intval', (array) $this->game->globals->get('draftOrder')));

        // Move ONE of the owner's draft-order entries to the front; that first draft becomes the discard.
        $idx = array_search($owner, $order, true);
        if ($idx !== false) {
            array_splice($order, $idx, 1);
        }
        array_unshift($order, $owner);
        $this->game->globals->set('draftOrder', $order);
        $this->game->globals->set('billyDiscardIndex', 0);
        $this->game->markBonusUsed(Material::BONUS_BILLY);

        $this->notify->all('bonusUsed', clienttranslate('${player_name} plays Billy\'s a Brute and drafts first'), [
            'player_id'   => $owner,
            'player_name' => $this->game->getPlayerNameById($owner),
            'bonus'       => $this->game->bonusState(),
        ]);
        return $this->beginDrafting($order);
    }

    #[PossibleAction]
    public function actBillySkip()
    {
        // Not consumed — the owner keeps Billy for a later trick.
        return $this->beginDrafting(
            array_values(array_map('intval', (array) $this->game->globals->get('draftOrder')))
        );
    }

    function zombie(int $playerId)
    {
        return $this->beginDrafting(
            array_values(array_map('intval', (array) $this->game->globals->get('draftOrder')))
        );
    }
}
