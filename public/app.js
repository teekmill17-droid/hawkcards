// ==========================================
// CARD VAULT — Client-side Application
// ==========================================

const sportEmoji = { Baseball: '⚾', Football: '🏈', Basketball: '🏀' };

function handleImgError(el, sport) {
  const wrap = el.closest('.card-img-wrap');
  if (wrap) wrap.outerHTML = `<div class="card-placeholder">${sportEmoji[sport] || '🃏'}</div>`;
}
function handleDetailImgError(el, sport) {
  const wrap = el.closest('.detail-img-wrap');
  if (wrap) wrap.outerHTML = `<div class="detail-img-placeholder">${sportEmoji[sport] || '🃏'}</div>`;
}
let currentFilter = 'All';
let bulkMode = false;
let scanQueue = []; // array of { file, preview, filename }
let editingId = null;
let editingBulkIndex = null;
let currentImagePath = '';
let cameraStream = null;
let reviewCardData = null;
let bulkReviewCards = [];

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', async () => {
  buildSportFilters();
  await checkSettings();
  await loadCards();
  await loadStats();

  // Close menu on outside click
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('dropdown-menu');
    const btn = document.getElementById('menu-btn');
    if (!menu.contains(e.target) && !btn.contains(e.target)) {
      menu.classList.remove('open');
    }
  });
});

// ========== NAVIGATION ==========
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelector(`[data-view="${view}"]`).classList.add('active');

  if (view === 'add' && !editingId) resetForm();
  if (view === 'scan') resetScan();
  if (view === 'stats') loadStats();
  if (view === 'collection') loadCards();
}

function openScan() { switchView('scan'); }

function toggleMenu() {
  document.getElementById('dropdown-menu').classList.toggle('open');
}

// ========== SETTINGS ==========
async function checkSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (!data.hasEbayAppId) {
      // subtle hint only — don't force modal
    }
  } catch (e) {}
}

function openSettings() {
  document.getElementById('dropdown-menu').classList.remove('open');
  document.getElementById('settings-modal').style.display = 'flex';
}

function closeSettings() {
  document.getElementById('settings-modal').style.display = 'none';
}

async function saveAnthropicKey() {
  const apiKey = document.getElementById('anthropic-key-input').value.trim();
  if (!apiKey) return;
  try {
    const res = await fetch('/api/settings/anthropic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey })
    });
    if (res.ok) {
      showToast('Claude key saved! Card recognition ready.', 'success');
      document.getElementById('anthropic-status').innerHTML = '<p style="color:var(--green)">✓ Saved — using Claude Haiku (~$0.002/scan)</p>';
    }
  } catch (e) {
    showToast('Failed to save key', 'error');
  }
}

async function saveGroqKey() {
  const apiKey = document.getElementById('groq-key-input').value.trim();
  if (!apiKey) return;
  try {
    const res = await fetch('/api/settings/groq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey })
    });
    if (res.ok) {
      showToast('Groq key saved! Card recognition is ready.', 'success');
      document.getElementById('groq-status').innerHTML = '<p style="color:var(--green)">✓ Saved — AI recognition ready</p>';
    }
  } catch (e) {
    showToast('Failed to save key', 'error');
  }
}

async function saveGeminiKey() {
  const el = document.getElementById('gemini-key-input');
  const apiKey = el ? el.value.trim() : '';
  if (!apiKey) return;
  try {
    const res = await fetch('/api/settings/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey })
    });
    if (res.ok) showToast('Gemini key saved!', 'success');
  } catch (e) {
    showToast('Failed to save key', 'error');
  }
}

async function saveEbayId() {
  const appId = document.getElementById('ebay-appid-input').value.trim();
  if (!appId) return;
  try {
    const res = await fetch('/api/settings/ebay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId })
    });
    if (res.ok) {
      showToast('eBay App ID saved!', 'success');
      document.getElementById('api-status').innerHTML = '<p style="color:var(--green)">✓ Saved — price lookups ready</p>';
    }
  } catch (e) {
    showToast('Failed to save App ID', 'error');
  }
}

// ========== CARDS ==========
function buildSportFilters() {
  const container = document.getElementById('sport-filters');
  ['All', 'Baseball', 'Football', 'Basketball'].forEach(sp => {
    const btn = document.createElement('button');
    btn.className = `filter-chip${sp === 'All' ? ' active' : ''}`;
    btn.textContent = (sp !== 'All' ? sportEmoji[sp] + ' ' : '') + sp;
    btn.onclick = () => {
      currentFilter = sp;
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      loadCards();
    };
    container.appendChild(btn);
  });
}

