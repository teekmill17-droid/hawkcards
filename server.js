const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');

const os = require('os');
const { initDB, query, queryOne, run } = require('./database');
// Try to load sharp (optional — for image compression)
let sharp = null;
try { sharp = require('sharp'); } catch (e) { /* sharp not available */ }

const app = express();
const PORT = process.env.PORT || 3000;

function getEbayAppId() {
  const row = queryOne("SELECT value FROM settings WHERE key = 'ebay_app_id'");
  return process.env.EBAY_APP_ID || (row ? row.value : null);
}

function getAnthropicKey() {
  const row = queryOne("SELECT value FROM settings WHERE key = 'anthropic_api_key'");
  return process.env.ANTHROPIC_API_KEY || (row ? row.value : null);
}

function getGroqKey() {
  const row = queryOne("SELECT value FROM settings WHERE key = 'groq_api_key'");
  return process.env.GROQ_API_KEY || (row ? row.value : null);
}

function getGeminiKey() {
  const row = queryOne("SELECT value FROM settings WHERE key = 'gemini_api_key'");
  return process.env.GEMINI_API_KEY || (row ? row.value : null);
}

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RENDER;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// =============================================
// API ROUTES
// =============================================

// --- Settings ---
app.get('/api/settings', (req, res) => {
  res.json({
    hasEbayAppId: !!getEbayAppId(),
    hasAnthropicKey: !!getAnthropicKey(),
    hasGroqKey: !!getGroqKey(),
    hasGeminiKey: !!getGeminiKey(),
    hasAiKey: !!(getAnthropicKey() || getGroqKey() || getGeminiKey()),
  });
});

app.post('/api/settings/ebay', (req, res) => {
  const { appId } = req.body;
  if (!appId) return res.status(400).json({ error: 'App ID required' });
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('ebay_app_id', ?)", [appId]);
  res.json({ success: true });
});

app.post('/api/settings/gemini', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('gemini_api_key', ?)", [apiKey]);
  res.json({ success: true });
});

app.post('/api/settings/anthropic', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('anthropic_api_key', ?)", [apiKey]);
  res.json({ success: true });
});

app.post('/api/settings/groq', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('groq_api_key', ?)", [apiKey]);
  res.json({ success: true });
});

// --- AI Card Recognition ---
// Prefers Groq (free, fast, reliable). Falls back to Gemini if Groq key not set.

const CARD_PROMPT = `You are a professional sports card authenticator and expert player identifier. Analyze this card image with extreme attention to detail. Return ONLY raw JSON — no markdown, no backticks, no explanation.

STEP 1 — READ ALL TEXT on the card (scan every location):
- Front: center name bar, bottom strip, top strip, all four corners, both side edges
- Back (if visible): header name, stat lines, copyright text at very bottom
- Fine print anywhere — copyright lines often contain the year and brand
- Foil stamps, holograms, serial number boxes

STEP 2 — IDENTIFY THE PLAYER (try each in order, stop when found):
1. Player name explicitly printed anywhere on the front or back
2. Autograph signature — carefully read the handwriting; many signatures spell the full name
3. If no name is readable, IDENTIFY from visual cues:
   • Jersey number + team colors/logo → look up known rosters
     e.g. #15 Kansas City Chiefs = Patrick Mahomes | #23 Chicago Bulls (90s) = Michael Jordan
     e.g. #12 Tampa Bay Buccaneers = Tom Brady | #10 LA Rams = Cooper Kupp
     e.g. #27 New York Yankees (pinstripes) = Mike Trout era ≠ look at uniform
   • Player's face, build, and athletic position shown in the action photo
   • Helmet decal, cap logo, or team name on uniform
   • Card era + uniform style to narrow the era and roster
4. If still uncertain after all above, make your single best guess and set confidence="low"

STEP 3 — IDENTIFY TEAM:
Use team name or logo printed on the card. If not printed but identifiable from uniform/helmet, use that. Do NOT leave blank if uniform is visible.

YEAR: Look at bottom edge text or copyright line. "2024 Topps Chrome" or "© 2024" → year=2024. If not visible, use null.

BRAND (manufacturer name only):
Topps, Bowman, Panini, Upper Deck, Leaf, Donruss, Fleer, Score, SP, O-Pee-Chee, Stadium Club, Select, Mosaic, Optic, Chronicles, Immaculate, Prizm, Certified, National Treasures

SET NAME (full product line including year + brand):
Examples: "2024 Topps Chrome", "2023 Panini Prizm", "2022 Bowman Draft", "2024 Leaf HYPE!"
Read the full text line at the card's edge — that IS the set name.

CARD NUMBER: Small text, often bottom corner or card back. Format: "123", "RC-45", "BCP-12". NOT a print run fraction like 23/99.

PARALLEL (color/finish variation — critical for value):
- Topps/Bowman Chrome: Base Refractor, Gold Refractor /50, Blue Refractor /150, Red Refractor /5, Orange /25, Purple /10, SuperFractor 1/1, Atomic, Speckle, Negative
- Panini Prizm: Silver (base), Gold /10, Red /149, Blue /199, Purple /49, Green /75, Red White Blue, Hyper, Disco, Holo
- Panini Optic: Base, Holo, Gold /10, Blue /149, Red /99, Pink /50, Purple /25
- Leaf: Gold, Silver, Blue, Red — always numbered
- Plain base card with no special finish = null
Look for: border/foil color, shimmer type, serial number stamp.

PRINT RUN: Serial number like "23/99" or "007/150" → record denominator only: "99" or "150".

SPORT: Baseball, Football, or Basketball only.

is_rookie: true ONLY if RC, Rookie Card, or Rookie logo is explicitly visible.
is_autograph: true if a handwritten signature is present on the card.
is_patch: true if a fabric/jersey swatch is embedded in the card.

Return exactly:
{"player_name":"","team":"","year":null,"sport":"Baseball","brand":"","card_number":"","set_name":"","subset":null,"parallel":null,"print_run":null,"is_rookie":false,"is_autograph":false,"is_patch":false,"condition_notes":null,"confidence":"high"}

confidence: "high"=name clearly printed on card, "medium"=identified from visual cues or partial text, "low"=best guess from limited information.`;

