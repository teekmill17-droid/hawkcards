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
let currentDetailHistory = [];
let viewMode = 'list';
let sortMode = 'value';

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

function setViewMode(mode) {
  viewMode = mode;
  document.getElementById('view-grid-btn')?.classList.toggle('active', mode === 'grid');
  document.getElementById('view-list-btn')?.classList.toggle('active', mode === 'list');
  loadCards();
}

function setSortMode(mode, el) {
  sortMode = mode;
  document.querySelectorAll('.sort-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  loadCards();
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

async function openSettings() {
  document.getElementById('dropdown-menu').classList.remove('open');
  document.getElementById('settings-modal').style.display = 'flex';
  try {
    const s = await fetch('/api/settings').then(r => r.json());
    if (s.hasAnthropicKey) document.getElementById('anthropic-status').innerHTML = '<p style="color:var(--green);font-size:12px">✓ Claude key saved</p>';
    if (s.hasGroqKey) document.getElementById('groq-status').innerHTML = '<p style="color:var(--green);font-size:12px">✓ Groq key saved</p>';
    if (s.hasGeminiKey) document.getElementById('gemini-status').innerHTML = '<p style="color:var(--green);font-size:12px">✓ Gemini key saved — AI price lookup ready</p>';
    if (s.hasEbayAppId) document.getElementById('api-status').innerHTML = '<p style="color:var(--green);font-size:12px">✓ eBay App ID saved</p>';
  } catch (e) {}
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
  const sort = sortMode;
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

    if (viewMode === 'list') {
      grid.className = 'ladder-list';
      grid.innerHTML = cards.map((card, i) => renderLadderRow(card, i + 1)).join('');
    } else {
      grid.className = 'cards-grid';
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
    }

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

function renderLadderRow(card, rank) {
  const pct = card.purchase_price > 0 && card.estimated_value > 0
    ? ((card.estimated_value - card.purchase_price) / card.purchase_price * 100) : null;
  const changeHtml = pct !== null
    ? `<span class="ldr-change ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}%</span>`
    : '';
  const grade = card.is_graded ? `PSA ${card.psa_grade || '?'}` : 'Raw';
  const isGraded = !!card.is_graded;
  const cardMeta = [card.year, card.set_name || card.brand, card.card_number ? `#${card.card_number}` : null, card.is_rookie ? 'RC' : null].filter(Boolean).join(' · ');
  const thumb = card.image_path
    ? `<img src="${card.image_path}" alt="" onerror="this.style.display='none'">`
    : `<span style="font-size:18px">${sportEmoji[card.sport] || '🃏'}</span>`;
  return `<div class="ldr-row" onclick="openDetail(${card.id})">
    <span class="ldr-rank">${rank}</span>
    <div class="ldr-thumb">${thumb}</div>
    <div class="ldr-info">
      <p class="ldr-name">${esc(card.player_name || 'Unknown')}</p>
      <p class="ldr-meta">${esc(cardMeta)}</p>
    </div>
    <span class="ldr-grade ${isGraded ? 'psa' : 'raw'}">${grade}</span>
    <div class="ldr-val">
      <p class="ldr-price">${card.estimated_value > 0 ? `$${Number(card.estimated_value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '—'}</p>
      ${changeHtml}
    </div>
  </div>`;
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  loadCards();
}

// ========== DETAIL MODAL — Card Ladder style ==========
async function openDetail(id) {
  try {
    const [card, history] = await Promise.all([
      fetch(`/api/cards/${id}`).then(r => r.json()),
      fetch(`/api/cards/${id}/price-history`).then(r => r.json()),
    ]);

    currentDetailHistory = history;
    const lastEntry = history.length ? history[history.length - 1] : null;

    const badges = [
      card.is_duplicate ? '<span class="dbadge dupe">DUPE</span>' : '',
      card.is_graded ? `<span class="dbadge graded">${card.psa_grade || 'GRADED'}</span>` : '',
      card.is_wishlist ? '<span class="dbadge wish">WISH</span>' : '',
      card.is_rookie ? '<span class="dbadge rookie">RC</span>' : '',
      card.is_autograph ? '<span class="dbadge auto">AUTO</span>' : '',
    ].filter(Boolean).join('');

    const setLine = [card.set_name, card.parallel, card.print_run ? `/${card.print_run}` : ''].filter(Boolean).join(' · ');
    const srcLabel = lastEntry?.source || 'est. value';

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
              ${setLine ? `<p class="detail-card-line">${esc(setLine)}</p>` : ''}
            </div>
            ${card.estimated_value > 0
              ? `<div class="detail-val-block">
                   <span class="detail-value">$${Number(card.estimated_value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                   <span class="detail-val-label">${esc(srcLabel)}</span>
                 </div>`
              : ''}
          </div>
          <div class="detail-actions">
            <button class="detail-btn" onclick="editCard(${card.id})">✏️ Edit</button>
            <button class="detail-btn accent" id="market-check-btn-${card.id}" onclick="runMarketCheck(${card.id})">🔍 Market Check</button>
            <button class="detail-btn" onclick="lookupDetailValue(${card.id})">⚡ Quick Price</button>
            <button class="detail-btn" onclick="setManualPrice(${card.id})">💲 Set Price</button>
            <button class="detail-btn" onclick="toggleDupe(${card.id}, ${card.is_duplicate})">${card.is_duplicate ? '✅ Undupe' : '🔁 Mark Dupe'}</button>
            <button class="detail-btn danger" onclick="deleteCard(${card.id})">🗑 Delete</button>
          </div>
        </div>

        <!-- Market Prices — Card Ladder style -->
        <div class="detail-section" id="market-section-${card.id}">
          ${buildMarketSection(lastEntry, card)}
        </div>

        <!-- Price History chart -->
        ${history.length ? `
          <div class="detail-section">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <p class="detail-section-title" style="margin:0">Price History <span class="detail-section-count">${history.length} lookup${history.length !== 1 ? 's' : ''}</span></p>
              <div class="ph-filters">
                ${['All','1Y','6M','1M','1W'].map(p => `<button class="ph-filter${p === 'All' ? ' active' : ''}" onclick="filterPriceChart('${p}', this)">${p}</button>`).join('')}
              </div>
            </div>
            <div id="price-chart-content">${buildPriceChartContent(history)}</div>
          </div>
        ` : ''}

        <!-- Card Details -->
        <div class="detail-section">
          <p class="detail-section-title">Card Details</p>
          <div class="detail-grid">
            ${detailField('Brand', card.brand)}
            ${detailField('Card #', card.card_number)}
            ${detailField('Set', card.set_name)}
            ${detailField('Subset', card.subset)}
            ${detailField('Parallel', card.parallel)}
            ${detailField('Print Run', card.print_run ? `/${card.print_run}` : '')}
            ${detailField('Condition', card.condition_grade)}
            ${detailField('Grade', card.psa_grade)}
            ${detailField('Purchased', card.purchase_price > 0 ? `$${card.purchase_price}` : '')}
          </div>
          ${card.notes ? `<div class="detail-notes">${esc(card.notes)}</div>` : ''}
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
  return `<div class="detail-field"><p class="detail-field-label">${label}</p><p class="detail-field-value">${esc(String(value))}</p></div>`;
}

// ========== MARKET CHECK ==========
async function runMarketCheck(id) {
  const btn = document.getElementById(`market-check-btn-${id}`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Fetching...'; }
  showAI('Market Check', 'Searching eBay · PWCC · Goldin · Heritage · CollX · 130pt', 'Finding real sold prices across all sources by grade');
  try {
    const res = await fetch(`/api/cards/${id}/market-check`, { method: 'POST' });
    const data = await res.json();
    hideAI();
    if (data.error) { showToast(data.error, 'error'); if (btn) { btn.disabled = false; btn.textContent = '🔍 Market Check'; } return; }
    const priceMsg = data.estimated_value > 0 ? ` — $${Number(data.estimated_value).toFixed(2)}` : '';
    showToast(`Market check complete${priceMsg}`, 'success');
    loadCards();
    openDetail(id);
  } catch (e) {
    hideAI();
    showToast('Market check failed — add a Gemini key in Settings', 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Market Check'; }
  }
}

function buildMarketSection(lastEntry, card) {
  const grades = lastEntry?.price_by_grade || {};
  const bySource = lastEntry?.sources || {};
  const allSales = lastEntry?.recent_sales || [];
  const rawAvg = lastEntry?.raw_value || 0;
  const hasGrades = Object.values(grades).some(g => (g.avg || 0) > 0);
  const hasAny = hasGrades || rawAvg > 0 || allSales.length > 0;

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
    <p class="detail-section-title" style="margin:0">Market Prices</p>
    ${hasAny ? `<span style="font-size:10px;color:var(--text-4)">${(lastEntry?.looked_up_at||'').slice(0,10)}</span>` : ''}
  </div>`;

  if (!hasAny) {
    html += `<p style="font-size:13px;color:var(--text-3);text-align:center;padding:14px 0 8px">
      No market data yet — tap <strong style="color:var(--accent)">Market Check</strong> to fetch live prices<br>
      <span style="font-size:11px;color:var(--text-4);display:block;margin-top:4px">eBay · PWCC · Goldin · Heritage · CollX · 130point</span>
    </p>`;
    return html;
  }

  // Grade price tiles
  html += `<div class="grade-tiles">`;
  if (rawAvg > 0) {
    html += `<div class="grade-tile">
      <span class="gt-label">Raw</span>
      <span class="gt-price">$${rawAvg < 10 ? rawAvg.toFixed(2) : Math.round(rawAvg)}</span>
      <span class="gt-count">ungraded</span>
    </div>`;
  }
  for (const g of ['PSA 7','PSA 8','PSA 9','PSA 10']) {
    const d = grades[g];
    if (!d || !(d.avg > 0)) continue;
    const psaNum = g.replace('PSA ', '');
    const isCurrent = card.psa_grade && card.psa_grade.toString().replace(/[^0-9.]/g, '') === psaNum;
    html += `<div class="grade-tile${isCurrent ? ' highlight' : ''}">
      <span class="gt-label">${g}</span>
      <span class="gt-price">$${d.avg < 10 ? d.avg.toFixed(2) : Math.round(d.avg)}</span>
      <span class="gt-count">${d.count > 0 ? d.count + ' sold' : 'est'}</span>
    </div>`;
  }
  html += `</div>`;

  // Source breakdown pills
  const sourceList = ['eBay','PWCC','Goldin','Heritage','CollX','130point'];
  if (Object.keys(bySource).length > 0) {
    html += `<div class="source-pills">`;
    for (const s of sourceList) {
      const d = bySource[s];
      const active = d && d.count > 0;
      html += `<span class="src-pill${active ? ' active' : ''}">
        ${s}${active ? `<span class="src-pill-count">${d.count}</span>` : ''}
      </span>`;
    }
    html += `</div>`;
  }

  // Recent sales table
  if (allSales.length > 0) {
    const fmt = n => Number(n) < 10 ? Number(n).toFixed(2) : Math.round(Number(n));
    html += `<p style="font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:1px;margin:12px 0 8px">Recent Sales</p>
    <div class="sales-table-wrap"><table class="sales-table">
      <thead><tr><th>Price</th><th>Grade</th><th>Source</th><th>Date</th></tr></thead>
      <tbody>
        ${allSales.slice(0, 15).map(s => {
          const gradeLabel = s.grade || 'Raw';
          const gradeClass = gradeLabel.toLowerCase().replace(/\s+/g, '-');
          const srcRaw = (s.source || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const srcClass = srcRaw === '130point' ? 'pt130' : srcRaw;
          return `<tr>
            <td class="st-price">$${fmt(s.price)}</td>
            <td><span class="grade-badge ${gradeClass}">${esc(gradeLabel)}</span></td>
            <td><span class="src-badge ${srcClass}">${esc(s.source || '')}</span></td>
            <td class="st-date">${(s.date || '').replace(/\s+\d{4}$/, '')}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  }

  return html;
}

function buildPriceChart(history) {
  if (!history.length) return '';
  const fmt = v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${Number(v).toFixed(2)}`;
  const vals = history.map(h => h.estimated_value);
  const last = vals[vals.length - 1];
  const first = vals[0];
  const change = last - first;
  const changePct = first > 0 ? ((change / first) * 100).toFixed(1) : null;
  const color = change >= 0 ? '#34d399' : '#ef4444';
  const changeLabel = changePct !== null
    ? `<span style="font-size:12px;font-weight:700;color:${color};background:${color}1a;padding:2px 10px;border-radius:6px">${change >= 0 ? '+' : ''}${changePct}%</span>`
    : '';
  const header = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <span style="font-size:22px;font-weight:800;color:${color}">${fmt(last)}</span>${changeLabel}</div>`;

  if (history.length === 1) {
    return header + `<p style="font-size:11px;color:var(--text-4)">First lookup ${history[0].looked_up_at.slice(0,10)} · check again later to track trend</p>`;
  }

  const W = 320, H = 100, pad = { t: 10, r: 10, b: 22, l: 44 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const minV = Math.min(...vals) * 0.93, maxV = Math.max(...vals) * 1.07;
  const range = maxV - minV || 1;
  const pts = history.map((h, i) => ({
    x: pad.l + (i / (history.length - 1)) * cw,
    y: pad.t + ch - ((h.estimated_value - minV) / range) * ch,
    val: h.estimated_value,
    date: h.looked_up_at.slice(0, 10),
  }));
  const ptStr = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaStr = `${pad.l},${pad.t + ch} ${ptStr} ${pad.l + cw},${pad.t + ch}`;
  const idxs = [0, Math.round((history.length - 1) / 2), history.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  const dateLabels = idxs.map(i => `<text x="${pts[i].x.toFixed(1)}" y="${H - 2}" font-size="8" fill="rgba(255,255,255,0.28)" text-anchor="middle">${pts[i].date.slice(5)}</text>`).join('');
  const dots = pts.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${color}" stroke="var(--bg)" stroke-width="1.5"><title>${fmt(p.val)} · ${p.date}</title></circle>`).join('');

  return header + `<svg viewBox="0 0 ${W} ${H}" class="price-chart-svg">
    <defs>
      <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.2"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <polygon points="${areaStr}" fill="url(#cg)"/>
    <polyline points="${ptStr}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    <text x="${pad.l - 4}" y="${pad.t + ch}" font-size="9" fill="rgba(255,255,255,0.28)" text-anchor="end">${fmt(minV * 1.05)}</text>
    <text x="${pad.l - 4}" y="${pad.t + 9}" font-size="9" fill="rgba(255,255,255,0.28)" text-anchor="end">${fmt(maxV * 0.95)}</text>
    ${dateLabels}
  </svg>`;
}

function buildSalesTrendChart(sales) {
  const dated = sales
    .map(s => ({ ...s, ts: s.date ? new Date(s.date).getTime() : 0 }))
    .filter(s => s.ts > 0 && s.price > 0)
    .sort((a, b) => a.ts - b.ts);
  if (dated.length < 3) return '';

  const fmt = v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${Number(v).toFixed(2)}`;
  const vals = dated.map(s => s.price);
  const change = vals[vals.length - 1] - vals[0];
  const color = change >= 0 ? '#34d399' : '#ef4444';

  const W = 320, H = 80, pad = { t: 8, r: 10, b: 18, l: 44 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const minV = Math.min(...vals) * 0.9, maxV = Math.max(...vals) * 1.1;
  const vRange = maxV - minV || 1;
  const minT = dated[0].ts, maxT = dated[dated.length - 1].ts;
  const tRange = maxT - minT || 1;

  const pts = dated.map(s => ({
    x: pad.l + ((s.ts - minT) / tRange) * cw,
    y: pad.t + ch - ((s.price - minV) / vRange) * ch,
    val: s.price, date: s.date,
  }));
  const ptStr = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaStr = `${pad.l},${pad.t + ch} ${ptStr} ${pts[pts.length-1].x.toFixed(1)},${pad.t + ch}`;
  const dots = pts.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" fill="${color}" stroke="var(--bg)" stroke-width="1"><title>${fmt(p.val)} · ${p.date}</title></circle>`).join('');
  const firstLbl = dated[0].date.replace(/\s+\d{4}$/, '');
  const lastLbl = dated[dated.length - 1].date.replace(/\s+\d{4}$/, '');

  return `<div style="margin-bottom:14px">
    <p style="font-size:11px;font-weight:600;color:var(--text-3);margin:0 0 6px">Market Trend <span style="font-size:10px;font-weight:400;color:var(--text-4)">${dated.length} recent eBay sales</span></p>
    <svg viewBox="0 0 ${W} ${H}" class="price-chart-svg">
      <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="${areaStr}" fill="url(#tg)"/>
      <polyline points="${ptStr}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
      ${dots}
      <text x="${pad.l}" y="${H - 2}" font-size="8" fill="rgba(255,255,255,0.28)" text-anchor="start">${firstLbl}</text>
      <text x="${W - pad.r}" y="${H - 2}" font-size="8" fill="rgba(255,255,255,0.28)" text-anchor="end">${lastLbl}</text>
      <text x="${pad.l - 4}" y="${pad.t + ch}" font-size="9" fill="rgba(255,255,255,0.28)" text-anchor="end">${fmt(minV * 1.05)}</text>
      <text x="${pad.l - 4}" y="${pad.t + 9}" font-size="9" fill="rgba(255,255,255,0.28)" text-anchor="end">${fmt(maxV * 0.95)}</text>
    </svg>
  </div>`;
}

function buildPriceBreakdown(priceByGrade, rawValue, sources) {
  const grades = priceByGrade || {};
  const hasData = rawValue > 0 || Object.values(grades).some(g => g?.avg > 0);
  if (!hasData) return '';
  const fmt = v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${Number(v).toFixed(2)}`;
  const cell = (label, data) => {
    if (!data || !(data.avg > 0)) return `<div class="grade-cell grade-empty"><p class="grade-label">${label}</p><p class="grade-na">—</p></div>`;
    return `<div class="grade-cell">
      <p class="grade-label">${label}</p>
      <p class="grade-price">${fmt(data.avg)}</p>
      ${data.low > 0 && data.high > 0 ? `<p class="grade-range">${fmt(data.low)} – ${fmt(data.high)}</p>` : ''}
      ${data.count > 0 ? `<p class="grade-count">${data.count} sale${data.count !== 1 ? 's' : ''}</p>` : ''}
      ${data.pop > 0 ? `<p class="grade-pop">Pop ${data.pop.toLocaleString()}</p>` : ''}
    </div>`;
  };
  const rawData = rawValue > 0 ? { avg: rawValue, low: 0, high: 0, count: 0 } : null;
  const sourcePills = Object.entries(sources || {})
    .filter(([, d]) => d?.count > 0)
    .map(([name, d]) => `<span class="source-pill">${name} · ${d.count}</span>`).join('');
  return `<div class="grade-breakdown">
    <p class="detail-section-title" style="margin-bottom:10px">Market Value by Grade</p>
    <div class="grade-grid">
      ${cell('Raw', rawData)}
      ${cell('PSA 9', grades['PSA 9'] || null)}
      ${cell('PSA 10', grades['PSA 10'] || null)}
    </div>
    ${sourcePills ? `<div class="source-pills" style="margin-top:8px">${sourcePills}</div>` : ''}
  </div>`;
}

function buildRecentComps(sales) {
  const valid = (sales || []).filter(s => s.price > 0).slice(0, 12);
  if (!valid.length) return '';
  return `<div class="detail-section" style="margin-top:12px">
    <p class="detail-section-title">Recent Comps <span class="detail-section-count">${valid.length} sales</span></p>
    <div class="comps-list">
      ${valid.map(s => {
        const isGraded = s.grade && s.grade !== 'Raw';
        return `<div class="comp-row">
          <span class="comp-badge ${isGraded ? 'graded' : 'raw'}">${s.grade || 'Raw'}</span>
          <div class="comp-info">
            ${s.title ? `<p class="comp-title">${esc(s.title)}</p>` : ''}
            <p class="comp-meta">${[s.source, s.date].filter(Boolean).join(' · ')}</p>
          </div>
          <span class="comp-price">$${Number(s.price).toFixed(2)}</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function buildPriceChartContent(history) {
  if (!history.length) return '<p style="font-size:12px;color:var(--text-4);text-align:center;padding:20px 0">No lookups in this period</p>';
  const latest = history[history.length - 1];
  const latestSales = (latest.recent_sales || []).filter(s => s.price > 0);
  const gradeBreakdown = buildPriceBreakdown(latest.price_by_grade, latest.raw_value, latest.sources);
  const trendChart = buildSalesTrendChart(latestSales.filter(s => s.date));
  const comps = buildRecentComps(latestSales);
  return `
    ${gradeBreakdown}
    ${trendChart}
    <div class="price-chart-wrap">${buildPriceChart(history)}</div>
    ${history.length > 1 ? `<div class="price-history-list" style="margin-top:10px">
      ${history.slice(-5).reverse().map(h => `
        <div class="ph-row">
          <span class="ph-date">${h.looked_up_at.slice(0,10)}</span>
          <span class="ph-val">$${Number(h.estimated_value).toFixed(2)}</span>
          <span class="ph-range">${h.value_range_low > 0 ? `$${h.value_range_low}–$${h.value_range_high}` : h.source || ''}</span>
          <span class="ph-count">${h.recent_sales_count > 0 ? `${h.recent_sales_count} sold` : ''}</span>
        </div>
      `).join('')}
    </div>` : ''}
    ${comps}
  `;
}

function filterPriceChart(period, el) {
  document.querySelectorAll('.ph-filter').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  let filtered = currentDetailHistory;
  if (period !== 'All') {
    const days = { '1Y': 365, '6M': 180, '1M': 30, '1W': 7 }[period];
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    filtered = currentDetailHistory.filter(h => h.looked_up_at.slice(0, 10) >= cutoff);
  }
  document.getElementById('price-chart-content').innerHTML = buildPriceChartContent(filtered);
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
  const fields = ['player_name', 'team', 'sport', 'year', 'brand', 'card_number', 'set_name', 'subset', 'parallel', 'print_run', 'condition_grade', 'psa_grade', 'estimated_value', 'purchase_price', 'notes'];
  fields.forEach(f => {
    const el = document.getElementById(`f-${f}`);
    if (el) el.value = card[f] || '';
  });
  document.getElementById('f-is_duplicate').checked = card.is_duplicate;
  document.getElementById('f-is_wishlist').checked = card.is_wishlist;
  document.getElementById('f-is_graded').checked = card.is_graded;
  ['is_rookie','is_autograph','is_patch'].forEach(f => { const el = document.getElementById(`f-${f}`); if (el) el.value = card[f] ? '1' : '0'; });

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

  const fields = ['player_name', 'team', 'year', 'brand', 'card_number', 'set_name', 'subset', 'parallel', 'print_run', 'psa_grade', 'estimated_value', 'purchase_price', 'notes'];
  fields.forEach(f => { const el = document.getElementById(`f-${f}`); if (el) el.value = ''; });
  document.getElementById('f-sport').value = 'Baseball';
  document.getElementById('f-condition_grade').value = 'Near Mint';
  document.getElementById('f-is_duplicate').checked = false;
  document.getElementById('f-is_wishlist').checked = false;
  document.getElementById('f-is_graded').checked = false;
  ['f-is_rookie','f-is_autograph','f-is_patch'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '0'; });
  document.getElementById('conf-banner')?.remove();
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
    print_run: document.getElementById('f-print_run').value.trim(),
    condition_grade: document.getElementById('f-condition_grade').value,
    psa_grade: document.getElementById('f-psa_grade').value.trim(),
    estimated_value: parseFloat(document.getElementById('f-estimated_value').value) || 0,
    purchase_price: parseFloat(document.getElementById('f-purchase_price').value) || 0,
    notes: document.getElementById('f-notes').value.trim(),
    is_duplicate: document.getElementById('f-is_duplicate').checked ? 1 : 0,
    is_wishlist: document.getElementById('f-is_wishlist').checked ? 1 : 0,
    is_graded: document.getElementById('f-is_graded').checked ? 1 : 0,
    is_rookie: parseInt(document.getElementById('f-is_rookie')?.value) || 0,
    is_autograph: parseInt(document.getElementById('f-is_autograph')?.value) || 0,
    is_patch: parseInt(document.getElementById('f-is_patch')?.value) || 0,
    image_path: currentImagePath,
  };
}

// Run price lookup in background after saving — no overlay, no blocking
async function silentPriceCheck(id) {
  try {
    const card = await (await fetch(`/api/cards/${id}`)).json();
    let result;
    try {
      // Try client-side first (fast)
      result = await lookupPriceClientSide(buildKeywordsClient(card));
      await fetch(`/api/cards/${id}/set-price`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price: result.estimated_value, source: result.source || 'eBay',
          range_low: result.value_range_low, range_high: result.value_range_high,
          sales_count: result.recent_sales_count, recent_sales: result.recent_sales,
        }),
      });
    } catch (e) {
      // Full market check — grade breakdown, all sources, saves internally
      const res = await fetch(`/api/cards/${id}/market-check`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      result = await res.json();
    }
    if (!result || result.error || !(result.estimated_value > 0)) return;
    showToast(`$${result.estimated_value} · ${result.source || 'market check done'}`, 'success');
    await loadCards();
    const onCollection = document.getElementById('view-collection')?.classList.contains('active');
    if (onCollection) openDetail(id);
  } catch (e) { /* silent */ }
}

async function saveCard() {
  const data = getFormData();
  if (!data.player_name) { showToast('Player name is required', 'error'); return; }

  try {
    if (editingBulkIndex !== null) {
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
      const res = await fetch('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const saved = await res.json();
      showToast('Card added! Checking price...');
      resetForm();
      switchView('collection');
      silentPriceCheck(saved.id); // background, no await
    }
  } catch (e) {
    showToast('Failed to save card', 'error');
  }
}

// Build the same search query the server uses
function buildKeywordsClient(card) {
  const parts = [card.player_name, card.year];
  const setLower = (card.set_name || '').toLowerCase();
  const brandLower = (card.brand || '').toLowerCase();
  if (card.set_name && card.brand && setLower.startsWith(brandLower)) {
    parts.push(card.set_name);
  } else {
    if (card.brand) parts.push(card.brand);
    if (card.set_name) parts.push(card.set_name);
  }
  if (card.parallel) parts.push(card.parallel);
  if (card.print_run) parts.push(`/${card.print_run}`);
  if (card.card_number) parts.push(`#${card.card_number}`);
  if (card.psa_grade) parts.push(`PSA ${card.psa_grade}`);
  return parts.filter(Boolean).join(' ');
}

// Fetch price data from the browser (bypasses Railway's blocked datacenter IP).
// Tries eBay sold listings via corsproxy.io (Cloudflare CDN — not IP-blocked by eBay),
// then 130point via allorigins.win as a backup.
async function lookupPriceClientSide(keywords) {
  const ebayUrl = 'https://www.ebay.com/sch/212/i.html?' + new URLSearchParams({
    _nkw: keywords, LH_Complete: '1', LH_Sold: '1', _sop: '13', _ipg: '20',
  });
  const point130Url = 'https://130point.com/sales/?' + new URLSearchParams({ search: keywords });

  const attempts = [
    { url: `https://corsproxy.io/?${encodeURIComponent(ebayUrl)}`, site: 'eBay' },
    { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(point130Url)}`, site: '130point' },
    { url: `https://corsproxy.io/?${encodeURIComponent(point130Url)}`, site: '130point' },
  ];

  for (const { url: proxyUrl, site } of attempts) {
    try {
      const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const html = await r.text();
      if (html.length < 1500 || html.includes('GoDaddy') || html.includes('domain is for sale')) continue;

      const prices = [];
      const recentSales = [];

      // JSON-LD schema (eBay)
      for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        try {
          const d = JSON.parse(m[1]);
          for (const el of (d['@type'] === 'ItemList' ? d.itemListElement || [] : [])) {
            const p = parseFloat(el.offers?.price || 0);
            if (p > 0 && p < 100000) { prices.push(p); recentSales.push({ title: el.name || '', price: p, date: '', url: el.url || '' }); }
          }
        } catch (e) {}
      }

      // itemprop price (eBay)
      if (!prices.length) {
        for (const m of html.matchAll(/itemprop="price"[^>]*content="([\d.]+)"/g)) {
          const p = parseFloat(m[1]); if (p > 0 && p < 100000) prices.push(p);
        }
      }

      // s-item__price spans (eBay)
      if (!prices.length) {
        for (const m of html.matchAll(/class="s-item__price"[^>]*>\s*\$\s*([\d,]+\.?\d*)/g)) {
          const p = parseFloat(m[1].replace(/,/g, '')); if (p > 0 && p < 100000) prices.push(p);
        }
      }

      // Dollar amounts in <td> cells (130point)
      if (!prices.length) {
        for (const m of html.matchAll(/<td[^>]*>\s*\$\s*([\d,]+\.?\d{0,2})\s*<\/td>/g)) {
          const p = parseFloat(m[1].replace(/,/g, '')); if (p > 0.25 && p < 50000) prices.push(p);
        }
      }

      if (prices.length >= 2) {
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        return {
          estimated_value: Math.round(avg * 100) / 100,
          value_range_low: Math.min(...prices),
          value_range_high: Math.max(...prices),
          recent_sales_count: prices.length,
          recent_sales: recentSales.slice(0, 10),
          source: site === 'eBay' ? 'eBay Sold Listings' : '130point.com',
        };
      }
    } catch (e) { /* try next */ }
  }
  throw new Error('client-side lookup failed');
}

async function lookupValue() {
  const data = getFormData();
  if (!data.player_name) { showToast('Enter a player name first', 'error'); return; }

  showAI('Looking up price...', 'Checking eBay sold listings...', 'Finding real recent sale prices');

  try {
    // Try browser-side fetch first (bypasses Railway IP block)
    let result;
    try {
      result = await lookupPriceClientSide(buildKeywordsClient(data));
    } catch (e) {
      // Fall back to server-side (which tries Gemini search, SportsCardsPro, etc.)
      const res = await fetch('/api/ebay-price', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      });
      result = await res.json();
    }
    hideAI();

    if (result.error) { showToast('No price data found — add a Gemini key in Settings for reliable lookup', 'info'); return; }

    if (result.estimated_value > 0) {
      document.getElementById('f-estimated_value').value = result.estimated_value;
      const range = result.value_range_low && result.value_range_high
        ? ` ($${result.value_range_low}–$${result.value_range_high})`
        : '';
      showToast(`${result.source}: $${result.estimated_value}${range} · ${result.recent_sales_count} sold`, 'success');
    } else {
      showToast(result.message || 'No recent eBay sales found', 'info');
    }
  } catch (e) {
    hideAI();
    showToast('Lookup failed — try adding a Gemini API key in Settings for reliable price search', 'info');
  }
}

async function lookupDetailValue(id) {
  const card = await (await fetch(`/api/cards/${id}`)).json();
  showAI('Market check...', `Searching for ${card.player_name}...`, 'eBay · PWCC · Goldin · Heritage · CollX · 130point');

  try {
    let result;
    try {
      // Try client-side first (fast, user's IP bypasses eBay block)
      result = await lookupPriceClientSide(buildKeywordsClient(card));
      await fetch(`/api/cards/${id}/set-price`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price: result.estimated_value, source: result.source || 'eBay',
          range_low: result.value_range_low, range_high: result.value_range_high,
          sales_count: result.recent_sales_count, recent_sales: result.recent_sales,
        }),
      });
    } catch (e) {
      // Full multi-source market check — grade breakdown, all sources, saves to DB internally
      const res = await fetch(`/api/cards/${id}/market-check`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      result = await res.json();
    }
    hideAI();

    if (result.error || !(result.estimated_value > 0)) {
      showToast('No price data found — tap Set Price to enter manually', 'info');
      return;
    }

    const hasGrades = result.grades && Object.values(result.grades).some(g => g?.avg > 0);
    showToast(hasGrades ? 'Market data loaded — Raw, PSA 9, PSA 10 prices found' : `${result.source || 'Done'}: $${result.estimated_value}`, 'success');
    loadCards();
    openDetail(id);
  } catch (e) {
    hideAI();
    showToast('Lookup failed — check your Gemini key in Settings', 'info');
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
  resetScan();
  switchView('add'); // calls resetForm() internally — must come before we set the image
  currentImagePath = imagePath;
  document.getElementById('form-image-preview').style.display = 'block';
  document.getElementById('form-preview-img').src = imagePath;
  document.getElementById('form-no-image').style.display = 'none';
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
  set('f-parallel', card.parallel);
  set('f-print_run', card.print_run);

  if (card.sport && ['Baseball', 'Football', 'Basketball'].includes(card.sport)) {
    document.getElementById('f-sport').value = card.sport;
  }

  // Auto-check graded if PSA grade detected
  if (card.psa_grade) {
    document.getElementById('f-is_graded').checked = true;
    set('f-psa_grade', card.psa_grade);
  }

  // Store AI-detected special attributes in hidden fields
  const setHidden = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ? '1' : '0'; };
  setHidden('f-is_rookie', card.is_rookie);
  setHidden('f-is_autograph', card.is_autograph);
  setHidden('f-is_patch', card.is_patch);

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

  // Confidence banner — injected at top of add form
  document.getElementById('conf-banner')?.remove();
  if (card.confidence === 'low' || card.confidence === 'medium') {
    const banner = document.createElement('div');
    banner.id = 'conf-banner';
    banner.className = `conf-banner conf-${card.confidence}`;
    banner.innerHTML = card.confidence === 'low'
      ? '<strong>Low confidence</strong> — AI wasn\'t certain. Verify all fields before saving.'
      : '<strong>Medium confidence</strong> — identified from visual cues. Double-check the details.';
    const firstSection = document.getElementById('view-add')?.querySelector('.section');
    if (firstSection) firstSection.insertBefore(banner, firstSection.firstChild);
  } else if (card.confidence === 'high') {
    showToast('Card identified with high confidence', 'success');
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
  let savedCount = 0;
  const savedIds = [];
  for (const card of bulkReviewCards) {
    try {
      const res = await fetch('/api/cards', {
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
      const saved = await res.json();
      savedIds.push(saved.id);
      savedCount++;
    } catch (e) {}
  }
  showToast(`${savedCount} card${savedCount !== 1 ? 's' : ''} added! Checking prices...`, 'success');
  bulkReviewCards = [];
  resetScan();
  switchView('collection');
  // Price check all cards sequentially in background
  (async () => {
    for (const id of savedIds) {
      await silentPriceCheck(id);
    }
  })();
}

function editBulkCard(index) {
  const card = bulkReviewCards[index];
  if (!card) return;

  editingBulkIndex = index;
  editingId = null;
  currentImagePath = card.image_path || '';

  document.getElementById('form-title').textContent = `Edit Card ${index + 1}`;
  document.getElementById('save-btn').textContent = '✓ Save & Return to Review';

  const fields = ['player_name', 'team', 'year', 'brand', 'card_number', 'set_name', 'subset', 'parallel', 'print_run', 'psa_grade', 'estimated_value', 'purchase_price', 'notes'];
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
  ['is_rookie','is_autograph','is_patch'].forEach(f => { const el = document.getElementById(`f-${f}`); if (el) el.value = card[f] ? '1' : '0'; });

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

// ========== MARKET SEARCH ==========
async function searchMarket() {
  const query = document.getElementById('market-input')?.value.trim();
  if (!query) return;
  const el = document.getElementById('market-results');
  el.innerHTML = '<div class="market-loading">Searching eBay, PWCC, Goldin, Heritage, Fanatics...</div>';
  try {
    const res = await fetch('/api/market-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: query })
    });
    const data = await res.json();
    if (data.error) { el.innerHTML = `<p class="market-empty">${esc(data.error)}</p>`; return; }
    el.innerHTML = renderMarketResult(data, query);
  } catch (e) {
    el.innerHTML = '<p class="market-empty">Search failed — check your Gemini key in Settings</p>';
  }
}

function renderMarketResult(data, query) {
  const gradeBreakdown = buildPriceBreakdown(data.grades, data.raw?.avg, data.by_source);
  const comps = buildRecentComps(data.recent_sales || []);
  const trendColor = data.trend === 'up' ? '#34d399' : data.trend === 'down' ? '#ef4444' : 'var(--text-3)';
  const trendIcon = data.trend === 'up' ? '↑' : data.trend === 'down' ? '↓' : '→';
  return `<div class="market-result">
    <div class="market-result-hdr">
      <div>
        <p class="market-result-title">${esc(query)}</p>
        ${data.trend ? `<span style="font-size:12px;font-weight:700;color:${trendColor}">${trendIcon} ${data.trend} trend</span>` : ''}
      </div>
      ${data.estimated_value > 0 ? `<div style="text-align:right">
        <p style="font-size:26px;font-weight:800;color:var(--accent)">$${Number(data.estimated_value).toFixed(2)}</p>
        <p style="font-size:10px;color:var(--text-4)">est. value</p>
      </div>` : ''}
    </div>
    ${gradeBreakdown}
    ${comps}
  </div>`;
}

// ========== UTILITY ==========
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
