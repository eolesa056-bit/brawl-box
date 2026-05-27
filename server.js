const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const port = process.env.PORT || 3000;
const db = new sqlite3.Database('database.db');

// Таблица игроков
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT UNIQUE,
        password TEXT,
        nickname TEXT,
        coins INTEGER DEFAULT 100,
        total_boxes INTEGER DEFAULT 0,
        is_admin INTEGER DEFAULT 0
    )`);
    
    // Создаём админа (только для будущего)
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
    db.run(`INSERT INTO users (login, password, nickname) VALUES (?, ?, ?)`, [login, password, nickname], function(err) {
        if (err) return res.json({ success: false, message: 'Логин занят' });
        res.json({ success: true });
    });
});

// Вход
app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    db.get(`SELECT * FROM users WHERE login = ? AND password = ?`, [login, password], (err, user) => {
        if (!user) return res.json({ success: false, message: 'Неверный логин или пароль' });
        res.json({ success: true, user: { id: user.id, nickname: user.nickname, is_admin: user.is_admin } });
    });
});

// Получить данные игрока
app.get('/api/user/:id', (req, res) => {
    db.get(`SELECT id, nickname, coins, total_boxes FROM users WHERE id = ?`, [req.params.id], (err, user) => {
        if (!user) return res.json({ error: 'not found' });
        res.json(user);
    });
});

// Сокеты
io.on('connection', (socket) => {
    socket.on('auth', (userId, callback) => {
        db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
            if (!user) return callback({ success: false });
            socket.userId = userId;
            callback({ success: true });
        });
    });
    
    socket.on('open_box', () => {
        const uid = socket.userId;
        if (!uid) return;
        
        const rand = Math.random() * 100;
        let reward = '';
        let coinsGain = 0;
        
        if (rand < 50) { reward = '50 монет'; coinsGain = 50; }
        else if (rand < 75) { reward = '100 монет'; coinsGain = 100; }
        else if (rand < 90) { reward = 'Обычный ящик'; }
        else { reward = 'РЕДКИЙ СКИН!'; }
        
        db.run(`UPDATE users SET coins = coins + ?, total_boxes = total_boxes + 1 WHERE id = ?`, [coinsGain, uid]);
        socket.emit('box_opened', { name: reward });
    });
});

server.listen(port, () => console.log(`🚀 Сервер на порту ${port}`));
