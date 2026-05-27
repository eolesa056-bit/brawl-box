const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Простая заглушка
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Brawl Box</title></head>
        <body style="background:#1a1a2e; color:white; text-align:center; padding:50px;">
            <h1>🎁 Brawl Box Simulator</h1>
            <p>Сервер работает!</p>
            <button onclick="alert('Игра скоро будет готова!')">Открыть ящик</button>
        </body>
        </html>
    `);
});

app.listen(port, () => {
    console.log(`✅ Сервер запущен на порту ${port}`);
});
