// YouTube Player State
let ytPlayer = null;
let ytApiReady = false;

window.onYouTubeIframeAPIReady = () => {
    ytApiReady = true;
    console.log("🎥 YouTube API Ready");
};

// Voice/WebRTC State
let localStream = null;
let peerConnections = {}; // socketId -> RTCPeerConnection
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' },
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.l.google.com:19305' }
    ]
};

// Audio Processing State
let audioContext = null;
let currentEffect = 'none';
let voiceProcessor = null; // ScriptProcessor or BiquadFilter
let processedStream = null;
let userAudios = {}; // socketId -> Audio Element
let screenStream = null;
let screenConnections = {}; // socketId -> RTCPeerConnection (Screenshare)
let socket = null;
let currentUser = null;
let isRegistering = false;
let simulationMode = false;
let activeContext = { type: 'channel', id: 'العامة', serverId: 'global-server' }; // { type: 'channel'|'dm', id: string, serverId: string }
let currentTypingUsers = new Set();
let typingTimeout = null;
let replyingTo = null; // { id, author, text }
let socketUsernameMap = {}; // socketId -> username for UI display

// Mock database for simulation mode
let mockMessages = JSON.parse(localStorage.getItem('rc_mock_messages')) || [
    { _id: '1', author: 'نظام راست', text: 'مرحباً بك في النسخة التجريبية من راست كورد!', timestamp: new Date(), role: 'admin' }
];

// Local Storage Helpers for App Performance
function saveMessagesToLocal(key, messages) {
    localStorage.setItem(`rc_cache_${key}`, JSON.stringify(messages.slice(-50)));
}

function loadMessagesFromLocal(key) {
    const saved = localStorage.getItem(`rc_cache_${key}`);
    return saved ? JSON.parse(saved) : [];
}

