# 🃏 Card Vault — Sports Card Collection Manager

A local web app for managing your baseball, football, and basketball card collection. Runs on your computer, stores everything locally, and uses AI to recognize cards from photos.

---

## 🚀 Quick Start (5 minutes)

### Step 1: Install Node.js
Download and install Node.js from: https://nodejs.org
(Click the big green "LTS" button, run the installer, click Next through everything)

### Step 2: Open Terminal / Command Prompt
- **Windows**: Press `Win + R`, type `cmd`, press Enter
- **Mac**: Open "Terminal" from Applications → Utilities

### Step 3: Navigate to this folder
```bash
cd path/to/card-vault
```
For example, if you put it on your Desktop:
- **Windows**: `cd Desktop\card-vault`
- **Mac**: `cd ~/Desktop/card-vault`

### Step 4: Install dependencies (one time only)
```bash
npm install
```

### Step 5: Start the app
```bash
npm start
```

### Step 6: Open in your browser
Go to: **http://localhost:3000**

That's it! The app is running. Keep the terminal window open while using it.

---

## 📷 Setting Up AI Card Recognition

The AI features (auto-recognizing cards from photos, looking up values) need an Anthropic API key.

1. Go to https://console.anthropic.com and create an account
2. Go to API Keys and create a new key
3. In Card Vault, click the **⋯** menu → **Settings**
4. Paste your API key and click Save

Without an API key, you can still:
- Add cards manually
- Upload photos
- Search, filter, and organize
- Export to CSV

The AI features just won't work until you add a key.

---

## 📋 Features

### Collection Management
- Add cards with full details: player, team, year, brand, card #, set, subset, parallel
- Condition grading (Gem Mint through Poor)
- PSA/BGS grade tracking
- Purchase price and estimated value
- Duplicate / trade bait flagging
- Wishlist for cards you want

### 📷 Card Scanner
- Use your webcam or phone camera to photograph cards
- Upload photos from your computer
- **Bulk Mode**: Scan multiple cards in a row, then batch-process

### 🤖 AI Card Recognition
- Snap a photo → AI identifies the player, team, year, brand, card number, set, parallel
- Searches online databases for current market values
- Checks eBay sold listings, Beckett, PSA, and price guides

### 🔍 Value Lookup
- Search any card's current market value
- Works from the card detail view or the add/edit form
- Pulls from real online sources

### 📊 Stats Dashboard
- Total cards and estimated collection value
- Breakdown by sport and brand
- Top 10 most valuable cards
- Graded card count

### 📥 CSV Export
- Export your entire collection to a spreadsheet
- Opens in Excel, Google Sheets, or any spreadsheet app
- Includes all fields: player, team, year, brand, card #, set, condition, value, etc.

---

## 💾 Your Data

Everything is stored locally on your computer:
- **Database**: `card_vault.db` (SQLite file in this folder)
- **Card photos**: `uploads/` folder
- **Nothing is sent to the cloud** (except AI recognition requests if you use that feature)

To back up your collection, just copy the `card_vault.db` file and the `uploads/` folder.

---

## 🛠 Troubleshooting

**"npm not found"**
→ Node.js isn't installed. Download it from https://nodejs.org

**"sharp" install error on Windows**
→ Run: `npm install --ignore-scripts` then `npm start`

**Camera not working**
→ Make sure you're using Chrome or Edge. Allow camera permissions when prompted.
→ You can always upload photos instead.

**AI recognition not working**
→ Check your API key in Settings. Make sure it starts with `sk-ant-`.

**Port 3000 already in use**
→ Run with a different port: `PORT=3001 npm start`

---

## 📱 Using on Your Phone

Once the app is running on your computer, you can access it from your phone too:

1. Find your computer's IP address:
   - **Windows**: Open Command Prompt, type `ipconfig`, look for "IPv4 Address"
   - **Mac**: System Preferences → Network → look for your IP
2. On your phone's browser, go to: `http://YOUR_IP:3000`
3. Now you can use your phone's camera to scan cards!

---

Made with ❤️ for card collectors everywhere.
