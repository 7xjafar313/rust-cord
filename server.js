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

let localDb = {
    users: [],
    messages: [],
    passwordRequests: []
};

// Track voice channel members
let voiceRooms = {
    "waiting-room": [] // { userId, username, avatar }
};

// --- TELEGRAM SYNC FUNCTIONS ---

// تحميل قاعدة البيانات من تيليجرام عند التشغيل
async function loadDbFromTelegram() {
    try {
        console.log('🔄 محاولة تحميل قاعدة البيانات من تيليجرام...');
        // تحقق أولاً من وجود ملف محلي
        if (fs.existsSync(DB_FILE_PATH)) {
            const fileData = JSON.parse(fs.readFileSync(DB_FILE_PATH));
            if (fileData && Array.isArray(fileData.users)) {
                localDb = fileData;
                console.log('✅ تم تحميل قاعدة البيانات من الملف المحلي.');
            }
        }

        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`;
        const response = await axios.get(url);
        const updates = response.data.result;

        if (!updates || updates.length === 0) {
            console.log('ℹ️ لم يتم العثور على تحديثات جديدة في تيليجرام.');
            return;
        }

        const docUpdates = updates.filter(u => u.message && u.message.document && u.message.document.file_name === 'db_backup.json');

        if (docUpdates.length > 0) {
            const lastUpdate = docUpdates[docUpdates.length - 1];
            const fileId = lastUpdate.message.document.file_id;

            const fileUrlResponse = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
            const filePath = fileUrlResponse.data.result.file_path;
            const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;

            const fileContent = await axios.get(downloadUrl);
            const downloadedData = typeof fileContent.data === 'string' ? JSON.parse(fileContent.data) : fileContent.data;

            if (downloadedData && Array.isArray(downloadedData.users)) {
                // ندمج البيانات المحلية مع بيانات تيليجرام أو نستبدلها؟ 
                // سنعتبر تيليجرام هو الأحدث إذا كان هناك فرق
                localDb = downloadedData;
                fs.writeFileSync(DB_FILE_PATH, JSON.stringify(localDb, null, 2));
                console.log('✅ تم تحديث القاعدة من تيليجرام بنجاح.');
            }
        }
    } catch (error) {
        console.error('⚠️ تحذير في مزامنة تيليجرام:', error.message);
        console.log('ℹ️ سيتم الاستمرار باستخدام القاعدة المحلية.');
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
app.use(express.static(path.join(__dirname, 'public')));

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
            isVerified: false,
            createdAt: new Date()
        };

        localDb.users.push(newUser);
        await saveAndSyncDb(); // الانتظار لضمان المزامنة

        const token = jwt.sign({ id: newUser._id, role: newUser.role, username: newUser.username }, JWT_SECRET);
        res.json({ success: true, token, user: { username: newUser.username, role: newUser.role } });
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
        res.json({ token, user: { username: user.username, role: user.role, isVerified: user.isVerified } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SETTINGS & ADMIN MANAGEMENT ---

app.post('/api/update-profile', async (req, res) => {
    try {
        const { token, newUsername, oldPassword, newPassword } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = localDb.users.find(u => u._id === decoded.id);

        if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

        // If password is being changed
        if (newPassword) {
            const isMatch = await bcrypt.compare(oldPassword, user.password);
            if (!isMatch) return res.status(401).json({ error: 'كلمة المرور القديمة غير صحيحة' });
            user.password = await bcrypt.hash(newPassword, 10);
        }

        if (newUsername) {
            // Check if username already exists
            const exists = localDb.users.find(u => u.username === newUsername && u._id !== user._id);
            if (exists) return res.status(400).json({ error: 'اسم المستخدم مأخوذ بالفعل' });
            user.username = newUsername;
        }

        await saveAndSyncDb();
        res.json({ success: true, user: { username: user.username, role: user.role } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/request-password-reset', async (req, res) => {
    try {
        const { token } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = localDb.users.find(u => u._id === decoded.id);

        if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

        // Add to requests if not already there
        const exists = localDb.passwordRequests.find(r => r.userId === user._id);
        if (!exists) {
            localDb.passwordRequests.push({
                userId: user._id,
                username: user.username,
                timestamp: new Date()
            });
            await saveAndSyncDb();
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin endpoint to get requests
app.post('/api/admin/get-requests', async (req, res) => {
    try {
        const { token } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin' && decoded.role !== 'assistant') return res.status(403).json({ error: 'غير مصرح لك' });

        res.json({ requests: localDb.passwordRequests });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin endpoint to resolve request (reset password)
app.post('/api/admin/resolve-request', async (req, res) => {
    try {
        const { token, targetUserId, newPassword, action } = req.body; // action: 'approve' or 'reject'
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin' && decoded.role !== 'assistant') return res.status(403).json({ error: 'غير مصرح لك' });

        if (action === 'approve') {
            const user = localDb.users.find(u => u._id === targetUserId);
            if (user) {
                user.password = await bcrypt.hash(newPassword, 10);
            }
        }

        localDb.passwordRequests = localDb.passwordRequests.filter(r => r.userId !== targetUserId);
        await saveAndSyncDb();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin endpoint to verify/unverify user
app.post('/api/admin/verify-user', async (req, res) => {
    try {
        const { token, targetUserId, verify } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin' && decoded.role !== 'assistant') return res.status(403).json({ error: 'غير مصرح لك' });

        const user = localDb.users.find(u => u._id === targetUserId);
        if (user) {
            user.isVerified = verify;
            await saveAndSyncDb();
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'المستخدم غير موجود' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
        const user = localDb.users.find(u => u.username === socket.user.username);
        const msg = {
            _id: Date.now().toString(),
            author: socket.user.username,
            role: socket.user.role,
            isVerified: user ? user.isVerified : false,
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
        if (socket.user.role === 'admin' || socket.user.role === 'assistant') {
            localDb.messages = localDb.messages.filter(m => m._id !== messageId);
            io.emit('message_deleted', messageId);
            saveAndSyncDb();
        }
    });

    // --- VOICE CHANNELS ---
    socket.on('join_voice', (roomId) => {
        // Leave previous rooms
        Object.keys(voiceRooms).forEach(id => {
            voiceRooms[id] = voiceRooms[id].filter(u => u.userId !== socket.user.id);
        });

        if (!voiceRooms[roomId]) voiceRooms[roomId] = [];

        const user = localDb.users.find(u => u._id === socket.user.id);
        voiceRooms[roomId].push({
            userId: socket.user.id,
            socketId: socket.id,
            username: socket.user.username,
            role: socket.user.role,
            isVerified: user ? user.isVerified : false,
            isMuted: false,
            isDeafened: false
        });

        io.emit('voice_state_update', voiceRooms);
    });

    socket.on('leave_voice', () => {
        Object.keys(voiceRooms).forEach(id => {
            voiceRooms[id] = voiceRooms[id].filter(u => u.userId !== socket.user.id);
        });
        io.emit('voice_state_update', voiceRooms);
    });

    socket.on('disconnect', () => {
        Object.keys(voiceRooms).forEach(id => {
            voiceRooms[id] = voiceRooms[id].filter(u => u.userId !== socket.user.id);
        });
        io.emit('voice_state_update', voiceRooms);
    });

    socket.on('move_user_voice', (data) => {
        if (socket.user.role === 'admin' || socket.user.role === 'assistant') {
            const { targetSocketId, targetRoomId } = data;
            io.to(targetSocketId).emit('force_move_voice', { targetRoomId });
        }
    });

    socket.on('kick_user_voice', (data) => {
        if (socket.user.role === 'admin' || socket.user.role === 'assistant') {
            io.to(data.targetSocketId).emit('force_kick_voice');
        }
    });

    socket.on('force_mute_user_voice', (data) => {
        if (socket.user.role === 'admin' || socket.user.role === 'assistant') {
            io.to(data.targetSocketId).emit('force_mute_voice');
        }
    });

    socket.on('mute_all_voice', (data) => {
        if (socket.user.role === 'admin' || socket.user.role === 'assistant') {
            const { roomId } = data;
            // Emit to everyone in the room except the admin/assistant
            socket.to(roomId).emit('force_mute_voice');
        }
    });

    // --- WEBRTC SIGNALING ---
    socket.on('voice_signal', (data) => {
        // Relay signal from sender to specific recipient
        io.to(data.to).emit('voice_signal', {
            signal: data.signal,
            from: socket.id,
            username: socket.user.username
        });
    });

    socket.on('voice_ice_candidate', (data) => {
        io.to(data.to).emit('voice_ice_candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    // Send initial voice state
    socket.emit('voice_state_update', voiceRooms);
});

// تشغيل النظام
loadDbFromTelegram().then(async () => {
    // التأكد من وجود حساب الأدمن الرئيسي
    const adminUser = localDb.users.find(u => u.username === 'sww');
    if (!adminUser) {
        console.log('🚀 إنشاء حساب المدير الرئيسي (sww)...');
        const hashedPassword = await bcrypt.hash('mmkkll00998877', 10);
        localDb.users.push({
            _id: Date.now().toString(),
            username: 'sww',
            password: hashedPassword,
            role: 'admin',
            email: 'admin@rustcord.com',
            createdAt: new Date()
        });
        await saveAndSyncDb();
        console.log('✅ تم إنشاء حساب المدير بنجاح.');
    }

    server.listen(PORT, '0.0.0.0', async () => {
        console.log(`Rust Cord running with Telegram Database on port ${PORT}`);

        // إرسال إشعار تشغيل النظام لتيليجرام
        try {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                chat_id: TELEGRAM_CHAT_ID,
                text: `🚀 تم تشغيل خادم راست كورد بنجاح!\n⏰ الوقت: ${new Date().toLocaleString('ar-EG')}\n👤 حالة المدير: متصل`
            });
            console.log('✅ تم إرسال إشعار التشغيل لتيليجرام.');
        } catch (e) {
            console.error('❌ فشل إرسال إشعار التشغيل لتيليجرام:', e.message);
        }
    });
});
