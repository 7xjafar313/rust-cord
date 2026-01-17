let socket;
let currentUser = null;
let isRegistering = false;
let simulationMode = false;

// Mock database for simulation mode
let mockMessages = JSON.parse(localStorage.getItem('rc_mock_messages')) || [
    { _id: '1', author: 'نظام راست', text: 'مرحباً بك في النسخة التجريبية من راست كورد!', timestamp: new Date(), role: 'admin' }
];

document.addEventListener('DOMContentLoaded', () => {
    const authBtn = document.getElementById('auth-btn');
    const authTitle = document.getElementById('auth-title');
    // Invite Logic
    const inviteTrigger = document.getElementById('invite-trigger');
    inviteTrigger.addEventListener('click', () => {
        const url = window.location.href;
        navigator.clipboard.writeText(url).then(() => {
            alert('تم نسخ رابط الدعوة! أرسله لأصدقائك لينضموا إليك.');
        });
    });

    // Auth Switch Logic
    const switchToRegister = document.getElementById('switch-to-register');
    const authOverlay = document.getElementById('auth-overlay');
    const appMain = document.getElementById('app-main');
    const logoutBtn = document.getElementById('logout-btn');

    switchToRegister.addEventListener('click', () => {
        isRegistering = !isRegistering;
        authTitle.innerText = isRegistering ? 'إنشاء حساب في راست كورد' : 'تسجيل الدخول إلى راست كورد';
        authBtn.innerText = isRegistering ? 'إنشاء حساب' : 'تسجيل الدخول';
        switchToRegister.innerText = isRegistering ? 'تسجيل الدخول' : 'إنشاء حساب';
        document.getElementById('email-group').style.display = isRegistering ? 'block' : 'none';
    });

    authBtn.addEventListener('click', async () => {
        const username = document.getElementById('auth-username').value;
        const password = document.getElementById('auth-password').value;
        const email = isRegistering ? document.getElementById('auth-email').value : '';

        if (!username || !password || (isRegistering && !email)) return alert('يرجى ملء جميع الحقول');

        // Check if server is running, if not, use simulation
        try {
            const res = await fetch(isRegistering ? '/api/register' : '/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, email })
            });
            const data = await res.json();
            if (data.token) {
                localStorage.setItem('rc_token', data.token);
                localStorage.setItem('rc_user', JSON.stringify(data.user));
                startApp(data.token, data.user);
                return;
            }
        } catch (e) {
            console.log("Server not found, entering simulation mode...");
            simulationMode = true;
        }

        if (simulationMode) {
            // First user in simulation is always Admin
            let users = JSON.parse(localStorage.getItem('rc_mock_users')) || [];
            if (isRegistering) {
                if (users.find(u => u.username === username)) return alert('المستخدم موجود مسبقاً');
                const role = users.length === 0 ? 'admin' : 'user';
                users.push({ username, password, role });
                localStorage.setItem('rc_mock_users', JSON.stringify(users));
                alert('تم التسجيل بنجاح (وضع التجربة)!');
                switchToRegister.click();
            } else {
                const user = users.find(u => u.username === username && u.password === password);
                if (user) {
                    currentUser = user;
                    startApp('sim-token', user);
                } else {
                    alert('خطأ في اسم المستخدم أو كلمة المرور');
                }
            }
        }
    });

    const savedToken = localStorage.getItem('rc_token') || localStorage.getItem('rc_sim_token');
    const savedUser = localStorage.getItem('rc_user') || localStorage.getItem('rc_sim_user');
    if (savedToken && savedUser) {
        startApp(savedToken, JSON.parse(savedUser));
    }

    logoutBtn.addEventListener('click', () => {
        localStorage.clear();
        location.reload();
    });
});

function startApp(token, user) {
    currentUser = user;
    localStorage.setItem('rc_sim_token', token);
    localStorage.setItem('rc_sim_user', JSON.stringify(user));

    document.getElementById('auth-overlay').style.display = 'none';
    document.getElementById('app-main').style.display = 'flex';
    document.getElementById('display-username').innerText = user.username;
    document.getElementById('display-role').innerText = user.role === 'admin' ? 'المدير العام' : 'عضو';

    if (user.role === 'admin') {
        document.getElementById('admin-badge').style.display = 'block';
    }

    if (token === 'sim-token') {
        initSimulation();
    } else {
        initSocket(token);
    }
}

function initSocket(token) {
    socket = io({ auth: { token } });
    const messagesContainer = document.getElementById('messages');

    socket.on('previous_messages', (messages) => {
        messagesContainer.innerHTML = '';
        messages.forEach(msg => renderMessage(msg));
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });

    socket.on('new_message', (msg) => {
        renderMessage(msg);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });

    socket.on('message_deleted', (id) => {
        const el = document.querySelector(`[data-id="${id}"]`);
        if (el) el.remove();
    });

    document.getElementById('message-input').onkeypress = (e) => {
        if (e.key === 'Enter' && e.target.value.trim() !== '') {
            socket.emit('send_message', { text: e.target.value });
            e.target.value = '';
        }
    };
}

function initSimulation() {
    const messagesContainer = document.getElementById('messages');
    renderMessages(mockMessages);

    document.getElementById('message-input').onkeypress = (e) => {
        if (e.key === 'Enter' && e.target.value.trim() !== '') {
            const newMsg = {
                _id: Date.now().toString(),
                author: currentUser.username,
                text: e.target.value,
                timestamp: new Date(),
                role: currentUser.role
            };
            mockMessages.push(newMsg);
            localStorage.setItem('rc_mock_messages', JSON.stringify(mockMessages));
            renderMessage(newMsg);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            e.target.value = '';
        }
    };
}

function renderMessages(msgs) {
    const container = document.getElementById('messages');
    container.innerHTML = '';
    msgs.forEach(renderMessage);
    container.scrollTop = container.scrollHeight;
}

function renderMessage(msg) {
    const container = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    messageDiv.setAttribute('data-id', msg._id);

    const time = new Date(msg.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const isAdmin = msg.role === 'admin';
    const deleteHtml = currentUser.role === 'admin' ? `<span class="delete-btn" onclick="deleteMsg('${msg._id}')">حذف</span>` : '';

    messageDiv.innerHTML = `
        <div class="message-avatar">
            <img src="logo.png" style="width:100%; border-radius:50%">
        </div>
        <div class="message-content">
            <div class="message-header">
                <span class="author" style="${isAdmin ? 'color: var(--admin-gold)' : ''}">${msg.author}</span>
                ${isAdmin ? '<span class="admin-tag">ADMIN</span>' : ''}
                <span class="timestamp">${time}</span>
                ${deleteHtml}
            </div>
            <p class="text">${msg.text}</p>
        </div>
    `;
    container.appendChild(messageDiv);
}

window.deleteMsg = function (id) {
    if (confirm('هل أنت متأكد من حذف هذه الرسالة؟')) {
        if (simulationMode || !socket) {
            mockMessages = mockMessages.filter(m => m._id !== id);
            localStorage.setItem('rc_mock_messages', JSON.stringify(mockMessages));
            document.querySelector(`[data-id="${id}"]`).remove();
        } else {
            socket.emit('delete_message', id);
        }
    }
};