async function recognizeWithClaude(apiKey, base64, mimeType) {
  const models = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
  for (const model of models) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: CARD_PROMPT }
        ]}]
      })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      console.log(`Claude ${model} failed (${r.status}):`, err?.error?.message || '');
      if (r.status === 400 || r.status === 404) continue; // model unavailable, try next
      throw new Error(err?.error?.message || `Claude error: ${r.status}`);
    }
    const data = await r.json();
    console.log(`Claude ${model} recognized card`);
    return data?.content?.[0]?.text || '';
  }
  throw new Error('No Claude model available for recognition');
}

async function recognizeWithGroq(apiKey, base64, mimeType) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        { type: 'text', text: CARD_PROMPT }
      ]}],
      max_tokens: 512,
      temperature: 0.1,
    })
  });
  if (!r.ok) {
    const err = await r.json();
    throw new Error(err?.error?.message || `Groq error: ${r.status}`);
  }
  const data = await r.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function recognizeWithGemini(apiKey, base64, mimeType) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: CARD_PROMPT }
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 512 }
      })
    }
  );
  if (!r.ok) {
    const err = await r.json();
    throw new Error(err?.error?.message || `Gemini error: ${r.status}`);
  }
  const data = await r.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

app.post('/api/recognize', async (req, res) => {
  const anthropicKey = getAnthropicKey();
  const groqKey = getGroqKey();
  const geminiKey = getGeminiKey();
  if (!anthropicKey && !groqKey && !geminiKey) {
    return res.status(400).json({ error: 'No AI key set. Add a Claude key in Settings (console.anthropic.com).' });
  }

  const { imagePath } = req.body;
  if (!imagePath) return res.status(400).json({ error: 'imagePath required' });

  const filename = imagePath.replace('/uploads/', '');
  const filePath = path.join(uploadsDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Image not found' });

  const base64 = fs.readFileSync(filePath).toString('base64');
  const mimeType = path.extname(filePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';

  try {
    const text = anthropicKey
      ? await recognizeWithClaude(anthropicKey, base64, mimeType)
      : groqKey
        ? await recognizeWithGroq(groqKey, base64, mimeType)
        : await recognizeWithGemini(geminiKey, base64, mimeType);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(400).json({ error: 'Could not parse card data from image' });
    res.json(JSON.parse(jsonMatch[0]));
  } catch (e) {
    console.error('AI recognize error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- Cards CRUD ---
app.get('/api/cards', (req, res) => {
  const { sport, search, sort, wishlist, duplicates } = req.query;
  let sql = 'SELECT * FROM cards WHERE 1=1';
  const params = [];

  if (wishlist === '1') { sql += ' AND is_wishlist = 1'; }
  else if (wishlist !== 'all') { sql += ' AND is_wishlist = 0'; }
  if (duplicates === '1') { sql += ' AND is_duplicate = 1'; }
  if (sport && sport !== 'All') { sql += ' AND sport = ?'; params.push(sport); }
  if (search) {
    sql += " AND (player_name LIKE ? OR team LIKE ? OR brand LIKE ? OR card_number LIKE ? OR set_name LIKE ?)";
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }

  switch (sort) {
    case 'oldest': sql += ' ORDER BY created_at ASC'; break;
    case 'value-high': sql += ' ORDER BY estimated_value DESC'; break;
    case 'value-low': sql += ' ORDER BY estimated_value ASC'; break;
    case 'year': sql += ' ORDER BY year DESC'; break;
    case 'name': sql += ' ORDER BY player_name ASC'; break;
    default: sql += ' ORDER BY created_at DESC';
  }

  res.json(query(sql, params));
});

app.get('/api/cards/:id', (req, res) => {
  const card = queryOne('SELECT * FROM cards WHERE id = ?', [Number(req.params.id)]);
  if (!card) return res.status(404).json({ error: 'Not found' });
  res.json(card);
});

app.post('/api/cards', (req, res) => {
  const c = req.body;
  const id = run(`INSERT INTO cards (player_name, team, year, sport, brand, card_number, set_name, subset, parallel,
      print_run, condition_grade, psa_grade, estimated_value, purchase_price, notes,
      is_duplicate, is_wishlist, is_graded, is_rookie, is_autograph, is_patch,
      image_path, ai_confidence, lookup_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.player_name || '', c.team || '', c.year || null, c.sport || 'Baseball',
     c.brand || '', c.card_number || '', c.set_name || '', c.subset || '', c.parallel || '',
     c.print_run || '',
     c.condition_grade || 'Near Mint', c.psa_grade || '',
     c.estimated_value || 0, c.purchase_price || 0, c.notes || '',
     c.is_duplicate ? 1 : 0, c.is_wishlist ? 1 : 0, c.is_graded ? 1 : 0,
     c.is_rookie ? 1 : 0, c.is_autograph ? 1 : 0, c.is_patch ? 1 : 0,
     c.image_path || '', c.ai_confidence || '', c.lookup_source || '']);
  res.json(queryOne('SELECT * FROM cards WHERE id = ?', [id]));
});

app.put('/api/cards/:id', (req, res) => {
  const c = req.body;
  run(`UPDATE cards SET player_name=?, team=?, year=?, sport=?, brand=?, card_number=?, set_name=?,
      subset=?, parallel=?, print_run=?, condition_grade=?, psa_grade=?, estimated_value=?, purchase_price=?,
      notes=?, is_duplicate=?, is_wishlist=?, is_graded=?, is_rookie=?, is_autograph=?, is_patch=?,
      image_path=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`,
    [c.player_name || '', c.team || '', c.year || null, c.sport || 'Baseball',
     c.brand || '', c.card_number || '', c.set_name || '', c.subset || '', c.parallel || '',
     c.print_run || '',
     c.condition_grade || 'Near Mint', c.psa_grade || '',
     c.estimated_value || 0, c.purchase_price || 0, c.notes || '',
     c.is_duplicate ? 1 : 0, c.is_wishlist ? 1 : 0, c.is_graded ? 1 : 0,
     c.is_rookie ? 1 : 0, c.is_autograph ? 1 : 0, c.is_patch ? 1 : 0,
     c.image_path || '', Number(req.params.id)]);
  res.json(queryOne('SELECT * FROM cards WHERE id = ?', [Number(req.params.id)]));
});

app.delete('/api/cards/:id', (req, res) => {
  const card = queryOne('SELECT image_path FROM cards WHERE id = ?', [Number(req.params.id)]);
  if (card && card.image_path) {
    const fname = card.image_path.replace('/uploads/', '');
    const imgPath = path.join(uploadsDir, fname);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }
  run('DELETE FROM cards WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

// --- Image Upload ---
async function compressImage(filePath) {
  if (!sharp) return null;
  try {
    const ext = path.extname(filePath);
    const compName = `comp_${path.basename(filePath, ext)}.jpg`;
    const compPath = path.join(uploadsDir, compName);
    await sharp(filePath)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(compPath);
    fs.unlinkSync(filePath);
    return compName;
  } catch (e) { return null; }
}

app.post('/api/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const compressed = await compressImage(req.file.path);
  const filename = compressed || req.file.filename;
  res.json({ filename, path: `/uploads/${filename}` });
});

app.post('/api/upload/bulk', upload.array('images', 50), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files' });
  const results = [];
  for (const file of req.files) {
    const compressed = await compressImage(file.path);
    const filename = compressed || file.filename;
    results.push({ filename, path: `/uploads/${filename}` });
  }
  res.json(results);
});

// --- eBay Price Lookup ---
// Uses official Finding API when App ID is set; falls back to scraping completed listings HTML

function buildKeywords(card) {
  const { player_name, year, brand, set_name, card_number, parallel, print_run, psa_grade } = card;
  const parts = [player_name, year];
  // Don't double up brand if set_name already starts with it (e.g. "Leaf" + "Leaf HYPE!")
  const setLower = (set_name || '').toLowerCase();
  const brandLower = (brand || '').toLowerCase();
  if (set_name && brand && setLower.startsWith(brandLower)) {
    parts.push(set_name);
  } else {
    if (brand) parts.push(brand);
    if (set_name) parts.push(set_name);
  }
  if (parallel) parts.push(parallel);
  if (print_run) parts.push(`/${print_run}`);
  if (card_number) parts.push(`#${card_number}`);
  if (psa_grade) parts.push(`PSA ${psa_grade}`);
  return parts.filter(Boolean).join(' ');
}

function calcStats(prices) {
  if (!prices.length) return null;
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  return {
    estimated_value: Math.round(avg * 100) / 100,
    value_range_low: Math.round(Math.min(...prices) * 100) / 100,
    value_range_high: Math.round(Math.max(...prices) * 100) / 100,
    recent_sales_count: prices.length,
  };
}

async function lookupViaFindingAPI(appId, keywords) {
  const params = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-VERSION': '1.0.0',
    'SECURITY-APPNAME': appId,
    'RESPONSE-DATA-FORMAT': 'JSON',
    'keywords': keywords,
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true',
    'sortOrder': 'EndTimeSoonest',
    'paginationInput.entriesPerPage': '20',
    'categoryId': '212',
  });

  const r = await fetch(`https://svcs.ebay.com/services/search/FindingService/v1?${params}`);
  if (!r.ok) throw new Error(`eBay API error: ${r.status}`);
  const data = await r.json();

  const ack = data?.findCompletedItemsResponse?.[0]?.ack?.[0];
  if (ack !== 'Success' && ack !== 'Warning') {
    const msg = data?.findCompletedItemsResponse?.[0]?.errorMessage?.[0]?.error?.[0]?.message?.[0];
    throw new Error(msg || 'eBay search failed — check your App ID');
  }

  const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
  const prices = items.map(i => parseFloat(i?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || '0')).filter(p => p > 0);
  const recentSales = items.slice(0, 10).map(i => ({
    title: i.title?.[0] || '',
    price: parseFloat(i.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || '0'),
    date: i.listingInfo?.[0]?.endTime?.[0]?.slice(0, 10) || '',
    url: i.viewItemURL?.[0] || '',
  }));

  return { prices, recentSales, source: 'eBay Sold Listings (API)' };
}

async function lookupViaEbayScrape(keywords) {
  const url = 'https://www.ebay.com/sch/212/i.html?' + new URLSearchParams({
    _nkw: keywords, LH_Complete: '1', LH_Sold: '1', _sop: '13', _ipg: '20',
  });

  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });
  if (!r.ok) throw new Error(`eBay returned ${r.status}`);
  const html = await r.text();

  if (html.length < 3000 || html.includes('g-recaptcha') || html.includes('_challenge')) {
    throw new Error('eBay blocked the request — add an eBay App ID in Settings for reliable lookups');
  }

  const prices = [];
  const recentSales = [];

  // Strategy 1: JSON-LD schema markup (most reliable when present)
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]);
      const elements = d['@type'] === 'ItemList' ? d.itemListElement || [] : [];
      for (const el of elements) {
        const price = parseFloat(el.offers?.price || 0);
        if (price > 0 && price < 100000) {
          prices.push(price);
          recentSales.push({ title: el.name || '', price, date: '', url: el.url || '' });
        }
      }
    } catch (e) {}
  }

  // Strategy 2: itemprop="price" content attributes
  if (!prices.length) {
    for (const m of html.matchAll(/itemprop="price"[^>]*content="([\d.]+)"/g)) {
      const p = parseFloat(m[1]);
      if (p > 0 && p < 100000) prices.push(p);
    }
    for (const m of html.matchAll(/content="([\d.]+)"[^>]*itemprop="price"/g)) {
      const p = parseFloat(m[1]);
      if (p > 0 && p < 100000) prices.push(p);
    }
  }

  // Strategy 3: s-item__price spans
  if (!prices.length) {
    for (const m of html.matchAll(/class="s-item__price"[^>]*>\s*\$\s*([\d,]+\.?\d*)/g)) {
      const p = parseFloat(m[1].replace(/,/g, ''));
      if (p > 0 && p < 100000) prices.push(p);
    }
  }

  if (!prices.length) throw new Error('No sold listings found on eBay');
  return { prices, recentSales: recentSales.slice(0, 10), source: 'eBay Sold Listings' };
}

