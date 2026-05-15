// ==========================================
// CARD VAULT — Client-side Application
// ==========================================

const sportEmoji = { Baseball: '⚾', Football: '🏈', Basketball: '🏀' };
let currentFilter = 'All';
let bulkMode = false;
let scanQueue = []; // array of { file, preview, filename }
let editingId = null;
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
    if (!data.hasApiKey) {
      // Show subtle hint, don't force
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

async function saveApiKey() {
  const key = document.getElementById('api-key-input').value.trim();
  if (!key) return;

  try {
    const res = await fetch('/api/settings/apikey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    });
    if (res.ok) {
      showToast('API key saved!', 'success');
      document.getElementById('api-status').innerHTML = '<p style="color:var(--green)">✓ Key saved</p>';
    }
  } catch (e) {
    showToast('Failed to save key', 'error');
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
            <img src="${card.image_path}" alt="" loading="lazy">
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
    const card = await (await fetch(`/api/cards/${id}`)).json();

    document.getElementById('detail-content').innerHTML = `
      ${card.image_path ? `<img class="detail-img" src="${card.image_path}" alt="">` : ''}
      <div class="detail-body">
        <div class="detail-header">
          <div>
            <p class="detail-name">${esc(card.player_name || 'Unknown')}</p>
            <p class="detail-sub">${[card.team, card.year, card.sport].filter(Boolean).join(' · ')}</p>
          </div>
          ${card.estimated_value > 0 ? `<span class="detail-value">$${Number(card.estimated_value).toLocaleString()}</span>` : ''}
        </div>

        <div class="detail-grid">
          ${detailField('Brand', card.brand)}
          ${detailField('Card #', card.card_number)}
          ${detailField('Set', card.set_name)}
          ${detailField('Subset', card.subset)}
          ${detailField('Parallel', card.parallel)}
          ${detailField('Condition', card.condition_grade)}
          ${detailField('Grade', card.psa_grade)}
          ${detailField('Purchase Price', card.purchase_price ? `$${card.purchase_price}` : '')}
          ${detailField('Type', card.is_duplicate ? 'Duplicate' : 'Original')}
          ${detailField('Status', card.is_graded ? 'Graded' : 'Raw')}
        </div>

        ${card.notes ? `<div class="detail-notes">${esc(card.notes)}</div>` : ''}

        ${card.lookup_source ? `
          <div class="detail-lookup-result">
            <p><strong>Value Source:</strong> ${esc(card.lookup_source)}</p>
          </div>
        ` : ''}

        <div class="detail-actions">
          <button class="detail-btn" onclick="editCard(${card.id})">✏️ Edit</button>
          <button class="detail-btn" onclick="lookupDetailValue(${card.id})">🔍 Lookup</button>
          <button class="detail-btn" onclick="toggleDupe(${card.id}, ${card.is_duplicate})">${card.is_duplicate ? '✅ Undupe' : '🔁 Dupe'}</button>
          <button class="detail-btn danger" onclick="deleteCard(${card.id})">🗑</button>
        </div>
      </div>
    `;

    document.getElementById('detail-modal').style.display = 'flex';
  } catch (e) {
    showToast('Failed to load card', 'error');
  }
}

function detailField(label, value) {
  if (!value) return '';
  return `<div><p class="detail-field-label">${label}</p><p class="detail-field-value">${esc(String(value))}</p></div>`;
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
  } else {
    document.getElementById('form-image-preview').style.display = 'none';
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
  currentImagePath = '';
  document.getElementById('form-title').textContent = 'Add Card';
  document.getElementById('save-btn').textContent = 'Add to Vault';
  document.getElementById('form-image-preview').style.display = 'none';

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
    if (editingId) {
      await fetch(`/api/cards/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      showToast('Card updated!');
    } else {
      await fetch('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      showToast('Card added to collection!');
    }
    resetForm();
    switchView('collection');
  } catch (e) {
    showToast('Failed to save card', 'error');
  }
}

async function lookupValue() {
  const data = getFormData();
  if (!data.player_name) { showToast('Enter a player name first', 'error'); return; }

  showAI('Looking Up Value...', 'Searching card databases...', 'Checking eBay, Beckett, PSA & more');

  try {
    const res = await fetch('/api/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    hideAI();

    if (result.error) {
      showToast(result.error, 'error');
      return;
    }

    if (result.estimated_value) {
      document.getElementById('f-estimated_value').value = result.estimated_value;
    }

    let info = [];
    if (result.recent_sales_summary) info.push(`Recent Sales: ${result.recent_sales_summary}`);
    if (result.card_details) info.push(`Details: ${result.card_details}`);
    if (result.notable_info) info.push(`Note: ${result.notable_info}`);
    if (result.value_range_low && result.value_range_high) {
      info.push(`Range: $${result.value_range_low} — $${result.value_range_high}`);
    }

    if (info.length) {
      showToast(`Value: $${result.estimated_value || '?'} — ${info[0].substring(0, 60)}`, 'success');
    } else {
      showToast(`Estimated value: $${result.estimated_value || 'unknown'}`, 'info');
    }
  } catch (e) {
    hideAI();
    showToast('Lookup failed — check your API key in Settings', 'error');
  }
}

async function lookupDetailValue(id) {
  closeDetail();
  const card = await (await fetch(`/api/cards/${id}`)).json();

  showAI('Looking Up Value...', `Searching for ${card.player_name}...`, 'Checking eBay, Beckett, PSA & more');

  try {
    const res = await fetch('/api/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card)
    });
    const result = await res.json();
    hideAI();

    if (result.error) { showToast(result.error, 'error'); return; }

    if (result.estimated_value) {
      card.estimated_value = result.estimated_value;
      card.lookup_source = result.sources || 'AI Web Search';
      await fetch(`/api/cards/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card)
      });
      showToast(`Value updated: $${result.estimated_value}`, 'success');
      loadCards();
    } else {
      showToast('Could not determine value', 'info');
    }
  } catch (e) {
    hideAI();
    showToast('Lookup failed', 'error');
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
  document.getElementById('scan-review-single').style.display = 'none';
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
    // Single file — upload then immediately recognize
    const formData = new FormData();
    formData.append('image', files[0]);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const result = await res.json();
      await autoRecognizeCard(result.path);
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
      await autoRecognizeCard(result.path);
    }
  } catch (e) {
    showToast('Capture failed', 'error');
  }
}

