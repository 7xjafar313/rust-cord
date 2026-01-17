const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Datastore = require('nedb-promises');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'rust_cord_secret_key_2024';

// Databases
const db = {
    users: Datastore.create({ filename: 'db/users.db', autoload: true }),
    messages: Datastore.create({ filename: 'db/messages.db', autoload: true }),
    channels: Datastore.create({ filename: 'db/channels.db', autoload: true })
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- AUTHENTICATION ---

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existing = await db.users.findOne({ username });
        if (existing) return res.status(400).json({ error: 'المستخدم موجود مسبقاً' });

        const hashedPassword = await bcrypt.hash(password, 10);

        // Specific Admin User - Protected for 'sww'
        const isAdmin = username.toLowerCase() === 'sww';
        const role = isAdmin ? 'admin' : 'user';

        const newUser = await db.users.insert({
            username,
            password: hashedPassword,
            role,
            createdAt: new Date()
        });

        res.json({ success: true, message: 'تم التسجيل بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await db.users.findOne({ username });
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
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// --- SOCKET.IO (REAL-TIME) ---

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

    // Send old messages
    const recentMessages = await db.messages.find({}).sort({ timestamp: 1 }).limit(50);
    socket.emit('previous_messages', recentMessages);

    socket.on('send_message', async (data) => {
        const msg = {
            author: socket.user.username,
            role: socket.user.role,
            text: data.text,
            timestamp: new Date()
        };
        const savedMsg = await db.messages.insert(msg);
        io.emit('new_message', savedMsg);
    });

    socket.on('delete_message', async (messageId) => {
        if (socket.user.role === 'admin') {
            await db.messages.remove({ _id: messageId });
            io.emit('message_deleted', messageId);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

server.listen(PORT, () => {
    console.log(`Rust Cord running on http://localhost:${PORT}`);
});