// Try multiple CORS proxies in sequence to bypass Railway's IP block
async function proxiedFetch(targetUrl) {
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    `https://thingproxy.freeboard.io/fetch/${targetUrl}`,
  ];
  for (const proxyUrl of proxies) {
    try {
      const r = await fetch(proxyUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const text = await r.text();
      if (text.length > 500 && !text.includes('GoDaddy') && !text.includes('domain is for sale')) return text;
    } catch (e) { /* try next proxy */ }
  }
  throw new Error('All proxies failed or returned empty pages');
}

async function lookupViaSportsCardsPro(keywords) {
  const url = 'https://sportscardspro.com/search?' + new URLSearchParams({ q: keywords });
  // Try direct first (smaller site, less likely to block)
  let html;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) html = await r.text();
  } catch (e) { /* fall through to proxy */ }

  if (!html || html.length < 500) html = await proxiedFetch(url);

  const prices = [];
  const recentSales = [];

  // Sports Card Pro embeds prices in JSON-LD and data attributes
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]);
      const offers = Array.isArray(d.offers) ? d.offers : (d.offers ? [d.offers] : []);
      for (const o of offers) {
        const p = parseFloat(o.price || 0);
        if (p > 0.25 && p < 50000) { prices.push(p); recentSales.push({ title: d.name || '', price: p, date: '', url: d.url || '' }); }
      }
      if (d.itemListElement) {
        for (const el of d.itemListElement) {
          const p = parseFloat(el?.offers?.price || 0);
          if (p > 0.25 && p < 50000) { prices.push(p); recentSales.push({ title: el.name || '', price: p, date: '', url: el.url || '' }); }
        }
      }
    } catch (e) {}
  }
  if (prices.length < 2) {
    for (const m of html.matchAll(/data-price="([\d.]+)"/g)) {
      const p = parseFloat(m[1]);
      if (p > 0.25 && p < 50000) prices.push(p);
    }
  }
  if (prices.length < 2) {
    for (const m of html.matchAll(/\$\s*([\d,]+\.\d{2})/g)) {
      const p = parseFloat(m[1].replace(/,/g, ''));
      if (p > 0.25 && p < 50000) prices.push(p);
    }
  }
  if (prices.length < 2) throw new Error('Not enough sales found on SportsCardsPro');
  return { prices, recentSales: recentSales.slice(0, 10), source: 'SportsCardsPro' };
}

