import { parseQuery, evaluateAST } from './queryParser.js';
import { initTooltip } from './tooltip.js';

let allCards = [];
const container = document.getElementById('cardGrid');
const searchInput = document.getElementById('searchInput');
const resultCount = document.getElementById('resultCount');
const showTokenCheckbox = document.getElementById('showToken');
const sortSelect = document.getElementById('sortSelect');
const sortOrder = document.getElementById('sortOrder');

function render() {
  const showTokens = showTokenCheckbox.checked;
  const sortBy = sortSelect.value;
  const isDesc = sortOrder.value === 'desc';
  const modifier = isDesc ? -1 : 1;

  const rawQuery = searchInput.value;
  const queryAST = parseQuery(rawQuery);

  // 1. Filter cards
  const filteredCards = allCards.filter(card => {
    if (!showTokens && card['data-card-series'] === 'Unknown') {
      return false;
    }
    if (queryAST) {
      return evaluateAST(queryAST, card);
    }
    return true;
  });

  // Update count label
  const count = filteredCards.length;
  if (count === 0) {
    resultCount.textContent = "No results";
  } else if (count === 1) {
    resultCount.textContent = "1 result";
  } else {
    resultCount.textContent = `${count} results`;
  }

  // 2. Sort cards
  filteredCards.sort((a, b) => {
    const costA = parseFloat(a['data-card-cost']) || 0;
    const costB = parseFloat(b['data-card-cost']) || 0;
    const powerA = parseFloat(a['data-card-power']) || 0;
    const powerB = parseFloat(b['data-card-power']) || 0;
    const nameA = a['data-card-name'] || '';
    const nameB = b['data-card-name'] || '';
    const releaseA = a['data-card-release'] || '';
    const releaseB = b['data-card-release'] || '';

    let comparison = 0;

    if (sortBy === 'cost') {
      if (costA !== costB) comparison = costA - costB;
      else if (powerA !== powerB) comparison = powerA - powerB;
      else comparison = nameA.localeCompare(nameB);
    } 
    else if (sortBy === 'power') {
      if (powerA !== powerB) comparison = powerA - powerB;
      else if (costA !== costB) comparison = costA - costB;
      else comparison = nameA.localeCompare(nameB);
    } 
    else if (sortBy === 'name') {
      const nameCmp = nameA.localeCompare(nameB);
      if (nameCmp !== 0) comparison = nameCmp;
      else if (costA !== costB) comparison = costA - costB;
      else comparison = powerA - powerB;
    }
    else if (sortBy === 'release') {
      const relCmp = releaseA.localeCompare(releaseB);
      if (relCmp !== 0) comparison = relCmp;
      else if (costA !== costB) comparison = costA - costB;
      else if (powerA !== powerB) comparison = powerA - powerB;
      else comparison = nameA.localeCompare(nameB);
    }

    return comparison * modifier;
  });

  // 3. Render cards with data-key
  container.innerHTML = filteredCards.map(card => {
    const key = card['data-card-key'];
    const name = card['data-card-name'] || key;
    
    return `
      <div class="card-item" data-key="${key}">
        <img 
          src="card_images/${key}.webp" 
          alt="${name}" 
          title="${name}"
          loading="lazy"
        >
        <span class="card-search-label">${name}</span>
      </div>
    `;
  }).join('');
}

// Initialize tooltip module with a card lookup callback
initTooltip(container, (key) => allCards.find(c => c['data-card-key'] === key));

// Event Listeners
searchInput.addEventListener('change', render);

searchInput.addEventListener('input', () => {
  if (searchInput.value.trim() === '') {
    render();
  }
});

showTokenCheckbox.addEventListener('change', render);
sortSelect.addEventListener('change', render);
sortOrder.addEventListener('change', render);

// Fetch cards
fetch('cards.json')
  .then(response => response.json())
  .then(cards => {
    allCards = cards;
    render();
  })
  .catch(err => console.error('Error loading cards:', err));