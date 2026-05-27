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
    db.all(`SELECT id, login, nickname, coins, total_boxes, is_banned FROM users`, (err, users) => {
        if (err) return res.json([]);
        res.json(users);
    });
});

// Админ-API: бан
app.post('/api/ban', (req, res) => {
    const { userId, reason, hours } = req.body;
    let expiresAt = null;
    if (hours > 0) {
        expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    }
    db.run(`UPDATE users SET is_banned = 1, ban_reason = ?, ban_expires_at = ? WHERE id = ?`, [reason, expiresAt, userId]);
    res.json({ success: true });
});

// Админ-API: разбан
app.post('/api/unban', (req, res) => {
    const { userId } = req.body;
    db.run(`UPDATE users SET is_banned = 0, ban_reason = NULL, ban_expires_at = NULL WHERE id = ?`, [userId]);
    res.json({ success: true });
});

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
                socket.emit('session_terminated');
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