async function loadCards() {
  const search = document.getElementById('search-input').value;
  const sort = document.getElementById('sort-select').value;
  const clearBtn = document.getElementById('clear-search');
  clearBtn.style.display = search ? 'flex' : 'none';

  const params = new URLSearchParams({ sort });
  if (currentFilter !== 'All') params.set('sport', currentFilter);
  if (search) params.set('search', search);

  try {
    const res = await fetch(`/api/cards?${params}`);
    const cards = await res.json();

    const grid = document.getElementById('cards-grid');
    const empty = document.getElementById('empty-state');

    if (cards.length === 0) {
      grid.innerHTML = '';
      empty.style.display = 'block';
      empty.querySelector('.empty-title').textContent = search ? 'No matches found' : 'No cards yet, Hawkeye';
      empty.querySelector('.empty-sub').textContent = search ? 'Try different search terms' : 'Scan or add your first card to get started';
      return;
    }

    empty.style.display = 'none';
    grid.innerHTML = cards.map((card, i) => `
      <div class="card-tile" style="animation-delay:${i * 0.03}s" onclick="openDetail(${card.id})">
        ${card.image_path ? `
          <div class="card-img-wrap">
            <img src="${card.image_path}" alt="" loading="lazy" onerror="handleImgError(this,'${card.sport}')">
            <div class="card-img-gradient"></div>
            ${card.is_duplicate ? '<span class="dupe-badge">DUPE</span>' : ''}
            ${card.is_graded ? `<span class="graded-badge">${card.psa_grade || 'GRADED'}</span>` : ''}
          </div>
        ` : `
          <div class="card-placeholder" style="position:relative">
            ${sportEmoji[card.sport] || '🃏'}
            ${card.is_duplicate ? '<span class="dupe-badge">DUPE</span>' : ''}
          </div>
        `}
        <div class="card-body">
          <p class="card-name">${esc(card.player_name || 'Unknown')}</p>
          <p class="card-meta">${[card.team, card.year, card.brand, card.set_name].filter(Boolean).join(' · ')}</p>
          <div class="card-footer">
            <span class="card-condition">${(card.condition_grade || '').split(' ')[0]}</span>
            ${card.estimated_value > 0 ? `<span class="card-value">$${Number(card.estimated_value).toLocaleString()}</span>` : ''}
          </div>
        </div>
      </div>
    `).join('');

    // Update header stats
    const allCards = await (await fetch('/api/cards')).json();
    const total = allCards.length;
    const value = allCards.reduce((s, c) => s + (c.estimated_value || 0), 0);
    document.getElementById('stat-count').textContent = `${total} cards`;
    document.getElementById('stat-value').textContent = `$${value.toLocaleString()}`;
  } catch (e) {
    console.error('Failed to load cards:', e);
  }
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  loadCards();
}

