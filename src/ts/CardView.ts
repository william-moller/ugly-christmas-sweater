/*
 * CardView — builds placeholder DOM for a sweater card.
 *
 * The publisher art has not arrived yet, so cards are drawn from data we DO have (colour + value,
 * with a colour-blind-friendly pattern per colour). Icon and orientation are printed on the physical
 * cards and live in Material::FACES once transcribed; until then they render as "?" and the markup is
 * already in place to show them the moment that data exists.
 */

/** Unicode glyphs for the four icons (used once Material::FACES is populated). */
const ICON_GLYPH: { [icon: string]: string } = {
    snowman: '☃',     // ☃
    candycane: '\u{1F36C}', // 🍬 (placeholder glyph)
    bell: '\u{1F514}',     // 🔔
    tree: '\u{1F384}',     // 🎄
};

/** Human-readable orientation label. */
const SLOT_LABEL: { [slot: string]: string } = { L: 'L', R: 'R', B: 'B' };

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
 * The inner face markup for a sweater card, matching the printed card art: the value, the
 * orientation letter on a "Christmas-light" bulb, and the icon all stacked in the TOP-LEFT corner,
 * over the colour + colour-blind pattern. Shared by the custom-DOM zones (createCardElement) and the
 * bga-cards hand (the CardManager's setupFrontDiv) so every card looks identical.
 */
export function cardFaceInner(card: SweaterCard, material: UcsMaterial): string {
    const face = faceOf(card, material);

    // A placed patch carries its chosen value/icon on the card row (wildValue / wildIcon); a regular
    // card uses its printed face. An unresolved patch shows a wild star / placeholder.
    const wildValue = card.wildValue != null && card.wildValue !== '' ? Number(card.wildValue) : null;
    const wildIcon = card.wildIcon != null && card.wildIcon !== '' ? String(card.wildIcon) : null;

    // Value: chosen patch value, else printed value, else a wild star for an unresolved patch.
    const valueLabel = wildValue != null ? String(wildValue) : (face.patch ? '★' : String(face.value));

    // Icon: chosen patch icon or printed icon → glyph; "?" placeholder until art, "✶" for a wild patch.
    const effIcon = wildIcon ?? face.icon;
    const iconLabel = effIcon ? (ICON_GLYPH[effIcon] ?? effIcon) : (face.patch ? '✶' : '?');

    // Orientation: prefer the card's placed slot (knitting), else the printed slot, else placeholder.
    const slotRaw = (card.slot as string) ?? face.slot ?? null;
    const slotLabel = slotRaw ? (SLOT_LABEL[slotRaw] ?? slotRaw) : (face.patch ? '✶' : '?');
    const bulbKind = slotRaw ?? 'wild';

    return `
        <div class="ucs-card-pattern"></div>
        <div class="ucs-card-corner">
            <div class="ucs-card-value">${valueLabel}</div>
            <div class="ucs-bulb ucs-bulb-${bulbKind}" title="orientation">${slotLabel}</div>
            <div class="ucs-icon-col">${iconLabel}</div>
        </div>
    `;
}

/** Add the colour/patch classes and inner face to an element (shared by both render paths). */
export function applyCardFace(el: HTMLElement, card: SweaterCard, material: UcsMaterial): void {
    const face = faceOf(card, material);
    el.classList.add('ucs-card', `ucs-color-${face.color}`);
    if (face.patch) {
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
    const colour = face.color.charAt(0).toUpperCase() + face.color.slice(1);
    if (face.patch) {
        return `<strong>${colour} Patch</strong><br>Wild. Starting a new sweater it "floats" (no orientation) `
            + `until a second card joins; its value &amp; icon are chosen at round-end scoring.`;
    }
    const icon = face.icon ?? '? (pending art)';
    const slot = face.slot ?? '? (pending art)';
    return `<strong>${colour} ${face.value}</strong><br>Icon: ${icon}<br>Orientation: ${slot}`;
}