async function lookupViaGeminiSearch(geminiKey, keywords) {
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  const prompt = `Search eBay for recently SOLD listings of this sports card: "${keywords}".

For each completed sale you find, output it on its own line in EXACTLY this format:
SALE: $[price] | [Month Day Year] | [listing title]

Example:
SALE: $14.50 | Jan 10 2025 | 2024 Topps Chrome Patrick Mahomes #100 PSA 10
SALE: $11.00 | Dec 28 2024 | Mahomes 2024 Topps Chrome Base Refractor

List up to 15 individual sales. Only include real completed transactions with actual sale prices and dates. Show the most recent sales first.`;

  for (const model of models) {
    let r;
    try {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
    } catch (e) {
      console.log(`Gemini ${model} network error:`, e.message);
      continue;
    }

    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      console.log(`Gemini ${model} HTTP ${r.status}:`, errBody.slice(0, 200));
      continue;
    }

    const data = await r.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    console.log(`Gemini ${model} response (${text.length} chars):`, text.slice(0, 400));

    if (!text) continue;

    // Try to extract structured SALE lines with dates first
    const recentSales = [];
    for (const m of text.matchAll(/SALE:\s*\$\s*([\d,]+\.?\d{0,2})\s*\|\s*([A-Za-z]{3,9}\.?\s+\d{1,2}[\s,]+\d{4})\s*\|\s*(.+?)(?=\n|SALE:|$)/g)) {
      const price = parseFloat(m[1].replace(/,/g, ''));
      if (price > 0.25 && price < 50000) {
        recentSales.push({ price, date: m[2].replace(/\.$/, '').trim(), title: m[3].trim() });
      }
    }

    const prices = recentSales.length > 0
      ? recentSales.map(s => s.price)
      : [];

    // Fall back to unstructured dollar extraction if structured format wasn't used
    if (prices.length === 0) {
      for (const m of text.matchAll(/\$\s*([\d,]+\.?\d{0,2})/g)) {
        const p = parseFloat(m[1].replace(/,/g, ''));
        if (p > 0.25 && p < 50000) prices.push(p);
      }
    }

    if (prices.length >= 1) {
      console.log(`Gemini ${model}: ${prices.length} prices, ${recentSales.length} with dates`);
      return { prices, recentSales, source: 'eBay (Google Search)' };
    }

    console.log(`Gemini ${model}: no prices found in response`);
  }

  throw new Error('Gemini search found no price data');
}

