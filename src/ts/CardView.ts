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

    const wildValue = card.wildValue != null && card.wildValue !== '' ? Number(card.wildValue) : null;
    const wildIcon = card.wildIcon != null && card.wildIcon !== '' ? String(card.wildIcon) : null;
    if (wildValue == null && wildIcon == null) return ''; // unresolved patch — art's own "?" suffices

    const valueLabel = wildValue != null ? String(wildValue) : '';
    return `<div class="ucs-wild-badge">`
        + `<span class="ucs-wild-value">${valueLabel}</span>`
        + (wildIcon ? `<span class="ucs-icon ucs-icon-${wildIcon} ucs-wild-icon"></span>` : '')
        + `</div>`;
}

/** Add the sizing + sprite-face classes and any patch overlay (shared by both render paths). */
export function applyCardFace(el: HTMLElement, card: SweaterCard, material: UcsMaterial): void {
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
    const wildValue = card.wildValue != null && card.wildValue !== '' ? Number(card.wildValue) : null;

    if (face?.patch) {
        const patchChip = `<span class="ucs-log-card ucs-log-patch ucs-color-${color}">★</span>`;
        if (wildValue != null) {
            const valueChip = `<span class="ucs-log-card ucs-color-${color}">${wildValue}</span>`;
            return `${patchChip} ${_('as')} ${valueChip}`;
        }
        return patchChip;
    }

    const valueLabel = wildValue != null ? String(wildValue) : String(face?.value ?? '?');
    return `<span class="ucs-log-card ucs-color-${color}">${valueLabel}</span>`;
}

/** A face-down placeholder (e.g. opponents' hand backs). */
export function createCardBack(): HTMLElement {
    const el = document.createElement('div');
    el.classList.add('ucs-card', 'ucs-card-back');
    return el;
}

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
