const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');

const os = require('os');
const { initDB, query, queryOne, run } = require('./database');
const Anthropic = require('@anthropic-ai/sdk').default;

// Try to load sharp (optional — for image compression)
let sharp = null;
try { sharp = require('sharp'); } catch (e) { /* sharp not available, images won't be compressed */ }

const app = express();
const PORT = process.env.PORT || 3000;

let anthropic = null;
function getAI() {
  if (!anthropic) {
    const row = queryOne("SELECT value FROM settings WHERE key = 'api_key'");
    const key = process.env.ANTHROPIC_API_KEY || (row ? row.value : null);
    if (!key) return null;
    anthropic = new Anthropic({ apiKey: key });
  }
  return anthropic;
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
  const row = queryOne("SELECT value FROM settings WHERE key = 'api_key'");
  res.json({ hasApiKey: !!(row && row.value) });
});

app.post('/api/settings/apikey', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('api_key', ?)", [apiKey]);
  anthropic = null;
  res.json({ success: true });
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

// --- AI Card Recognition ---
app.post('/api/recognize', async (req, res) => {
  const ai = getAI();
  if (!ai) return res.status(400).json({ error: 'API key not set. Go to Settings.' });

  const { imagePath } = req.body;
  if (!imagePath) return res.status(400).json({ error: 'Image path required' });

  try {
    const fname = imagePath.replace('/uploads/', '');
    const fullPath = path.join(uploadsDir, fname);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Image not found' });

    const imageData = fs.readFileSync(fullPath).toString('base64');
    const ext = path.extname(fullPath).toLowerCase();
    const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';

    // Step 1: Visual recognition
    const recognition = await ai.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 1500,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageData } },
        { type: 'text', text: `You are a sports card expert. Analyze this trading card carefully. Look for:
- Player name, Team name/logo, Card year/season
- Brand (Topps, Panini, Upper Deck, Bowman, Donruss, Fleer, Score, etc.)
- Card number (front corner or back), Set name (e.g. "Topps Chrome", "Prizm", "Select")
- Subset/insert name, Parallel type (refractor, prizm, holo, colored border)
- Sport (Baseball/Football/Basketball), Rookie card indicators
- Condition issues (creases, corner wear, centering)

Return ONLY a JSON object, no markdown:
{"player_name":"","team":"","year":null,"sport":"Baseball","brand":"","card_number":"","set_name":"","subset":"","parallel":"","is_rookie":false,"condition_grade":"Near Mint","confidence":"high"}` }
      ]}]
    });

    const recText = recognition.content.map(b => b.text || '').join('');
    let cardData;
    try { cardData = JSON.parse(recText.replace(/```json|```/g, '').trim()); }
    catch { return res.status(500).json({ error: 'AI parse failed', raw: recText }); }

    // Step 2: Value lookup via web search
    let lookupData = null;
    if (cardData.player_name) {
      try {
        const q = [cardData.player_name, cardData.year, cardData.brand, cardData.set_name,
          cardData.card_number ? `#${cardData.card_number}` : '', cardData.parallel,
          'sports card value price'].filter(Boolean).join(' ');

        const lookup = await ai.messages.create({
          model: 'claude-sonnet-4-20250514', max_tokens: 1000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: `Find the current market value of: ${q}
Check eBay sold listings, Beckett, PSA, COMC, price guides.
Return ONLY JSON: {"estimated_value":0,"value_range_low":0,"value_range_high":0,"recent_sales":"","set_info":"","notable_details":"","source":""}` }]
        });

        const lt = lookup.content.map(b => b.text || '').join('');
        try { lookupData = JSON.parse(lt.replace(/```json|```/g, '').trim()); }
        catch { const m = lt.match(/\{[\s\S]*\}/); if (m) try { lookupData = JSON.parse(m[0]); } catch {} }
      } catch (e) { console.error('Lookup error:', e.message); }
    }

    res.json({
      ...cardData,
      estimated_value: lookupData?.estimated_value || 0,
      lookup_source: lookupData?.source || '',
      notable_details: lookupData?.notable_details || '',
    });
  } catch (e) {
    console.error('Recognition error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Bulk recognize
app.post('/api/recognize/bulk', async (req, res) => {
  const ai = getAI();
  if (!ai) return res.status(400).json({ error: 'API key not set' });
  const { images } = req.body;
  if (!images?.length) return res.status(400).json({ error: 'No images' });

  const results = [];
  for (const img of images) {
    try {
      const fname = img.imagePath.replace('/uploads/', '');
      const fullPath = path.join(uploadsDir, fname);
      if (!fs.existsSync(fullPath)) { results.push({ tempId: img.tempId, error: 'Not found' }); continue; }

      const imageData = fs.readFileSync(fullPath).toString('base64');
      const ext = path.extname(fullPath).toLowerCase();
      const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';

      const rec = await ai.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 1500,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageData } },
          { type: 'text', text: `Sports card expert: analyze this card. Return ONLY JSON:
{"player_name":"","team":"","year":null,"sport":"Baseball","brand":"","card_number":"","set_name":"","subset":"","parallel":"","is_rookie":false,"condition_grade":"Near Mint","confidence":"high"}` }
        ]}]
      });

      const t = rec.content.map(b => b.text || '').join('');
      const data = JSON.parse(t.replace(/```json|```/g, '').trim());
      results.push({ tempId: img.tempId, ...data });
    } catch (e) {
      results.push({ tempId: img.tempId, error: e.message, player_name: '', sport: 'Baseball' });
    }
  }
  res.json(results);
});

// --- Value Lookup ---
app.post('/api/lookup', async (req, res) => {
  const ai = getAI();
  if (!ai) return res.status(400).json({ error: 'API key not set' });
  const { player_name, year, brand, set_name, card_number, parallel, sport } = req.body;
  const q = [player_name, year, brand, set_name, card_number ? `#${card_number}` : '', parallel, sport, 'card value'].filter(Boolean).join(' ');

  try {
    const lookup = await ai.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 1200,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: `Search for the current market value of this sports card: ${q}
Check eBay sold listings, PSA, Beckett, COMC, price guides.
Return ONLY JSON: {"estimated_value":0,"value_range_low":0,"value_range_high":0,"recent_sales_summary":"","card_details":"","notable_info":"","sources":""}` }]
    });
    const text = lookup.content.map(b => b.text || '').join('');
    let data;
    try { data = JSON.parse(text.replace(/```json|```/g, '').trim()); }
    catch { const m = text.match(/\{[\s\S]*\}/); data = m ? JSON.parse(m[0]) : { error: 'Parse failed' }; }
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
