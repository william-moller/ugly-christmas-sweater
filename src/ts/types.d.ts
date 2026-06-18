interface UglyChristmasSweaterPlayer extends Player {
    fadPoints: number; // total Fad points scored (tie-break #2)
}

interface UglyChristmasSweaterGamedatas extends Gamedatas<UglyChristmasSweaterPlayer> {
    // TODO: type the fields returned by Game::getAllDatas (hand, draftpool, trick, knitting,
    // activeGameplay, counts, material, roundNo, leaderId) as the UI is built out.
}

/*
 * State arg types
 */
interface PlayCardArgs {
    playableCardsIds: number[];
}

interface DraftCardArgs {
    draftableIds: number[];
}
