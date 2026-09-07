<?php

declare(strict_types=1);

namespace Bga\Games\UglyChristmasSweaters\States;

use Bga\Games\UglyChristmasSweaters\Material;

/**
 * The tail every draft placement owes, shared by the two states that can reach it: DraftCard when there
 * is nothing to assign (every Casual/Avid draft, and most Express ones), and ExpressPatchAssign once the
 * player has assigned or skipped.
 *
 * It cannot simply live at the end of actDraftCard any more: Fad claims must be evaluated AFTER any
 * mid-draft Patch assignment, because a Patch pinned down first can win an icon Fad that a wild one never
 * could. One copy here so the two exit paths cannot drift.
 */
trait FinishesDraftPlacement
{
    /**
     * Resolve this placement's Fad claims, announce the hand's end if it just triggered, and hand on to
     * the next drafter.
     */
    protected function finishDraftPlacement(int $playerId): string
    {
        // Express: evaluated between each draft — the active player claims any displayed Fad their tableau
        // now satisfies (locking that sweater). Only they can claim now, so there's never a tie. Re-score
        // afterwards so the claimed Fad's points land immediately. No-op outside Express.
        foreach ($this->game->evaluateFadClaims($playerId) as $claim) {
            $fad = Material::fads()[$claim['type_arg']] ?? null;
            $this->notify->all('fadClaimed', clienttranslate('${player_name} claims the Fad: ${fad_label}'), [
                'player_id'   => $playerId,
                'player_name' => $this->game->getPlayerNameById($playerId),
                'fad_id'      => $claim['fad_id'],
                'fad_type'    => $claim['type_arg'],
                // Fallback label; the client re-translates it from its own material in bgaFormatText.
                'fad_label'   => $fad['title'] ?? '',
                'build_no'    => $claim['build_no'],
                'gameplay'    => $this->game->getGameplayState(),
            ]);
            $this->game->afterKnittingChanged($playerId);
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

        return NextDrafter::class;
    }
}
