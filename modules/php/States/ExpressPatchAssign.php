<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweaters\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\GameFramework\UserException;
use Bga\Games\UglyChristmasSweaters\Game;

/**
 * Express only, mid-draft: after a placement completes a sweater that still holds a wild Patch, offer the
 * drafter the OPTION to fix that Patch's value + icon before Fad claims are evaluated.
 *
 * Why it exists: in Express a Fad is claimed the instant a sweater satisfies it, and claiming LOCKS that
 * sweater. A sweater completed with a wild Patch has no icon yet, so it can only ever match a Fad on its
 * (fixed) colour — it auto-claims the colour Fad and can never afterwards take the icon Fad it was one
 * choice away from, because evaluateFadClaims skips locked builds and the display has moved on by the
 * time round-end assignment comes round. Assigning here is what lets the player take that Fad.
 *
 * Strictly optional, per the designer: skipping leaves the Patch wild for the usual round-end
 * AssignPatches pass, which is what a player wants when they would rather keep building over that sweater
 * than race for a Fad. Casual and Avid never have anything to offer here (a Patch has no reason to commit
 * before scoring there), so they fall straight through to the claim resolution every draft owes anyway.
 */
class ExpressPatchAssign extends GameState
{
    use FinishesDraftPlacement;

    function __construct(protected Game $game)
    {
        parent::__construct($game,
            id: 45,
            type: StateType::ACTIVE_PLAYER,
            description: clienttranslate('${actplayer} may set a patch before Fads are claimed'),
            descriptionMyTurn: clienttranslate('${you} may set a patch\'s value and icon now, to claim a Fad with it'),
        );
    }

    function onEnteringState(int $activePlayerId, array $args)
    {
        // Reachable with nothing to offer only via a race (the sweater stopped qualifying); the normal
        // no-op path is DraftCard never sending us here at all.
        if (empty($args['assignable'])) {
            return $this->finishDraftPlacement($activePlayerId);
        }
        return null; // wait for the player to assign or skip
    }

    public function getArgs(): array
    {
        $activePlayerId = (int) $this->game->getActivePlayerId();
        $assignable = $this->game->expressAssignablePatches($activePlayerId);
        return [
            'assignable' => $assignable,
            '_no_notify' => empty($assignable),
        ];
    }

    /**
     * Assign one Patch and STAY in this state — a player with a second eligible Patch is offered it too.
     * The client drives that loop off its own pending list and calls actFinishExpressPatch when done,
     * exactly as the round-end AssignPatches state already works.
     */
    #[PossibleAction]
    public function actAssignExpressPatch(int $card_id, int $value, string $icon, int $activePlayerId)
    {
        // Re-read rather than trusting the entry args: an earlier assignment in this same state may have
        // changed what is still eligible.
        if (!in_array($card_id, $this->game->expressAssignablePatches($activePlayerId), true)) {
            throw new UserException(clienttranslate('That patch cannot be assigned right now'));
        }
        $this->game->assignPatch($card_id, $activePlayerId, $value, $icon);

        // Pinning the Patch can raise the sweater's public value straight away (its run / icon bonuses
        // were held back while it was wild), so refresh before anything claims against it.
        $this->game->afterKnittingChanged($activePlayerId);

        $this->notify->all('patchAssigned', clienttranslate('${player_name} sets a patch to ${card_label}'), [
            'player_id'   => $activePlayerId,
            'player_name' => $this->game->getPlayerNameById($activePlayerId),
            'card_id'     => $card_id,
            'card'        => $this->game->cardForNotif($card_id),
            'card_label'  => $this->game->cardLabel($card_id),
        ]);

        return null; // stay active; the player may have another patch to set
    }

    /** Done assigning (or declined outright): evaluate the claims this draft owes and move on. */
    #[PossibleAction]
    public function actFinishExpressPatch(int $activePlayerId)
    {
        return $this->finishDraftPlacement($activePlayerId);
    }

    function zombie(int $playerId)
    {
        // Never commit an abandoned player's wild Patch — leave it for the round-end pass, which assigns
        // a safe default only if the sweater is still complete at scoring.
        return $this->finishDraftPlacement($playerId);
    }
}
