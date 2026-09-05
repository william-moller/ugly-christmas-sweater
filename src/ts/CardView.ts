/*
 * CardView — builds the DOM for a sweater card.
 *
 * Card faces are the real publisher art, painted from a CSS sprite sheet (img/sweaters.jpg) via the
 * per-card `.ucs-face-<colour>_<value>` classes (see applyCardFace / faceSpriteClass). The printed art
 * already carries value, icon and orientation, so the only DOM overlay is a wild-value badge for a
 * patch that has taken on an identity. The icon glyphs below are still used for that badge, for the
 * game log chips, and for pickers/read-outs.
 */

// Translated display names for the data-driven colour / icon / orientation values. Each `_()` call
// takes a literal so BGA's translation scanner picks it up; the lookup runs at render time. Falls
// back to the raw value for anything unexpected. These are the single source of truth for turning a
// card's colour/icon/slot into player-facing text (tooltips, read-outs).
export function colourName(colour: string): string {
    switch (colour) {
        case 'green': return _('Green');
        case 'red': return _('Red');
        case 'yellow': return _('Yellow');
        case 'purple': return _('Purple');
        default: return colour;
    }
}
// A colour-tinted Trendy-Yarn name for a game-log line ("New Trendy Yarn: Purple"). Tinted via the
// .ucs-log-trendy-<colour> classes (same $colors hexes as the cards — see Game.scss); the visible text
// is the translated colour name from colourName().
export function trendyLogChip(colour: string): string {
    return `<span class="ucs-log-trendy-${colour}">${colourName(colour)}</span>`;
}
export function iconName(icon: string): string {
    switch (icon) {
        case 'snowman': return _('Snowman');
        case 'candycane': return _('Candy Cane');
        case 'bell': return _('Bell');
        case 'tree': return _('Tree');
        default: return icon;
    }
}
export function orientationName(slot: string): string {
    switch (slot) {
        case 'L': return _('Left');
        case 'R': return _('Right');
        case 'B': return _('Bottom');
        default: return slot;
    }
}

/** The three orientation slots a sweater piece can occupy — mirrors Material::SLOTS. */
export const SLOTS = ['L', 'R', 'B'] as const;

/**
 * HTML tooltip for a Fad round-parameter card: its printed title plus the concrete scoring every player
 * can earn this round. `fad` is a Material::fads() entry — either { title, objectives:[{match,value}×2] }
 * (one colour + one icon objective, each scored independently) or { title, clash:true } (the "Clash Is In"
 * card, which instead scores an all-different sweater). VP comes from the server (material.vp).
 */
export function fadTooltip(fad: any, vp: UcsVp): string {
    const title = fad?.title ? _(fad.title) : _('Fad');
    let lines: string;
    if (fad?.clash) {
        lines = `<li>${_('Three pieces all different colours and all different icons')} — <b>+${vp.fad} ${_('VP')}</b></li>`;
    } else {
        lines = (fad?.objectives ?? []).map((o: any) => {
            // colourName/iconName are the single source of truth for the player-facing value text.
            const what = o.match === 'icon'
                ? `${_('All')} ${iconName(o.value)} ${_('icons')}`
                : `${_('All')} ${colourName(o.value)}`;
            return `<li>${what} — <b>+${vp.fad} ${_('VP')}</b></li>`;
        }).join('');
    }
    const note = fad?.clash ? '' : `<div class="ucs-tt-note">${_('A single sweater can score both.')}</div>`;
    return `<div class="ucs-tt"><strong>${title}</strong>`
        + `<div class="ucs-tt-sub">${_('Fad — each player scores this round for a completed sweater:')}</div>`
        + `<ul class="ucs-tt-list">${lines}</ul>${note}</div>`;
}

/**
 * HTML tooltip for a Secret Santa objective: the family member's name plus the three pieces the completed
 * sweater must cover. `ss` is a Material::secretSantas() entry — { name, needs:['<color|icon>:<value>'×3] };
 * each piece counts toward EITHER its colour or its icon (orientation ignored), so the needs are shown as
 * a plain checklist. The same entry shape arrives on a REVEALED card, so opponents' cards render here too:
 * `owner` switches the wording from my own private objective to theirs, and `done`, when the verdict is
 * known, replaces the "when satisfied" line with what actually happened.
 */