function showScanPreview() {
  document.getElementById('scan-start').style.display = 'none';
  document.getElementById('camera-view').style.display = 'none';
  document.getElementById('scan-review-single').style.display = 'none';
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

  showAI('Analyzing Cards...', `Processing ${scanQueue.length} card(s)...`, 'Identifying player, team, year, brand & set');

  const images = scanQueue.map((item, i) => ({ imagePath: item.path, tempId: i.toString() }));

  try {
    const res = await fetch('/api/recognize/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images })
    });
    const results = await res.json();
    hideAI();

    bulkReviewCards = results.map((r, i) => ({
      ...r,
      image_path: scanQueue[parseInt(r.tempId) || i]?.path || '',
    }));

    showBulkReview(bulkReviewCards);
  } catch (e) {
    hideAI();
    showToast('Recognition failed — check API key in Settings', 'error');
  }
}

async function skipAI() {
  // Save cards without AI — just the images
  for (const item of scanQueue) {
    await fetch('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_name: '', image_path: item.path })
    });
  }
  showToast(`${scanQueue.length} card(s) added — tap to edit details`, 'info');
  resetScan();
  switchView('collection');
}

// ========== STATS ==========
async function loadStats() {
  try {
    const stats = await (await fetch('/api/stats')).json();

    const statCards = [
      { n: stats.total, l: 'Total Cards', c: '#a78bfa' },
      { n: `$${stats.totalValue.toLocaleString()}`, l: 'Est. Value', c: '#34d399' },
      { n: stats.duplicates, l: 'Duplicates', c: '#fbbf24' },
      { n: stats.graded, l: 'Graded', c: '#60a5fa' },
    ];

    let html = `
      <div class="stats-grid">
        ${statCards.map((s, i) => `
          <div class="stat-card" style="animation-delay:${i * 0.06}s">
            <p class="stat-num" style="color:${s.c}">${s.n}</p>
            <p class="stat-label">${s.l}</p>
          </div>
        `).join('')}
      </div>

      <h3 class="stat-section-title">By Sport</h3>
      ${stats.bySport.map(s => `
        <div class="sport-row">
          <span class="sport-emoji">${sportEmoji[s.sport] || '🃏'}</span>
          <div class="sport-info">
            <div class="sport-top">
              <span class="sport-name">${s.sport}</span>
              <span class="sport-meta">${s.count} cards · $${s.value.toLocaleString()}</span>
            </div>
            <div class="bar-bg"><div class="bar-fg" style="width:${stats.total ? (s.count / stats.total) * 100 : 0}%"></div></div>
          </div>
        </div>
      `).join('')}
    `;

    if (stats.byBrand.length) {
      html += `
        <h3 class="stat-section-title">Top Brands</h3>
        ${stats.byBrand.map(b => `
          <div class="sport-row">
            <span class="sport-emoji">🏷</span>
            <div class="sport-info">
              <div class="sport-top">
                <span class="sport-name">${esc(b.brand)}</span>
                <span class="sport-meta">${b.count} cards · $${b.value.toLocaleString()}</span>
              </div>
              <div class="bar-bg"><div class="bar-fg" style="width:${stats.total ? (b.count / stats.total) * 100 : 0}%"></div></div>
            </div>
          </div>
        `).join('')}
      `;
    }

    if (stats.topCards.length) {
      html += `
        <h3 class="stat-section-title">💎 Most Valuable</h3>
        ${stats.topCards.map((c, i) => `
          <div class="top-card-row" onclick="openDetail(${c.id})" style="cursor:pointer">
            <span class="top-rank">#${i + 1}</span>
            <div style="flex:1">
              <p class="top-name">${esc(c.player_name)}</p>
              <p class="top-meta">${[c.team, c.year, c.sport, c.set_name].filter(Boolean).join(' · ')}</p>
            </div>
            <span class="top-value">$${(c.estimated_value || 0).toLocaleString()}</span>
          </div>
        `).join('')}
      `;
    }

    html += `
      <div style="margin-top:28px; display:flex; gap:10px; flex-wrap:wrap">
        <button class="btn-primary" onclick="exportCSV()" style="flex:1">📥 Export CSV</button>
        <button class="btn-secondary" onclick="openSettings()" style="flex:1">⚙️ Settings</button>
      </div>
    `;

    document.getElementById('stats-content').innerHTML = html;
  } catch (e) {
    console.error('Failed to load stats:', e);
  }
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

async function autoRecognizeCard(imagePath) {
  showAI('Analyzing Card...', 'Reading card details...', 'Identifying player, year, brand & checking eBay prices');
  try {
    const res = await fetch('/api/recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath })
    });
    const data = await res.json();
    hideAI();
    if (data.error) { showToast(data.error, 'error'); resetScan(); return; }
    reviewCardData = { ...data, image_path: imagePath };
    showSingleReview(reviewCardData);
  } catch (e) {
    hideAI();
    showToast('Recognition failed — check API key in Settings', 'error');
    resetScan();
  }
}

