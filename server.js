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
        ban_expires_at DATETIME,
        is_admin INTEGER DEFAULT 0
    )`);
    
    // Создаём админа, если его нет
    db.get(`SELECT * FROM users WHERE login = 'unity'`, (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (login, password, nickname, is_admin) VALUES (?, ?, ?, ?)`, 
                ['unity', 'ALT F4', 'Администратор', 1]);
        }
    });
});

app.use(express.static('public'));
app.use(express.json());

// Регистрация
app.post('/api/register', (req, res) => {
    const { login, password, nickname } = req.body;
    db.run(`INSERT INTO users (login, password, nickname) VALUES (?, ?, ?)`, 
        [login, password, nickname], 
        function(err) {
            if (err) return res.json({ success: false, message: 'Логин занят' });
            res.json({ success: true });
        });
});

// Вход
app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    db.get(`SELECT * FROM users WHERE login = ? AND password = ?`, [login, password], (err, user) => {
        if (!user) return res.json({ success: false, message: 'Неверный логин или пароль' });
        res.json({ success: true, user: { id: user.id, login: user.login, nickname: user.nickname, is_admin: user.is_admin } });
    });
});

// Получить игрока
app.get('/api/user/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT id, login, nickname, coins, total_boxes FROM users WHERE id = ?`, [id], (err, user) => {
        if (!user) return res.json({ error: 'not found' });
        res.json(user);
    });
});

// Админ-API: получить всех игроков
app.get('/api/users', (req, res) => {
    db.all(`SELECT id, login, nickname, coins, total_boxes, is_banned, ban_reason FROM users`, (err, users) => {
        if (err) return res.json([]);
        res.json(users);
    });
});

// Админ-API: бан (МГНОВЕННЫЙ, с причиной)
app.post('/api/ban', (req, res) => {
    const { userId, reason } = req.body;
    db.run(`UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?`, [reason, userId]);
    
    // Мгновенный кик забаненного игрока с указанием причины
    const userSocket = userSockets.get(userId);
    if (userSocket) {
        userSocket.emit('session_terminated', { reason: reason });
        userSocket.disconnect(true);
    }
    res.json({ success: true });
});

// Админ-API: разбан
app.post('/api/unban', (req, res) => {
    const { userId } = req.body;
    db.run(`UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?`, [userId]);
    res.json({ success: true });
});

// ========== ДОПОЛНИТЕЛЬНЫЕ АДМИН-API ==========

// Получить все промокоды
app.get('/api/promocodes', (req, res) => {
    db.all(`SELECT * FROM promocodes`, (err, promos) => {
        if (err) return res.json([]);
        res.json(promos);
    });
});

// Создать промокод
app.post('/api/create_promo', (req, res) => {
    const { code, reward, max } = req.body;
    db.run(`INSERT INTO promocodes (code, reward, max_activations, current_activations) VALUES (?, ?, ?, 0)`, [code, reward, max]);
    res.json({ success: true });
});

// Получить репорты
app.get('/api/reports', (req, res) => {
    db.all(`SELECT r.*, u1.nickname as from_nick, u2.nickname as to_nick FROM reports r 
            JOIN users u1 ON r.from_player_id = u1.id 
            JOIN users u2 ON r.to_player_id = u2.id`, (err, reports) => {
        if (err) return res.json([]);
        res.json(reports);
    });
});

// Разрешить репорт
app.post('/api/resolve_report', (req, res) => {
    const { reportId, action } = req.body;
    if (action === 'ban') {
        db.get(`SELECT to_player_id FROM reports WHERE id = ?`, [reportId], (err, report) => {
            if (report) {
                db.run(`UPDATE users SET is_banned = 1 WHERE id = ?`, [report.to_player_id]);
            }
        });
    }
    db.run(`UPDATE reports SET status = 'resolved' WHERE id = ?`, [reportId]);
    res.json({ success: true });
});

// Получить ивенты
app.get('/api/events', (req, res) => {
    db.all(`SELECT * FROM events WHERE is_active = 1`, (err, events) => {
        if (err) return res.json([]);
        res.json(events);
    });
});

// Создать ивент
app.post('/api/create_event', (req, res) => {
    const { name, type, end_time } = req.body;
    db.run(`INSERT INTO events (name, event_type, end_time, is_active) VALUES (?, ?, ?, 1)`, [name, type, end_time]);
    res.json({ success: true });
});

// Остановить ивент
app.post('/api/stop_event', (req, res) => {
    const { eventId } = req.body;
    db.run(`UPDATE events SET is_active = 0 WHERE id = ?`, [eventId]);
    res.json({ success: true });
});

// Хранилище сокетов
const userSockets = new Map();

io.on('connection', (socket) => {
    console.log('✅ Подключился:', socket.id);
    
    socket.on('auth', (userId, callback) => {
        db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
            if (err || !user) {
                callback({ success: false });
            } else {
                socket.userId = userId;
                socket.isAdmin = user.is_admin === 1;
                userSockets.set(userId, socket);
                callback({ success: true, is_admin: socket.isAdmin });
            }
        });
    });
    
    socket.on('open_box', () => {
        const userId = socket.userId;
        if (!userId) return;
        
        db.get(`SELECT is_banned FROM users WHERE id = ?`, [userId], (err, user) => {
            if (user && user.is_banned) {
                socket.emit('session_terminated', { reason: user.ban_reason || 'Нарушение правил' });
                socket.disconnect(true);
                return;
            }
            
            const rand = Math.random() * 100;
            let rewardName = '';
            let coinsReward = 0;
            
            if (rand < 50) {
                rewardName = '50 монет';
                coinsReward = 50;
            } else if (rand < 75) {
                rewardName = '100 монет';
                coinsReward = 100;
            } else if (rand < 90) {
                rewardName = 'Обычный ящик';
            } else {
                rewardName = 'РЕДКИЙ СКИН!';
            }
            
            db.run(`UPDATE users SET coins = coins + ?, total_boxes = total_boxes + 1 WHERE id = ?`, [coinsReward, userId]);
            socket.emit('box_opened', { name: rewardName });
        });
    });
    
    socket.on('disconnect', () => {
        if (socket.userId) userSockets.delete(socket.userId);
        console.log('❌ Отключился:', socket.id);
    });
});

server.listen(port, () => {
    console.log(`🚀 Сервер запущен на порту ${port}`);
});
