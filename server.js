const express = require('express');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const db = new Database('pastes.db');

db.prepare(`
    CREATE TABLE IF NOT EXISTS pastes (
        id TEXT PRIMARY KEY,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        is_burn INTEGER DEFAULT 0
    )
`).run();

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 10,
    message: { error: "Too many pastes! Slow down for 15 minutes." }
});

app.use(express.json());
app.use(express.static('public'));

setInterval(() => {
    const deleted = db.prepare("DELETE FROM pastes WHERE expires_at < datetime('now')").run();
    if (deleted.changes > 0) console.log(`[Cleanup] Deleted ${deleted.changes} expired pastes.`);
}, 600000);

app.get('/api', (req, res) => res.sendFile(path.join(__dirname, 'public/api.html')));
app.get('/changelog', (req, res) => res.sendFile(path.join(__dirname, 'public/changelog.html')));

app.post('/api/save', limiter, (req, res) => {
    const { content, expiry, isBurned } = req.body;

    if (!content || content.length < 1) return res.status(400).json({ error: "Empty paste!" });
    if (content.length > 100000) return res.status(400).json({ error: "Paste too large (Max 100k chars)." });

    let hours = 168; // Default 7 days
    if (expiry === '1h') hours = 1;
    if (expiry === '1d') hours = 24;

    const id = nanoid(6);
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

    try {
        const insert = db.prepare('INSERT INTO pastes (id, content, expires_at, is_burn) VALUES (?, ?, ?, ?)');
        insert.run(id, content, expiresAt, isBurned ? 1 : 0);
        res.json({ id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error." });
    }
});

app.get('/v/:id', (req, res) => {
    const paste = db.prepare('SELECT id FROM pastes WHERE id = ?').get(req.params.id);
    if (paste) res.sendFile(path.join(__dirname, 'public/view.html'));
    else res.status(404).send("Paste not found or already deleted.");
});

app.get('/api/paste/:id', (req, res) => {
    const paste = db.prepare('SELECT * FROM pastes WHERE id = ?').get(req.params.id);
    
    if (!paste) return res.json({ error: "Not found" });

    if (paste.is_burn === 1) {
        db.prepare('DELETE FROM pastes WHERE id = ?').run(req.params.id);
        console.log(`[Burn] Paste ${req.params.id} destroyed.`);
    }

    res.json({ 
        content: paste.content, 
        burned: paste.is_burn === 1,
        language: paste.language || 'javascript' 
    });
});

app.listen(3000, () => console.log('NullPaste Engine live at http://localhost:3000'));