// ========== DETAIL MODAL ==========
async function openDetail(id) {
  try {
    const [card, history] = await Promise.all([
      fetch(`/api/cards/${id}`).then(r => r.json()),
      fetch(`/api/cards/${id}/price-history`).then(r => r.json()),
    ]);

    const lastSales = history.length ? history[history.length - 1].recent_sales || [] : [];
    const badges = [
      card.is_duplicate ? '<span class="dbadge dupe">DUPE</span>' : '',
      card.is_graded ? `<span class="dbadge graded">${card.psa_grade || 'GRADED'}</span>` : '',
      card.is_wishlist ? '<span class="dbadge wish">WISH</span>' : '',
    ].filter(Boolean).join('');

    document.getElementById('detail-content').innerHTML = `
      ${card.image_path
        ? `<div class="detail-img-wrap"><img class="detail-img" src="${card.image_path}" alt="" onerror="handleDetailImgError(this,'${card.sport}')"></div>`
        : `<div class="detail-img-placeholder">${sportEmoji[card.sport] || '🃏'}</div>`}

      <div class="detail-body">
        <div class="detail-top">
          <div class="detail-title-row">
            <div>
              <p class="detail-name">${esc(card.player_name || 'Unknown')} ${badges}</p>
              <p class="detail-sub">${[card.team, card.year, card.sport].filter(Boolean).join(' · ')}</p>
            </div>
            ${card.estimated_value > 0
              ? `<div class="detail-val-block">
                   <span class="detail-value">$${Number(card.estimated_value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                   <span class="detail-val-label">est. value</span>
                 </div>`
              : ''}
          </div>
          <div class="detail-actions">
            <button class="detail-btn" onclick="editCard(${card.id})">✏️ Edit</button>
            <button class="detail-btn accent" onclick="lookupDetailValue(${card.id})">🔍 Lookup Price</button>
            <button class="detail-btn" onclick="setManualPrice(${card.id})">💲 Set Price</button>
            <button class="detail-btn" onclick="toggleDupe(${card.id}, ${card.is_duplicate})">${card.is_duplicate ? '✅ Undupe' : '🔁 Mark Dupe'}</button>
            <button class="detail-btn danger" onclick="deleteCard(${card.id})">🗑 Delete</button>
          </div>
        </div>

        <div class="detail-section">
          <p class="detail-section-title">Card Details</p>
          <div class="detail-grid">
            ${detailField('Brand', card.brand)}
            ${detailField('Card #', card.card_number)}
            ${detailField('Set', card.set_name)}
            ${detailField('Subset', card.subset)}
            ${detailField('Parallel', card.parallel)}
            ${detailField('Condition', card.condition_grade)}
            ${detailField('Grade', card.psa_grade)}
            ${detailField('Purchased', card.purchase_price > 0 ? `$${card.purchase_price}` : '')}
          </div>
          ${card.notes ? `<div class="detail-notes">${esc(card.notes)}</div>` : ''}
        </div>

        ${history.length > 1 ? `
          <div class="detail-section">
            <p class="detail-section-title">Price History <span class="detail-section-count">${history.length} lookups</span></p>
            <div class="price-chart-wrap">${buildPriceChart(history)}</div>
            <div class="price-history-list">
              ${history.slice(-5).reverse().map(h => `
                <div class="ph-row">
                  <span class="ph-date">${h.looked_up_at.slice(0,10)}</span>
                  <span class="ph-val">$${Number(h.estimated_value).toFixed(2)}</span>
                  <span class="ph-range">${h.value_range_low > 0 ? `$${h.value_range_low}–$${h.value_range_high}` : ''}</span>
                  <span class="ph-count">${h.recent_sales_count > 0 ? `${h.recent_sales_count} sold` : ''}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : history.length === 1 ? `
          <div class="detail-section">
            <p class="detail-section-title">Price History</p>
            <p class="detail-hint">1 lookup so far — check again later to see trend</p>
          </div>
        ` : ''}

        ${lastSales.length ? `
          <div class="detail-section">
            <p class="detail-section-title">Recent eBay Sales <span class="detail-section-count">${lastSales.length} listings</span></p>
            <div class="sales-list">
              ${lastSales.map(s => `
                <div class="sale-row">
                  <div class="sale-info">
                    <p class="sale-title">${esc(s.title)}</p>
                    <p class="sale-date">${s.date || ''}</p>
                  </div>
                  <span class="sale-price">$${Number(s.price).toFixed(2)}</span>
                  ${s.url ? `<a class="sale-link" href="${s.url}" target="_blank">↗</a>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${(() => {
          // Build clean keyword — avoid doubling brand in set name (e.g. "Leaf" + "Leaf HYPE!")
          const { player_name, year, brand, set_name, card_number, parallel } = card;
          const setLower = (set_name || '').toLowerCase();
          const brandLower = (brand || '').toLowerCase();
          const setPart = set_name && brand && setLower.startsWith(brandLower) ? set_name : [brand, set_name].filter(Boolean).join(' ');
          const q = [player_name, year, setPart, parallel, card_number ? `#${card_number}` : ''].filter(Boolean).join(' ');
          const enc = encodeURIComponent(q);
          const encName = encodeURIComponent(player_name || '');
          return `
            <div class="detail-section">
              <p class="detail-section-title">Search Online</p>
              <p class="detail-hint" style="margin-bottom:8px;font-size:11px">${esc(q)}</p>
              <div class="search-links">
                <a class="search-link-btn" href="https://www.ebay.com/sch/212/i.html?_nkw=${enc}&LH_Complete=1&LH_Sold=1&_sop=13" target="_blank">eBay Sold</a>
                <a class="search-link-btn" href="https://sportscardspro.com/search?q=${enc}" target="_blank">SportsCardsPro</a>
                <a class="search-link-btn" href="https://130point.com/sales/?search=${enc}" target="_blank">130point</a>
                <a class="search-link-btn" href="https://www.comc.com/Cards?SearchQuery=${encName}" target="_blank">COMC</a>
              </div>
            </div>
          `;
        })()}
      </div>
    `;

    document.getElementById('detail-modal').style.display = 'flex';
  } catch (e) {
    showToast('Failed to load card', 'error');
  }
}

function detailField(label, value) {
  if (!value) return '';
  return `<div class="detail-field"><p class="detail-field-label">${label}</p><p class="detail-field-value">${esc(String(value))}</p></div>`;
}

function buildPriceChart(history) {
  if (history.length < 2) return '';
  const W = 320, H = 80, pad = { t: 8, r: 8, b: 20, l: 40 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const vals = history.map(h => h.estimated_value);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const pts = history.map((h, i) => {
    const x = pad.l + (i / (history.length - 1)) * cw;
    const y = pad.t + ch - ((h.estimated_value - minV) / range) * ch;
    return `${x},${y}`;
  });
  const area = `${pad.l},${pad.t + ch} ${pts.join(' ')} ${pad.l + cw},${pad.t + ch}`;
  const first = pts[0].split(','), last = pts[pts.length - 1].split(',');
  const change = vals[vals.length - 1] - vals[0];
  const color = change >= 0 ? '#34d399' : '#ef4444';
  return `<svg viewBox="0 0 ${W} ${H}" class="price-chart-svg">
    <defs>
      <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <polygon points="${area}" fill="url(#cg)"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="${color}"/>
    <text x="${pad.l - 4}" y="${Number(pad.t) + Number(ch) + 1}" font-size="9" fill="rgba(255,255,255,0.35)" text-anchor="end">$${minV.toFixed(0)}</text>
    <text x="${pad.l - 4}" y="${pad.t + 8}" font-size="9" fill="rgba(255,255,255,0.35)" text-anchor="end">$${maxV.toFixed(0)}</text>
    <text x="${first[0]}" y="${H}" font-size="8" fill="rgba(255,255,255,0.3)" text-anchor="middle">${history[0].looked_up_at.slice(5,10)}</text>
    <text x="${last[0]}" y="${H}" font-size="8" fill="rgba(255,255,255,0.3)" text-anchor="middle">${history[history.length-1].looked_up_at.slice(5,10)}</text>
  </svg>`;
}

function closeDetail() {
  document.getElementById('detail-modal').style.display = 'none';
}

async function editCard(id) {
  closeDetail();
  const card = await (await fetch(`/api/cards/${id}`)).json();
  editingId = id;
  currentImagePath = card.image_path || '';

  document.getElementById('form-title').textContent = 'Edit Card';
  document.getElementById('save-btn').textContent = 'Save Changes';

  // Fill form
  const fields = ['player_name', 'team', 'sport', 'year', 'brand', 'card_number', 'set_name', 'subset', 'parallel', 'condition_grade', 'psa_grade', 'estimated_value', 'purchase_price', 'notes'];
  fields.forEach(f => {
    const el = document.getElementById(`f-${f}`);
    if (el) el.value = card[f] || '';
  });
  document.getElementById('f-is_duplicate').checked = card.is_duplicate;
  document.getElementById('f-is_wishlist').checked = card.is_wishlist;
  document.getElementById('f-is_graded').checked = card.is_graded;

  if (card.image_path) {
    document.getElementById('form-image-preview').style.display = 'block';
    document.getElementById('form-preview-img').src = card.image_path;
    document.getElementById('form-no-image').style.display = 'none';
  } else {
    document.getElementById('form-image-preview').style.display = 'none';
    document.getElementById('form-no-image').style.display = 'block';
  }

  switchView('add');
}

async function toggleDupe(id, current) {
  const card = await (await fetch(`/api/cards/${id}`)).json();
  card.is_duplicate = current ? 0 : 1;
  await fetch(`/api/cards/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card)
  });
  closeDetail();
  loadCards();
  showToast(current ? 'Unmarked as duplicate' : 'Marked as duplicate');
}

async function deleteCard(id) {
  if (!confirm('Delete this card from your collection?')) return;
  await fetch(`/api/cards/${id}`, { method: 'DELETE' });
  closeDetail();
  loadCards();
  showToast('Card deleted');
}

// ========== FORM ==========
function resetForm() {
  editingId = null;
  editingBulkIndex = null;
  currentImagePath = '';
  document.getElementById('form-title').textContent = 'Add Card';
  document.getElementById('save-btn').textContent = 'Add to Collection';
  document.getElementById('form-image-preview').style.display = 'none';
  document.getElementById('form-no-image').style.display = 'block';

  const fields = ['player_name', 'team', 'year', 'brand', 'card_number', 'set_name', 'subset', 'parallel', 'psa_grade', 'estimated_value', 'purchase_price', 'notes'];
  fields.forEach(f => { const el = document.getElementById(`f-${f}`); if (el) el.value = ''; });
  document.getElementById('f-sport').value = 'Baseball';
  document.getElementById('f-condition_grade').value = 'Near Mint';
  document.getElementById('f-is_duplicate').checked = false;
  document.getElementById('f-is_wishlist').checked = false;
  document.getElementById('f-is_graded').checked = false;
}

function cancelForm() {
  resetForm();
  switchView('collection');
}

function removeFormImage() {
  currentImagePath = '';
  document.getElementById('form-image-preview').style.display = 'none';
  document.getElementById('form-no-image').style.display = 'block';
}

async function replaceFormImage(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  const formData = new FormData();
  formData.append('image', file);
  showToast('Uploading photo...', 'info');
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const result = await res.json();
    currentImagePath = result.path;
    document.getElementById('form-preview-img').src = result.path;
    document.getElementById('form-image-preview').style.display = 'block';
    document.getElementById('form-no-image').style.display = 'none';
    showToast('Photo uploaded!');
  } catch (e) {
    showToast('Upload failed', 'error');
  }
}

function getFormData() {
  return {
    player_name: document.getElementById('f-player_name').value.trim(),
    team: document.getElementById('f-team').value.trim(),
    year: parseInt(document.getElementById('f-year').value) || null,
    sport: document.getElementById('f-sport').value,
    brand: document.getElementById('f-brand').value.trim(),
    card_number: document.getElementById('f-card_number').value.trim(),
    set_name: document.getElementById('f-set_name').value.trim(),
    subset: document.getElementById('f-subset').value.trim(),
    parallel: document.getElementById('f-parallel').value.trim(),
    condition_grade: document.getElementById('f-condition_grade').value,
    psa_grade: document.getElementById('f-psa_grade').value.trim(),
    estimated_value: parseFloat(document.getElementById('f-estimated_value').value) || 0,
    purchase_price: parseFloat(document.getElementById('f-purchase_price').value) || 0,
    notes: document.getElementById('f-notes').value.trim(),
    is_duplicate: document.getElementById('f-is_duplicate').checked ? 1 : 0,
    is_wishlist: document.getElementById('f-is_wishlist').checked ? 1 : 0,
    is_graded: document.getElementById('f-is_graded').checked ? 1 : 0,
    image_path: currentImagePath,
  };
}

async function saveCard() {
  const data = getFormData();
  if (!data.player_name) { showToast('Player name is required', 'error'); return; }

  try {
    if (editingBulkIndex !== null) {
      // Update in-memory bulk review card and return to review
      bulkReviewCards[editingBulkIndex] = { ...bulkReviewCards[editingBulkIndex], ...data };
      const idx = editingBulkIndex;
      editingBulkIndex = null;
      editingId = null;
      showBulkReview(bulkReviewCards);
      switchView('scan');
      showToast(`Card ${idx + 1} updated`);
    } else if (editingId) {
      await fetch(`/api/cards/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      showToast('Card updated!');
      resetForm();
      switchView('collection');
    } else {
      await fetch('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      showToast('Card added to collection!');
      resetForm();
      switchView('collection');
    }
  } catch (e) {
    showToast('Failed to save card', 'error');
  }
}

async function lookupValue() {
  const data = getFormData();
  if (!data.player_name) { showToast('Enter a player name first', 'error'); return; }

  showAI('Looking up price...', 'Checking eBay sold listings...', 'Finding real recent sale prices');

  try {
    const res = await fetch('/api/ebay-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    hideAI();

    if (result.error) { showToast(result.error, 'error'); return; }

    if (result.estimated_value > 0) {
      document.getElementById('f-estimated_value').value = result.estimated_value;
      const range = result.value_range_low && result.value_range_high
        ? ` (range $${result.value_range_low}–$${result.value_range_high})`
        : '';
      showToast(`eBay avg: $${result.estimated_value}${range} · ${result.recent_sales_count} sold`, 'success');
    } else {
      showToast(result.message || 'No recent eBay sales found', 'info');
    }
  } catch (e) {
    hideAI();
    showToast('Lookup failed — check your connection or add eBay App ID in Settings', 'error');
  }
}

async function lookupDetailValue(id) {
  const card = await (await fetch(`/api/cards/${id}`)).json();
  showAI('Looking up price...', `Checking for ${card.player_name}...`, 'Trying SportsCardsPro, 130point, eBay...');

  try {
    const res = await fetch('/api/ebay-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...card, card_id: id })
    });
    const result = await res.json();
    hideAI();

    if (result.error) {
      showToast('Auto lookup blocked — use Search Online links below, then tap Set Price', 'info');
      return;
    }

    if (result.estimated_value > 0) {
      card.estimated_value = result.estimated_value;
      card.lookup_source = result.source || 'eBay Sold Listings';
      await fetch(`/api/cards/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card)
      });
      showToast(`${result.source}: $${result.estimated_value} · ${result.recent_sales_count} sold`, 'success');
      loadCards();
      openDetail(id);
    } else {
      showToast(result.message || 'No sales found', 'info');
    }
  } catch (e) {
    hideAI();
    showToast('Lookup failed', 'error');
  }
}

async function setManualPrice(id) {
  const val = prompt('Enter the price you found (e.g. 12.50):');
  if (!val) return;
  const price = parseFloat(val);
  if (isNaN(price) || price <= 0) { showToast('Invalid price', 'error'); return; }
  try {
    await fetch(`/api/cards/${id}/set-price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price, source: 'Manual' })
    });
    showToast(`Price set to $${price.toFixed(2)}`, 'success');
    loadCards();
    openDetail(id);
  } catch (e) {
    showToast('Failed to set price', 'error');
  }
}

// ========== SCAN ==========
function resetScan() {
  scanQueue = [];
  reviewCardData = null;
  bulkReviewCards = [];
  stopCamera();
  document.getElementById('scan-start').style.display = 'grid';
  document.getElementById('camera-view').style.display = 'none';
  document.getElementById('scan-preview').style.display = 'none';
  document.getElementById('scan-review-bulk').style.display = 'none';
  document.getElementById('bulk-more').style.display = bulkMode ? 'flex' : 'none';
  document.getElementById('file-input').multiple = bulkMode;
  document.getElementById('upload-sub').textContent = bulkMode ? 'Select multiple photos' : 'Select a photo';
}

function toggleBulk() {
  bulkMode = !bulkMode;
  const btn = document.getElementById('bulk-toggle');
  btn.classList.toggle('active', bulkMode);
  btn.textContent = bulkMode ? '✓ Bulk Mode' : '⚡ Bulk Mode';
  resetScan();
}

function triggerUpload() {
  const input = document.getElementById('file-input');
  input.multiple = bulkMode;
  input.click();
}

async function handleFileUpload(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  e.target.value = '';

  if (bulkMode || files.length > 1) {
    const formData = new FormData();
    files.forEach(f => formData.append('images', f));
    try {
      const res = await fetch('/api/upload/bulk', { method: 'POST', body: formData });
      const results = await res.json();
      results.forEach(r => scanQueue.push({ path: r.path, filename: r.filename }));
    } catch (err) { showToast('Upload failed', 'error'); return; }
    showScanPreview();
  } else {
    // Single file — upload then open form with image
    const formData = new FormData();
    formData.append('image', files[0]);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const result = await res.json();
      await recognizeCard(result.path);
    } catch (err) { showToast('Upload failed', 'error'); }
  }
}

async function startCamera() {
  try {
    // Safari needs simpler constraints sometimes
    let constraints = {
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }
    };

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      // Fallback: Safari may reject complex constraints
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    }

    cameraStream = stream;
    const video = document.getElementById('video');
    video.srcObject = stream;

    // Safari requires play() to be caught — it returns a promise that can reject
    try { await video.play(); } catch (e) { /* autoplay blocked, user will see frozen frame until interaction */ }

    document.getElementById('scan-start').style.display = 'none';
    document.getElementById('scan-preview').style.display = 'none';
    document.getElementById('camera-view').style.display = 'block';
  } catch (e) {
    showToast('Camera access denied — use upload instead', 'error');
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  const video = document.getElementById('video');
  if (video) video.srcObject = null; // Safari cleanup
  document.getElementById('camera-view').style.display = 'none';
}

async function capturePhoto() {
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  canvas.getContext('2d').drawImage(video, 0, 0);

  // Safari fallback: toBlob may not exist in very old versions
  let blob;
  if (canvas.toBlob) {
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  } else {
    // Fallback: convert dataURL to blob
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const resp = await fetch(dataUrl);
    blob = await resp.blob();
  }

  const formData = new FormData();
  formData.append('image', blob, `capture_${Date.now()}.jpg`);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const result = await res.json();

    if (bulkMode) {
      scanQueue.push({ path: result.path, filename: result.filename });
      showToast(`Card #${scanQueue.length} captured!`, 'info');
      showScanPreview();
    } else {
      stopCamera();
      await recognizeCard(result.path);
    }
  } catch (e) {
    showToast('Capture failed', 'error');
  }
}

function showScanPreview() {
  document.getElementById('scan-start').style.display = 'none';
  document.getElementById('camera-view').style.display = 'none';
  document.getElementById('scan-review-bulk').style.display = 'none';

  const preview = document.getElementById('scan-preview');
  preview.style.display = 'block';

  const grid = document.getElementById('preview-grid');
  grid.innerHTML = scanQueue.map((item, i) => `
    <div class="preview-thumb">
      <img src="${item.path}" alt="">
      <button class="preview-remove" onclick="removeScan(${i})">✕</button>
      <span class="preview-num">${i + 1}</span>
    </div>
  `).join('');

  document.getElementById('scan-count').textContent = `(${scanQueue.length})`;
  document.getElementById('bulk-more').style.display = bulkMode ? 'flex' : 'none';
}

function removeScan(i) {
  scanQueue.splice(i, 1);
  if (scanQueue.length === 0) {
    resetScan();
  } else {
    showScanPreview();
  }
}

function clearScans() {
  scanQueue = [];
  resetScan();
}

async function processScans() {
  if (!scanQueue.length) return;

  let hasAI = false;
  try {
    const s = await (await fetch('/api/settings')).json();
    hasAI = s.hasAiKey;
  } catch (e) {}

  if (!hasAI) {
    // No AI key — show blank review cards for manual entry
    bulkReviewCards = scanQueue.map(item => ({
      image_path: item.path, player_name: '', team: '', year: null,
      sport: 'Baseball', brand: '', card_number: '', set_name: '',
      subset: '', parallel: '', condition_grade: 'Near Mint', estimated_value: 0,
    }));
    showBulkReview(bulkReviewCards);
    return;
  }

  showAI('Analyzing Cards...', `Processing ${scanQueue.length} card${scanQueue.length !== 1 ? 's' : ''}...`, 'Reading player, year, brand, parallel & more');

  bulkReviewCards = [];
  for (let i = 0; i < scanQueue.length; i++) {
    const item = scanQueue[i];
    const bar = document.getElementById('ai-progress');
    if (bar) bar.style.width = `${(i / scanQueue.length) * 100}%`;
    document.getElementById('ai-sub').textContent = `Card ${i + 1} of ${scanQueue.length}...`;

    try {
      const res = await fetch('/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: item.path })
      });
      const card = await res.json();
      const parallel = [card.parallel, card.print_run ? `/${card.print_run}` : null].filter(Boolean).join(' ');
      const notesParts = [];
      if (card.is_rookie) notesParts.push('Rookie Card');
      if (card.is_autograph) notesParts.push('Autograph');
      if (card.is_patch) notesParts.push('Patch/Relic');
      if (card.condition_notes) notesParts.push(card.condition_notes);
      bulkReviewCards.push({
        image_path: item.path,
        player_name: card.player_name || '',
        team: card.team || '',
        year: card.year || null,
        sport: card.sport || 'Baseball',
        brand: card.brand || '',
        card_number: card.card_number || '',
        set_name: card.set_name || '',
        subset: card.subset || '',
        parallel: parallel || '',
        condition_grade: 'Near Mint',
        estimated_value: 0,
        notes: notesParts.join(' · '),
        is_rookie: card.is_rookie || false,
        confidence: card.confidence || '',
      });
    } catch (e) {
      bulkReviewCards.push({
        image_path: item.path, player_name: '', team: '', year: null,
        sport: 'Baseball', brand: '', card_number: '', set_name: '',
        subset: '', parallel: '', condition_grade: 'Near Mint', estimated_value: 0,
      });
    }
  }

  const bar = document.getElementById('ai-progress');
  if (bar) bar.style.width = '100%';
  hideAI();
  showBulkReview(bulkReviewCards);
}