export function secretSantaTooltip(ss: any, vp: UcsVp, owner?: string, done?: boolean): string {
    const name = ss?.name ? _(ss.name) : _('Secret Santa');
    const needs = (ss?.needs ?? []).map((n: string) => {
        const [kind, value] = String(n).split(':');
        return `<li>${kind === 'icon' ? iconName(value) : colourName(value)}</li>`;
    }).join('');
    const sub = owner
        ? _('${player_name}\'s objective — one sweater covering all three:').replace('${player_name}', owner)
        : _('Your private objective — complete a sweater covering all three:');
    const note = done === undefined
        ? `${_('Worth')} <b>+${vp.secretSanta} ${_('VP')}</b> ${_('when satisfied.')}`
        : done
            ? `<b>${_('Completed')}</b> — +${vp.secretSanta} ${_('VP')}`
            : `<b>${_('Not completed')}</b> — ${_('no VP')}`;
    return `<div class="ucs-tt"><strong>${name}</strong>`
        + `<div class="ucs-tt-sub">${sub}</div>`
        + `<ul class="ucs-tt-list">${needs}</ul>`
        + `<div class="ucs-tt-note">${note}</div></div>`;
}

/**
 * A card's wild value / icon if it has taken one on, else null. A patch carries these once it has
 * copied a card in a trick or been assigned at round-end scoring; the server sends them as strings,
 * and an unresolved patch as null or ''. Single source of truth for that "resolved?" test.
 */
export function wildValueOf(card: SweaterCard): number | null {
    return card.wildValue != null && card.wildValue !== '' ? Number(card.wildValue) : null;
}
export function wildIconOf(card: SweaterCard): string | null {
    return card.wildIcon != null && card.wildIcon !== '' ? String(card.wildIcon) : null;
}

/** Resolve a card row to its static face via the material map. */
export function faceOf(card: SweaterCard, material: UcsMaterial): CardFace {
    const key = `${card.type}_${card.type_arg}`;
    return material.sweaters[key];
}

/** True when a card is a patch (wild). */
export function isPatch(card: SweaterCard, material: UcsMaterial): boolean {
    const face = faceOf(card, material);
    return !!face && face.patch;
}

/**
 * The CSS class that paints a card's face from the sprite sheet (img/sweaters.jpg). Keyed exactly
 * like faceOf() — `<colour>_<value>`, value 0 = patch — so it resolves the same cell for all 52
 * cards. Generated positions live in src/scss/_sweater-sprites.scss (scripts/build-sprites.mjs).
 */
export function faceSpriteClass(card: SweaterCard): string {
    return `ucs-face-${card.type}_${card.type_arg}`;
}

/**
 * Overlay markup drawn ON TOP of a card's sprite face. The printed art already carries value, icon
 * and orientation for every numbered card, so numbered cards need no overlay (returns ''). The only
 * overlay is for a PATCH that has taken on an identity — a value/icon copied during a trick, or
 * assigned at round-end scoring — shown as a centred badge over the wild patch art.
 */
export function cardFaceInner(card: SweaterCard, material: UcsMaterial): string {
    const face = faceOf(card, material);
    if (!face?.patch) return ''; // numbered card — the printed art shows everything

    const wildValue = wildValueOf(card);
    const wildIcon = wildIconOf(card);
    if (wildValue == null && wildIcon == null) return ''; // unresolved patch — art's own "?" suffices

    const valueLabel = wildValue != null ? String(wildValue) : '';
    return `<div class="ucs-wild-badge">`
        + `<span class="ucs-wild-value">${valueLabel}</span>`
        + (wildIcon ? `<span class="ucs-icon ucs-icon-${wildIcon} ucs-wild-icon"></span>` : '')
        + `</div>`;
}

/** Add the sizing + sprite-face classes and any patch overlay (shared by both render paths). */
function applyCardFace(el: HTMLElement, card: SweaterCard, material: UcsMaterial): void {
    const face = faceOf(card, material);
    el.classList.add('ucs-card', 'ucs-face', faceSpriteClass(card));
    if (face?.patch) {
        el.classList.add('ucs-patch');
    }
    el.innerHTML = cardFaceInner(card, material);
}

