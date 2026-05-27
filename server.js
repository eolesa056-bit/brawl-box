const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const port = process.env.PORT || 3000;
const db = new sqlite3.Database('database.db');

// Создаём таблицы
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT UNIQUE,
        password TEXT,
        nickname TEXT,
        coins INTEGER DEFAULT 100,
        total_boxes INTEGER DEFAULT 0,
        is_banned INTEGER DEFAULT 0,
        ban_reason TEXT,
        is_admin INTEGER DEFAULT 0
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS promocodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE,
        reward TEXT,
        max_activations INTEGER,
        current_activations INTEGER DEFAULT 0
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_player_id INTEGER,
        to_player_id INTEGER,
        reason TEXT,
        evidence TEXT,
        status TEXT DEFAULT 'pending'
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        event_type TEXT,
        end_time DATETIME,
        is_active INTEGER DEFAULT 1
    )`);
    
    // Админ по умолчанию
    db.get(`SELECT * FROM users WHERE login = 'unity'`, (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (login, password, nickname, is_admin) VALUES (?, ?, ?, ?)`, 
                ['unity', 'ALT F4', 'Администратор', 1]);
        }
    });
});

app.use(express.static('public'));
app.use(express.json());

// ========== API ==========
app.post('/api/register', (req, res) => {
    const { login, password, nickname } = req.body;
    db.run(`INSERT INTO users (login, password, nickname) VALUES (?, ?, ?)`, [login, password, nickname], function(err) {
        if (err) return res.json({ success: false, message: 'Логин занят' });
        res.json({ success: true });
    });
});

app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    db.get(`SELECT * FROM users WHERE login = ? AND password = ?`, [login, password], (err, user) => {
        if (!user) return res.json({ success: false, message: 'Неверный логин или пароль' });
        res.json({ success: true, user: { id: user.id, login: user.login, nickname: user.nickname, is_admin: user.is_admin } });
    });
});

app.get('/api/user/:id', (req, res) => {
    db.get(`SELECT id, login, nickname, coins, total_boxes FROM users WHERE id = ?`, [req.params.id], (err, user) => {
        if (!user) return res.json({ error: 'not found' });
        res.json(user);
    });
});

app.get('/api/users', (req, res) => {
    db.all(`SELECT id, login, nickname, coins, total_boxes, is_banned, ban_reason FROM users`, (err, users) => {
        res.json(users || []);
    });
});

app.post('/api/ban', (req, res) => {
    const { userId, reason } = req.body;
    db.run(`UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?`, [reason, userId]);
    const sock = userSockets.get(parseInt(userId));
    if (sock) { sock.emit('session_terminated', { reason }); sock.disconnect(true); }
    res.json({ success: true });
});

app.post('/api/unban', (req, res) => {
    db.run(`UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?`, [req.body.userId]);
    res.json({ success: true });
});

app.get('/api/promocodes', (req, res) => {
    db.all(`SELECT * FROM promocodes`, (err, rows) => res.json(rows || []));
});

app.post('/api/create_promo', (req, res) => {
    const { code, reward, max } = req.body;
    db.run(`INSERT INTO promocodes (code, reward, max_activations) VALUES (?, ?, ?)`, [code, reward, max]);
    res.json({ success: true });
});

app.get('/api/reports', (req, res) => {
    db.all(`SELECT r.*, u1.nickname as from_nick, u2.nickname as to_nick 
            FROM reports r LEFT JOIN users u1 ON r.from_player_id = u1.id LEFT JOIN users u2 ON r.to_player_id = u2.id`, (err, rows) => res.json(rows || []));
});

app.post('/api/resolve_report', (req, res) => {
    const { reportId, action } = req.body;
    if (action === 'ban') {
        db.get(`SELECT to_player_id FROM reports WHERE id = ?`, [reportId], (err, rep) => {
            if (rep) db.run(`UPDATE users SET is_banned = 1 WHERE id = ?`, [rep.to_player_id]);
        });
    }
    db.run(`UPDATE reports SET status = 'resolved' WHERE id = ?`, [reportId]);
    res.json({ success: true });
});

app.get('/api/events', (req, res) => {
    db.all(`SELECT * FROM events WHERE is_active = 1`, (err, rows) => res.json(rows || []));
});

app.post('/api/create_event', (req, res) => {
    const { name, type, end_time } = req.body;
    db.run(`INSERT INTO events (name, event_type, end_time, is_active) VALUES (?, ?, ?, 1)`, [name, type, end_time]);
    res.json({ success: true });
});

app.post('/api/stop_event', (req, res) => {
    db.run(`UPDATE events SET is_active = 0 WHERE id = ?`, [req.body.eventId]);
    res.json({ success: true });
});

// ========== SOCKETS ==========
const userSockets = new Map();
io.on('connection', (socket) => {
    socket.on('auth', (userId, callback) => {
        const uid = parseInt(userId);
        db.get(`SELECT * FROM users WHERE id = ?`, [uid], (err, user) => {
            if (!user) return callback({ success: false });
            socket.userId = uid;
            userSockets.set(uid, socket);
            callback({ success: true, is_admin: user.is_admin === 1 });
        });
    });
    
    socket.on('open_box', () => {
        const uid = socket.userId;
        if (!uid) return;
        db.get(`SELECT is_banned, ban_reason FROM users WHERE id = ?`, [uid], (err, user) => {
            if (user?.is_banned) {
                socket.emit('session_terminated', { reason: user.ban_reason || 'Нарушение' });
                socket.disconnect(true);
                return;
            }
            const r = Math.random() * 100;
            let reward = '', coinsGain = 0;
            if (r < 45) { reward = '50 монет'; coinsGain = 50; }
            else if (r < 70) { reward = '100 монет'; coinsGain = 100; }
            else if (r < 85) { reward = '📦 Обычный ящик'; }
            else if (r < 95) { reward = '✨ Редкий ящик ✨'; }
            else { reward = '🔥 ЛЕГЕНДАРНЫЙ СКИН! 🔥'; }
            db.run(`UPDATE users SET coins = coins + ?, total_boxes = total_boxes + 1 WHERE id = ?`, [coinsGain, uid]);
            socket.emit('box_opened', { name: reward });
        });
    });
});

server.listen(port, () => console.log(`🚀 Сервер на порту ${port}`));
