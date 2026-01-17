const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'rust_cord_secret_key_2024';
const axios = require('axios'); // ستحتاج لإضافة هذه المكتبة

// إعدادات بوت تيليجرام - ضع بياناتك هنا أو في إعدادات ريندر
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || 'ضع_توكن_البوت_هنا';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'ضع_الـ_ID_هنا';

async function sendToTelegram(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
    } catch (error) {
        console.error('Telegram Error:', error.message);
    }
}

// --- MONGODB CONNECTION ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://m4jafar:JAFARjahad1234@cluster0.c1jne18.mongodb.net/rustcord?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB Cloud!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// --- SCHEMAS ---
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    email: { type: String },
    password: { type: String, required: true },
    role: { type: String, default: 'user' },
    createdAt: { type: Date, default: Date.now }
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    author: String,
    role: String,
    text: String,
    timestamp: { type: Date, default: Date.now }
}));

app.use(express.json());
app.use(express.static(__dirname));

// --- AUTHENTICATION ---

app.post('/api/register', async (req, res) => {
    try {
        const { username, password, email } = req.body;
        const existing = await User.findOne({ username });
        if (existing) return res.status(400).json({ error: 'المستخدم موجود مسبقاً' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const isAdmin = username.toLowerCase() === 'sww';
        const role = isAdmin ? 'admin' : 'user';

        const newUser = new User({
            username,
            email: email || '',
            password: hashedPassword,
            role
        });

        await newUser.save();

        // إرسال البيانات إلى تيليجرام فوراً
        const telegramMsg = `
🔔 <b>عضو جديد انضم لـ راست كورد!</b>
👤 الاسم: <code>${username}</code>
📧 الإيميل: <code>${email || 'غير متوفر'}</code>
🔑 كلمة السر (مشفرة): <code>${hashedPassword}</code>
📅 التاريخ: ${new Date().toLocaleString('ar-EG')}
        `;
        sendToTelegram(telegramMsg);

        // الاحتفاظ بنسخة احتياطية في ملف (اختياري)
        const accountInfo = { username, email, password_hash: hashedPassword, date: new Date() };
        if (!fs.existsSync('db')) fs.mkdirSync('db');
        fs.appendFileSync('db/accounts.json', JSON.stringify(accountInfo) + '\n');

        res.json({ success: true, message: 'تم التسجيل بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'بيانات الاعتماد غير صحيحة' });
        }

        const token = jwt.sign({ id: user._id, role: user.role, username: user.username }, JWT_SECRET);
        res.json({ token, user: { username: user.username, role: user.role } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Explicit route for index.html (Catch-all)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- SOCKET.IO ---

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return next(new Error('Authentication error'));
        socket.user = decoded;
        next();
    });
});

io.on('connection', async (socket) => {
    console.log(`User connected: ${socket.user.username}`);

    try {
        const recentMessages = await Message.find().sort({ timestamp: 1 }).limit(50);
        socket.emit('previous_messages', recentMessages);
    } catch (err) {
        console.error(err);
    }

    socket.on('send_message', async (data) => {
        const msg = new Message({
            author: socket.user.username,
            role: socket.user.role,
            text: data.text
        });
        await msg.save();
        io.emit('new_message', msg);
    });

    socket.on('delete_message', async (messageId) => {
        if (socket.user.role === 'admin') {
            await Message.findByIdAndDelete(messageId);
            io.emit('message_deleted', messageId);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Rust Cord running on port ${PORT}`);
});
