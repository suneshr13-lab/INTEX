/*
Sikkim Tourism - Backend (server.js)

This single-file backend uses Node + Express + SQLite (sqlite3). It:
- serves a simple REST API for destinations, bookings and contact messages
- initializes an SQLite database file `sikkim.db` on first run
- optionally serves the static frontend if placed in a `public/` folder or if you point PUBLIC_DIR env
- protects admin endpoints using a simple ADMIN_TOKEN env variable

Files included (this single file contains all server code). Create package.json shown below and then run `npm install`.

--- package.json (copy into a separate file) ---
{
  "name": "sikkim-backend",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "body-parser": "^1.20.2",
    "cors": "^2.8.5",
    "dotenv": "^16.0.3",
    "express": "^4.18.2",
    "sqlite3": "^5.1.6"
  }
}
--- end package.json ---

--- .env example (create .env file) ---
# PORT the server listens on
PORT=4000
# simple admin token for protected endpoints (change for production)
ADMIN_TOKEN=change-me-to-a-secure-token
# optional path to serve static frontend files (relative or absolute)
PUBLIC_DIR=./sikkim-tourism-website
--- end .env ---

USAGE:
1) create package.json with the snippet above
2) npm install
3) create .env file and set ADMIN_TOKEN
4) node server.js

The server will create sikkim.db and seed some destinations. Admin endpoints require X-ADMIN-TOKEN header to equal ADMIN_TOKEN value.

*/

const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const PORT = process.env.PORT || 4000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me-to-a-secure-token';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'sikkim.db');
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'sikkim-tourism-website');

// Helper to require admin token
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.admin_token;
  if (!token || token !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// create DB if not exists and initialize tables + seed
function initDb(callback) {
  const dbExists = fs.existsSync(DB_PATH);
  const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) throw err;
  });

  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS destinations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      summary TEXT,
      details TEXT,
      region TEXT,
      image TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      destination_id INTEGER,
      guests INTEGER DEFAULT 1,
      start_date TEXT,
      end_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(destination_id) REFERENCES destinations(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT,
      message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Seed destinations only if newly created or empty
    db.get('SELECT COUNT(*) as cnt FROM destinations', (err, row) => {
      if (err) throw err;
      if (!row || row.cnt === 0) {
        const seed = [
          ['Tsomgo Lake','A stunning glacial lake near Gangtok','Tsomgo (Changu) Lake is a glacial lake situated at 3,753 m. Visitors enjoy yak rides and the lake's turquoise waters.','East Sikkim','/images/tsomgo.jpg'],
          ['Nathula Pass','High altitude pass on India-China border','Nathula is a historic mountain pass on the Indo-China border; permits may be required.','East Sikkim','/images/nathula.jpg'],
          ['Yuksom','Gateway to Kanchenjunga treks','Yuksom is a historic town and starting point for treks to Kanchenjunga.','West Sikkim','/images/yuksom.jpg']
        ];
        const stmt = db.prepare('INSERT INTO destinations(name,summary,details,region,image) VALUES (?,?,?,?,?)');
        for (const d of seed) stmt.run(d);
        stmt.finalize();
        console.log('Seeded destinations');
      }
      if (callback) callback(db);
    });
  });
}

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// serve frontend static if folder exists
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  console.log('Serving static files from', PUBLIC_DIR);
} else {
  console.log('Public directory not found at', PUBLIC_DIR);
}

// API: GET /api/destinations
app.get('/api/destinations', (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  db.all('SELECT * FROM destinations ORDER BY id', (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: 'db error', details: err.message });
    res.json({ data: rows });
  });
});

// API: GET /api/destinations/:id
app.get('/api/destinations/:id', (req, res) => {
  const id = req.params.id;
  const db = new sqlite3.Database(DB_PATH);
  db.get('SELECT * FROM destinations WHERE id=?', [id], (err, row) => {
    db.close();
    if (err) return res.status(500).json({ error: 'db error' });
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json({ data: row });
  });
});

// API: POST /api/bookings  - create a booking
app.post('/api/bookings', (req, res) => {
  const { name, email, phone, destination_id, guests, start_date, end_date, notes } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
  const db = new sqlite3.Database(DB_PATH);
  const stmt = db.prepare(`INSERT INTO bookings(name,email,phone,destination_id,guests,start_date,end_date,notes) VALUES (?,?,?,?,?,?,?,?)`);
  stmt.run([name,email,phone || null,destination_id || null,guests || 1,start_date || null,end_date || null,notes || null], function(err) {
    if (err) return res.status(500).json({ error: 'db error', details: err.message });
    const id = this.lastID;
    db.get('SELECT * FROM bookings WHERE id=?', [id], (err,row) => {
      db.close();
      res.status(201).json({ data: row });
    });
  });
});

// API: GET /api/bookings - admin only
app.get('/api/bookings', requireAdmin, (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  db.all('SELECT b.*, d.name as destination_name FROM bookings b LEFT JOIN destinations d ON b.destination_id = d.id ORDER BY b.created_at DESC', (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: 'db error' });
    res.json({ data: rows });
  });
});

// API: POST /api/contact - store contact messages
app.post('/api/contact', (req, res) => {
  const { name, email, message } = req.body;
  if (!email || !message) return res.status(400).json({ error: 'email and message required' });
  const db = new sqlite3.Database(DB_PATH);
  const stmt = db.prepare('INSERT INTO contacts(name,email,message) VALUES (?,?,?)');
  stmt.run([name || null,email,message], function(err) {
    if (err) return res.status(500).json({ error: 'db error', details: err.message });
    db.get('SELECT * FROM contacts WHERE id=?', [this.lastID], (err,row) => {
      db.close();
      res.status(201).json({ data: row });
    });
  });
});

// Admin: GET /api/contacts
app.get('/api/contacts', requireAdmin, (req, res) => {
  const db = new sqlite3.Database(DB_PATH);
  db.all('SELECT * FROM contacts ORDER BY created_at DESC', (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: 'db error' });
    res.json({ data: rows });
  });
});

// Admin: add destination (protected)
app.post('/api/destinations', requireAdmin, (req, res) => {
  const { name, summary, details, region, image } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = new sqlite3.Database(DB_PATH);
  const stmt = db.prepare('INSERT INTO destinations(name,summary,details,region,image) VALUES (?,?,?,?,?)');
  stmt.run([name,summary||null,details||null,region||null,image||null], function(err) {
    if (err) return res.status(500).json({ error: 'db error', details: err.message });
    db.get('SELECT * FROM destinations WHERE id=?', [this.lastID], (err,row) => {
      db.close();
      res.status(201).json({ data: row });
    });
  });
});

// Admin: delete booking by id
app.delete('/api/bookings/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const db = new sqlite3.Database(DB_PATH);
  db.run('DELETE FROM bookings WHERE id=?', [id], function(err) {
    db.close();
    if (err) return res.status(500).json({ error: 'db error' });
    if (this.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ success: true });
  });
});

// health
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// fallback to index.html for SPA routes if public dir exists
if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  app.get('*', (req, res) => {
    const p = path.join(PUBLIC_DIR, 'index.html');
    res.sendFile(p);
  });
}

// start server after DB init
initDb(() => {
  app.listen(PORT, () => {
    console.log(`Sikkim backend listening on http://localhost:${PORT}`);
    console.log('Use X-ADMIN-TOKEN header to access admin endpoints');
  });
});