async function lookupViaGeminiMarketData(geminiKey, keywords) {
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  const prompt = `You are a sports card market analyst. Use Google Search to find REAL recent SOLD prices for this card: "${keywords}"

Search across: eBay completed/sold listings, PWCC Marketplace (pwccmarketplace.com), Goldin Auctions (goldincards.com), Heritage Auctions (ha.com), CollX (collx.app), and 130point.com.

Return ONLY this exact JSON — no markdown, no text before or after, no backticks:
{
  "raw": {"avg":0,"low":0,"high":0,"count":0},
  "grades": {
    "PSA 7":{"avg":0,"low":0,"high":0,"count":0},
    "PSA 8":{"avg":0,"low":0,"high":0,"count":0},
    "PSA 9":{"avg":0,"low":0,"high":0,"count":0},
    "PSA 10":{"avg":0,"low":0,"high":0,"count":0}
  },
  "by_source": {
    "eBay":{"avg":0,"count":0},
    "PWCC":{"avg":0,"count":0},
    "Goldin":{"avg":0,"count":0},
    "Heritage":{"avg":0,"count":0},
    "CollX":{"avg":0,"count":0},
    "130point":{"avg":0,"count":0}
  },
  "recent_sales":[
    {"price":12.50,"date":"Jan 15 2025","grade":"PSA 9","source":"eBay","title":"listing title"}
  ],
  "trend":"stable"
}

Rules:
- raw = ungraded/raw copies only (no PSA or BGS grade label on the sale)
- Fill grades ONLY where you found actual sales data — leave as 0 if not found
- Fill by_source for each platform where you found prices — leave as 0 if not found
- trend: "up" if prices are rising over last 90 days, "down" if falling, "stable" if flat
- List up to 20 recent_sales sorted newest first
- Only include real data found via Google Search — do not estimate`;

  for (const model of models) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
          }),
          signal: AbortSignal.timeout(28000),
        }
      );
      if (!r.ok) { const e = await r.text(); console.log(`Gemini ${model} market ${r.status}:`, e.slice(0,150)); continue; }
      const data = await r.json();
      const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
      console.log(`Gemini ${model} market (${text.length}):`, text.slice(0, 400));
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) { console.log(`Gemini ${model} market: no JSON`); continue; }
      return JSON.parse(m[0]);
    } catch (e) { console.log(`Gemini ${model} market error:`, e.message); }
  }
  throw new Error('Gemini market data lookup failed');
}

async function lookupVia130Point(keywords) {
  const url = 'https://130point.com/sales/?' + new URLSearchParams({ search: keywords });
  const html = await proxiedFetch(url);
  const prices = [];
  for (const m of html.matchAll(/<td[^>]*>\s*\$\s*([\d,]+\.?\d{0,2})\s*<\/td>/g)) {
    const p = parseFloat(m[1].replace(/,/g, ''));
    if (p > 0.25 && p < 50000) prices.push(p);
  }
  if (prices.length < 3) {
    for (const m of html.matchAll(/\$\s*([\d,]+\.\d{2})\b/g)) {
      const p = parseFloat(m[1].replace(/,/g, ''));
      if (p > 0.25 && p < 50000) prices.push(p);
    }
  }
  if (prices.length < 2) throw new Error('Not enough sales found on 130point');
  return { prices, recentSales: [], source: '130point.com' };
}

