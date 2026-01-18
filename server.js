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
    passwordRequests: [],
    bans: [],
    directMessages: [],
    roles: [
        { name: 'Admin', color: '#de4b39', permissions: ['all'] },
        { name: 'Member', color: '#b9bbbe', permissions: [] }
    ],
    auditLogs: [],
    servers: [],
    serverRequests: []
};

// Track voice channel members
let voiceRooms = {
    "waiting-room": [] // { userId, username, avatar }
};

// --- YOUTUBE SEARCH HELPER ---
async function searchYouTube(query) {
    try {
        const res = await axios.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });
        const html = res.data;
        // Improved regex to find videoId in various YouTube response formats
        const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
        if (match) return match[1];
        const backupMatch = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
        if (backupMatch) return backupMatch[1];
    } catch (e) { console.error("YT Search Error:", e); }
    return null;
}

// --- TELEGRAM SYNC FUNCTIONS ---

// تحميل قاعدة البيانات من تيليجرام عند التشغيل
async function loadDbFromTelegram() {
    try {
        console.log('🔄 محاولة تحميل قاعدة البيانات من تيليجرام...');
        // تحقق أولاً من وجود ملف محلي
        if (fs.existsSync(DB_FILE_PATH)) {
            try {
                const fileData = JSON.parse(fs.readFileSync(DB_FILE_PATH));
                if (fileData && Array.isArray(fileData.users)) {
                    localDb = {
                        users: fileData.users || [],
                        messages: fileData.messages || [],
                        passwordRequests: fileData.passwordRequests || [],
                        bans: fileData.bans || [],
                        directMessages: fileData.directMessages || [],
                        roles: fileData.roles || [
                            { name: 'Admin', color: '#de4b39', permissions: ['all'] },
                            { name: 'Member', color: '#b9bbbe', permissions: [] }
                        ],
                        auditLogs: fileData.auditLogs || [],
                        servers: fileData.servers || [],
                        serverRequests: fileData.serverRequests || []
                    };
                    console.log('✅ تم تحميل قاعدة البيانات من الملف المحلي.');
                }
            } catch (err) {
                console.error('⚠️ خطأ في قراءة ملف القاعدة المحلي، سيتم البدء من جديد:', err.message);
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
                localDb = {
                    users: downloadedData.users || [],
                    messages: downloadedData.messages || [],
                    passwordRequests: downloadedData.passwordRequests || [],
                    bans: downloadedData.bans || [],
                    directMessages: downloadedData.directMessages || [],
                    roles: downloadedData.roles || [
                        { name: 'Admin', color: '#de4b39', permissions: ['all'] },
                        { name: 'Member', color: '#b9bbbe', permissions: [] }
                    ],
                    auditLogs: downloadedData.auditLogs || [],
                    servers: downloadedData.servers || [],
                    serverRequests: downloadedData.serverRequests || []
                };
                fs.writeFileSync(DB_FILE_PATH, JSON.stringify(localDb, null, 2));
                console.log('✅ تم تحديث القاعدة من تيليجرام بنجاح.');
            }
        }
    } catch (error) {
        console.error('⚠️ تحذير في مزامنة تيليجرام:', error.message);
        console.log('ℹ️ سيتم الاستمرار باستخدام القاعدة المحلية.');
        // Ensure auditLogs exists if file loading partially failed or it's a new file
        if (!localDb.auditLogs) localDb.auditLogs = [];
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

function logAudit(userId, username, action, details) {
    localDb.auditLogs.push({
        userId,
        username,
        action,
        details,
        timestamp: new Date()
    });
    // Keep only last 200 logs
    if (localDb.auditLogs.length > 200) localDb.auditLogs.shift();
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
            avatar: '',
            status: 'online',
            customStatus: '',
            xp: 0,
            level: 1,
            lastXpGain: 0,
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

        if (user && localDb.bans.find(b => b.userId === user._id)) {
            return res.status(403).json({ error: 'لقد تم حظرك من هذا السيرفر' });
        }

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'بيانات الاعتماد غير صحيحة' });
        }

        const token = jwt.sign({ id: user._id, role: user.role, username: user.username }, JWT_SECRET);
        res.json({
            token, user: {
                username: user.username,
                role: user.role,
                isVerified: user.isVerified,
                avatar: user.avatar,
                level: user.level,
                xp: user.xp
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SETTINGS & ADMIN MANAGEMENT ---

app.post('/api/update-profile', async (req, res) => {
    try {
        const { token, newUsername, oldPassword, newPassword, newAvatar, newStatus, newCustomStatus } = req.body;
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

        if (newAvatar !== undefined) {
            user.avatar = newAvatar;
        }

        if (newStatus) user.status = newStatus;
        if (newCustomStatus !== undefined) user.customStatus = newCustomStatus;

        await saveAndSyncDb();
        res.json({ success: true, user: { username: user.username, role: user.role, avatar: user.avatar, status: user.status, customStatus: user.customStatus } });
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
            logAudit(decoded.id, decoded.username, verify ? 'توثيق حساب' : 'إلغاء توثيق', `المستهدف: ${user.username}`);
            await saveAndSyncDb();
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'المستخدم غير موجود' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin endpoint to ban user
app.post('/api/admin/ban-user', async (req, res) => {
    try {
        const { token, targetUserId, reason } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin' && decoded.role !== 'assistant') return res.status(403).json({ error: 'غير مصرح لك' });

        const user = localDb.users.find(u => u._id === targetUserId);
        if (user) {
            if (!localDb.bans.find(b => b.userId === targetUserId)) {
                localDb.bans.push({ userId: targetUserId, username: user.username, reason: reason || 'لا يوجد سبب' });
                logAudit(decoded.id, decoded.username, 'حظر مستخدم', `المستهدف: ${user.username} | السبب: ${reason}`);
                await saveAndSyncDb();
            }
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'المستخدم غير موجود' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Role Management Endpoints
app.post('/api/admin/create-role', async (req, res) => {
    try {
        const { token, name, color } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).json({ error: 'للمدير العام فقط' });

        localDb.roles.push({ name, color, permissions: [] });
        await saveAndSyncDb();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/delete-role', async (req, res) => {
    try {
        const { token, name } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).json({ error: 'للمدير العام فقط' });

        localDb.roles = localDb.roles.filter(r => r.name !== name);
        // Also remove the role from users who have it
        localDb.users.forEach(u => {
            if (u.customRole === name) u.customRole = null;
        });

        await saveAndSyncDb();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/assign-role', async (req, res) => {
    try {
        const { token, targetUserId, roleName } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin' && decoded.role !== 'assistant') return res.status(403).json({ error: 'غير مصرح لك' });

        const user = localDb.users.find(u => u._id === targetUserId);
        if (user) {
            user.customRole = roleName;
            await saveAndSyncDb();
            res.json({ success: true });
        } else res.status(404).json({ error: 'المستخدم غير موجود' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/get-all-roles', (req, res) => {
    res.json({ roles: localDb.roles });
});

app.post('/api/admin/get-audit-logs', (req, res) => {
    try {
        const { token } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin' && decoded.role !== 'assistant') return res.status(403).json({ error: 'غير مصرح' });
        res.json({ logs: localDb.auditLogs.slice().reverse() });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
    // إرسالة قائمة الأعضاء المتصلين لجميع المستخدمين
    const broadcastOnlineUsers = () => {
        const connectedSids = new Set();
        for (const [id, s] of io.sockets.sockets) {
            if (s.user) connectedSids.add(s.user.id);
        }

        const allUsers = localDb.users.map(userData => ({
            id: userData._id,
            username: userData.username,
            avatar: userData.avatar,
            status: connectedSids.has(userData._id) ? (userData.status || 'online') : 'offline',
            customStatus: userData.customStatus,
            role: userData.role,
            isVerified: userData.isVerified,
            level: userData.level
        }));

        io.emit('update_members_list', allUsers);
    };

    broadcastOnlineUsers();

    // إرسال قائمة السيرفرات الخاصة بالمستخدم فور الاتصال
    const sendMyServers = () => {
        const myServers = localDb.servers.filter(s =>
            s.ownerId === 'system' ||
            s.ownerId === socket.user.id ||
            s.members.includes(socket.user.id)
        );
        socket.emit('my_servers_list', myServers);
    };
    sendMyServers();

    // إرسال آخر 50 رسالة من السيرفر الحالي (الافتراضي: العالمي)

    socket.on('get_previous_messages', (data) => {
        const serverId = data ? data.serverId : 'global-server';
        const msgs = localDb.messages.filter(m => m.serverId === serverId).slice(-100);
        socket.emit('previous_messages', msgs);
    });

    socket.on('send_message', (data) => {
        const user = localDb.users.find(u => u.username === socket.user.username);
        let customRoleColor = '';
        let customRoleName = '';

        if (user && user.customRole) {
            const role = localDb.roles.find(r => r.name === user.customRole);
            if (role) {
                customRoleColor = role.color;
                customRoleName = role.name;
            }
        }

        // --- LEVEL SYSTEM ---
        const now = Date.now();
        let levelUp = false;
        if (user) {
            if ((now - (user.lastXpGain || 0)) > 30000) { // 30s cooldown
                user.xp = (user.xp || 0) + Math.floor(Math.random() * 10) + 15;
                user.lastXpGain = now;
                const nextLevelXp = (user.level || 1) * 100;
                if (user.xp >= nextLevelXp) {
                    user.level = (user.level || 1) + 1;
                    user.xp -= nextLevelXp;
                    levelUp = true;
                }
            }
        }

        const msg = {
            _id: Date.now().toString(),
            author: socket.user.username,
            role: socket.user.role,
            customRoleName,
            customRoleColor,
            isVerified: user ? user.isVerified : false,
            avatar: user ? user.avatar : '',
            level: user ? user.level : 1,
            text: data.text,
            file: data.file,
            fileName: data.fileName,
            fileType: data.fileType,
            replyTo: data.replyTo || null, // { id, author, text }
            reactions: {}, // { emoji: [usernames] }
            serverId: data.serverId || 'global-server',
            timestamp: new Date()
        };
        localDb.messages.push(msg);

        // تقليص حجم المصفوفة لتجنب تضخم الملف جداً (اختياري)
        if (localDb.messages.length > 1000) localDb.messages.shift();

        io.emit('new_message', msg);
        if (levelUp) {
            io.emit('level_up', { username: user.username, level: user.level });
        }
        saveAndSyncDb(); // حفظ الرسائل أيضاً

        // --- BOT COMMANDS (#شغل) ---
        if (data.text && data.text.startsWith('#شغل')) {
            const query = data.text.replace('#شغل', '').trim();
            if (query) {
                (async () => {
                    console.log(`🔍 Bot Searching for: ${query}`);
                    let videoId = null;
                    if (query.includes('youtube.com/watch?v=')) {
                        videoId = query.split('v=')[1].split('&')[0];
                    } else if (query.includes('youtu.be/')) {
                        videoId = query.split('youtu.be/')[1].split('?')[0];
                    } else {
                        videoId = await searchYouTube(query);
                    }

                    if (videoId) {
                        console.log(`✅ Found Video ID: ${videoId}`);
                        // Find user's room to "join" it
                        let userRoomId = null;
                        Object.keys(voiceRooms).forEach(rid => {
                            if (voiceRooms[rid].find(u => u.socketId === socket.id)) userRoomId = rid;
                        });

                        if (userRoomId) {
                            console.log(`🤖 Bot joining voice room: ${userRoomId}`);
                            // Remove bot from any other room first
                            Object.keys(voiceRooms).forEach(rid => {
                                voiceRooms[rid] = voiceRooms[rid].filter(u => u.userId !== 'bot-id');
                            });
                            // Add bot to the room
                            voiceRooms[userRoomId].push({
                                userId: 'bot-id',
                                socketId: 'bot-socket',
                                username: 'راست بوت 🤖',
                                role: 'admin',
                                isVerified: true,
                                avatar: 'logo.png', // Or a bot icon
                                status: 'online',
                                customStatus: '🎶 يستمع للموسيقى',
                                isMuted: false,
                                isDeafened: false
                            });
                            io.emit('voice_state_update', voiceRooms);
                        }

                        const botMsg = {
                            _id: 'bot-' + Date.now(),
                            author: 'راست بوت 🤖',
                            role: 'admin',
                            text: `🎶 جاري تشغيل: ${query}`,
                            serverId: data.serverId || 'global-server',
                            timestamp: new Date()
                        };
                        io.emit('new_message', botMsg);
                        io.emit('play_youtube', { videoId, title: query });
                        logAudit('system', 'Bot', 'تشغيل يوتيوب', query);
                    } else {
                        console.log(`❌ No Video ID found for: ${query}`);
                        const errorMsg = {
                            _id: 'bot-' + Date.now(),
                            author: 'راست بوت 🤖',
                            role: 'admin',
                            text: `❌ عذراً، لم أجد نتائج لـ: ${query}`,
                            serverId: data.serverId || 'global-server',
                            timestamp: new Date()
                        };
                        io.emit('new_message', errorMsg);
                    }
                })();
            }
        } else if (data.text && data.text.startsWith('#ايقاف')) {
            // Remove bot from voice rooms
            Object.keys(voiceRooms).forEach(rid => {
                voiceRooms[rid] = voiceRooms[rid].filter(u => u.userId !== 'bot-id');
            });
            io.emit('voice_state_update', voiceRooms);

            const botMsg = {
                _id: 'bot-' + Date.now(),
                author: 'راست بوت 🤖',
                role: 'admin',
                text: `🛑 تم إيقاف التشغيل بواسطة ${socket.user.username}`,
                serverId: data.serverId || 'global-server',
                timestamp: new Date()
            };
            io.emit('new_message', botMsg);
            io.emit('stop_music');
        }
    });

    socket.on('delete_message', (messageId) => {
        if (socket.user.role === 'admin' || socket.user.role === 'assistant') {
            localDb.messages = localDb.messages.filter(m => m._id !== messageId);
            io.emit('message_deleted', messageId);
            saveAndSyncDb();
        }
    });

    socket.on('add_reaction', (data) => {
        const { messageId, emoji } = data;
        const msg = localDb.messages.find(m => m._id === messageId);
        if (msg) {
            if (!msg.reactions) msg.reactions = {};
            if (!msg.reactions[emoji]) msg.reactions[emoji] = [];

            const username = socket.user.username;
            if (!msg.reactions[emoji].includes(username)) {
                msg.reactions[emoji].push(username);
            } else {
                // Remove if already reacted
                msg.reactions[emoji] = msg.reactions[emoji].filter(u => u !== username);
                if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
            }

            io.emit('update_reactions', { messageId, reactions: msg.reactions });
            saveAndSyncDb();
        }
    });

    socket.on('clear_chat', (data) => {
        if (socket.user.role === 'admin' || socket.user.role === 'assistant') {
            const serverId = data.serverId || 'global-server';
            localDb.messages = localDb.messages.filter(m => m.serverId !== serverId);
            io.emit('chat_cleared', { serverId });
            saveAndSyncDb();
            logAudit(socket.user.id, socket.user.username, 'مسح المحادثة', `تم مسح جميع الرسائل في سيرفر: ${serverId}`);
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
            avatar: user ? user.avatar : '',
            status: user ? user.status : 'online',
            customStatus: user ? user.customStatus : '',
            isMuted: false,
            isDeafened: false
        });

        io.emit('voice_state_update', voiceRooms);
    });

    socket.on('update_status', (data) => {
        const user = localDb.users.find(u => u._id === socket.user.id);
        if (user) {
            user.status = data.status || user.status;
            user.customStatus = data.customStatus !== undefined ? data.customStatus : user.customStatus;

            // Sync status with voice rooms if user is in one
            Object.keys(voiceRooms).forEach(roomId => {
                const member = voiceRooms[roomId].find(u => u.userId === socket.user.id);
                if (member) {
                    member.status = user.status;
                    member.customStatus = user.customStatus;
                }
            });

            io.emit('voice_state_update', voiceRooms);
            broadcastOnlineUsers();
            saveAndSyncDb();
        }
    });

    socket.on('get_online_users', () => {
        broadcastOnlineUsers();
    });

    socket.on('update_voice_status', (data) => {
        Object.keys(voiceRooms).forEach(roomId => {
            const member = voiceRooms[roomId].find(u => u.socketId === socket.id);
            if (member) {
                member.isMuted = data.isMuted;
                member.isDeafened = data.isDeafened;
            }
        });
        io.emit('voice_state_update', voiceRooms);
    });

    socket.on('screen_signal', (data) => {
        io.to(data.to).emit('screen_signal', {
            signal: data.signal,
            from: socket.id
        });
    });

    socket.on('screen_ice_candidate', (data) => {
        io.to(data.to).emit('screen_ice_candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    socket.on('update_voice_status', (data) => {
        Object.keys(voiceRooms).forEach(roomId => {
            const member = voiceRooms[roomId].find(u => u.socketId === socket.id);
            if (member) {
                member.isMuted = data.isMuted;
                member.isDeafened = data.isDeafened;
                console.log(`🎙️ User ${member.username} logic: Muted=${member.isMuted}, Deafened=${member.isDeafened}`);
            }
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
        broadcastOnlineUsers();
    });

    // --- DIRECT MESSAGES ---
    socket.on('send_dm', (data) => {
        const { to, text, file, fileName, fileType } = data;
        const msg = {
            from: socket.user.username,
            to,
            text,
            file,
            fileName,
            fileType,
            timestamp: new Date()
        };
        localDb.directMessages.push(msg);

        // Find recipient socket
        const recipientSocket = Array.from(io.sockets.sockets.values()).find(s => s.user && s.user.username === to);
        if (recipientSocket) {
            recipientSocket.emit('new_dm', msg);
        }
        socket.emit('new_dm', msg); // Send back to sender
        saveAndSyncDb();
    });

    socket.on('get_dms_with', (targetUsername) => {
        const dms = localDb.directMessages.filter(m =>
            (m.from === socket.user.username && m.to === targetUsername) ||
            (m.from === targetUsername && m.to === socket.user.username)
        );
        socket.emit('previous_dms', dms);
    });

    socket.on('typing', (data) => {
        socket.broadcast.emit('user_typing', { username: socket.user.username, isTyping: data.isTyping });
    });

    // --- MUSIC BOT ---
    socket.on('play_music_req', (data) => {
        if (socket.user.role === 'admin' || socket.user.role === 'assistant') {
            io.emit('play_music', { url: data.url });
            logAudit(socket.user.id, socket.user.username, 'تشغيل موسيقى', `الرابط: ${data.url}`);
        }
    });

    socket.on('stop_music_req', () => {
        if (socket.user.role === 'admin' || socket.user.role === 'assistant') {
            io.emit('stop_music');
            logAudit(socket.user.id, socket.user.username, 'إيقاف الموسيقى', 'تم إيقاف البث الصوتي');
        }
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
            io.to(data.targetSocketId).emit('force_mute_voice', { action: 'mute' });
        }
    });

    socket.on('force_unmute_user_voice', (data) => {
        if (socket.user.role === 'admin' || socket.user.role === 'assistant') {
            io.to(data.targetSocketId).emit('force_mute_voice', { action: 'unmute' });
        }
    });

    socket.on('mute_all_voice', (data) => {
        if (socket.user.role === 'admin' || socket.user.role === 'assistant') {
            const { roomId } = data;
            // Emit to everyone in the room except the admin/assistant
            socket.to(roomId).emit('force_mute_voice');
        }
    });

    // --- SERVER MANAGEMENT ---
    socket.on('request_server', (data) => {
        const { serverName } = data;
        const request = {
            _id: Date.now().toString(),
            userId: socket.user.id,
            username: socket.user.username,
            serverName,
            status: 'pending',
            timestamp: new Date()
        };
        localDb.serverRequests.push(request);
        saveAndSyncDb();

        // Notify admins/assistants
        io.emit('new_server_request', request);
        logAudit(socket.user.id, socket.user.username, 'طلب إنشاء سيرفر', `اسم السيرفر: ${serverName}`);
    });

    socket.on('get_server_requests', () => {
        if (socket.user.role === 'admin' || socket.user.role === 'assistant') {
            socket.emit('server_requests_list', localDb.serverRequests);
        }
    });

    socket.on('resolve_server_request', (data) => {
        if (socket.user.role === 'admin' || socket.user.role === 'assistant') {
            const { requestId, action } = data;
            const request = localDb.serverRequests.find(r => r._id === requestId);

            if (request) {
                request.status = action === 'approve' ? 'approved' : 'rejected';

                if (action === 'approve') {
                    const newServer = {
                        _id: Date.now().toString(),
                        name: request.serverName,
                        ownerId: request.userId,
                        members: [request.userId],
                        channels: [
                            { id: 'general', name: 'العامة', type: 'text' },
                            { id: 'voice', name: 'غرفة صوتية', type: 'voice' }
                        ],
                        icon: 'logo.png',
                        createdAt: new Date()
                    };
                    localDb.servers.push(newServer);
                    io.emit('server_approved', { userId: request.userId, server: newServer });
                } else {
                    io.emit('server_rejected', { userId: request.userId, serverName: request.serverName });
                }

                saveAndSyncDb();
                logAudit(socket.user.id, socket.user.username, action === 'approve' ? 'قبول سيرفر' : 'رفض سيرفر', `السيرفر: ${request.serverName} للمستخدم: ${request.username}`);
            }
        }
    });

    socket.on('get_my_servers', () => {
        sendMyServers();
    });
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

    // تهيئة السيرفر العام إذا كان غير موجود
    if (!localDb.servers || localDb.servers.length === 0) {
        console.log('🌐 إنشاء السيرفر العام الافتراضي...');
        localDb.servers = [{
            _id: 'global-server',
            name: 'راست كورد (العالمي)',
            ownerId: 'system',
            members: [], // فارغ يعني متاح للجميع
            channels: [
                { id: 'general', name: 'العامة', type: 'text' },
                { id: 'news', name: 'أخبار-البرنامج', type: 'text' }
            ],
            icon: 'logo.png',
            createdAt: new Date()
        }];
        await saveAndSyncDb();
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
