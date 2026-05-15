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
  res.json({ hasEbayAppId: !!getEbayAppId(), hasGeminiKey: !!getGeminiKey() });
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

// --- AI Card Recognition (Google Gemini — free tier) ---
app.post('/api/recognize', async (req, res) => {
  const apiKey = getGeminiKey();
  if (!apiKey) return res.status(400).json({ error: 'Gemini API key not set. Go to Settings.' });

  const { imagePath } = req.body;
  if (!imagePath) return res.status(400).json({ error: 'imagePath required' });

  const filename = imagePath.replace('/uploads/', '');
  const filePath = path.join(uploadsDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Image not found' });

  const imageData = fs.readFileSync(filePath);
  const base64 = imageData.toString('base64');
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

  const prompt = `You are a sports trading card expert. Analyze this card image and extract every visible detail. Return ONLY a valid JSON object — no markdown, no explanation, just JSON.

{
  "player_name": "First Last",
  "team": "Team Name",
  "year": 2021,
  "sport": "Baseball",
  "brand": "Topps",
  "card_number": "500",
  "set_name": "2021 Topps Chrome",
  "subset": "insert or subset name, or null",
  "parallel": "e.g. Prizm Silver, Gold Refractor, Blue /150, or null if base",
  "is_rookie": false,
  "condition_notes": "any visible damage or wear, or null",
  "confidence": "high"
}

Rules:
- sport: exactly "Baseball", "Football", or "Basketball"
- brand examples: Topps, Panini, Upper Deck, Bowman, Fleer, Donruss, Score, Leaf
- set_name: full set name e.g. "2021 Topps Chrome", "2022 Panini Prizm"
- parallel: be specific — "Prizm Silver", "Prizm Gold", "Prizm Holo", "Refractor", "Blue Refractor /150", "Gold /50". Use null if standard base card
- is_rookie: true only if the card explicitly says RC, Rookie, or Rookie Card
- confidence: "high" if clearly readable, "medium" if partially visible, "low" if unclear
- Use null for any field you cannot determine from the image`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: prompt }
          ]}],
          generationConfig: { temperature: 0.1, maxOutputTokens: 512 }
        })
      }
    );

    if (!response.ok) {
      const err = await response.json();
      const msg = err?.error?.message || `Gemini error: ${response.status}`;
      return res.status(400).json({ error: msg });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(400).json({ error: 'Could not parse card data from image' });

    res.json(JSON.parse(jsonMatch[0]));
  } catch (e) {
    console.error('Gemini recognize error:', e);
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
      condition_grade, psa_grade, estimated_value, purchase_price, notes, is_duplicate, is_wishlist,
      is_graded, image_path, ai_confidence, lookup_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.player_name || '', c.team || '', c.year || null, c.sport || 'Baseball',
     c.brand || '', c.card_number || '', c.set_name || '', c.subset || '', c.parallel || '',
     c.condition_grade || 'Near Mint', c.psa_grade || '',
     c.estimated_value || 0, c.purchase_price || 0, c.notes || '',
     c.is_duplicate ? 1 : 0, c.is_wishlist ? 1 : 0, c.is_graded ? 1 : 0,
     c.image_path || '', c.ai_confidence || '', c.lookup_source || '']);
  res.json(queryOne('SELECT * FROM cards WHERE id = ?', [id]));
});

app.put('/api/cards/:id', (req, res) => {
  const c = req.body;
  run(`UPDATE cards SET player_name=?, team=?, year=?, sport=?, brand=?, card_number=?, set_name=?,
      subset=?, parallel=?, condition_grade=?, psa_grade=?, estimated_value=?, purchase_price=?,
      notes=?, is_duplicate=?, is_wishlist=?, is_graded=?, image_path=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`,
    [c.player_name || '', c.team || '', c.year || null, c.sport || 'Baseball',
     c.brand || '', c.card_number || '', c.set_name || '', c.subset || '', c.parallel || '',
     c.condition_grade || 'Near Mint', c.psa_grade || '',
     c.estimated_value || 0, c.purchase_price || 0, c.notes || '',
     c.is_duplicate ? 1 : 0, c.is_wishlist ? 1 : 0, c.is_graded ? 1 : 0,
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
  const { player_name, year, brand, set_name, card_number, parallel, psa_grade } = card;
  return [player_name, year, brand, set_name,
    card_number ? `#${card_number}` : '', parallel, psa_grade, 'card']
    .filter(Boolean).join(' ');
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

app.post('/api/ebay-price', async (req, res) => {
  const { player_name } = req.body;
  if (!player_name) return res.status(400).json({ error: 'Player name required' });

  const keywords = buildKeywords(req.body);
  const appId = getEbayAppId();

  try {
    let result;
    if (appId) {
      result = await lookupViaFindingAPI(appId, keywords);
    } else {
      result = await lookupViaEbayScrape(keywords);
    }

    const { prices, recentSales, source } = result;
    if (!prices.length) return res.json({ estimated_value: 0, recent_sales_count: 0, message: 'No recent eBay sales found' });

    const stats = calcStats(prices);
    res.json({ ...stats, recent_sales: recentSales, source });
  } catch (e) {
    console.error('eBay price error:', e.message);
    res.status(500).json({ error: e.message });
  }
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

  res.json({
    total: total.count, totalValue: tv.total,
    duplicates: dupes.count, wishlist: wish.count, graded: graded.count,
    bySport, byBrand, topCards, recentCards
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
