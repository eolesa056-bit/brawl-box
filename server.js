const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = process.env.PORT || 3000;

const db = new sqlite3.Database('database.db');

// Таблица игроков
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nickname TEXT UNIQUE,
        coins INTEGER DEFAULT 100,
        total_boxes INTEGER DEFAULT 0,
        is_admin INTEGER DEFAULT 0
    )`);
});

app.use(express.static('public'));
app.use(express.json());

// Проверка существования ника
app.post('/api/check_nickname', (req, res) => {
    const { nickname } = req.body;
    db.get(`SELECT * FROM players WHERE nickname = ?`, [nickname], (err, player) => {
        if (player) {
            res.json({ exists: true, is_admin: player.is_admin === 1 });
        } else {
            res.json({ exists: false });
        }
    });
});

// Вход/регистрация
app.post('/api/login', (req, res) => {
    const { nickname, password } = req.body;
    
    db.get(`SELECT * FROM players WHERE nickname = ?`, [nickname], (err, player) => {
        if (player) {
            // Админ проверяет пароль
            if (player.is_admin === 1) {
                if (password === 'ALT F4') {
                    res.json({ success: true, player: { id: player.id, nickname: player.nickname, coins: player.coins, total_boxes: player.total_boxes, is_admin: true } });
                } else {
                    res.json({ success: false, message: 'Неверный пароль администратора' });
                }
            } else {
                // Обычный игрок — просто входим
                res.json({ success: true, player: { id: player.id, nickname: player.nickname, coins: player.coins, total_boxes: player.total_boxes, is_admin: false } });
            }
        } else {
            // Создаём нового игрока
            db.run(`INSERT INTO players (nickname) VALUES (?)`, [nickname], function(err) {
                if (err) return res.json({ success: false, message: 'Ошибка создания' });
                res.json({ success: true, player: { id: this.lastID, nickname: nickname, coins: 100, total_boxes: 0, is_admin: false } });
            });
        }
    });
});

// Открыть ящик
app.get('/api/open_box/:playerId', (req, res) => {
    const playerId = req.params.playerId;
    
    const rand = Math.random() * 100;
    let reward = '';
    let coinsGain = 0;
    
    if (rand < 50) { reward = '50 монет'; coinsGain = 50; }
    else if (rand < 75) { reward = '100 монет'; coinsGain = 100; }
    else if (rand < 90) { reward = 'Обычный ящик'; }
    else { reward = 'РЕДКИЙ СКИН!'; }
    
    db.run(`UPDATE players SET coins = coins + ?, total_boxes = total_boxes + 1 WHERE id = ?`, [coinsGain, playerId]);
    
    db.get(`SELECT coins, total_boxes FROM players WHERE id = ?`, [playerId], (err, player) => {
        res.json({ success: true, reward: reward, coins: player.coins, total_boxes: player.total_boxes });
    });
});

app.listen(port, () => console.log(`🚀 Сервер на порту ${port}`));
