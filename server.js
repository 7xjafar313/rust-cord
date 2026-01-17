const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'rust_cord_secret_key_2024';

// --- TELEGRAM DATABASE CONFIG ---
// ضع التوكن والايدي الخاص بك هنا
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '6780979570:AAEpS358Uxk_FuegiXu80-ElfxnVFE_AQrU';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1680454327';

const DB_FILE_PATH = path.join(__dirname, 'db_backup.json');

// بيانات افتراضية للقاعدة
let localDb = {
    users: [],
    messages: []
};

// --- TELEGRAM SYNC FUNCTIONS ---

// تحميل قاعدة البيانات من تيليجرام عند التشغيل
async function loadDbFromTelegram() {
    try {
        console.log('🔄 محاولة تحميل قاعدة البيانات من تيليجرام...');
        // سنبحث عن آخر ملف أرسله البوت في المحادثة
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`;
        const response = await axios.get(url);
        const updates = response.data.result;

        // نبحث عن آخر رسالة تحتوي على مستند (Document)
        const docUpdates = updates.filter(u => u.message && u.message.document && u.message.document.file_name === 'db_backup.json');

        if (docUpdates.length > 0) {
            const lastUpdate = docUpdates[docUpdates.length - 1];
            const fileId = lastUpdate.message.document.file_id;

            // الحصول على رابط الملف
            const fileUrlResponse = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
            const filePath = fileUrlResponse.data.result.file_path;
            const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;

            const fileContent = await axios.get(downloadUrl);
            localDb = fileContent.data;
            fs.writeFileSync(DB_FILE_PATH, JSON.stringify(localDb, null, 2));
            console.log('✅ تم استرجاع قاعدة البيانات بنجاح من تيليجرام.');
        } else {
            console.log('ℹ️ لم يتم العثور على ملف قاعدة بيانات سابق في تيليجرام. سيتم بدء قاعدة جديدة.');
            if (fs.existsSync(DB_FILE_PATH)) {
                localDb = JSON.parse(fs.readFileSync(DB_FILE_PATH));
            }
        }
    } catch (error) {
        console.error('❌ خطأ في تحميل القاعدة من تيليجرام:', error.message);
        if (fs.existsSync(DB_FILE_PATH)) {
            localDb = JSON.parse(fs.readFileSync(DB_FILE_PATH));
            console.log('⚠️ تم استخدام النسخة المحلية المؤقتة.');
        }
    }
}

// حفظ قاعدة البيانات وإرسالها لتيليجرام
async function saveAndSyncDb() {
    try {
        const dataStr = JSON.stringify(localDb, null, 2);
        fs.writeFileSync(DB_FILE_PATH, dataStr);

        const form = new FormData();
        form.append('chat_id', TELEGRAM_CHAT_ID);
        form.append('document', fs.createReadStream(DB_FILE_PATH), 'db_backup.json');
        form.append('caption', `🔄 تحديث قاعدة البيانات - ${new Date().toLocaleString('ar-EG')}`);

        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, form, {
            headers: form.getHeaders()
        });
        console.log('☁️ تم رفع نسخة المزامنة إلى تيليجرام.');
    } catch (error) {
        console.error('❌ خطأ في مزامنة تيليجرام:', error.message);
    }
}

app.use(express.json());
app.use(express.static(__dirname));

// --- AUTHENTICATION ---

app.post('/api/register', async (req, res) => {
    try {
        const { username, password, email } = req.body;

        if (localDb.users.find(u => u.username === username)) {
            return res.status(400).json({ error: 'المستخدم موجود مسبقاً' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const isAdmin = username.toLowerCase() === 'sww';
        const role = isAdmin ? 'admin' : 'user';

        const newUser = {
            _id: Date.now().toString(),
            username,
            email: email || '',
            password: hashedPassword,
            role,
            createdAt: new Date()
        };

        localDb.users.push(newUser);
        saveAndSyncDb(); // مزامنة فورية

        res.json({ success: true, message: 'تم التسجيل بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = localDb.users.find(u => u.username === username);

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'بيانات الاعتماد غير صحيحة' });
        }

        const token = jwt.sign({ id: user._id, role: user.role, username: user.username }, JWT_SECRET);
        res.json({ token, user: { username: user.username, role: user.role } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
    // إرسال آخر 50 رسالة من الذاكرة
    const recentMessages = localDb.messages.slice(-50);
    socket.emit('previous_messages', recentMessages);

    socket.on('send_message', (data) => {
        const msg = {
            _id: Date.now().toString(),
            author: socket.user.username,
            role: socket.user.role,
            text: data.text,
            timestamp: new Date()
        };
        localDb.messages.push(msg);

        // تقليص حجم المصفوفة لتجنب تضخم الملف جداً (اختياري)
        if (localDb.messages.length > 1000) localDb.messages.shift();

        io.emit('new_message', msg);
        saveAndSyncDb(); // حفظ الرسائل أيضاً
    });

    socket.on('delete_message', (messageId) => {
        if (socket.user.role === 'admin') {
            localDb.messages = localDb.messages.filter(m => m._id !== messageId);
            io.emit('message_deleted', messageId);
            saveAndSyncDb();
        }
    });
});

// تشغيل النظام
loadDbFromTelegram().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Rust Cord running with Telegram Database on port ${PORT}`);
    });
});