async function lookupViaClaudeEstimate(anthropicKey, keywords) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `You are a sports card market expert. Estimate the eBay resale value for this card in Near Mint condition:

"${keywords}"

Consider the player's popularity, set rarity, and parallel. Common base cards are usually $0.25–$2. Star rookies and rare parallels can be hundreds.

Return ONLY JSON, no other text:
{"low": 8.00, "avg": 12.50, "high": 18.00}`
      }]
    })
  });
  if (!r.ok) throw new Error(`Claude estimate: ${r.status}`);
  const data = await r.json();
  const text = data?.content?.[0]?.text || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in Claude response');
  const parsed = JSON.parse(m[0]);
  const avg = parseFloat(parsed.avg);
  if (!avg || avg <= 0) throw new Error('Invalid estimate');
  return {
    estimated_value: Math.round(avg * 100) / 100,
    value_range_low: Math.round((parseFloat(parsed.low) || avg * 0.7) * 100) / 100,
    value_range_high: Math.round((parseFloat(parsed.high) || avg * 1.3) * 100) / 100,
    recent_sales_count: 0,
    recentSales: [],
    source: 'AI Estimate',
  };
}

app.post('/api/ebay-price', async (req, res) => {
  const { player_name, card_id } = req.body;
  if (!player_name) return res.status(400).json({ error: 'Player name required' });

  const keywords = buildKeywords(req.body);
  const appId = getEbayAppId();

  try {
    let result;
    if (appId) {
      result = await lookupViaFindingAPI(appId, keywords);
    } else {
      const geminiKey = getGeminiKey();
      const anthropicKey = getAnthropicKey();
      const sources = [
        ...(geminiKey ? [{ name: 'Gemini', fn: () => lookupViaGeminiSearch(geminiKey, keywords) }] : []),
        { name: 'SportsCardsPro', fn: () => lookupViaSportsCardsPro(keywords) },
        { name: '130point', fn: () => lookupVia130Point(keywords) },
        { name: 'eBay', fn: () => lookupViaEbayScrape(keywords) },
        // Claude estimate is the guaranteed final fallback — works as long as the AI key is set
        ...(anthropicKey ? [{ name: 'Claude', fn: () => lookupViaClaudeEstimate(anthropicKey, keywords) }] : []),
      ];
      let lastErr;
      for (const src of sources) {
        try {
          result = await src.fn();
          break;
        } catch (e) {
          console.log(`${src.name} failed:`, e.message);
          lastErr = e;
        }
      }
      if (!result) throw lastErr;
    }

    // Some sources (Claude estimate) return pre-computed stats; others return raw prices
    const stats = result.estimated_value !== undefined
      ? {
          estimated_value: result.estimated_value,
          value_range_low: result.value_range_low || result.estimated_value,
          value_range_high: result.value_range_high || result.estimated_value,
          recent_sales_count: result.recent_sales_count || 0,
        }
      : calcStats(result.prices || []);

    if (!stats || !stats.estimated_value) {
      return res.json({ estimated_value: 0, recent_sales_count: 0, message: 'No price data found' });
    }

    const payload = { ...stats, recent_sales: result.recentSales || [], source: result.source };

    if (card_id) {
      run(`INSERT INTO price_history (card_id, estimated_value, value_range_low, value_range_high, recent_sales_count, recent_sales_json, source)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [card_id, stats.estimated_value, stats.value_range_low || 0, stats.value_range_high || 0,
         stats.recent_sales_count, JSON.stringify(result.recentSales || []), result.source]);
    }

    res.json(payload);
  } catch (e) {
    console.error('Price lookup error:', e.message);
    res.status(500).json({ error: 'Price lookup failed — tap Set Price to enter manually', keywords });
  }
});

// Save a price result — used by both manual entry and client-side lookups
app.post('/api/cards/:id/set-price', (req, res) => {
  const id = Number(req.params.id);
  const { price, source, range_low, range_high, sales_count, recent_sales } = req.body;
  if (!price || isNaN(price)) return res.status(400).json({ error: 'Price required' });
  run('UPDATE cards SET estimated_value=?, lookup_source=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [price, source || 'Manual', id]);
  run(`INSERT INTO price_history (card_id, estimated_value, value_range_low, value_range_high, recent_sales_count, recent_sales_json, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, price, range_low || 0, range_high || 0, sales_count || 0,
     JSON.stringify(recent_sales || []), source || 'Manual']);
  res.json(queryOne('SELECT * FROM cards WHERE id=?', [id]));
});

// Full multi-source market check — grade-level pricing from eBay, PWCC, Goldin, Heritage, CollX, 130point
app.post('/api/cards/:id/market-check', async (req, res) => {
  const id = Number(req.params.id);
  const card = queryOne('SELECT * FROM cards WHERE id = ?', [id]);
  if (!card) return res.status(404).json({ error: 'Not found' });

  const geminiKey = getGeminiKey();
  const anthropicKey = getAnthropicKey();
  const keywords = buildKeywords(card);
  let marketData, source = 'Multi-Source';

  if (geminiKey) {
    try { marketData = await lookupViaGeminiMarketData(geminiKey, keywords); }
    catch (e) { console.error('Market Gemini failed:', e.message); }
  }

  // Fallback: Claude estimate with grade multipliers
  if (!marketData && anthropicKey) {
    try {
      const est = await lookupViaClaudeEstimate(anthropicKey, keywords);
      const base = est.estimated_value;
      marketData = {
        raw: { avg: +(base * 0.5).toFixed(2), low: +(base * 0.3).toFixed(2), high: +(base * 0.7).toFixed(2), count: 0 },
        grades: {
          'PSA 8': { avg: +(base * 0.75).toFixed(2), low: 0, high: 0, count: 0 },
          'PSA 9': { avg: base, low: est.value_range_low, high: est.value_range_high, count: 0 },
          'PSA 10': { avg: +(base * 2.2).toFixed(2), low: 0, high: 0, count: 0 },
        },
        by_source: {}, recent_sales: [], trend: 'stable',
      };
      source = 'AI Estimate';
    } catch (e) {
      return res.status(500).json({ error: 'Market check requires a Gemini or Claude key in Settings' });
    }
  }

  if (!marketData) return res.status(500).json({ error: 'Add a Gemini API key in Settings for market check' });

  // Pick best estimated value for this card's specific PSA grade
  const psaNum = (card.psa_grade || '').toString().replace(/[^0-9.]/g, '');
  let estimatedValue = 0;
  if (psaNum && marketData.grades?.[`PSA ${psaNum}`]?.avg > 0) {
    estimatedValue = marketData.grades[`PSA ${psaNum}`].avg;
  } else {
    const vals = Object.values(marketData.grades || {}).map(g => g.avg || 0).filter(v => v > 0).sort((a, b) => a - b);
    estimatedValue = vals.length ? vals[Math.floor(vals.length / 2)] : (marketData.raw?.avg || 0);
  }

  if (estimatedValue > 0) {
    run('UPDATE cards SET estimated_value=?, lookup_source=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [estimatedValue, source, id]);
    const allSales = marketData.recent_sales || [];
    const allHighs = Object.values(marketData.grades || {}).map(g => g.high || 0).filter(v => v > 0);
    run(`INSERT INTO price_history (card_id, estimated_value, value_range_low, value_range_high, recent_sales_count, recent_sales_json, source, raw_value, price_by_grade_json, sources_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, estimatedValue, marketData.raw?.low || 0, allHighs.length ? Math.max(...allHighs) : 0,
       allSales.length, JSON.stringify(allSales), source,
       marketData.raw?.avg || 0, JSON.stringify(marketData.grades || {}), JSON.stringify(marketData.by_source || {})]);
  }

  res.json({ ...marketData, estimated_value: estimatedValue, keywords });
});

app.get('/api/debug/price', async (req, res) => {
  const keywords = req.query.q || 'Patrick Mahomes 2017 Panini Prizm';
  const log = [];
  const geminiKey = getGeminiKey();
  const anthropicKey = getAnthropicKey();
  log.push({ hasGeminiKey: !!geminiKey, hasAnthropicKey: !!anthropicKey, keywords });

  if (geminiKey) {
    for (const model of ['gemini-2.0-flash', 'gemini-1.5-flash']) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `Search for eBay sold prices for: "${keywords}". List the prices.` }] }],
              tools: [{ google_search: {} }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 256 }
            }),
            signal: AbortSignal.timeout(15000),
          }
        );
        const body = await r.text();
        log.push({ model, status: r.status, responsePreview: body.slice(0, 400) });
      } catch (e) {
        log.push({ model, error: e.message });
      }
      break; // only test first model
    }
  }

  res.json(log);
});

app.get('/api/debug/storage', (req, res) => {
  const files = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).slice(0, 20) : [];
  res.json({ DATA_DIR, uploadsDir, fileCount: files.length, files, IS_PROD });
});

app.get('/api/cards/:id/price-history', (req, res) => {
  const history = query(
    'SELECT * FROM price_history WHERE card_id = ? ORDER BY looked_up_at ASC',
    [Number(req.params.id)]
  );
  res.json(history.map(h => ({
    ...h,
    recent_sales: JSON.parse(h.recent_sales_json || '[]'),
    price_by_grade: JSON.parse(h.price_by_grade_json || '{}'),
    sources: JSON.parse(h.sources_json || '{}'),
  })));
});

// --- CSV Export ---
app.get('/api/export/csv', (req, res) => {
  const cards = query('SELECT * FROM cards ORDER BY created_at DESC');
  const headers = ['ID','Player Name','Team','Year','Sport','Brand','Card #','Set','Subset','Parallel','Condition','PSA Grade','Est. Value','Purchase Price','Duplicate','Wishlist','Graded','Notes','Date Added'];
  const rows = cards.map(c => [
    c.id, c.player_name, c.team, c.year || '', c.sport, c.brand, c.card_number,
    c.set_name, c.subset, c.parallel, c.condition_grade, c.psa_grade,
    c.estimated_value, c.purchase_price, c.is_duplicate ? 'Yes' : 'No',
    c.is_wishlist ? 'Yes' : 'No', c.is_graded ? 'Yes' : 'No',
    (c.notes || '').replace(/"/g, '""'), c.created_at
  ].map(v => `"${v}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="card-vault-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

// --- Stats ---
app.get('/api/stats', (req, res) => {
  const total = queryOne('SELECT COUNT(*) as count FROM cards WHERE is_wishlist = 0');
  const tv = queryOne('SELECT COALESCE(SUM(estimated_value), 0) as total FROM cards WHERE is_wishlist = 0');
  const dupes = queryOne('SELECT COUNT(*) as count FROM cards WHERE is_duplicate = 1 AND is_wishlist = 0');
  const wish = queryOne('SELECT COUNT(*) as count FROM cards WHERE is_wishlist = 1');
  const graded = queryOne('SELECT COUNT(*) as count FROM cards WHERE is_graded = 1 AND is_wishlist = 0');
  const bySport = query("SELECT sport, COUNT(*) as count, COALESCE(SUM(estimated_value), 0) as value FROM cards WHERE is_wishlist = 0 GROUP BY sport");
  const byBrand = query("SELECT brand, COUNT(*) as count, COALESCE(SUM(estimated_value), 0) as value FROM cards WHERE is_wishlist = 0 AND brand != '' GROUP BY brand ORDER BY count DESC LIMIT 10");
  const topCards = query("SELECT * FROM cards WHERE is_wishlist = 0 AND estimated_value > 0 ORDER BY estimated_value DESC LIMIT 10");
  const recentCards = query("SELECT * FROM cards WHERE is_wishlist = 0 ORDER BY created_at DESC LIMIT 5");

  // Portfolio value over time — one point per day, sum of all card values
  const portfolioHistory = query(`
    SELECT DATE(looked_up_at) as date, SUM(ph.estimated_value) as value
    FROM price_history ph
    JOIN cards c ON c.id = ph.card_id
    WHERE c.is_wishlist = 0
    GROUP BY DATE(looked_up_at)
    ORDER BY date ASC
    LIMIT 90
  `);

  // Top movers — cards with the biggest $ change between first and last lookup
  const movers = query(`
    SELECT c.id, c.player_name, c.team, c.year, c.set_name, c.parallel, c.image_path,
           first_ph.estimated_value as value_first,
           last_ph.estimated_value as value_last,
           (last_ph.estimated_value - first_ph.estimated_value) as change
    FROM cards c
    JOIN price_history first_ph ON first_ph.id = (
      SELECT id FROM price_history WHERE card_id = c.id ORDER BY looked_up_at ASC LIMIT 1
    )
    JOIN price_history last_ph ON last_ph.id = (
      SELECT id FROM price_history WHERE card_id = c.id ORDER BY looked_up_at DESC LIMIT 1
    )
    WHERE c.is_wishlist = 0 AND first_ph.id != last_ph.id
    ORDER BY ABS(change) DESC
    LIMIT 5
  `);

  res.json({
    total: total.count, totalValue: tv.total,
    duplicates: dupes.count, wishlist: wish.count, graded: graded.count,
    bySport, byBrand, topCards, recentCards,
    portfolioHistory, movers,
  });
});

// SPA catch-all
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Start
(async () => {
  await initDB();

  if (IS_PROD) {
    // Production (Railway / Render / cloud) — platform handles HTTPS
    app.listen(PORT, () => {
      console.log(`🦅 HawkCollects2317 running on port ${PORT}`);
    });
  } else {
    // Local development — spin up HTTP + HTTPS (for phone camera)
    function getLocalIP() {
      const nets = os.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === 'IPv4' && !net.internal) return net.address;
        }
      }
      return 'localhost';
    }

    const certsDir = path.join(__dirname, 'certs');
    const keyPath = path.join(certsDir, 'key.pem');
    const certPath = path.join(certsDir, 'cert.pem');
    let httpsReady = false;

    if (!fs.existsSync(certPath)) {
      try {
        if (!fs.existsSync(certsDir)) fs.mkdirSync(certsDir);
        const forge = require('node-forge');
        const keys = forge.pki.rsa.generateKeyPair(2048);
        const cert = forge.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = '01';
        cert.validity.notBefore = new Date();
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
        const attrs = [{ name: 'commonName', value: 'hawkcollects' }];
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        cert.sign(keys.privateKey);
        fs.writeFileSync(keyPath, forge.pki.privateKeyToPem(keys.privateKey));
        fs.writeFileSync(certPath, forge.pki.certificateToPem(cert));
        httpsReady = true;
      } catch (e) {
        console.error('  ⚠  Failed to generate HTTPS certificate:', e.message);
      }
    } else {
      httpsReady = true;
    }

    const HTTPS_PORT = Number(PORT) + 443;
    const localIP = getLocalIP();

    app.listen(PORT, () => {
      console.log('');
      console.log('  ╔══════════════════════════════════════════════════════╗');
      console.log('  ║                                                      ║');
      console.log('  ║   🦅  HAWKCOLLECTS2317 is running!                  ║');
      console.log('  ║                                                      ║');
      console.log(`  ║   Computer:  http://localhost:${PORT}                     ║`);
      if (httpsReady) {
        console.log(`  ║   Phone:     https://${localIP}:${HTTPS_PORT}`.padEnd(57) + '║');
      } else {
        console.log('  ║   Phone:     ⚠ HTTPS not available (see below)       ║');
      }
      console.log('  ║                                                      ║');
      console.log('  ║   Database:  card_vault.db                           ║');
      console.log('  ║   Photos:    uploads/                                ║');
      console.log('  ║   Press Ctrl+C to stop                               ║');
      console.log('  ║                                                      ║');
      console.log('  ╚══════════════════════════════════════════════════════╝');

      if (httpsReady) {
        console.log('');
        console.log(`  📱 On your phone, open Safari/Chrome and go to:`);
        console.log(`     https://${localIP}:${HTTPS_PORT}`);
        console.log('');
        console.log('  ⚠  Your phone will show a security warning —');
        console.log('     tap Advanced → Proceed (Chrome) or Show Details → Visit (Safari)');
      } else {
        console.log('');
        console.log('  ⚠  HTTPS unavailable. Camera will only work on this computer.');
        console.log('     Delete the certs/ folder and restart to retry.');
      }
      console.log('');
    });

    if (httpsReady) {
      try {
        https.createServer({
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        }, app).listen(HTTPS_PORT, '0.0.0.0');
      } catch (e) {
        console.error('  ⚠  HTTPS server failed to start:', e.message);
      }
    }
  }
})();
