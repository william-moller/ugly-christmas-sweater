<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweater\States;

use Bga\GameFramework\StateType;
use Bga\GameFramework\States\GameState;
use Bga\GameFramework\States\PossibleAction;
use Bga\Games\UglyChristmasSweater\Game;
use Bga\Games\UglyChristmasSweater\Material;

/**
 * Tina Can Tink (bonus): at round end, BEFORE scoring (and before patch assignment), the (unused) Tina
 * owner may move one placed sweater piece or swap two placed pieces, then the card is spent. Passes
 * straight through to AssignPatches when the option is Off, no Tina owner remains, or the owner passes.
 */
class TinaTink extends GameState
{
    function __construct(protected Game $game)
    {
        parent::__construct($game,
            id: 62,
            type: StateType::MULTIPLE_ACTIVE_PLAYER,
            description: clienttranslate('A player may play Tina Can Tink'),
            descriptionMyTurn: clienttranslate('Play Tina Can Tink to move or swap a sweater piece, or pass'),
        );
    }

    function onEnteringState()
    {
        $owner = $this->game->bonusEnabled() ? $this->game->bonusOwner(Material::BONUS_TINA) : null;
        if ($owner === null) {
            return AssignPatches::class; // nobody can Tink → straight to patch assignment / scoring
        }
        $this->game->gamestate->setPlayersMultiactive([$owner], AssignPatches::class);
        return null;
    }

    public function getArgs(): array
    {
        $owner = $this->game->bonusEnabled() ? $this->game->bonusOwner(Material::BONUS_TINA) : null;
        // Skip the front-end prep/blink when nobody can Tink (we pass straight through to AssignPatches).
        return ['owner' => $owner, '_no_notify' => $owner === null];
    }

    #[PossibleAction]
    public function actTinaMove(int $card_id, int $build_no, string $slot)
    {
        $playerId = (int) $this->game->getCurrentPlayerId();
        $this->game->tinaMove($playerId, $card_id, $build_no, $slot);
        $this->finish($playerId);
    }

    #[PossibleAction]
    public function actTinaSwap(int $card_a, int $card_b)
    {
        $playerId = (int) $this->game->getCurrentPlayerId();
        $this->game->tinaSwap($playerId, $card_a, $card_b);
        $this->finish($playerId);
    }

    #[PossibleAction]
    public function actTinaSkip()
    {
        // Not consumed — the owner keeps Tina for a later round.
        $this->game->gamestate->setPlayerNonMultiactive((int) $this->game->getCurrentPlayerId(), AssignPatches::class);
    }

    /** Spend the card, push the re-arranged knitting + refreshed score, and hand off to scoring. */
    private function finish(int $playerId): void
    {
        $this->game->markBonusUsed(Material::BONUS_TINA);
        $this->game->refreshPublicScore($playerId);
        $this->notify->all('tinaResolved', clienttranslate('${player_name} plays Tina Can Tink'), [
            'player_id'   => $playerId,
            'player_name' => $this->game->getPlayerNameById($playerId),
            'knitting'    => array_values($this->game->getCardsWithExtras(Game::LOC_KNITTING, $playerId)),
            'bonus'       => $this->game->bonusState(),
        ]);
        $this->game->gamestate->setPlayerNonMultiactive($playerId, AssignPatches::class);
    }

    function zombie(int $playerId)
    {
        $this->game->gamestate->setPlayerNonMultiactive($playerId, AssignPatches::class);
    }
}
