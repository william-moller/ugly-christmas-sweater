<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\Games\UglyChristmasSweater\Game;
use Bga\Games\UglyChristmasSweater\Material;

/**
 * Round-end Patch assignment. A Patch's value + icon stay wild until now: every player who has a Patch
 * in a COMPLETED sweater assigns a value (1-12) and icon to each, simultaneously (order doesn't matter —
 * they're only filling in their own cards). Then scoring runs (ScoreRound). If no one has such a patch,
 * we skip straight to ScoreRound. Patches in incomplete sweaters are never assigned (those don't score).
 */
class AssignPatches extends GameState
{
    function __construct(protected Game $game)
    {
        parent::__construct($game,
            id: 65,
            type: StateType::MULTIPLE_ACTIVE_PLAYER,
            description: clienttranslate('Other players are assigning their patch cards'),
            descriptionMyTurn: clienttranslate('Assign a value and icon to each of your patch cards'),
        );
    }

    function onEnteringState()
    {
        $assignable = $this->game->playersWithUnassignedPatches();
        if (empty($assignable)) {
            return ScoreRound::class; // nobody has a patch in a completed sweater → nothing to assign
        }
        $this->game->gamestate->setPlayersMultiactive(array_keys($assignable), ScoreRound::class);
    }

    public function getArgs(): array
    {
        // Knitting is public, so the assignable patches (playerId => [cardId]) can be public args; each
        // client only assigns its own. _no_notify skips the prep/blink when there's nothing to assign.
        $assignable = $this->game->playersWithUnassignedPatches();
        return [
            'assignable' => $assignable,
            '_no_notify' => empty($assignable),
        ];
    }

    #[PossibleAction]
    public function actAssignPatch(int $card_id, int $value, string $icon)
    {
        $playerId = (int) $this->game->getCurrentPlayerId();
        $this->game->assignPatch($card_id, $playerId, $value, $icon);

        // Assigning a patch can raise the sweater's public value (run / Fad / icon bonuses that were held
        // back while the patch was wild — see publicSweaterScore), so refresh the official score now rather
        // than leaving the panel stale until scoreRound. The appliedPublic delta keeps the total correct.
        $this->game->refreshPublicScore($playerId);

        // Carry the now-assigned card row so every client re-renders the patch with its value/icon.
        $this->notify->all('patchAssigned', clienttranslate('${player_name} sets a patch to ${card_label}'), [
            'player_id'   => $playerId,
            'player_name' => $this->game->getPlayerNameById($playerId),
            'card_id'     => $card_id,
            'card'        => $this->game->cardForNotif($card_id),
            'card_label'  => $this->game->cardLabel($card_id),
        ]);

        // This player is done once none of their completed-sweater patches remain unassigned.
        if (empty($this->game->unassignedPatchesInCompletedSweaters($playerId))) {
            $this->game->gamestate->setPlayerNonMultiactive($playerId, ScoreRound::class);
        }
    }

    function zombie(int $playerId)
    {
        // Abandoned player: assign a safe default (lowest value, first icon) to each pending patch.
        foreach ($this->game->unassignedPatchesInCompletedSweaters($playerId) as $cardId) {
            $this->game->assignPatch($cardId, $playerId, Material::VALUE_MIN, Material::ICONS[0]);
        }
        $this->game->gamestate->setPlayerNonMultiactive($playerId, ScoreRound::class);
    }
}
