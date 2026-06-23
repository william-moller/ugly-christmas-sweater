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
 * Build a card element. `extras` lets callers add a small overlay (e.g. the slot a card occupies in a
 * build, which is dynamic and lives on the card row rather than the static face).
 */
export function createCardElement(card: SweaterCard, material: UcsMaterial): HTMLElement {
    const face = faceOf(card, material);
    const el = document.createElement('div');
    el.id = `ucs-card-${card.id}`;
    el.dataset.cardId = String(card.id);
    el.classList.add('ucs-card', `ucs-color-${face.color}`);
    if (face.patch) {
        el.classList.add('ucs-patch');
    }

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

    el.innerHTML = `
        <div class="ucs-card-pattern"></div>
        <div class="ucs-card-value">${valueLabel}</div>
        <div class="ucs-card-icon">${iconLabel}</div>
        <div class="ucs-card-slot" title="orientation">${slotLabel}</div>
    `;
    return el;
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
        return `<strong>${colour} Patch</strong><br>Wild — value, icon and orientation are chosen when played/placed.`;
    }
    const icon = face.icon ?? '? (pending art)';
    const slot = face.slot ?? '? (pending art)';
    return `<strong>${colour} ${face.value}</strong><br>Icon: ${icon}<br>Orientation: ${slot}`;
}
