const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = process.env.PORT || 3000;

const db = new sqlite3.Database('database.db');

// ========== СОЗДАНИЕ ТАБЛИЦ ==========
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nickname TEXT UNIQUE,
        tag TEXT UNIQUE,
        avatar TEXT DEFAULT '🎮',
        nickname_color TEXT DEFAULT '#ffffff',
        coins INTEGER DEFAULT 100,
        total_boxes INTEGER DEFAULT 0,
        cups INTEGER DEFAULT 0,
        record_cups INTEGER DEFAULT 0,
        next_free_nickname_change DATETIME,
        path_data TEXT DEFAULT '[]',
        is_admin INTEGER DEFAULT 0
    )`);
    
    // Добавляем колонки, если их нет (для старых баз)
    db.run(`ALTER TABLE players ADD COLUMN nickname_color TEXT DEFAULT '#ffffff'`, () => {});
    db.run(`ALTER TABLE players ADD COLUMN record_cups INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE players ADD COLUMN path_data TEXT DEFAULT '[]'`, () => {});
    
    // Админ unity / ALT F4
    db.get(`SELECT * FROM players WHERE nickname = 'unity'`, (err, row) => {
        if (!row) {
            const tag = '#' + Math.random().toString(36).substr(2, 6).toUpperCase();
            db.run(`INSERT INTO players (nickname, tag, is_admin) VALUES (?, ?, ?)`, 
                ['unity', tag, 1]);
        }
    });
});

app.use(express.static('public'));
app.use(express.json());

// ========== API АВТОРИЗАЦИИ И ПРОФИЛЯ ==========
app.post('/api/login', (req, res) => {
    const { nickname, password } = req.body;
    
    db.get(`SELECT * FROM players WHERE nickname = ?`, [nickname], (err, player) => {
        if (player) {
            if (player.is_admin === 1) {
                if (password === 'ALT F4') {
                    res.json({ success: true, player: { id: player.id, nickname: player.nickname, tag: player.tag, avatar: player.avatar, coins: player.coins, total_boxes: player.total_boxes, cups: player.cups, is_admin: true } });
                } else {
                    res.json({ success: false, message: 'Неверный пароль администратора' });
                }
            } else {
                res.json({ success: true, player: { id: player.id, nickname: player.nickname, tag: player.tag, avatar: player.avatar, coins: player.coins, total_boxes: player.total_boxes, cups: player.cups, is_admin: false } });
            }
        } else {
            // Создаём нового игрока
            const tag = '#' + Math.random().toString(36).substr(2, 6).toUpperCase();
            db.run(`INSERT INTO players (nickname, tag) VALUES (?, ?)`, [nickname, tag], function(err) {
                if (err) return res.json({ success: false, message: 'Ошибка создания' });
                db.get(`SELECT * FROM players WHERE id = ?`, [this.lastID], (err, newPlayer) => {
                    res.json({ success: true, player: { id: newPlayer.id, nickname: newPlayer.nickname, tag: newPlayer.tag, avatar: newPlayer.avatar, coins: newPlayer.coins, total_boxes: newPlayer.total_boxes, cups: newPlayer.cups, is_admin: false } });
                });
            });
        }
    });
});

app.get('/api/player/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT id, nickname, tag, avatar, nickname_color, coins, total_boxes, cups, record_cups, path_data FROM players WHERE id = ?`, [id], (err, player) => {
        if (!player) return res.json({ error: 'not found' });
        res.json(player);
    });
});

app.post('/api/change_avatar', (req, res) => {
    const { playerId, avatar } = req.body;
    db.run(`UPDATE players SET avatar = ? WHERE id = ?`, [avatar, playerId]);
    res.json({ success: true });
});

app.post('/api/change_nickname', (req, res) => {
    const { playerId, newNickname, color } = req.body;
    
    // Если передан ТОЛЬКО цвет (newNickname отсутствует)
    if (!newNickname || newNickname.trim() === '') {
        db.run(`UPDATE players SET nickname_color = ? WHERE id = ?`, [color, playerId]);
        return res.json({ success: true, message: 'Цвет обновлён' });
    }
    
    // Иначе — меняем и ник, и цвет (с кулдауном 24 часа)
    db.get(`SELECT next_free_nickname_change FROM players WHERE id = ?`, [playerId], (err, player) => {
        const now = new Date();
        if (player && player.next_free_nickname_change && new Date(player.next_free_nickname_change) > now) {
            return res.json({ success: false, message: 'Сменить ник можно раз в 24 часа' });
        }
        
        db.get(`SELECT id FROM players WHERE nickname = ? AND id != ?`, [newNickname, playerId], (err, existing) => {
            if (existing) return res.json({ success: false, message: 'Никнейм уже занят' });
            
            const nextFree = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            db.run(`UPDATE players SET nickname = ?, nickname_color = ?, next_free_nickname_change = ? WHERE id = ?`, [newNickname, color, nextFree.toISOString(), playerId]);
            res.json({ success: true, next_free_change: nextFree.toISOString() });
        });
    });
});

// ========== ИГРОВАЯ МЕХАНИКА ==========
app.get('/api/open_box/:playerId', (req, res) => {
    const playerId = req.params.playerId;
    
    const rand = Math.random() * 100;
    let reward = '';
    let coinsGain = 0;
    let cupsGain = 0;
    
    if (rand < 50) { reward = '50 монет'; coinsGain = 50; }
    else if (rand < 75) { reward = '100 монет'; coinsGain = 100; }
    else if (rand < 90) { reward = 'Обычный ящик'; cupsGain = 5; }
    else { reward = 'РЕДКИЙ СКИН!'; cupsGain = 20; }
    
    db.run(`UPDATE players SET coins = coins + ?, total_boxes = total_boxes + 1, cups = cups + ? WHERE id = ?`, [coinsGain, cupsGain, playerId]);
    
    // Обновляем рекорд, если нужно
    db.get(`SELECT cups, record_cups FROM players WHERE id = ?`, [playerId], (err, player) => {
        if (player && player.cups > player.record_cups) {
            db.run(`UPDATE players SET record_cups = ? WHERE id = ?`, [player.cups, playerId]);
        }
    });
    
    db.get(`SELECT coins, total_boxes, cups FROM players WHERE id = ?`, [playerId], (err, player) => {
        res.json({ success: true, reward: reward, coins: player.coins, total_boxes: player.total_boxes, cups: player.cups });
    });
});

// ========== ПУТЬ К СЛАВЕ (НАГРАДЫ) ==========
app.post('/api/save_path', (req, res) => {
    const { playerId, pathData } = req.body;
    db.run(`UPDATE players SET path_data = ? WHERE id = ?`, [JSON.stringify(pathData), playerId]);
    res.json({ success: true });
});

app.post('/api/add_coins', (req, res) => {
    const { playerId, coins } = req.body;
    db.run(`UPDATE players SET coins = coins + ? WHERE id = ?`, [coins, playerId]);
    res.json({ success: true });
});

app.post('/api/add_box', (req, res) => {
    const { playerId } = req.body;
    db.run(`UPDATE players SET total_boxes = total_boxes + 1 WHERE id = ?`, [playerId]);
    res.json({ success: true });
});

app.post('/api/add_skin', (req, res) => {
    // Здесь можно добавить логику выдачи скина в отдельную таблицу
    res.json({ success: true });
});

app.listen(port, () => console.log(`🚀 Сервер на порту ${port}`));