/**
 * Build a standalone card element (used by the custom-DOM zones: draft pool, trade area, knitting).
 * The bga-cards hand builds its faces through the CardManager instead (see Game.ts), but both share
 * `cardFaceInner` so the visuals match.
 */
export function createCardElement(card: SweaterCard, material: UcsMaterial): HTMLElement {
    const el = document.createElement('div');
    el.id = `ucs-card-${card.id}`;
    el.dataset.cardId = String(card.id);
    applyCardFace(el, card, material);
    return el;
}

/**
 * A compact inline card "chip" for the game log: a colour-coded box showing the card's value
 * (colour + value is enough to identify the exact card in play). Built client-side from the card
 * row carried in the notification, so historical logs / replays stay valid.
 *
 * A **Patch** is shown as its own wild-star chip so it's never confused with the real card it copies:
 * a patch that has taken on a value (e.g. mimicking the previous card in a trick) reads "★ as 11";
 * an unresolved patch (just drafted) shows only the star.
 */
export function cardLogChip(card: SweaterCard, material: UcsMaterial): string {
    const face = faceOf(card, material);
    const color = face?.color ?? String(card.type);
    const wildValue = wildValueOf(card);
    // Native `title` tooltip: log HTML is injected by the framework (main log + replay/chat log) with no
    // live node we could addTooltipHtml onto, so a plain-text title is the robust way to make the chip
    // hoverable. Escaped for the attribute; our label strings never contain quotes, but be defensive.
    const t = ` title="${cardLogTitle(card, material).replace(/"/g, '&quot;')}"`;

    if (face?.patch) {
        const patchChip = `<span class="ucs-log-card ucs-log-patch ucs-color-${color}"${t}>★</span>`;
        if (wildValue != null) {
            const valueChip = `<span class="ucs-log-card ucs-color-${color}"${t}>${wildValue}</span>`;
            return `${patchChip} ${_('as')} ${valueChip}`;
        }
        return patchChip;
    }

    const valueLabel = wildValue != null ? String(wildValue) : String(face?.value ?? '?');
    return `<span class="ucs-log-card ucs-color-${color}"${t}>${valueLabel}</span>`;
}

/**
 * Plain-text description of a card for a log chip's native `title` tooltip (colour + value · icon ·
 * orientation; a patch reads as its wild identity). Kept plain — unlike the BGA HTML tooltips elsewhere —
 * because the framework injects log HTML with no node we can bind gameui.addTooltipHtml to.
 *
 * Doubles as the card's accessible name — see the `cardAriaLabel` alias below. The card faces are
 * sprite-painted divs with no intrinsic text, so without this a screen reader announces nothing at all.
 */
function cardLogTitle(card: SweaterCard, material: UcsMaterial): string {
    const face = faceOf(card, material);
    const colour = colourName(face?.color ?? String(card.type));
    const wildValue = wildValueOf(card);
    if (face?.patch) {
        const base = `${colour} ${_('Patch')} (${_('wild')})`;
        return wildValue != null ? `${base} ${_('as')} ${wildValue}` : base;
    }
    const parts = [`${colour} ${wildValue != null ? wildValue : (face?.value ?? '?')}`];
    if (face?.icon) parts.push(iconName(face.icon));
    if (face?.slot) parts.push(orientationName(face.slot));
    return parts.join(' · ');
}

/**
 * The accessible name (`aria-label`) for a card element. Same string as the log chip's title — a card
 * reads the same way whether a screen reader meets it in the log or on the table — so this is a
 * deliberate alias, not a copy that could drift.
 */
export const cardAriaLabel = cardLogTitle;

/** Tooltip HTML describing a card (colour + value; icon/orientation once known). */
export function cardTooltip(card: SweaterCard, material: UcsMaterial): string {
    const face = faceOf(card, material);
    const colour = colourName(face.color);
    if (face.patch) {
        return `<strong>${colour} ${_('Patch')}</strong><br>`
            + _('Wild. Starting a new sweater it "floats" (no orientation) until a second card joins; its value & icon are chosen at round-end scoring.');
    }
    const icon = face.icon ? iconName(face.icon) : '?';
    const slot = face.slot ? orientationName(face.slot) : '?';
    return `<strong>${colour} ${face.value}</strong><br>${_('Icon:')} ${icon}<br>${_('Orientation:')} ${slot}`;
}
