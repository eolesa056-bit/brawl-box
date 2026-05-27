const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const port = process.env.PORT || 3000;

// Простая защита паролем (только для админки)
const adminPassword = 'admin123';  // Смени на свой пароль!

// Проверка пароля для админки
app.use('/admin.html', (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
        return res.status(401).send('Требуется пароль');
    }
    
    const base64 = authHeader.split(' ')[1];
    const [login, password] = Buffer.from(base64, 'base64').toString().split(':');
    
    if (password !== adminPassword) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
        return res.status(401).send('Неверный пароль');
    }
    next();
});

// База данных
const db = new sqlite3.Database('database.db');

// Создаём таблицы
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS players (
        secret_id TEXT PRIMARY KEY,
        visible_tag TEXT UNIQUE,
        nickname TEXT,
        coins INTEGER DEFAULT 100,
        total_boxes INTEGER DEFAULT 0,
        is_banned INTEGER DEFAULT 0,
        ban_reason TEXT,
        ban_expires_at DATETIME
    )`);
});

// Папка с игрой
app.use(express.static('public'));
app.use(express.json());

// API: получить всех игроков
app.get('/api/players', (req, res) => {
    db.all(`SELECT secret_id, visible_tag, nickname, coins, total_boxes, is_banned FROM players`, (err, players) => {
        if (err) return res.json([]);
        res.json(players);
    });
});

// API: получить игрока
app.get('/api/player/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT * FROM players WHERE secret_id = ?`, [id], (err, player) => {
        if (err || !player) return res.json({ error: 'not found' });
        res.json(player);
    });
});

// API: бан игрока
app.post('/api/ban', (req, res) => {
    const { playerId, reason, hours } = req.body;
    let expiresAt = null;
    if (hours > 0) {
        expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    }
    db.run(`UPDATE players SET is_banned = 1, ban_reason = ?, ban_expires_at = ? WHERE secret_id = ?`,
        [reason, expiresAt, playerId]);
    res.json({ success: true });
});

// API: разбан
app.post('/api/unban', (req, res) => {
    const { playerId } = req.body;
    db.run(`UPDATE players SET is_banned = 0, ban_reason = NULL, ban_expires_at = NULL WHERE secret_id = ?`, [playerId]);
    res.json({ success: true });
});

const playerSockets = new Map();

io.on('connection', (socket) => {
    console.log('✅ Игрок подключился:', socket.id);
    
    socket.on('register', (nickname, callback) => {
        const secretId = 'player_' + Math.random().toString(36).substr(2, 8);
        const visibleTag = '#' + Math.random().toString(36).substr(2, 6).toUpperCase();
        
        db.run(`INSERT INTO players (secret_id, visible_tag, nickname) VALUES (?, ?, ?)`,
            [secretId, visibleTag, nickname],
            function(err) {
                if (err) {
                    callback({ success: false, message: 'Ошибка' });
                } else {
                    socket.playerId = secretId;
                    playerSockets.set(secretId, socket);
                    callback({ success: true, secret_id: secretId, visible_tag: visibleTag });
                }
            });
    });
    
    socket.on('open_box', () => {
        const playerId = socket.playerId;
        if (!playerId) return;
        
        db.get(`SELECT is_banned FROM players WHERE secret_id = ?`, [playerId], (err, player) => {
            if (player && player.is_banned) {
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
            
            db.run(`UPDATE players SET coins = coins + ?, total_boxes = total_boxes + 1 WHERE secret_id = ?`,
                [coinsReward, playerId]);
            
            socket.emit('box_opened', { name: rewardName });
        });
    });
    
    socket.on('disconnect', () => {
        if (socket.playerId) playerSockets.delete(socket.playerId);
        console.log('❌ Игрок отключился:', socket.id);
    });
});

server.listen(port, () => {
    console.log(`🚀 Сервер запущен на порту ${port}`);
});
