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
    db.run(`INSERT INTO promocodes (code, reward, max_activations) VALUES (?, ?, ?)`, [code, reward, max]);
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