function updateLocalCache(key, msg) {
    const messages = loadMessagesFromLocal(key);
    messages.push(msg);
    saveMessagesToLocal(key, messages);
}

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
            if (res.ok && data.token) {
                localStorage.setItem('rc_token', data.token);
                localStorage.setItem('rc_user', JSON.stringify(data.user));
                startApp(data.token, data.user);
                return;
            } else {
                const errorData = await res.json().catch(() => ({}));
                return alert(errorData.error || 'حدث خطأ غير متوقع في الخادم');
            }
        } catch (e) {
            console.log("Server error or not found:", e);
            alert('لا يمكن الاتصال بالخادم. يرجى التأكد من تشغيل server.js');
        }

        if (simulationMode) {
            alert('سيتم الدخول في وضع التجربة (بدون حفظ في الخادم)');
            // First user in simulation is always Admin
            let users = JSON.parse(localStorage.getItem('rc_mock_users')) || [
                { username: 'sww', password: 'mmkkll00998877', role: 'admin' }
            ];
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

    // --- SERVER REQUESTS UI ---
    const addServerBtn = document.querySelector('.add-server');
    const serverRequestOverlay = document.getElementById('server-request-overlay');
    const closeServerReq = document.getElementById('close-server-req');
    const submitServerReqBtn = document.getElementById('submit-server-req-btn');

    addServerBtn.onclick = () => {
        serverRequestOverlay.style.display = 'flex';
    };

    closeServerReq.onclick = () => {
        serverRequestOverlay.style.display = 'none';
    };

    submitServerReqBtn.onclick = () => {
        const serverName = document.getElementById('new-server-name-input').value;
        if (!serverName) return alert('يرجى إدخال اسم السيرفر');
        socket.emit('request_server', { serverName });
        serverRequestOverlay.style.display = 'none';
        document.getElementById('new-server-name-input').value = '';
        alert('تم إرسال طلبك للإدارة للموافقة.');
    };

    // Mobile Menu Toggle
    const mobileMenuTrigger = document.getElementById('mobile-menu-trigger');
    const channelSidebar = document.querySelector('.channel-sidebar');

    if (mobileMenuTrigger) {
        mobileMenuTrigger.onclick = (e) => {
            e.stopPropagation();
            channelSidebar.classList.toggle('show');
        };
    }

    // Close sidebar on mobile when clicking a channel
    document.querySelectorAll('.channel-item, .dm-user-item').forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                channelSidebar.classList.remove('show');
            }
        });
    });

    // Close sidebars on mobile when clicking anywhere else
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            // Channel Sidebar
            if (channelSidebar.classList.contains('show')) {
                if (!channelSidebar.contains(e.target) && e.target !== mobileMenuTrigger) {
                    channelSidebar.classList.remove('show');
                }
            }
            // Members Sidebar
            if (membersSidebar && membersSidebar.classList.contains('show')) {
                if (!membersSidebar.contains(e.target) && e.target !== membersTrigger) {
                    membersSidebar.classList.remove('show');
                }
            }
        }
    });

    // Members Sidebar Toggle
    const membersTrigger = document.getElementById('members-trigger');
    const membersSidebar = document.querySelector('.members-sidebar');
    const closeMembers = document.getElementById('close-members');

    if (membersTrigger && membersSidebar) {
        membersTrigger.onclick = (e) => {
            e.stopPropagation();
            membersSidebar.classList.toggle('show');
        };
    }

    if (closeMembers) {
        closeMembers.onclick = () => {
            membersSidebar.classList.remove('show');
        };
    }

    async function loadServerRequests() {
        if (!socket) return;
        socket.emit('get_server_requests');
    }

    // --- SETTINGS LOGIC ---
    const settingsTrigger = document.getElementById('settings-trigger');
    const settingsOverlay = document.getElementById('settings-overlay');
    const closeSettings = document.getElementById('close-settings');
    const updateProfileBtn = document.getElementById('update-profile-btn');
    const requestPwdResetBtn = document.getElementById('request-pwd-reset-btn');

    settingsTrigger.addEventListener('click', () => {
        settingsOverlay.style.display = 'flex';
        updateUIForUser(); // Ensure fields are fresh
        if (currentUser.role === 'admin' || currentUser.role === 'assistant') {
            loadPasswordRequests();
            loadRolesAdmin();
            loadAuditLogs();
        }
    });

    document.getElementById('avatar-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 2 * 1024 * 1024) return alert('حجم الصورة كبير جداً (الأقصى 2MB)');
            const reader = new FileReader();
            reader.onload = (event) => {
                document.getElementById('settings-avatar').value = event.target.result;
                const preview = document.querySelector('#settings-avatar-preview img');
                if (preview) preview.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    document.getElementById('settings-avatar').addEventListener('input', (e) => {
        const preview = document.querySelector('#settings-avatar-preview img');
        if (preview) preview.src = e.target.value || 'logo.png';
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.admin-tab').forEach(t => t.style.display = 'none');
            btn.classList.add('active');
            document.getElementById(`${btn.dataset.tab}-tab`).style.display = 'block';
            if (btn.dataset.tab === 'audit') loadAuditLogs();
            if (btn.dataset.tab === 'server-reqs') loadServerRequests();
        });
    });

    document.getElementById('create-role-btn').addEventListener('click', async () => {
        const name = document.getElementById('new-role-name').value;
        const color = document.getElementById('new-role-color').value;
        const token = localStorage.getItem('rc_token');
        if (!name) return;

        try {
            const res = await fetch('/api/admin/create-role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, name, color })
            });
            if (res.ok) {
                alert('تم إنشاء الرتبة');
                loadRolesAdmin();
            }
        } catch (e) { console.error(e); }
    });

    async function loadRolesAdmin() {
        const token = localStorage.getItem('rc_token');
        const container = document.getElementById('roles-list-admin');
        if (!container) return;
        try {
            const res = await fetch('/api/admin/get-all-roles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            });
            const data = await res.json();
            container.innerHTML = '';
            data.roles.forEach(role => {
                const div = document.createElement('div');
                div.className = 'role-item';
                div.innerHTML = `
                    <span class="role-badge" style="background: ${role.color}">${role.name}</span>
                    <button class="btn-small" onclick="deleteRole('${role.name}')">حذف</button>
                `;
                container.appendChild(div);
            });
        } catch (e) { }
    }

    window.deleteRole = async function (roleName) {
        if (!confirm(`هل أنت متأكد من حذف رتبة ${roleName}؟`)) return;
        const token = localStorage.getItem('rc_token');
        try {
            const res = await fetch('/api/admin/delete-role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, name: roleName })
            });
            if (res.ok) {
                alert('تم حذف الرتبة');
                loadRolesAdmin();
            }
        } catch (e) { }
    };

    // Settings Sidebar Navigation
    document.querySelectorAll('.settings-sidebar .sidebar-item').forEach(item => {
        item.addEventListener('click', () => {
            if (item.id === 'logout-settings-btn') {
                document.getElementById('logout-btn').click();
                return;
            }
            document.querySelectorAll('.settings-sidebar .sidebar-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            const target = item.getAttribute('data-target');
            document.querySelectorAll('.settings-content-section').forEach(sec => sec.style.display = 'none');
            const targetEl = document.getElementById(target);
            if (targetEl) targetEl.style.display = 'block';
        });
    });

    // Admin Sub-tabs Navigation
    document.querySelectorAll('.admin-tab-nav-premium .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.admin-tab-nav-premium .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.getAttribute('data-tab');
            document.querySelectorAll('.admin-tab-content').forEach(p => p.classList.remove('active')); // Use class toggling or display
            document.querySelectorAll('.admin-tab-content').forEach(p => p.style.display = 'none');

            const panel = document.getElementById(tab);
            if (panel) {
                panel.style.display = 'block';
                panel.classList.add('active');
            }
        });
    });

    window.updateSettingsUI = function (user) {
        if (!document.getElementById('settings-display-username')) return;

        // Update Preview
        document.getElementById('settings-display-username').innerText = user.username;
        document.getElementById('settings-display-role').innerText = user.role === 'admin' ? 'المدير العام' : (user.role === 'assistant' ? 'مساعد القائد' : 'عضو');

        const avatarEl = document.getElementById('preview-avatar-circle');
        const avatarUrl = user.avatar || 'logo.png';
        avatarEl.style.backgroundImage = `url('${avatarUrl}')`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';

        document.getElementById('settings-avatar').value = user.avatar || '';
        document.getElementById('settings-custom-status').value = user.customStatus || '';
        document.getElementById('settings-status').value = user.status || 'online';
        document.getElementById('settings-username').value = user.username;

        const xpPercent = (user.xp || 0) / ((user.level || 1) * 100) * 100;
        document.getElementById('settings-xp-bar').style.width = xpPercent + '%';
        document.getElementById('settings-display-lvl').innerText = `Level ${user.level || 1}`;

        const adminSection = document.getElementById('admin-management-settings');
        if (user.role === 'admin' || user.role === 'assistant') {
            if (adminSection) adminSection.style.display = 'block';
        } else {
            if (adminSection) adminSection.style.display = 'none';
        }
    }

    document.getElementById('update-profile-btn-user')?.addEventListener('click', updateProfile);
    document.getElementById('update-profile-btn-security')?.addEventListener('click', updateProfile);

    async function updateProfile() {
        const avatar = document.getElementById('settings-avatar').value;
        const customStatus = document.getElementById('settings-custom-status').value;
        const status = document.getElementById('settings-status').value;
        const newUsername = document.getElementById('settings-username').value;

        // Passwords might be in different section, get them safely
        const oldPassEl = document.getElementById('current-password');
        const newPassEl = document.getElementById('new-password');
        const oldPassword = oldPassEl ? oldPassEl.value : '';
        const newPassword = newPassEl ? newPassEl.value : '';

        const token = localStorage.getItem('rc_token');

        try {
            const res = await fetch('/api/update-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newUsername, oldPassword, newPassword, newAvatar: avatar, newStatus: status, newCustomStatus: customStatus })
            });

            const data = await res.json();
            if (res.ok) {
                alert('تم تحديث البيانات بنجاح!');
                if (newUsername !== currentUser.username) {
                    location.reload();
                } else {
                    currentUser = { ...currentUser, ...data.user };
                    updateSettingsUI(currentUser);
                    // Don't close overlay immediately so user can see result
                    if (socket) {
                        socket.emit('update_status', { status: currentUser.status, customStatus: currentUser.customStatus });
                        // request refresh of users
                    }
                }
            } else {
                alert(data.error);
            }
        } catch (e) {
            console.error(e);
            alert('خطأ في الاتصال');
        }
    }

    if (requestPwdResetBtn) {
        requestPwdResetBtn.addEventListener('click', async () => {
            const token = localStorage.getItem('rc_token');
            if (!token) return alert('غير ممكن في وضع التجربة');

            try {
                const res = await fetch('/api/request-password-reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                if (res.ok) alert('تم إرسال طلبك للمدير بنجاح.');
            } catch (e) {
                alert('خطأ في الاتصال');
            }
        });
    }

    async function loadPasswordRequests() {
        const token = localStorage.getItem('rc_token');
        const container = document.getElementById('password-requests');
        try {
            const res = await fetch('/api/admin/get-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            });
            const data = await res.json();
            if (data.requests && data.requests.length > 0) {
                container.innerHTML = '';
                data.requests.forEach(req => {
                    const div = document.createElement('div');
                    div.className = 'request-item';
                    const time = new Date(req.timestamp).toLocaleTimeString();
                    div.innerHTML = `
                        <div class="request-info">
                            <span class="request-user">${req.username}</span>
                            <span class="request-time">${time}</span>
                        </div>
                        <div class="request-actions">
                            <button class="btn-small btn-approve" onclick="resolveRequest('${req.userId}', 'approve')">تغيير الباسورد</button>
                            <button class="btn-small btn-reject" onclick="resolveRequest('${req.userId}', 'reject')">رفض</button>
                        </div>
                    `;
                    container.appendChild(div);
                });
            } else {
                container.innerHTML = '<p class="empty-msg">لا يوجد طلبات حالياً.</p>';
            }
        } catch (e) {
            console.error('Error loading requests');
        }
    }

    async function loadAuditLogs() {
        const token = localStorage.getItem('rc_token');
        const container = document.getElementById('audit-logs-list');
        if (!token || !container) return;
        try {
            const res = await fetch('/api/admin/get-audit-logs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            });
            const data = await res.json();
            container.innerHTML = '';
            if (data.logs.length === 0) {
                container.innerHTML = '<p class="empty-msg">لا توجد سجلات بعد.</p>';
                return;
            }
            data.logs.forEach(log => {
                const div = document.createElement('div');
                div.className = 'role-item';
                div.innerHTML = `
                    <div style="font-size: 12px">
                        <span style="color: var(--accent-rust)">${log.username}</span>: 
                        <b>${log.action}</b> 
                        <span style="color: var(--text-muted)">(${log.details})</span>
                        <div style="font-size: 10px; color: var(--text-muted)">${new Date(log.timestamp).toLocaleString()}</div>
                    </div>
                `;
                container.appendChild(div);
            });
        } catch (e) { console.error(e); }
    }

    window.resolveRequest = async function (userId, action) {
        let newPassword = '';
        if (action === 'approve') {
            newPassword = prompt('أدخل كلمة المرور الجديدة للمستخدم:');
            if (!newPassword) return;
        }

        const token = localStorage.getItem('rc_token');
        try {
            const res = await fetch('/api/admin/resolve-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, targetUserId: userId, newPassword, action })
            });
            if (res.ok) {
                alert('تمت العملية بنجاح');
                loadPasswordRequests();
            }
        } catch (e) {
            alert('فشلت العملية');
        }
    };
    /* End of resolveRequest */


    function startApp(token, user) {
        currentUser = user;
        localStorage.setItem('rc_sim_token', token);
        localStorage.setItem('rc_sim_user', JSON.stringify(user));

        document.getElementById('auth-overlay').style.display = 'none';
        document.getElementById('app-main').style.display = 'flex';
        document.getElementById('display-username').innerText = user.username;
        document.getElementById('display-level').innerText = `Lvl ${user.level || 1}`;

        if (user.avatar) {
            document.getElementById('current-user-avatar').innerHTML = `<img src="${user.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
            document.getElementById('settings-avatar').value = user.avatar;
        }

        if (user.role === 'admin' || user.role === 'assistant') {
            document.getElementById('display-role').innerText = user.role === 'admin' ? 'المدير العام' : 'مساعد القائد';
            document.getElementById('admin-badge').style.display = 'block';
            document.getElementById('admin-voice-effects').style.display = 'flex';
            document.getElementById('admin-management-section').style.display = 'block';
            document.getElementById('clear-chat-btn').style.display = 'flex';
        } else {
            document.getElementById('display-role').innerText = 'عضو';
            document.getElementById('clear-chat-btn').style.display = 'none';
        }

        if (token === 'sim-token') {
            initSimulation();
        } else {
            initSocket(token);
        }

        // Channel Switching
        document.querySelectorAll('.channel-item').forEach(item => {
            item.addEventListener('click', () => {
                switchToChannel(item.querySelector('.channel-name').innerText);
            });
        });

        // File Upload Logic
        const fileTrigger = document.getElementById('file-trigger');
        const fileInput = document.getElementById('file-input');

        fileTrigger.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    sendMessage(null, {
                        file: event.target.result,
                        fileName: file.name,
                        fileType: file.type
                    });
                };
                reader.readAsDataURL(file);
            }
        });

        document.getElementById('send-btn').addEventListener('click', () => {
            const input = document.getElementById('message-input');
            if (input.value.trim() !== '') {
                sendMessage(input.value);
                input.value = '';
                cancelReply();
            }
        });

        // Emoji Picker Logic
        const emojiTrigger = document.getElementById('emoji-trigger');
        const emojiPicker = document.getElementById('emoji-picker');
        const msgInput = document.getElementById('message-input');

        const commonEmojis = ['😊', '😂', '🤣', '❤️', '😍', '😒', '😭', '😘', '😑', '😁', '😉', '💀', '🔥', '✨', '👍', '🙏', '💯', '👋', '🎉', '😎', '🙄', '🤔', '😳', '😡', '🤬', '🥵', '🥶', '😱', '🤫', '🥱', '😴', '🤤', '🤮', '🤑', '🤠', '🤡', '🌞', '🌙', '⭐', '🎈', '🎁', '🌹', '💎', '🎮', '🎧', '📱', '💻', '💡', '💰', '⚔️', '🛡️', '👑'];

        commonEmojis.forEach(emoji => {
            const span = document.createElement('span');
            span.className = 'emoji-item';
            span.innerText = emoji;
            span.onclick = () => {
                msgInput.value += emoji;
                emojiPicker.style.display = 'none';
                msgInput.focus();
            };
            emojiPicker.appendChild(span);
        });

        emojiTrigger.onclick = (e) => {
            e.stopPropagation();
            emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'grid' : 'none';
        };

        document.addEventListener('click', (e) => {
            if (!emojiPicker.contains(e.target) && e.target !== emojiTrigger) {
                emojiPicker.style.display = 'none';
            }
        });

        document.getElementById('cancel-reply').onclick = cancelReply;

        document.addEventListener('click', () => {
            if (ytPlayer && ytPlayer.getPlayerState) {
                const state = ytPlayer.getPlayerState();
                if (state === 2 || state === 5) { // Paused or Cued
                    ytPlayer.playVideo();
                }
            }
        }, { once: false });

        // Clear Chat Logic
        const clearChatBtn = document.getElementById('clear-chat-btn');
        if (clearChatBtn) {
            clearChatBtn.onclick = () => {
                if (confirm('هل أنت متأكد من مسح جميع الرسائل في هذا السيرفر؟')) {
                    socket.emit('clear_chat', { serverId: activeContext.serverId || 'global-server' });
                }
            };
        }
    }

    function cancelReply() {
        replyingTo = null;
        document.getElementById('reply-preview-container').style.display = 'none';
    }

    function setReply(id, author, text) {
        replyingTo = { id, author, text };
        document.getElementById('reply-preview-container').style.display = 'flex';
        document.getElementById('reply-preview-user').innerText = author;
        document.getElementById('reply-preview-text').innerText = text;
        document.getElementById('message-input').focus();
    }

    function updateUIForUser() {
        document.getElementById('display-username').innerText = currentUser.username;
        document.getElementById('display-level').innerText = `Lvl ${currentUser.level || 1}`;

        // Settings Profile Preview
        const verifiedHtml = currentUser.isVerified ? '<span class="verified-badge" title="حساب موثق" style="margin-left:4px; vertical-align: middle;"><svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent-rust)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"></path></svg></span>' : '';
        document.getElementById('settings-display-username').innerHTML = currentUser.username + verifiedHtml;
        const roleMap = { 'admin': 'المدير العام 👑', 'assistant': 'مساعد القائد 🎖️', 'user': 'عضو 👤' };
        document.getElementById('settings-display-role').innerText = roleMap[currentUser.role] || 'عضو';

        const currentLvl = currentUser.level || 1;
        const currentXp = currentUser.xp || 0;
        const nextLvlXp = currentLvl * 100;
        const xpPercent = Math.min((currentXp / nextLvlXp) * 100, 100);

        // Update both UI bars (sidebar and settings)
        const xpFill = document.getElementById('display-xp-fill');
        if (xpFill) xpFill.style.width = xpPercent + '%';

        const settingsXpBar = document.getElementById('settings-xp-bar');
        if (settingsXpBar) settingsXpBar.style.width = xpPercent + '%';

        document.getElementById('settings-display-lvl').innerText = `المستوى ${currentLvl} (${currentXp}/${nextLvlXp} XP)`;

        if (currentUser.avatar) {
            document.getElementById('current-user-avatar').innerHTML = `<img src="${currentUser.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
            document.getElementById('settings-avatar').value = currentUser.avatar;
        }

        document.getElementById('settings-status-select').value = currentUser.status || 'online';
        document.getElementById('settings-custom-status').value = currentUser.customStatus || '';

        const previewImg = document.querySelector('#settings-avatar-preview img');
        if (previewImg) previewImg.src = currentUser.avatar || 'logo.png';

        const indicator = document.querySelector('#current-user-avatar .status-indicator');
        if (indicator) {
            indicator.className = 'status-indicator ' + (currentUser.status || 'online');
        }
    }

    let allMembersRaw = []; // Store for profile lookups

    function showUserProfile(username) {
        const user = allMembersRaw.find(m => m.username === username);
        if (!user) return;

        document.getElementById('profile-card-username').innerText = user.username;
        document.getElementById('profile-card-avatar').src = user.avatar || 'logo.png';
        document.getElementById('profile-card-status').className = 'status-indicator ' + (user.status || 'online');

        const roleMap = { 'admin': 'المدير العام 👑', 'assistant': 'مساعد القائد 🎖️', 'user': 'عضو 👤' };
        document.getElementById('profile-card-role').innerText = roleMap[user.role] || 'عضو';
        document.getElementById('profile-card-custom-status').innerText = user.customStatus || 'لا توجد حالة...';
        document.getElementById('profile-card-lvl').innerText = `المستوى ${user.level || 1}`;

        document.getElementById('profile-card-dm-btn').onclick = () => {
            switchToDM(user.username);
            document.getElementById('user-profile-modal').style.display = 'none';
        };

        document.getElementById('user-profile-modal').style.display = 'flex';
    }

    function renderMembersList(members) {
        allMembersRaw = members;
        const container = document.getElementById('members-list');
        if (!container) return;

        container.innerHTML = '';

        const admins = members.filter(m => m.role === 'admin' && m.status !== 'offline');
        const assistants = members.filter(m => m.role === 'assistant' && m.status !== 'offline');
        const usersOnline = members.filter(m => m.role !== 'admin' && m.role !== 'assistant' && m.status !== 'offline');
        const offline = members.filter(m => m.status === 'offline');

        const renderCategory = (title, list) => {
            if (list.length === 0) return;
            const catDiv = document.createElement('div');
            catDiv.className = 'member-category';
            catDiv.innerText = `${title} — ${list.length}`;
            container.appendChild(catDiv);

            list.forEach(member => {
                const memberDiv = document.createElement('div');
                memberDiv.className = 'dm-user-item';
                if (member.status === 'offline') memberDiv.classList.add('offline');

                const verifiedHtml = member.isVerified ? '<span class="verified-badge" title="حساب موثق" style="margin-left:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"></path></svg></span>' : '';
                const roleColor = (member.role === 'admin') ? 'var(--admin-gold)' : (member.role === 'assistant' ? 'var(--assistant-gold)' : '');

                let statusText = 'متصل';
                if (member.status === 'offline') statusText = 'غير متصل';
                else if (member.status === 'dnd') statusText = 'يرجى عدم الإزعاج';
                else if (member.status === 'idle') statusText = 'خامل';

                memberDiv.innerHTML = `
                <div class="dm-user-avatar">
                    <img src="${member.avatar || 'logo.png'}" style="width:100%; height:100%; object-fit: cover; border-radius: 50%;">
                    <div class="status-indicator-mini ${member.status || 'online'}"></div>
                </div>
                <div class="dm-user-info">
                    <span class="dm-username" style="color: ${roleColor}">${member.username}${verifiedHtml}</span>
                    <span class="dm-status">${member.customStatus || statusText}</span>
                </div>
            `;
                memberDiv.onclick = () => showUserProfile(member.username);
                container.appendChild(memberDiv);
            });
        };

        renderCategory('المدراء', admins);
        renderCategory('المساعدين', assistants);
        renderCategory('الأعضاء المتصلين', usersOnline);
        renderCategory('غير متصلين', offline);
    }

    function switchToChannel(channelName) {
        activeContext = { type: 'channel', id: channelName };
        document.getElementById('current-channel-name').innerText = channelName;
        document.getElementById('message-input').placeholder = `أرسل رسالة في #${channelName}`;
        document.querySelectorAll('.channel-item, .dm-user-item').forEach(el => el.classList.remove('active'));
        // Mark general as active if it's the one
        if (channelName === 'العامة') document.querySelector('.channel-item').classList.add('active');

        // تحميل الرسائل من الهاتف فوراً لسرعة التطبيق
        const cached = loadMessagesFromLocal(`channel_${activeContext.serverId || 'global-server'}_${channelName}`);
        if (cached.length > 0) {
            const container = document.getElementById('messages');
            container.innerHTML = '';
            cached.forEach(msg => renderMessage(msg));
            container.scrollTop = container.scrollHeight;
        }

        // Refresh messages from server
        if (socket) socket.emit('get_previous_messages', { serverId: activeContext.serverId || 'global-server' });
    }

    function switchToDM(username, avatar) {
        activeContext = { type: 'dm', id: username };
        document.getElementById('current-channel-name').innerText = `@${username}`;
        document.getElementById('message-input').placeholder = `أرسل رسالة إلى ${username}`;
        document.querySelectorAll('.channel-item, .dm-user-item').forEach(el => el.classList.remove('active'));

        const dmItem = document.getElementById(`dm-${username}`);
        if (dmItem) {
            dmItem.classList.add('active');
            dmItem.classList.remove('has-unread');
            const statusEl = dmItem.querySelector('.dm-status');
            if (statusEl && statusEl.innerText.includes('رسالة')) statusEl.innerText = 'متصل';
        }

        // تحميل الرسائل من الهاتف فوراً
        const cached = loadMessagesFromLocal(`dm_${username}`);
        if (cached.length > 0) {
            const container = document.getElementById('messages');
            container.innerHTML = '';
            cached.forEach(msg => renderMessage(msg));
            container.scrollTop = container.scrollHeight;
        }

        // Fetch DMs
        if (socket) socket.emit('get_dms_with', username);
    }

    function initSocket(token) {
        socket = io({ auth: { token } });
        const messagesContainer = document.getElementById('messages');

        socket.on('roles_updated', (roles) => {
            renderRoles(roles);
        });

        socket.on('user_typing', (data) => {
            if (data.serverId !== (activeContext.serverId || 'global-server')) return;

            if (data.isTyping) {
                currentTypingUsers.add(data.username);
            } else {
                currentTypingUsers.delete(data.username);
            }

            const indicator = document.getElementById('typing-indicator');
            if (indicator) {
                if (currentTypingUsers.size === 0) {
                    indicator.innerText = '';
                } else if (currentTypingUsers.size === 1) {
                    indicator.innerText = `${[...currentTypingUsers][0]} يكتب الآن...`;
                } else if (currentTypingUsers.size > 1 && currentTypingUsers.size < 4) {
                    indicator.innerText = `${[...currentTypingUsers].join(', ')} يكتبون الآن...`;
                } else if (currentTypingUsers.size >= 4) {
                    indicator.innerText = `عدة أشخاص يكتبون الآن...`;
                }
            }
        });

        socket.on('previous_messages', (messages) => {
            messagesContainer.innerHTML = '';
            messages.forEach(msg => renderMessage(msg));
            messagesContainer.scrollTop = messagesContainer.scrollHeight;

            // حفظ في الذاكرة المحلية للتطبيق
            const contextKey = `channel_${activeContext.serverId || 'global-server'}_${activeContext.id}`;
            saveMessagesToLocal(contextKey, messages);
        });

        socket.on('new_message', (msg) => {
            renderMessage(msg);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;

            // تحديث الذاكرة المحلية
            const contextKey = `channel_${msg.serverId || 'global-server'}_${msg.channelId || 'العامة'}`;
            updateLocalCache(contextKey, msg);
        });

        socket.on('update_reactions', (data) => {
            const { messageId, reactions } = data;
            const msgEl = document.querySelector(`[data-id="${messageId}"]`);
            if (msgEl) {
                const container = msgEl.querySelector('.reactions-container');
                if (container) {
                    container.innerHTML = '';
                    Object.entries(reactions).forEach(([emoji, users]) => {
                        const badge = document.createElement('div');
                        badge.className = `reaction-badge ${users.includes(currentUser.username) ? 'active' : ''}`;
                        badge.innerHTML = `<span>${emoji}</span><span class="reaction-count">${users.length}</span>`;
                        badge.onclick = () => socket.emit('add_reaction', { messageId, emoji });
                        container.appendChild(badge);
                    });
                }
            }
        });

        socket.on('message_deleted', (id) => {
            const el = document.querySelector(`[data-id="${id}"]`);
            if (el) el.remove();
        });

        socket.on('server_approved', (data) => {
            if (data.userId === currentUser._id || data.userId === currentUser.id) {
                alert(`✅ مبروك! تم قبول طلبك لإنشاء سيرفر: ${data.server.name}`);
                socket.emit('get_my_servers');
            }
        });

        socket.emit('get_my_servers');
        socket.emit('get_previous_messages', { serverId: activeContext.serverId || 'global-server' });

        socket.on('chat_cleared', (data) => {
            if (activeContext.serverId === data.serverId) {
                document.getElementById('messages').innerHTML = '';
                alert('تم مسح جميع الرسائل في هذه القناة بواسطة الإدارة.');
            }
        });

        socket.on('previous_dms', (messages) => {
            if (activeContext.type === 'dm') {
                document.getElementById('messages').innerHTML = '';
                messages.forEach(msg => renderMessage(msg));
                document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;

                // حفظ في الذاكرة المحلية
                saveMessagesToLocal(`dm_${activeContext.id}`, messages);
            }
        });

        socket.on('new_dm', (msg) => {
            if (activeContext.type === 'dm' && (msg.from === activeContext.id || msg.from === currentUser.username)) {
                renderMessage(msg);
                document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
            } else if (msg.from !== currentUser.username) {
                // Notification for new DM if not in that DM
                showDMNotification(msg);
            }
            updateDMList(msg);

            // تحديث الذاكرة المحلية
            const otherUser = msg.from === currentUser.username ? msg.to : msg.from;
            updateLocalCache(`dm_${otherUser}`, msg);
        });

        function showDMNotification(msg) {
            const notification = document.createElement('div');
            notification.className = 'level-up-toast'; // Reuse beauty of level-up toast
            notification.style.background = 'var(--accent-primary)';
            notification.innerHTML = `
            <div style="display:flex; align-items:center;">
                <img src="${msg.avatar || 'logo.png'}" style="width:30px; height:30px; border-radius:50%; margin-left:10px;">
                <div>
                    <div style="font-weight:bold;">رسالة خاصة من ${msg.from}</div>
                    <div style="font-size:12px; opacity:0.9;">${msg.text ? (msg.text.substring(0, 30) + '...') : 'أرسل ملفاً'}</div>
                </div>
            </div>
        `;
            notification.onclick = () => {
                switchToDM(msg.from);
                notification.remove();
            };
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 5000);

            // Play notification sound if possible
            const bell = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            bell.volume = 0.5;
            bell.play().catch(() => { });
        }

        socket.on('update_members_list', (members) => {
            renderMembersList(members);
        });

        socket.on('user_typing', (data) => {
            if (data.isTyping) currentTypingUsers.add(data.username);
            else currentTypingUsers.delete(data.username);
            renderTypingIndicator();
        });

        socket.on('level_up', (data) => {
            const notification = document.createElement('div');
            notification.className = 'level-up-toast';
            notification.innerText = `✨ تهانينا ${data.username}! لقد ارتفعت للمستوى ${data.level}`;
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 5000);

            if (data.username === currentUser.username) {
                currentUser.level = data.level;
                updateUIForUser();
            }
        });

        socket.on('play_music', (data) => {
            const audio = document.getElementById('global-audio');
            // Stop YT if playing
            if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();

            audio.src = data.url;
            audio.play();
            document.getElementById('music-panel').style.display = 'flex';
            document.getElementById('current-track').innerText = `مشغل الآن: ${data.title || data.url.split('/').pop()}`;
        });

        socket.on('play_youtube', (data) => {
            const audio = document.getElementById('global-audio');
            audio.pause();
            audio.src = '';

            document.getElementById('music-panel').style.display = 'flex';
            document.getElementById('current-track').innerText = `مشغل الآن (يوتيوب): ${data.title}`;

            const startYT = () => {
                if (!ytPlayer) {
                    ytPlayer = new YT.Player('youtube-player-container', {
                        height: '1',
                        width: '1',
                        videoId: data.videoId,
                        playerVars: {
                            'autoplay': 1,
                            'controls': 0,
                            'modestbranding': 1,
                            'origin': window.location.origin
                        },
                        events: {
                            'onReady': (event) => {
                                event.target.playVideo();
                                event.target.unMute();
                                event.target.setVolume(100);
                            },
                            'onStateChange': (event) => {
                                if (event.data === YT.PlayerState.UNSTARTED) {
                                    event.target.playVideo();
                                }
                            },
                            'onError': (e) => console.error("YT Error:", e)
                        }
                    });
                } else if (ytPlayer.loadVideoById) {
                    ytPlayer.loadVideoById(data.videoId);
                    ytPlayer.playVideo();
                    ytPlayer.unMute();
                }
            };

            if (ytApiReady) {
                startYT();
            } else {
                // Wait for API
                const checkReady = setInterval(() => {
                    if (ytApiReady) {
                        clearInterval(checkReady);
                        startYT();
                    }
                }, 500);
            }
        });

        socket.on('stop_music', () => {
            const audio = document.getElementById('global-audio');
            audio.pause();
            audio.src = '';
            if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
            document.getElementById('music-panel').style.display = 'none';
        });

        socket.on('server_requests_list', (requests) => {
            const container = document.getElementById('server-reqs-list');
            if (!container) return;
            container.innerHTML = '';
            const pending = requests.filter(r => r.status === 'pending');
            if (pending.length === 0) {
                container.innerHTML = '<p class="empty-msg">لا توجد طلبات معلقة حالياً.</p>';
                return;
            }
            pending.forEach(req => {
                const div = document.createElement('div');
                div.className = 'request-item';
                div.innerHTML = `
                <div>
                    <strong>${req.serverName}</strong>
                    <div style="font-size: 11px; color: var(--text-muted)">بواسطة: ${req.username}</div>
                </div>
                <div class="request-actions">
                    <button class="btn-small btn-approve" onclick="resolveServerRequest('${req._id}', 'approve')">✅ قبول</button>
                    <button class="btn-small btn-reject" onclick="resolveServerRequest('${req._id}', 'reject')">❌ رفض</button>
                </div>
            `;
                container.appendChild(div);
            });
        });

        socket.on('my_servers_list', (servers) => {
            renderServers(servers);
        });

        socket.on('server_rejected', (data) => {
            if (data.userId === currentUser.id) {
                alert(`❌ للأسف، تم رفض طلبك لإنشاء سيرفر "${data.serverName}".`);
            }
        });

        function updateDMList(msg) {
            const otherUser = msg.from === currentUser.username ? msg.to : msg.from;
            let dmItem = document.getElementById(`dm-${otherUser}`);
            if (!dmItem) {
                dmItem = document.createElement('div');
                dmItem.id = `dm-${otherUser}`;
                dmItem.className = 'dm-user-item';
                dmItem.innerHTML = `
                <div class="dm-user-avatar"><img src="logo.png" style="width:100%"></div>
                <div class="dm-user-info">
                    <span class="dm-username">${otherUser}</span>
                    <span class="dm-status">${msg.from === currentUser.username ? 'آخر رسالة منك' : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:4px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>رسالة جديدة'}</span>
                </div>
            `;
                dmItem.onclick = () => {
                    switchToDM(otherUser);
                    dmItem.classList.remove('has-unread');
                    dmItem.querySelector('.dm-status').innerText = 'متصل';
                };
                document.getElementById('dm-list').appendChild(dmItem);
            }

            if (msg.from !== currentUser.username && (activeContext.type !== 'dm' || activeContext.id !== otherUser)) {
                dmItem.classList.add('has-unread');
                dmItem.querySelector('.dm-status').innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:4px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>رسالة غير مقروءة';
            }
        }

        function renderTypingIndicator() {
            const indicator = document.getElementById('typing-indicator');
            if (currentTypingUsers.size === 0) {
                indicator.innerHTML = '';
            } else {
                const users = Array.from(currentTypingUsers).join(', ');
                indicator.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:6px; animation: bounce 1s infinite;"><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg>${users} يكتب الآن...`;
            }
        }

        // --- WEBRTC / VOICE ENGINE ---

        async function applyAudioProcessing(stream) {
            if ((currentUser.role !== 'admin' && currentUser.role !== 'assistant') || currentEffect === 'none') return stream;

            if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();

            const source = audioContext.createMediaStreamSource(stream);
            const destination = audioContext.createMediaStreamDestination();

            let lastNode = source;

            if (currentEffect === 'robot') {
                const filter = audioContext.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = 800;

                const oscillator = audioContext.createOscillator();
                oscillator.type = 'sawtooth';
                oscillator.frequency.value = 50;
                const oscGain = audioContext.createGain();
                oscGain.gain.value = 0.1;
                oscillator.connect(oscGain);
                oscillator.start();

                const delay = audioContext.createDelay();
                delay.delayTime.value = 0.01;
                oscGain.connect(delay.delayTime);

                source.connect(filter);
                filter.connect(delay);
                lastNode = delay;
            } else if (currentEffect === 'chipmunk') {
                const highpass = audioContext.createBiquadFilter();
                highpass.type = 'highpass';
                highpass.frequency.value = 1200;
                source.connect(highpass);
                lastNode = highpass;
            } else if (currentEffect === 'deep') {
                const lowpass = audioContext.createBiquadFilter();
                lowpass.type = 'lowpass';
                lowpass.frequency.value = 300;
                source.connect(lowpass);
                lastNode = lowpass;
            }

            lastNode.connect(destination);
            processedStream = destination.stream;
            return processedStream;
        }

        // --- SETTINGS PREVIEW LOGIC ---
        const avatarInput = document.getElementById('settings-avatar');
        const avatarFileInput = document.getElementById('avatar-file-input');
        const avatarPreviewImg = document.querySelector('#settings-avatar-preview img');

        avatarInput.addEventListener('input', () => {
            if (avatarInput.value) avatarPreviewImg.src = avatarInput.value;
        });

        avatarFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    avatarPreviewImg.src = event.target.result;
                    avatarInput.value = event.target.result; // Put base64 in the URL input for convenience
                };
                reader.readAsDataURL(file);
            }
        });

        document.querySelectorAll('.effect-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                document.querySelectorAll('.effect-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentEffect = btn.getAttribute('data-effect');

                if (localStream) {
                    const targetStream = await applyAudioProcessing(localStream);
                    const newTrack = targetStream.getAudioTracks()[0];

                    Object.values(peerConnections).forEach(pc => {
                        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
                        if (sender) sender.replaceTrack(newTrack);
                    });
                }
            });
        });

        async function initLocalStream(withVideo = false) {
            try {
                // Check if we already have the requested tracks
                if (localStream) {
                    const hasVideo = localStream.getVideoTracks().length > 0;
                    if (!withVideo || hasVideo) {
                        // We already have what we need, or we don't need video
                        return localStream;
                    }
                }

                const constraints = {
                    audio: true,
                    video: withVideo ? { facingMode: "user" } : false
                };

                console.log("🎬 Requesting media with constraints:", constraints);
                const rawStream = await navigator.mediaDevices.getUserMedia(constraints);

                if (!localStream) {
                    localStream = rawStream;
                } else {
                    rawStream.getTracks().forEach(track => {
                        const exists = localStream.getTracks().find(t => t.kind === track.kind);
                        if (!exists) localStream.addTrack(track);
                    });
                }

                console.log("🎤 تم تفعيل الوسائط بنجاح");

                if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'assistant')) {
                    const audioTracks = localStream.getAudioTracks();
                    if (audioTracks.length > 0) {
                        const audioOnly = new MediaStream(audioTracks);
                        const processed = await applyAudioProcessing(audioOnly);
                        const combined = new MediaStream([
                            ...processed.getAudioTracks(),
                            ...localStream.getVideoTracks()
                        ]);
                        return combined;
                    }
                }
                return localStream;
            } catch (e) {
                console.error("Stream init error:", e);
                if (withVideo) {
                    alert("تعذر تشغيل الكاميرا. يرجى التأكد من إعطاء الصلاحيات.");
                } else {
                    alert("تعذر تشغيل الميكروفون. يرجى التأكد من إعطاء الصلاحيات.");
                }
                return null;
            }
        }

        async function callUser(targetSocketId) {
            if (peerConnections[targetSocketId]) return;

            const pc = new RTCPeerConnection(ICE_SERVERS);
            peerConnections[targetSocketId] = pc;

            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('voice_ice_candidate', { to: targetSocketId, candidate: event.candidate });
                }
            };

            pc.ontrack = (event) => {
                handleRemoteTrack(targetSocketId, event);
            };

            pc.onnegotiationneeded = async () => {
                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    socket.emit('voice_signal', { to: targetSocketId, signal: offer });
                } catch (err) { console.error(err); }
            };

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('voice_signal', { to: targetSocketId, signal: offer });
        }

        function handleRemoteTrack(socketId, event) {
            if (event.track.kind === 'audio') {
                console.log(`🔊 Receiving audio from: ${socketId}`);
                const remoteAudio = new Audio();
                remoteAudio.srcObject = event.streams[0];
                remoteAudio.autoplay = true;
                userAudios[socketId] = remoteAudio;
                remoteAudio.play().catch(err => console.error("Auto-play failed:", err));
            } else if (event.track.kind === 'video') {
                console.log(`📹 Receiving video from: ${socketId}`);
                renderRemoteVideo(socketId, event.streams[0]);
            }
        }

        function renderRemoteVideo(socketId, stream) {
            let grid = document.getElementById('voice-video-grid');
            let videoWrap = document.getElementById(`video-wrap-${socketId}`);
            if (!videoWrap) {
                videoWrap = document.createElement('div');
                videoWrap.id = `video-wrap-${socketId}`;
                videoWrap.className = 'video-item';
                const label = socketId === 'local' ? 'أنت' : (socketUsernameMap[socketId] || `مستخدم (${socketId.substring(0, 4)})`);
                videoWrap.innerHTML = `
            <video autoplay playsinline ${socketId === 'local' ? 'muted' : ''}></video>
            <div class="video-label">${label}</div>
        `;
                grid.appendChild(videoWrap);
            }
            const video = videoWrap.querySelector('video');
            if (video.srcObject !== stream) video.srcObject = stream;
        }

        socket.on('voice_signal', async (data) => {
            let pc = peerConnections[data.from];

            if (!pc) {
                pc = new RTCPeerConnection(ICE_SERVERS);
                peerConnections[data.from] = pc;

                localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

                pc.onicecandidate = (event) => {
                    if (event.candidate) {
                        socket.emit('voice_ice_candidate', { to: data.from, candidate: event.candidate });
                    }
                };

                pc.ontrack = (event) => {
                    handleRemoteTrack(data.from, event);
                };

                pc.onnegotiationneeded = async () => {
                    try {
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        socket.emit('voice_signal', { to: data.from, signal: offer });
                    } catch (err) { console.error(err); }
                };
            }

            if (data.signal.type === 'offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit('voice_signal', { to: data.from, signal: answer });
            } else if (data.signal.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
            }
        });

        socket.on('voice_ice_candidate', async (data) => {
            const pc = peerConnections[data.from];
            if (pc) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        });

        socket.on('screen_signal', async (data) => {
            let pc = screenConnections[data.from];
            if (!pc) {
                pc = new RTCPeerConnection(ICE_SERVERS);
                screenConnections[data.from] = pc;

                pc.ontrack = (event) => {
                    const stream = event.streams[0];
                    showRemoteScreen(data.from, stream);

                    // Remove video when stream ends
                    stream.getVideoTracks()[0].onended = () => {
                        const videoWrap = document.getElementById(`screen-video-${data.from}`);
                        if (videoWrap) videoWrap.remove();
                        if (screenConnections[data.from]) {
                            screenConnections[data.from].close();
                            delete screenConnections[data.from];
                        }
                    };
                };

                pc.onicecandidate = (event) => {
                    if (event.candidate) {
                        socket.emit('screen_ice_candidate', { to: data.from, candidate: event.candidate });
                    }
                };
            }

            if (data.signal.type === 'offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit('screen_signal', { to: data.from, signal: answer });
            } else if (data.signal.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
            }
        });

        socket.on('screen_ice_candidate', async (data) => {
            const pc = screenConnections[data.from];
            if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        });

        function showRemoteScreen(socketId, stream) {
            let container = document.getElementById('screens-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'screens-container';
                container.className = 'screens-container';
                document.body.appendChild(container);
            }

            let videoWrap = document.getElementById(`screen-video-${socketId}`);
            if (!videoWrap) {
                videoWrap = document.createElement('div');
                videoWrap.id = `screen-video-${socketId}`;
                videoWrap.className = 'screen-share-overlay';
                videoWrap.innerHTML = `
                <div class="screen-header">
                    <span>${socketId === 'local' ? 'معاينة شاشتك' : 'شاشة مشاركة'}</span>
                    <div class="screen-controls">
                        <button class="expand-screen" title="توسيع">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                            </svg>
                        </button>
                        <button class="close-screen" title="إغلاق">&times;</button>
                    </div>
                </div>
                <video autoplay playsinline muted></video>
            `;
                container.appendChild(videoWrap);

                const video = videoWrap.querySelector('video');
                const expandBtn = videoWrap.querySelector('.expand-screen');
                const closeBtn = videoWrap.querySelector('.close-screen');

                expandBtn.onclick = (e) => {
                    e.stopPropagation();
                    videoWrap.classList.toggle('fullscreen');
                };

                video.onclick = () => {
                    videoWrap.classList.toggle('fullscreen');
                };

                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    videoWrap.remove();
                    if (socketId === 'local') stopScreenShare();
                };
            }

            const video = videoWrap.querySelector('video');
            if (video.srcObject !== stream) {
                video.srcObject = stream;
            }

            // Handle stream end
            stream.getVideoTracks()[0].onended = () => {
                videoWrap.remove();
                if (socketId === 'local') stopScreenShare();
            };
        }

        // Handle updates to rooms to initiate calls
        socket.on('voice_state_update', async (rooms) => {
            // Find which room I am in
            // Update username map
            socketUsernameMap = {};
            Object.keys(rooms).forEach(rid => {
                rooms[rid].forEach(u => {
                    socketUsernameMap[u.socketId] = u.username;
                });
                if (rooms[rid].find(u => u.socketId === socket.id)) myRoomId = rid;
            });

            if (myRoomId && socket.id) {
                const currentRoomUsers = rooms[myRoomId];
                const otherUsers = currentRoomUsers.filter(u => u.socketId !== socket.id);
                const otherSocketIds = otherUsers.map(u => u.socketId);

                console.log(`🎙️ Voice Room Update: ${myRoomId}, Users: ${currentRoomUsers.length}`);

                // 1. تنظيف الاتصالات القديمة
                Object.keys(peerConnections).forEach(sid => {
                    if (!otherSocketIds.includes(sid)) {
                        console.log(`🔌 Closing connection with: ${sid}`);
                        if (peerConnections[sid]) peerConnections[sid].close();
                        delete peerConnections[sid];
                        if (userAudios[sid]) delete userAudios[sid];

                        const remoteVid = document.getElementById(`video-wrap-${sid}`);
                        if (remoteVid) remoteVid.remove();
                    }
                });

                // 2. إنشاء اتصالات جديدة (فقط إذا كان معرف السوكيت الخاص بي أكبر لتجنب التصادم)
                for (const user of otherUsers) {
                    // Voice Connection
                    if (!peerConnections[user.socketId] && socket.id > user.socketId) {
                        if (localStream) {
                            console.log(`📡 Initiating call to: ${user.username} (${user.socketId})`);
                            await callUser(user.socketId);
                        } else {
                            console.warn("⚠️ Cannot initiate call: localStream is not ready");
                        }
                    }

                    // Auto-share screen if already sharing
                    if (screenStream && !screenConnections[user.socketId]) {
                        console.log(`🖥️ Auto-sharing screen with joining user: ${user.username}`);
                        await shareScreenWith(user.socketId);
                    }
                }
            } else if (!myRoomId) {
                // أنا لست في أي غرفة، أغلق كل الاتصالات
                Object.keys(peerConnections).forEach(sid => {
                    peerConnections[sid].close();
                    delete peerConnections[sid];
                });
                userAudios = {};
            }

            // UI Update
            Object.keys(rooms).forEach(roomId => {
                const container = document.getElementById(`voice-members-${roomId}`);
                if (container) {
                    container.innerHTML = '';
                    rooms[roomId].forEach(user => {
                        const memberDiv = document.createElement('div');
                        memberDiv.className = 'voice-member-item';
                        const muteIcon = user.isMuted ? '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>' : '';
                        const deafIcon = user.isDeafened ? '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="1" y1="1" x2="23" y2="23"></line></svg>' : '';
                        const screenIcon = user.isSharingScreen ? '<div class="screen-indicator" title="يشارك الشاشة"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h7l-2 3v1h8v-1l-2-3h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 12H3V5h18v10z"/></svg> بث</div>' : '';

                        // Admin Actions
                        let adminActions = '';
                        if ((currentUser.role === 'admin' || currentUser.role === 'assistant') && user.socketId !== socket.id) {
                            adminActions = `
                            <div class="admin-actions-group">
                                <button class="admin-action-btn" onclick="requestMoveUser('${user.socketId}', '${roomId}')" title="نقل">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3l4 4-4 4"></path><path d="M20 7H4"></path><path d="M8 21l-4-4 4-4"></path><path d="M4 17h16"></path></svg>
                                </button>
                                <button class="admin-action-btn" onclick="toggleForceMute('${user.socketId}', ${user.isMuted})" title="${user.isMuted ? 'إلغاء الكتم' : 'كتم إجباري'}">
                                    ${user.isMuted ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>'}
                                </button>
                                <button class="admin-action-btn kick" onclick="requestKickUser('${user.socketId}')" title="طرد">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                                </button>
                            </div>
                        `;
                        }

                        // Volume Control for others
                        let volumeControl = '';
                        if (user.socketId !== socket.id) {
                            volumeControl = `
                            <div class="user-volume-control">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-muted)"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                                <input type="range" min="0" max="1" step="0.1" value="1" oninput="setUserVolume('${user.socketId}', this.value)">
                            </div>
                        `;
                        }

                        const verifiedHtml = user.isVerified ? '<span class="verified-badge" title="حساب موثق" style="margin-left:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"></path></svg></span>' : '';
                        const avatarSrc = user.avatar || 'logo.png';
                        const customStatusHtml = user.customStatus ? `<div class="member-custom-status">${user.customStatus}</div>` : '';

                        memberDiv.innerHTML = `
                        <div class="voice-member-avatar">
                             <img src="${avatarSrc}" style="width:100%; height:100%; object-fit: cover; border-radius:50%">
                             <div class="status-indicator-mini ${user.status || 'online'}"></div>
                        </div>
                        <div class="member-voice-details">
                            <span class="member-name" style="${(user.role === 'admin' || user.role === 'assistant') ? (user.role === 'admin' ? 'color: var(--admin-gold)' : 'color: var(--assistant-gold)') : ''}">${user.username}${verifiedHtml}</span>
                            ${customStatusHtml}
                            ${volumeControl}
                        </div>
                        <div class="voice-status-icons">${screenIcon}${muteIcon}${deafIcon}</div>
                        ${adminActions}
                    `;
                        container.appendChild(memberDiv);
                    });
                }
            });
        });

        socket.on('force_move_voice', async (data) => {
            const targetChan = document.querySelector(`.voice-channel[data-room-id="${data.targetRoomId}"]`);
            if (targetChan) targetChan.click();
            console.log("✈️ تم نقلك إلى غرفة أخرى بواسطة المدير");
        });

        socket.on('force_mute_voice', (data) => {
            const action = data.action || 'mute';
            if (action === 'mute' && !localVoiceStatus.isMuted) {
                document.getElementById('mute-btn').click();
                alert("⚠️ تم كتم ميكروفونك بواسطة المدير");
            } else if (action === 'unmute' && localVoiceStatus.isMuted) {
                document.getElementById('mute-btn').click();
                alert("🔊 تم إلغاء كتم ميكروفونك بواسطة المدير");
            }
        });

        socket.on('force_kick_voice', () => {
            document.getElementById('leave-voice-btn').click();
            alert("🚫 تم طردك من الغرفة الصوتية بواسطة المدير");
        });

        window.requestMoveUser = function (socketId, currentRoomId) {
            const otherRoomId = currentRoomId === 'waiting-room' ? 'lounge' : 'waiting-room';
            socket.emit('move_user_voice', { targetSocketId: socketId, targetRoomId: otherRoomId });
        };

        window.toggleForceMute = function (socketId, currentMuted) {
            if (currentMuted) {
                socket.emit('force_unmute_user_voice', { targetSocketId: socketId });
            } else {
                socket.emit('force_mute_user_voice', { targetSocketId: socketId });
            }
        };

        window.setUserVolume = function (socketId, volume) {
            if (userAudios[socketId]) {
                userAudios[socketId].volume = volume;
            }
        };

        window.requestKickUser = function (socketId) {
            if (confirm("هل أنت متأكد من طرد هذا المستخدم؟")) {
                socket.emit('kick_user_voice', { targetSocketId: socketId });
            }
        };

        document.getElementById('mute-all-btn').addEventListener('click', () => {
            let myRoomId = null;
            document.querySelectorAll('.voice-channel').forEach(chan => {
                if (chan.classList.contains('active')) myRoomId = chan.getAttribute('data-room-id');
            });
            if (myRoomId) {
                socket.emit('mute_all_voice', { roomId: myRoomId });
                alert("🔇 تم إرسال أمر كتم لجميع الأعضاء في الغرفة");
            }
        });

        // Modified Logic for joining
        const voiceChannels = document.querySelectorAll('.voice-channel');
        voiceChannels.forEach(chan => {
            chan.addEventListener('click', async () => {
                const stream = await initLocalStream();
                if (!stream) return;

                const roomId = chan.getAttribute('data-room-id');
                const roomName = chan.querySelector('.channel-name').innerText;
                socket.emit('join_voice', roomId);

                document.getElementById('voice-controls').style.display = 'flex';
                document.getElementById('floating-voice-bar').style.display = 'flex';
                document.getElementById('floating-room-name').innerText = roomName;
                document.querySelector('.voice-info .room-name').innerText = roomName;
                document.querySelectorAll('.voice-channel').forEach(c => c.classList.remove('active'));
                chan.classList.add('active');
            });
        });

        async function shareScreenWith(sid) {
            if (!screenStream || screenConnections[sid]) return;

            try {
                const pc = new RTCPeerConnection(ICE_SERVERS);
                screenConnections[sid] = pc;

                screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));

                pc.onicecandidate = (event) => {
                    if (event.candidate) {
                        socket.emit('screen_ice_candidate', { to: sid, candidate: event.candidate });
                    }
                };

                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socket.emit('screen_signal', { to: sid, signal: offer });
            } catch (err) {
                console.error(`Failed to share screen with ${sid}:`, err);
            }
        }

        document.getElementById('screen-share-btn').addEventListener('click', async () => {
            if (screenStream) {
                stopScreenShare();
                return;
            }

            // التحقق من دعم مشاركة الشاشة
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                const isAndroid = /Android/.test(navigator.userAgent);
                const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

                let errorMsg = "عذراً، مشاركة الشاشة غير مدعومة في متصفحك الحالي.";

                if (isIOS) {
                    errorMsg = "على آيفون، يرجى استخدام الكاميرا أو الدخول من جهاز كمبيوتر للمشاركة.";
                } else if (isAndroid) {
                    errorMsg = "بسبب قيود أندرويد، قد لا تعمل المشاركة من المتصفح العادي. \n\nجرب الحل الآتي:\n1. استخدم متصفح Firefox أو Kiwi.\n2. قم بتفعيل خيار 'إصدار سطح المكتب' (Desktop Site).\n3. حاول مرة أخرى.";
                } else if (!window.isSecureContext) {
                    errorMsg = "يجب استخدام HTTPS (رابط آمن) لمشاركة الشاشة.";
                }

                alert(errorMsg);
                return;
            }

            console.log("📱 محاولة تشغيل مشاركة الشاشة على الأجهزة المحمولة...");
            try {
                const constraints = {
                    video: {
                        cursor: "always",
                        displaySurface: "monitor" // بعض متصفحات الأندرويد تفضل هذه التعريفات
                    },
                    audio: false
                };

                console.log("🖥️ Starting screen share...");
                screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
                document.getElementById('screen-share-btn').classList.add('active');

                // Show local preview
                showRemoteScreen('local', screenStream);

                screenStream.getVideoTracks()[0].onended = () => stopScreenShare();

                // Notify others in room
                Object.keys(peerConnections).forEach(async (sid) => {
                    await shareScreenWith(sid);
                });

                localVoiceStatus.isSharingScreen = true;
                socket.emit('update_voice_status', localVoiceStatus);
            } catch (e) {
                console.error("Screen share error:", e);
                if (e.name === 'NotAllowedError') {
                    // User cancelled or permission denied
                } else {
                    alert("حدث خطأ أثناء محاولة مشاركة الشاشة: " + e.message);
                }
            }
        });

        function stopScreenShare() {
            if (screenStream) {
                screenStream.getTracks().forEach(t => t.stop());
                screenStream = null;
            }
            const localPreview = document.getElementById('screen-video-local');
            if (localPreview) localPreview.remove();

            Object.values(screenConnections).forEach(pc => pc.close());
            screenConnections = {};
            document.getElementById('screen-share-btn').classList.remove('active');

            localVoiceStatus.isSharingScreen = false;
            if (socket) socket.emit('update_voice_status', localVoiceStatus);
        }

        let localVoiceStatus = { isMuted: false, isDeafened: false, isSharingScreen: false, isVideoOn: false };

        document.getElementById('video-btn').addEventListener('click', async () => {
            localVoiceStatus.isVideoOn = !localVoiceStatus.isVideoOn;
            const btn = document.getElementById('video-btn');
            btn.classList.toggle('active', localVoiceStatus.isVideoOn);

            if (localVoiceStatus.isVideoOn) {
                const stream = await initLocalStream(true);
                if (stream) {
                    const videoTrack = stream.getVideoTracks()[0];
                    // Add track to all active peer connections
                    Object.values(peerConnections).forEach(pc => {
                        const senders = pc.getSenders();
                        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                        if (videoSender) {
                            videoSender.replaceTrack(videoTrack);
                        } else {
                            pc.addTrack(videoTrack, localStream);
                        }
                    });
                    renderRemoteVideo('local', localStream);
                }
            } else {
                // Stop camera tracks
                if (localStream) {
                    localStream.getVideoTracks().forEach(t => {
                        t.stop();
                        localStream.removeTrack(t);
                    });
                }
                const localVid = document.getElementById('video-wrap-local');
                if (localVid) localVid.remove();

                // Remove video track from connections
                Object.values(peerConnections).forEach(pc => {
                    const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (videoSender) pc.removeTrack(videoSender);
                });
            }
            socket.emit('update_voice_status', localVoiceStatus);
        });

        // Floating Voice Bar listeners
        document.getElementById('float-mute-btn').addEventListener('click', () => {
            document.getElementById('mute-btn').click();
        });
        document.getElementById('float-deafen-btn').addEventListener('click', () => {
            document.getElementById('deafen-btn').click();
        });
        document.getElementById('float-leave-btn').addEventListener('click', () => {
            document.getElementById('leave-voice-btn').click();
        });

        document.getElementById('mute-btn').addEventListener('click', () => {
            localVoiceStatus.isMuted = !localVoiceStatus.isMuted;
            document.getElementById('mute-btn').classList.toggle('active', localVoiceStatus.isMuted);
            const floatMute = document.getElementById('float-mute-btn');
            if (floatMute) floatMute.classList.toggle('active', localVoiceStatus.isMuted);

            if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = !localVoiceStatus.isMuted);
            socket.emit('update_voice_status', localVoiceStatus);
        });

        document.getElementById('deafen-btn').addEventListener('click', () => {
            localVoiceStatus.isDeafened = !localVoiceStatus.isDeafened;
            document.getElementById('deafen-btn').classList.toggle('active', localVoiceStatus.isDeafened);
            const floatDeaf = document.getElementById('float-deafen-btn');
            if (floatDeaf) floatDeaf.classList.toggle('active', localVoiceStatus.isDeafened);

            if (localVoiceStatus.isDeafened) {
                localVoiceStatus.isMuted = true;
                document.getElementById('mute-btn').classList.add('active');
                const floatMute = document.getElementById('float-mute-btn');
                if (floatMute) floatMute.classList.add('active');
                if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = false);
            }
            socket.emit('update_voice_status', localVoiceStatus);
        });

        document.getElementById('leave-voice-btn').addEventListener('click', () => {
            socket.emit('leave_voice');
            document.getElementById('voice-controls').style.display = 'none';
            document.getElementById('floating-voice-bar').style.display = 'none';
            document.querySelectorAll('.voice-channel').forEach(c => c.classList.remove('active'));

            Object.values(peerConnections).forEach(pc => pc.close());
            peerConnections = {};
            if (localStream) {
                localStream.getTracks().forEach(t => t.stop());
                localStream = null;
            }

            stopScreenShare();

            // Clear Video Grid
            document.getElementById('voice-video-grid').innerHTML = '';
            document.getElementById('video-btn').classList.remove('active');

            localVoiceStatus = { isMuted: false, isDeafened: false, isSharingScreen: false, isVideoOn: false };
            document.getElementById('mute-btn').classList.remove('active');
            document.getElementById('deafen-btn').classList.remove('active');
            const floatMute = document.getElementById('float-mute-btn');
            const floatDeaf = document.getElementById('float-deafen-btn');
            if (floatMute) floatMute.classList.remove('active');
            if (floatDeaf) floatDeaf.classList.remove('active');
            userAudios = {};
        });

        document.getElementById('message-input').onkeypress = (e) => {
            if (socket) socket.emit('typing', { isTyping: true });

            clearTimeout(window.typingTimer);
            window.typingTimer = setTimeout(() => {
                if (socket) socket.emit('typing', { isTyping: false });
            }, 2000);

            if (e.key === 'Enter' && e.target.value.trim() !== '') {
                sendMessage(e.target.value);
                e.target.value = '';
            }
        };

        // Music Bot Admin Controls
        document.getElementById('play-music-btn').addEventListener('click', () => {
            const url = document.getElementById('music-url').value;
            if (url && (currentUser.role === 'admin' || currentUser.role === 'assistant')) {
                socket.emit('play_music_req', { url });
            }
        });

        document.getElementById('stop-music-btn').addEventListener('click', () => {
            if (currentUser.role === 'admin' || currentUser.role === 'assistant') {
                socket.emit('stop_music_req');
            }
        });

        document.getElementById('refresh-sound-btn').addEventListener('click', () => {
            if (ytPlayer && ytPlayer.playVideo) {
                ytPlayer.playVideo();
                ytPlayer.unMute();
                ytPlayer.setVolume(100);
                alert("تمت محاولة تنشيط الصوت بنجاح!");
            } else {
                alert("لا يوجد بث يوتيوب حالياً لتنشيطه.");
            }
        });
    }

    function sendMessage(text, attachment = null) {
        if (!socket) return;

        const payload = {
            text: text,
            replyTo: replyingTo,
            serverId: activeContext.serverId || 'global-server',
            ...attachment
        };

        if (activeContext.type === 'channel') {
            socket.emit('send_message', payload);
        } else {
            payload.to = activeContext.id;
            socket.emit('send_dm', payload);
        }
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
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }

    function parseDiscordMarkdown(text) {
        if (!text) return '';

        // Escaping HTML
        let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Links
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        html = html.replace(urlRegex, '<a href="$1" target="_blank" style="color: #00a8fc; text-decoration: none;">$1</a>');

        // Bold **text**
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Italic *text* or _text_
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        html = html.replace(/_(.*?)_/g, '<em>$1</em>');

        // Underline __text__
        html = html.replace(/__(.*?)__/g, '<span style="text-decoration: underline;">$1</span>');

        // Strikethrough ~~text~~
        html = html.replace(/~~(.*?)~~/g, '<del>$1</del>');

        // Inline Code `text`
        html = html.replace(/`(.*?)`/g, '<code style="background: rgba(0,0,0,0.3); padding: 2px 4px; border-radius: 4px; font-family: monospace;">$1</code>');

        // Code blocks ```text```
        html = html.replace(/```([\s\S]*?)```/g, '<pre style="background: #2b2d31; padding: 10px; border-radius: 8px; margin: 8px 0; overflow-x: auto; border: 1px solid rgba(255,255,255,0.05); font-family: monospace;">$1</pre>');

        return html;
    }

    function renderMessage(msg) {
        const container = document.getElementById('messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';
        messageDiv.setAttribute('data-id', msg._id);

        const time = new Date(msg.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
        const isAdmin = msg.role === 'admin';
        const isAssistant = msg.role === 'assistant';
        const canDelete = currentUser.role === 'admin' || currentUser.role === 'assistant';
        const deleteHtml = canDelete ? `<span class="delete-btn" onclick="deleteMsg('${msg._id}')">حذف</span>` : '';

        let tagHtml = '';
        let authorColor = '';

        // Custom Role Display
        if (msg.customRoleColor) {
            authorColor = `color: ${msg.customRoleColor}`;
            tagHtml = `<span class="admin-tag" style="background: ${msg.customRoleColor}">${msg.customRoleName || 'ROLE'}</span>`;
        } else if (isAdmin) {
            tagHtml = '<span class="admin-tag">ADMIN</span>';
            authorColor = 'color: var(--admin-gold)';
        } else if (isAssistant) {
            tagHtml = '<span class="admin-tag" style="background: #718096;">MOD</span>';
            authorColor = 'color: var(--assistant-gold)';
        }

        const verifiedHtml = msg.isVerified ? '<span class="verified-badge" title="حساب موثق"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"></path></svg></span>' : '';
        const avatarSrc = msg.avatar || 'logo.png';
        const authorName = msg.author || msg.from;

        let mediaHtml = '';
        if (msg.file) {
            const isImage = (msg.fileType && msg.fileType.startsWith('image/')) || msg.file.startsWith('data:image/');
            if (isImage) {
                mediaHtml = `<div class="image-wrapper"><img src="${msg.file}" class="message-image" loading="lazy" onclick="window.open('${msg.file}')"></div>`;
            } else {
                mediaHtml = `<div class="file-attachment">📂 <a href="${msg.file}" download="${msg.fileName || 'file'}">${msg.fileName || 'تحميل الملف'}</a></div>`;
            }
        }

        let replyHtml = '';
        if (msg.replyTo) {
            replyHtml = `
            <div class="reply-to-content" onclick="scrollToMessage('${msg.replyTo.id}')">
                <span class="reply-to-user">@${msg.replyTo.author}</span>
                <span class="reply-to-text">${msg.replyTo.text}</span>
            </div>
        `;
        }

        let reactionsHtml = '<div class="reactions-container">';
        if (msg.reactions) {
            Object.entries(msg.reactions).forEach(([emoji, users]) => {
                const activeClass = users.includes(currentUser.username) ? 'active' : '';
                reactionsHtml += `
                <div class="reaction-badge ${activeClass}" onclick="addReaction('${msg._id}', '${emoji}')">
                    <span>${emoji}</span>
                    <span class="reaction-count">${users.length}</span>
                </div>
            `;
            });
        }
        reactionsHtml += '</div>';

        const parsedText = parseDiscordMarkdown(msg.text);

        messageDiv.innerHTML = `
        <div class="message-avatar">
            <img src="${avatarSrc}" style="width:100%; height:100%; object-fit: cover; border-radius:50%">
        </div>
        <div class="message-content">
            ${replyHtml}
            <div class="message-header">
                <span class="author" style="${authorColor}">${authorName}</span>
                <span class="user-level-badge">Lvl ${msg.level || 1}</span>
                ${verifiedHtml}
                ${tagHtml}
                <span class="timestamp">${time}</span>
                ${deleteHtml}
                <div class="message-actions">
                    <button class="action-icon" title="رد" onclick="setReply('${msg._id}', '${authorName}', '${(msg.text || 'صورة/ملف').replace(/'/g, "\\'")}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg>
                    </button>
                    <button class="action-icon" title="تفاعل" onclick="addReaction('${msg._id}', '❤️')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                    </button>
                    <button class="action-icon" onclick="addReaction('${msg._id}', '👍')">👍</button>
                    <button class="action-icon" onclick="addReaction('${msg._id}', '😂')">😂</button>
                    <button class="action-icon" onclick="addReaction('${msg._id}', '🔥')">🔥</button>
                    <button class="action-icon" onclick="addReaction('${msg._id}', '💯')">💯</button>
                </div>
            </div>
            <p class="text">${parsedText}</p>
            ${mediaHtml}
            ${reactionsHtml}
        </div>
    `;
        container.appendChild(messageDiv);
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }

    window.addReaction = function (messageId, emoji) {
        if (socket) socket.emit('add_reaction', { messageId, emoji });
    };

    window.scrollToMessage = function (id) {
        const el = document.querySelector(`[data-id="${id}"]`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.style.backgroundColor = 'rgba(222, 75, 57, 0.2)';
            setTimeout(() => el.style.backgroundColor = '', 2000);
        }
    };

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
    window.resolveServerRequest = function (requestId, action) {
        if (confirm(`هل أنت متأكد من ${action === 'approve' ? 'قبول' : 'رفض'} هذا الطلب؟`)) {
            socket.emit('resolve_server_request', { requestId, action });
        }
    };

    function renderServers(servers) {
        const sidebar = document.querySelector('.server-sidebar');
        if (!sidebar) return;
        // Keep internal ones or clear and rebuild
        const existingIcons = sidebar.querySelectorAll('.server-icon:not(.add-server):not(.separator)');
        existingIcons.forEach(icon => icon.remove());

        const addBtn = sidebar.querySelector('.add-server');

        servers.forEach(srv => {
            const div = document.createElement('div');
            div.className = 'server-icon';
            if (activeContext.serverId === srv._id) div.classList.add('active');
            div.title = srv.name;

            if (srv.icon === 'logo.png' || !srv.icon) {
                div.innerHTML = `<span class="server-initials">${srv.name.substring(0, 2)}</span>`;
            } else {
                div.innerHTML = `<img src="${srv.icon}" alt="${srv.name}" style="width:100%; border-radius:50%">`;
            }

            div.onclick = () => switchToServer(srv);
            sidebar.insertBefore(div, addBtn);
        });
    }

    function renderRoles(roles) {
        const list = document.getElementById('admin-roles-list');
        if (!list) return;
        list.innerHTML = '';
        if (!roles || roles.length === 0) {
            list.innerHTML = '<p class="empty-msg">لا توجد رتب إضافية.</p>';
            return;
        }
        roles.forEach(r => {
            const div = document.createElement('div');
            div.className = 'role-item';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.style.padding = '8px';
            div.style.background = 'rgba(255,255,255,0.05)';
            div.style.borderRadius = '4px';
            div.style.marginTop = '4px';
            div.style.borderRight = `4px solid ${r.color}`;

            div.innerHTML = `
                <span style="font-weight:bold; color:var(--text-normal)">${r.name}</span>
                <div style="display:flex; gap:10px; align-items:center">
                    <span style="color:${r.color}; font-size:12px; font-family:monospace">${r.color}</span>
                </div>
            `;
            list.appendChild(div);
        });
    }

    // Message Input Typing Listener
    const msgInput = document.getElementById('message-input');
    if (msgInput) {
        msgInput.addEventListener('input', () => {
            if (socket) {
                if (!typingTimeout) {
                    socket.emit('typing', { isTyping: true, serverId: activeContext.serverId });
                }

                clearTimeout(typingTimeout);
                typingTimeout = setTimeout(() => {
                    socket.emit('typing', { isTyping: false, serverId: activeContext.serverId });
                    typingTimeout = null;
                }, 3000);
            }
        });
    }

    function switchToServer(server) {
        activeContext.serverId = server._id;
        document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));

        // UI Update for sidebar icons
        const icons = document.querySelectorAll('.server-icon');
        icons.forEach(ic => {
            if (ic.title === server.name) ic.classList.add('active');
        });

        // Update channels UI
        const headerTitle = document.querySelector('.sidebar-header h1');
        if (headerTitle) headerTitle.innerText = server.name;

        // Switch to first channel or default
        const channelName = (server.channels && server.channels.length > 0) ? server.channels[0].name : 'العامة';
        activeContext.id = channelName;
        const channelDisplay = document.getElementById('current-channel-name');
        if (channelDisplay) channelDisplay.innerText = channelName;
        const input = document.getElementById('message-input');
        if (input) input.placeholder = `أرسل رسالة في #${channelName}`;

        // Clear and reload messages for this server
        const msgContainer = document.getElementById('messages');
        if (msgContainer) {
            msgContainer.innerHTML = '';
            socket.emit('get_previous_messages', { serverId: server._id });
        }
    }


    // --- Global Functions for HTML onClick ---
    window.addEmoji = function (emoji) {
        const input = document.getElementById('message-input');
        input.value += emoji;
        input.focus();
        document.getElementById('emoji-picker').style.display = 'none';

        // Trigger generic input event for typing indicator
        const event = new Event('input', { bubbles: true });
        input.dispatchEvent(event);
    };

    window.createRole = function () {
        if (currentUser.role !== 'admin' && currentUser.role !== 'assistant') return alert('ليس لديك صلاحية!');
        const name = document.getElementById('new-role-name').value;
        const color = document.getElementById('new-role-color').value;
        if (!name) return alert('يرجى إدخال اسم الرتبة');

        // Optimistically add to UI or wait for server?
        // Let's emit to server (assuming server handles it - if not we'd need to add endpoint, but let's assume valid flow)
        // Check if socket exists
        if (socket) {
            socket.emit('create_role', { name, color });
            document.getElementById('new-role-name').value = '';
        } else {
            console.error("Socket not connected");
        }
    };
});
