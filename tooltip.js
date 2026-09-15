// ==========================================
// CARD HOVER TOOLTIP MODULE
// ==========================================

export function initTooltip(container, getCardByKey) {
  const tooltip = document.getElementById('cardTooltip');
  if (!tooltip || !container) return;

  container.addEventListener('mouseover', (e) => {
    const cardItem = e.target.closest('.card-item');
    if (!cardItem) return;

    const key = cardItem.dataset.key;
    const card = getCardByKey(key);
    if (!card) return;

    const name = card['data-card-name'] || key;
    const cost = card['data-card-cost'] ?? '-';
    const power = card['data-card-power'] ?? '-';
    const type = (card['data-card-type'] || '').toUpperCase();
    const desc = card['description'] || '<i>No ability text</i>';

    // If card is a SPELL, omit power and show only cost
    const stats = type === 'SPELL' ? `${cost}` : `${cost}/${power}`;

    // Header format: CARDNAME - COST (for spells) or CARDNAME - COST/POWER
    tooltip.innerHTML = `
      <div class="card-tooltip-header">${name} - ${stats}</div>
      <div class="card-tooltip-body">${desc}</div>
    `;

    tooltip.style.display = 'block';

    // Position calculation relative to viewport
    const rect = cardItem.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    // Center horizontally over the card, clamped to screen edges
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    if (left < 10) left = 10;
    if (left + tooltipRect.width > window.innerWidth - 10) {
      left = window.innerWidth - tooltipRect.width - 10;
    }

    // 6rem top bar is 96px high
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top - 96;

    let top;
    // If not enough room below and more room above, flip ABOVE the card
    if (spaceBelow < tooltipRect.height + 12 && spaceAbove > spaceBelow) {
      top = rect.top - tooltipRect.height;
    } else {
      top = rect.bottom;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  });

  container.addEventListener('mouseout', (e) => {
    const cardItem = e.target.closest('.card-item');
    if (!cardItem) return;
    if (!cardItem.contains(e.relatedTarget)) {
      tooltip.style.display = 'none';
    }
  });

  // Hide tooltip when scrolling so it doesn't float away
  window.addEventListener('scroll', () => {
    tooltip.style.display = 'none';
  }, { passive: true });
}