function showSingleReview(card) {
  document.getElementById('scan-start').style.display = 'none';
  document.getElementById('camera-view').style.display = 'none';
  document.getElementById('scan-preview').style.display = 'none';

  document.getElementById('review-img').src = card.image_path;
  document.getElementById('review-player').textContent = card.player_name || 'Unknown Player';
  document.getElementById('review-meta').textContent =
    [card.year, card.team, card.brand, card.set_name, card.parallel].filter(Boolean).join(' · ');

  const priceEl = document.getElementById('review-ebay');
  const labelEl = document.getElementById('review-ebay-label');
  if (card.estimated_value > 0) {
    priceEl.textContent = `$${Number(card.estimated_value).toLocaleString()}`;
    labelEl.textContent = card.lookup_source || 'eBay Sold Listings';
    priceEl.style.display = 'block';
    labelEl.style.display = 'block';
  } else {
    priceEl.style.display = 'none';
    labelEl.style.display = 'none';
  }

  document.getElementById('scan-review-single').style.display = 'block';
}

async function quickSaveCard() {
  if (!reviewCardData) return;
  const btn = document.querySelector('#scan-review-single .btn-primary');
  if (btn) btn.disabled = true;
  try {
    await fetch('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_name: reviewCardData.player_name || '',
        team: reviewCardData.team || '',
        year: reviewCardData.year || null,
        sport: reviewCardData.sport || 'Baseball',
        brand: reviewCardData.brand || '',
        card_number: reviewCardData.card_number || '',
        set_name: reviewCardData.set_name || '',
        subset: reviewCardData.subset || '',
        parallel: reviewCardData.parallel || '',
        condition_grade: reviewCardData.condition_grade || 'Near Mint',
        estimated_value: reviewCardData.estimated_value || 0,
        image_path: reviewCardData.image_path || '',
        ai_confidence: reviewCardData.confidence || '',
        lookup_source: reviewCardData.lookup_source || 'eBay Sold Listings',
        notes: reviewCardData.is_rookie ? 'Rookie Card' : '',
      })
    });
    showToast('Card added to collection!', 'success');
    reviewCardData = null;
    resetScan();
    switchView('collection');
  } catch (e) {
    if (btn) btn.disabled = false;
    showToast('Failed to save card', 'error');
  }
}

function editReviewCard() {
  if (!reviewCardData) return;
  editingId = null;
  currentImagePath = reviewCardData.image_path || '';
  document.getElementById('form-title').textContent = 'Add Card';
  document.getElementById('save-btn').textContent = 'Add to Collection';

  ['player_name','team','year','brand','card_number','set_name','subset','parallel','psa_grade','estimated_value','purchase_price'].forEach(f => {
    const el = document.getElementById(`f-${f}`);
    if (el) el.value = reviewCardData[f] || '';
  });
  if (reviewCardData.sport) document.getElementById('f-sport').value = reviewCardData.sport;
  if (reviewCardData.condition_grade) document.getElementById('f-condition_grade').value = reviewCardData.condition_grade;
  document.getElementById('f-is_duplicate').checked = false;
  document.getElementById('f-is_wishlist').checked = false;
  document.getElementById('f-is_graded').checked = false;

  if (currentImagePath) {
    document.getElementById('form-image-preview').style.display = 'block';
    document.getElementById('form-preview-img').src = currentImagePath;
  }
  resetScan();
  switchView('add');
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
  reviewCardData = card;
  editReviewCard();
}

// ========== UTILITY ==========
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