// ========== STATS ==========
async function loadStats() {
  try {
    const stats = await (await fetch('/api/stats')).json();
    const tv = stats.totalValue || 0;

    let html = `
      <div class="stats-grid">
        <div class="stat-card" style="animation-delay:0s">
          <p class="stat-num" style="color:#a78bfa">${stats.total}</p>
          <p class="stat-label">Total Cards</p>
        </div>
        <div class="stat-card" style="animation-delay:0.06s">
          <p class="stat-num" style="color:#34d399">$${tv.toLocaleString(undefined,{maximumFractionDigits:0})}</p>
          <p class="stat-label">Est. Value</p>
        </div>
        <div class="stat-card" style="animation-delay:0.12s">
          <p class="stat-num" style="color:#60a5fa">${stats.graded}</p>
          <p class="stat-label">Graded</p>
        </div>
        <div class="stat-card" style="animation-delay:0.18s">
          <p class="stat-num" style="color:#fbbf24">${stats.duplicates}</p>
          <p class="stat-label">Dupes</p>
        </div>
      </div>
    `;

    // Portfolio value chart
    if (stats.portfolioHistory && stats.portfolioHistory.length > 1) {
      html += `
        <h3 class="stat-section-title">Portfolio Value</h3>
        <div class="portfolio-chart-wrap">${buildPortfolioChart(stats.portfolioHistory)}</div>
      `;
    }

    // Top movers
    if (stats.movers && stats.movers.length) {
      html += `<h3 class="stat-section-title">📈 Top Movers</h3>`;
      html += stats.movers.map(m => {
        const up = m.change >= 0;
        return `
          <div class="mover-row" onclick="openDetail(${m.id})">
            ${m.image_path
              ? `<img src="${m.image_path}" class="mover-thumb" alt="">`
              : `<div class="mover-thumb-ph">${sportEmoji[m.sport] || '🃏'}</div>`}
            <div class="mover-info">
              <p class="mover-name">${esc(m.player_name)}</p>
              <p class="mover-meta">${[m.year, m.set_name, m.parallel].filter(Boolean).join(' · ')}</p>
            </div>
            <div class="mover-change ${up ? 'up' : 'down'}">
              <span class="mover-arrow">${up ? '▲' : '▼'}</span>
              <span class="mover-delta">$${Math.abs(m.change).toFixed(2)}</span>
              <span class="mover-now">now $${Number(m.value_last).toFixed(2)}</span>
            </div>
          </div>
        `;
      }).join('');
    }

    // By sport
    html += `<h3 class="stat-section-title">By Sport</h3>`;
    html += stats.bySport.map(s => `
      <div class="sport-row">
        <span class="sport-emoji">${sportEmoji[s.sport] || '🃏'}</span>
        <div class="sport-info">
          <div class="sport-top">
            <span class="sport-name">${s.sport}</span>
            <span class="sport-meta">${s.count} cards · $${Number(s.value).toLocaleString(undefined,{maximumFractionDigits:0})}</span>
          </div>
          <div class="bar-bg"><div class="bar-fg" style="width:${stats.total ? (s.count / stats.total) * 100 : 0}%"></div></div>
        </div>
      </div>
    `).join('');

    // Top brands
    if (stats.byBrand.length) {
      html += `<h3 class="stat-section-title">Top Brands</h3>`;
      const maxBrand = stats.byBrand[0].count;
      html += stats.byBrand.map(b => `
        <div class="sport-row">
          <span class="sport-emoji">🏷</span>
          <div class="sport-info">
            <div class="sport-top">
              <span class="sport-name">${esc(b.brand)}</span>
              <span class="sport-meta">${b.count} cards · $${Number(b.value).toLocaleString(undefined,{maximumFractionDigits:0})}</span>
            </div>
            <div class="bar-bg"><div class="bar-fg" style="width:${(b.count / maxBrand) * 100}%"></div></div>
          </div>
        </div>
      `).join('');
    }

    // Most valuable
    if (stats.topCards.length) {
      html += `<h3 class="stat-section-title">💎 Most Valuable</h3>`;
      html += stats.topCards.map((c, i) => `
        <div class="top-card-row" onclick="openDetail(${c.id})">
          ${c.image_path
            ? `<img src="${c.image_path}" class="top-card-thumb" alt="">`
            : `<span class="top-rank">#${i+1}</span>`}
          <div class="top-card-info">
            <p class="top-name">${esc(c.player_name)}</p>
            <p class="top-meta">${[c.year, c.brand, c.set_name, c.parallel].filter(Boolean).join(' · ')}</p>
          </div>
          <span class="top-value">$${Number(c.estimated_value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        </div>
      `).join('');
    }

    html += `
      <div class="stats-actions">
        <button class="btn-primary" onclick="exportCSV()">📥 Export CSV</button>
        <button class="btn-secondary" onclick="openSettings()">⚙️ Settings</button>
      </div>
    `;

    document.getElementById('stats-content').innerHTML = html;
  } catch (e) {
    console.error('Failed to load stats:', e);
  }
}

function buildPortfolioChart(history) {
  const W = 340, H = 100, pad = { t: 10, r: 10, b: 22, l: 46 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const vals = history.map(h => Number(h.value));
  const minV = Math.min(...vals) * 0.95, maxV = Math.max(...vals) * 1.05;
  const range = maxV - minV || 1;
  const pts = history.map((h, i) => {
    const x = pad.l + (i / (history.length - 1)) * cw;
    const y = pad.t + ch - ((vals[i] - minV) / range) * ch;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `${pad.l},${pad.t + ch} ${pts.join(' ')} ${pad.l + cw},${pad.t + ch}`;
  const color = vals[vals.length-1] >= vals[0] ? '#34d399' : '#ef4444';
  const fmt = v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
  return `<svg viewBox="0 0 ${W} ${H}" class="portfolio-chart-svg">
    <defs>
      <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <polygon points="${area}" fill="url(#pg)"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${pts[pts.length-1].split(',')[0]}" cy="${pts[pts.length-1].split(',')[1]}" r="4" fill="${color}"/>
    <text x="${pad.l - 4}" y="${pad.t + ch}" font-size="9" fill="rgba(255,255,255,0.4)" text-anchor="end">${fmt(minV)}</text>
    <text x="${pad.l - 4}" y="${pad.t + 9}" font-size="9" fill="rgba(255,255,255,0.4)" text-anchor="end">${fmt(maxV)}</text>
    <text x="${pad.l}" y="${H}" font-size="8" fill="rgba(255,255,255,0.3)">${history[0].date.slice(5)}</text>
    <text x="${pad.l + cw}" y="${H}" font-size="8" fill="rgba(255,255,255,0.3)" text-anchor="end">${history[history.length-1].date.slice(5)}</text>
  </svg>`;
}

// ========== EXPORT ==========
function exportCSV() {
  document.getElementById('dropdown-menu').classList.remove('open');
  window.open('/api/export/csv', '_blank');
  showToast('CSV exported!');
}

function resetAll() {
  document.getElementById('dropdown-menu').classList.remove('open');
  if (!confirm('Delete ALL cards? This cannot be undone.')) return;
  if (!confirm('Are you really sure? This will permanently delete your entire collection.')) return;

  // Delete all cards one by one (to also delete images)
  fetch('/api/cards').then(r => r.json()).then(async cards => {
    for (const c of cards) {
      await fetch(`/api/cards/${c.id}`, { method: 'DELETE' });
    }
    loadCards();
    showToast('Collection reset');
  });
}

// ========== AI OVERLAY ==========
function showAI(title, sub, hint) {
  document.getElementById('ai-title').textContent = title;
  document.getElementById('ai-sub').textContent = sub;
  document.getElementById('ai-hint').textContent = hint;
  document.getElementById('ai-progress').style.width = '0%';
  document.getElementById('ai-overlay').style.display = 'flex';
}

function hideAI() {
  document.getElementById('ai-overlay').style.display = 'none';
}

// ========== TOAST ==========
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.style.display = 'block';
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// ========== SCAN REVIEW ==========

function openFormWithImage(imagePath) {
  resetForm();
  currentImagePath = imagePath;
  document.getElementById('form-image-preview').style.display = 'block';
  document.getElementById('form-preview-img').src = imagePath;
  document.getElementById('form-no-image').style.display = 'none';
  resetScan();
  switchView('add');
  setTimeout(() => document.getElementById('f-player_name')?.focus(), 100);
}

async function recognizeCard(imagePath) {
  let hasAI = false;
  try {
    const s = await (await fetch('/api/settings')).json();
    hasAI = s.hasAiKey;
  } catch (e) {}

  if (!hasAI) {
    openFormWithImage(imagePath);
    return;
  }

  showAI('Analyzing Card...', 'Reading player, year, brand, parallel...', 'Powered by Google Gemini (free)');

  let progress = 0;
  const ticker = setInterval(() => {
    progress = Math.min(progress + 6, 88);
    const bar = document.getElementById('ai-progress');
    if (bar) bar.style.width = progress + '%';
  }, 200);

  try {
    const res = await fetch('/api/recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath })
    });
    clearInterval(ticker);
    const bar = document.getElementById('ai-progress');
    if (bar) bar.style.width = '100%';

    const card = await res.json();
    hideAI();

    if (card.error) {
      showToast(card.error, 'error');
      openFormWithImage(imagePath);
      return;
    }

    openFormWithImage(imagePath);
    // Fill after form resets (brief tick)
    setTimeout(() => fillFormFromCard(card), 50);
  } catch (e) {
    clearInterval(ticker);
    hideAI();
    showToast('Recognition failed — fill in manually', 'error');
    openFormWithImage(imagePath);
  }
}

function fillFormFromCard(card) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el && val != null && val !== '') el.value = val;
  };
  set('f-player_name', card.player_name);
  set('f-team', card.team);
  set('f-year', card.year);
  set('f-brand', card.brand);
  set('f-card_number', card.card_number);
  set('f-set_name', card.set_name);
  set('f-subset', card.subset);

  // Combine parallel + print run
  const parallel = [card.parallel, card.print_run ? `/${card.print_run}` : null]
    .filter(Boolean).join(' ');
  set('f-parallel', parallel || card.parallel);

  if (card.sport && ['Baseball', 'Football', 'Basketball'].includes(card.sport)) {
    document.getElementById('f-sport').value = card.sport;
  }

  // Auto-check graded if PSA grade detected
  if (card.psa_grade) {
    document.getElementById('f-is_graded').checked = true;
    set('f-psa_grade', card.psa_grade);
  }

  // Build notes from special attributes
  const notesParts = [];
  if (card.is_rookie) notesParts.push('Rookie Card');
  if (card.is_autograph) notesParts.push('Autograph');
  if (card.is_patch) notesParts.push('Patch/Relic');
  if (card.condition_notes) notesParts.push(card.condition_notes);
  const notesEl = document.getElementById('f-notes');
  if (notesEl && notesParts.length && !notesEl.value) {
    notesEl.value = notesParts.join(' · ');
  }

  // Show toast with confidence
  if (card.confidence === 'low') {
    showToast('Low confidence — please review the filled fields', 'info');
  } else if (card.confidence === 'medium') {
    showToast('Card recognized — double-check the details', 'info');
  }
}

function showBulkReview(cards) {
  document.getElementById('scan-preview').style.display = 'none';
  document.getElementById('review-bulk-count').textContent =
    `${cards.length} card${cards.length !== 1 ? 's' : ''} recognized — review before saving`;

  document.getElementById('bulk-review-list').innerHTML = cards.map((card, i) => `
    <div class="bulk-review-item">
      ${card.image_path
        ? `<img src="${esc(card.image_path)}" class="bulk-review-thumb" alt="">`
        : `<div class="bulk-review-thumb-placeholder">${sportEmoji[card.sport] || '🃏'}</div>`}
      <div class="bulk-review-info">
        <p class="bulk-review-name">${esc(card.player_name || 'Unknown')}</p>
        <p class="bulk-review-meta">${esc([card.year, card.brand, card.set_name].filter(Boolean).join(' · ') || card.sport || '')}</p>
        ${card.estimated_value > 0 ? `<p class="bulk-review-price">$${Number(card.estimated_value).toLocaleString()}</p>` : ''}
      </div>
      <button class="bulk-edit-btn" onclick="editBulkCard(${i})">Edit</button>
    </div>
  `).join('');

  document.getElementById('scan-review-bulk').style.display = 'block';
}

async function saveBulkCards() {
  const btn = document.querySelector('#scan-review-bulk .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  let saved = 0;
  for (const card of bulkReviewCards) {
    try {
      await fetch('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_name: card.player_name || '',
          team: card.team || '',
          year: card.year || null,
          sport: card.sport || 'Baseball',
          brand: card.brand || '',
          card_number: card.card_number || '',
          set_name: card.set_name || '',
          subset: card.subset || '',
          parallel: card.parallel || '',
          condition_grade: card.condition_grade || 'Near Mint',
          estimated_value: card.estimated_value || 0,
          image_path: card.image_path || '',
          ai_confidence: card.confidence || '',
          notes: card.is_rookie ? 'Rookie Card' : '',
        })
      });
      saved++;
    } catch (e) {}
  }
  showToast(`${saved} card${saved !== 1 ? 's' : ''} added to collection!`, 'success');
  bulkReviewCards = [];
  resetScan();
  switchView('collection');
}

function editBulkCard(index) {
  const card = bulkReviewCards[index];
  if (!card) return;

  editingBulkIndex = index;
  editingId = null;
  currentImagePath = card.image_path || '';

  document.getElementById('form-title').textContent = `Edit Card ${index + 1}`;
  document.getElementById('save-btn').textContent = '✓ Save & Return to Review';

  const fields = ['player_name', 'team', 'year', 'brand', 'card_number', 'set_name', 'subset', 'parallel', 'psa_grade', 'estimated_value', 'purchase_price', 'notes'];
  fields.forEach(f => {
    const el = document.getElementById(`f-${f}`);
    if (el) el.value = card[f] != null ? card[f] : '';
  });
  if (card.sport && ['Baseball', 'Football', 'Basketball'].includes(card.sport)) {
    document.getElementById('f-sport').value = card.sport;
  }
  if (card.condition_grade) document.getElementById('f-condition_grade').value = card.condition_grade;
  document.getElementById('f-is_duplicate').checked = false;
  document.getElementById('f-is_wishlist').checked = false;
  document.getElementById('f-is_graded').checked = false;

  if (card.image_path) {
    document.getElementById('form-image-preview').style.display = 'block';
    document.getElementById('form-preview-img').src = card.image_path;
    document.getElementById('form-no-image').style.display = 'none';
  } else {
    document.getElementById('form-image-preview').style.display = 'none';
    document.getElementById('form-no-image').style.display = 'block';
  }

  switchView('add');
}

// ========== UTILITY ==========
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
