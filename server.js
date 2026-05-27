const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const port = process.env.PORT || 3000;

// База данных
const db = new sqlite3.Database('database.db');

// Создаём ВСЕ таблицы
db.serialize(() => {
    // Таблица пользователей
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
    
    // Таблица промокодов
    db.run(`CREATE TABLE IF NOT EXISTS promocodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE,
        reward TEXT,
        max_activations INTEGER,
        current_activations INTEGER DEFAULT 0
    )`);
    
    // Таблица репортов
    db.run(`CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_player_id INTEGER,
        to_player_id INTEGER,
        reason TEXT,
        evidence TEXT,
        status TEXT DEFAULT 'pending'
    )`);
    
    // Таблица ивентов
    db.run(`CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        event_type TEXT,
        end_time DATETIME,
        is_active INTEGER DEFAULT 1
    )`);
    
    // Создаём админа
    db.get(`SELECT * FROM users WHERE login = 'unity'`, (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (login, password, nickname, is_admin) VALUES (?, ?, ?, ?)`, 
                ['unity', 'ALT F4', 'Администратор', 1]);
        }
    });
    
    // Добавляем тестового игрока для отладки
    db.get(`SELECT * FROM users WHERE login = 'test'`, (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (login, password, nickname, coins, total_boxes) VALUES (?, ?, ?, ?, ?)`, 
                ['test', '123', 'Тестер', 500, 10]);
        }
    });
});

app.use(express.static('public'));
app.use(express.json());

// ========== АВТОРИЗАЦИЯ ==========
app.post('/api/register', (req, res) => {
    const { login, password, nickname } = req.body;
    db.run(`INSERT INTO users (login, password, nickname) VALUES (?, ?, ?)`, 
        [login, password, nickname], 
        function(err) {
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
    const id = req.params.id;
    db.get(`SELECT id, login, nickname, coins, total_boxes FROM users WHERE id = ?`, [id], (err, user) => {
        if (!user) return res.json({ error: 'not found' });
        res.json(user);
    });
});

// ========== АДМИН-API ==========
app.get('/api/users', (req, res) => {
    db.all(`SELECT id, login, nickname, coins, total_boxes, is_banned, ban_reason FROM users`, (err, users) => {
        if (err) {
            console.error('Ошибка:', err);
            return res.json([]);
        }
        res.json(users || []);
    });
});

app.post('/api/ban', (req, res) => {
    const { userId, reason } = req.body;
    db.run(`UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?`, [reason, userId]);
    const userSocket = userSockets.get(parseInt(userId));
    if (userSocket) {
        userSocket.emit('session_terminated', { reason: reason });
        userSocket.disconnect(true);
    }
    res.json({ success: true });
});

app.post('/api/unban', (req, res) => {
    const { userId } = req.body;
    db.run(`UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?`, [userId]);
    res.json({ success: true });
});

// Промокоды
app.get('/api/promocodes', (req, res) => {
    db.all(`SELECT * FROM promocodes`, (err, promos) => {
        res.json(promos || []);
    });
});

app.post('/api/create_promo', (req, res) => {
    const { code, reward, max } = req.body;
    db.run(`INSERT INTO promocodes (code, reward, max_activations) VALUES (?, ?, ?)`, [code, reward, max]);
    res.json({ success: true });
});

// Репорты
app.get('/api/reports', (req, res) => {
    db.all(`SELECT r.*, u1.nickname as from_nick, u2.nickname as to_nick 
            FROM reports r 
            LEFT JOIN users u1 ON r.from_player_id = u1.id 
            LEFT JOIN users u2 ON r.to_player_id = u2.id`, (err, reports) => {
        res.json(reports || []);
    });
});

app.post('/api/resolve_report', (req, res) => {
    const { reportId, action } = req.body;
    if (action === 'ban') {
        db.get(`SELECT to_player_id FROM reports WHERE id = ?`, [reportId], (err, report) => {
            if (report) db.run(`UPDATE users SET is_banned = 1 WHERE id = ?`, [report.to_player_id]);
        });
    }
    db.run(`UPDATE reports SET status = 'resolved' WHERE id = ?`, [reportId]);
    res.json({ success: true });
});

// Ивенты
app.get('/api/events', (req, res) => {
    db.all(`SELECT * FROM events WHERE is_active = 1`, (err, events) => {
        res.json(events || []);
    });
});

app.post('/api/create_event', (req, res) => {
    const { name, type, end_time } = req.body;
    db.run(`INSERT INTO events (name, event_type, end_time, is_active) VALUES (?, ?, ?, 1)`, [name, type, end_time]);
    res.json({ success: true });
});

app.post('/api/stop_event', (req, res) => {
    const { eventId } = req.body;
    db.run(`UPDATE events SET is_active = 0 WHERE id = ?`, [eventId]);
    res.json({ success: true });
});

// ========== SOCKET.IO ==========
const userSockets = new Map();

io.on('connection', (socket) => {
    console.log('✅ Подключился:', socket.id);
    
    socket.on('auth', (userId, callback) => {
        const userIdNum = parseInt(userId);
        db.get(`SELECT * FROM users WHERE id = ?`, [userIdNum], (err, user) => {
            if (err || !user) {
                callback({ success: false });
            } else {
                socket.userId = userIdNum;
                socket.isAdmin = user.is_admin === 1;
                userSockets.set(userIdNum, socket);
                callback({ success: true, is_admin: socket.isAdmin });
            }
        });
    });
    
    socket.on('open_box', () => {
        const userId = socket.userId;
        if (!userId) return;
        
        db.get(`SELECT is_banned, ban_reason, coins FROM users WHERE id = ?`, [userId], (err, user) => {
            if (err || !user) return;
            if (user.is_banned) {
                socket.emit('session_terminated', { reason: user.ban_reason || 'Нарушение правил' });
                socket.disconnect(true);
                return;
            }
            
            const rand = Math.random() * 100;
            let rewardName = '';
            let coinsReward = 0;
            
            if (rand < 45) { rewardName = '50 монет'; coinsReward = 50; }
            else if (rand < 70) { rewardName = '100 монет'; coinsReward = 100; }
            else if (rand < 85) { rewardName = '📦 Обычный ящик'; }
            else if (rand < 95) { rewardName = '✨ Редкий ящик ✨'; }
            else { rewardName = '🔥 ЛЕГЕНДАРНЫЙ СКИН! 🔥'; }
            
            db.run(`UPDATE users SET coins = coins + ?, total_boxes = total_boxes + 1 WHERE id = ?`, [coinsReward, userId]);
            socket.emit('box_opened', { name: rewardName, coins: coinsReward });
        });
    });
    
    socket.on('disconnect', () => {
        if (socket.userId) userSockets.delete(socket.userId);
    });
});

server.listen(port, () => {
    console.log(`🚀 Сервер запущен на порту ${port}`);
});
