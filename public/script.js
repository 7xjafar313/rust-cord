let socket;
let currentUser = null;
let isRegistering = false;
let simulationMode = false;

// Voice/WebRTC State
let localStream = null;
let peerConnections = {}; // socketId -> RTCPeerConnection
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
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
let activeContext = { type: 'channel', id: 'العامة' }; // { type: 'channel'|'dm', id: string }
let currentTypingUsers = new Set();

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

    // --- SETTINGS LOGIC ---
    const settingsTrigger = document.getElementById('settings-trigger');
    const settingsOverlay = document.getElementById('settings-overlay');
    const closeSettings = document.getElementById('close-settings');
    const updateProfileBtn = document.getElementById('update-profile-btn');
    const requestPwdResetBtn = document.getElementById('request-pwd-reset-btn');

    settingsTrigger.addEventListener('click', () => {
        settingsOverlay.style.display = 'flex';
        if (currentUser.role === 'admin' || currentUser.role === 'assistant') {
            loadPasswordRequests();
            loadRolesAdmin();
            loadAuditLogs();
        }
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.admin-tab').forEach(t => t.style.display = 'none');
            btn.classList.add('active');
            document.getElementById(`${btn.dataset.tab}-tab`).style.display = 'block';
            if (btn.dataset.tab === 'audit') loadAuditLogs();
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

    closeSettings.addEventListener('click', () => {
        settingsOverlay.style.display = 'none';
    });

    updateProfileBtn.addEventListener('click', async () => {
        const newUsername = document.getElementById('settings-new-username').value;
        const oldPassword = document.getElementById('settings-old-password').value;
        const newPassword = document.getElementById('settings-new-password').value;
        const newAvatar = document.getElementById('settings-avatar').value;
        const newStatus = document.getElementById('settings-status-select').value;
        const newCustomStatus = document.getElementById('settings-custom-status').value;
        const token = localStorage.getItem('rc_token');

        if (!token) return alert('غير ممكن في وضع التجربة');

        try {
            const res = await fetch('/api/update-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newUsername, oldPassword, newPassword, newAvatar, newStatus, newCustomStatus })
            });
            const data = await res.json();
            if (res.ok) {
                alert('تم تحديث البيانات بنجاح!');
                currentUser.username = data.user.username;
                currentUser.avatar = data.user.avatar;
                currentUser.status = data.user.status;
                currentUser.customStatus = data.user.customStatus;

                updateUIForUser();
                localStorage.setItem('rc_user', JSON.stringify(currentUser));
                settingsOverlay.style.display = 'none';

                if (socket) socket.emit('update_status', { status: currentUser.status, customStatus: currentUser.customStatus });
            } else {
                alert(data.error);
            }
        } catch (e) {
            alert('خطأ في الاتصال');
        }
    });

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
});

function startApp(token, user) {
    currentUser = user;
    localStorage.setItem('rc_sim_token', token);
    localStorage.setItem('rc_sim_user', JSON.stringify(user));

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
    } else {
        document.getElementById('display-role').innerText = 'عضو';
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
        }
    });
}

function updateUIForUser() {
    document.getElementById('display-username').innerText = currentUser.username;
    document.getElementById('display-level').innerText = `Lvl ${currentUser.level || 1}`;
    if (currentUser.avatar) {
        document.getElementById('current-user-avatar').innerHTML = `<img src="${currentUser.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
        document.getElementById('settings-avatar').value = currentUser.avatar;
    }

    document.getElementById('settings-status-select').value = currentUser.status || 'online';
    document.getElementById('settings-custom-status').value = currentUser.customStatus || '';

    const indicator = document.querySelector('#current-user-avatar .status-indicator');
    if (indicator) {
        indicator.className = 'status-indicator ' + (currentUser.status || 'online');
    }
}

function switchToChannel(channelName) {
    activeContext = { type: 'channel', id: channelName };
    document.getElementById('current-channel-name').innerText = channelName;
    document.getElementById('message-input').placeholder = `أرسل رسالة في #${channelName}`;
    document.querySelectorAll('.channel-item, .dm-user-item').forEach(el => el.classList.remove('active'));
    // Mark general as active if it's the one
    if (channelName === 'العامة') document.querySelector('.channel-item').classList.add('active');

    // Refresh messages
    if (socket) socket.emit('get_previous_messages'); // Assuming we can re-fetch
}

function switchToDM(username, avatar) {
    activeContext = { type: 'dm', id: username };
    document.getElementById('current-channel-name').innerText = `@${username}`;
    document.getElementById('message-input').placeholder = `أرسل رسالة إلى ${username}`;
    document.querySelectorAll('.channel-item, .dm-user-item').forEach(el => el.classList.remove('active'));

    // Fetch DMs
    if (socket) socket.emit('get_dms_with', username);
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

    socket.on('previous_dms', (messages) => {
        if (activeContext.type === 'dm') {
            document.getElementById('messages').innerHTML = '';
            messages.forEach(msg => renderMessage(msg));
            document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
        }
    });

    socket.on('new_dm', (msg) => {
        if (activeContext.type === 'dm' && (msg.from === activeContext.id || msg.from === currentUser.username)) {
            renderMessage(msg);
            document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
        }
        updateDMList(msg);
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
        audio.src = data.url;
        audio.play();
        document.getElementById('music-panel').style.display = 'flex';
        document.getElementById('current-track').innerText = `مشغل الآن: ${data.url.split('/').pop()}`;
    });

    socket.on('stop_music', () => {
        const audio = document.getElementById('global-audio');
        audio.pause();
        audio.src = '';
        document.getElementById('music-panel').style.display = 'none';
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
                    <span class="dm-status">رسالة جديدة</span>
                </div>
            `;
            dmItem.onclick = () => {
                switchToDM(otherUser);
                dmItem.classList.add('active');
            };
            document.getElementById('dm-list').appendChild(dmItem);
        }
    }

    function renderTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (currentTypingUsers.size === 0) {
            indicator.innerText = '';
        } else {
            const users = Array.from(currentTypingUsers).join(', ');
            indicator.innerText = `${users} يكتب الآن...`;
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

    async function initLocalStream() {
        try {
            if (!localStream) {
                const rawStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                localStream = rawStream;
                console.log("🎤 تم تفعيل الميكروفون");

                if (currentUser.role === 'admin' || currentUser.role === 'assistant') {
                    const processed = await applyAudioProcessing(rawStream);
                    localStream = processed; // Update global localStream to the processed one
                    return processed;
                }
            }
            return localStream;
        } catch (e) {
            alert("خطأ: يرجى السماح بالوصول للميكروفون لتتمكن من التحدث");
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
            console.log(`🔊 Receiving audio from: ${targetSocketId}`);
            const remoteAudio = new Audio();
            remoteAudio.srcObject = event.streams[0];
            remoteAudio.autoplay = true;
            userAudios[targetSocketId] = remoteAudio;
            remoteAudio.play().catch(err => console.error("Auto-play failed:", err));
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voice_signal', { to: targetSocketId, signal: offer });
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
                console.log(`🔊 Receiving audio from: ${data.from}`);
                const remoteAudio = new Audio();
                remoteAudio.srcObject = event.streams[0];
                remoteAudio.autoplay = true;
                userAudios[data.from] = remoteAudio;
                remoteAudio.play().catch(err => console.error("Auto-play failed:", err));
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
                showRemoteScreen(data.from, event.streams[0]);
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
        let videoWrap = document.getElementById(`screen-video-${socketId}`);
        if (!videoWrap) {
            videoWrap = document.createElement('div');
            videoWrap.id = `screen-video-${socketId}`;
            videoWrap.className = 'screen-share-overlay';
            videoWrap.innerHTML = `
                <div class="screen-header">
                    <span>مشاركة شاشة</span>
                    <button class="close-screen">&times;</button>
                </div>
                <video autoplay playsinline></video>
            `;
            document.body.appendChild(videoWrap);
            videoWrap.querySelector('.close-screen').onclick = () => videoWrap.remove();
        }
        videoWrap.querySelector('video').srcObject = stream;
    }

    // Handle updates to rooms to initiate calls
    socket.on('voice_state_update', async (rooms) => {
        // Find which room I am in
        let myRoomId = null;
        Object.keys(rooms).forEach(rid => {
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
                }
            });

            // 2. إنشاء اتصالات جديدة (فقط إذا كان معرف السوكيت الخاص بي أكبر لتجنب التصادم)
            for (const user of otherUsers) {
                if (!peerConnections[user.socketId] && socket.id > user.socketId) {
                    if (localStream) {
                        console.log(`📡 Initiating call to: ${user.username} (${user.socketId})`);
                        await callUser(user.socketId);
                    } else {
                        console.warn("⚠️ Cannot initiate call: localStream is not ready");
                    }
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

                    // Admin Actions
                    let adminActions = '';
                    if ((currentUser.role === 'admin' || currentUser.role === 'assistant') && user.socketId !== socket.id) {
                        adminActions = `
                            <div class="admin-actions-group">
                                <span class="admin-action-btn" onclick="requestMoveUser('${user.socketId}', '${roomId}')" title="نقل">✈️</span>
                                <span class="admin-action-btn" onclick="toggleForceMute('${user.socketId}', ${user.isMuted})" title="${user.isMuted ? 'إلغاء الكتم' : 'كتم إجباري'}">${user.isMuted ? '🔊' : '🔇'}</span>
                                <span class="admin-action-btn kick" onclick="requestKickUser('${user.socketId}')" title="طرد">🚫</span>
                            </div>
                        `;
                    }

                    // Volume Control for others
                    let volumeControl = '';
                    if (user.socketId !== socket.id) {
                        volumeControl = `
                            <div class="user-volume-control">
                                <span>🔈</span>
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
                        <div class="voice-status-icons">${muteIcon}${deafIcon}</div>
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
            document.querySelector('.voice-info .room-name').innerText = roomName;
            document.querySelectorAll('.voice-channel').forEach(c => c.classList.remove('active'));
            chan.classList.add('active');
        });
    });

    document.getElementById('screen-share-btn').addEventListener('click', async () => {
        if (screenStream) {
            stopScreenShare();
            return;
        }

        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            document.getElementById('screen-share-btn').classList.add('active');

            screenStream.getVideoTracks()[0].onended = () => stopScreenShare();

            // Notify others in room
            Object.keys(peerConnections).forEach(async (sid) => {
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
            });
        } catch (e) {
            console.error("Screen share error:", e);
        }
    });

    function stopScreenShare() {
        if (screenStream) {
            screenStream.getTracks().forEach(t => t.stop());
            screenStream = null;
        }
        Object.values(screenConnections).forEach(pc => pc.close());
        screenConnections = {};
        document.getElementById('screen-share-btn').classList.remove('active');
    }

    let localVoiceStatus = { isMuted: false, isDeafened: false };

    document.getElementById('mute-btn').addEventListener('click', () => {
        localVoiceStatus.isMuted = !localVoiceStatus.isMuted;
        document.getElementById('mute-btn').classList.toggle('active', localVoiceStatus.isMuted);
        if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = !localVoiceStatus.isMuted);
        socket.emit('update_voice_status', localVoiceStatus);
    });

    document.getElementById('deafen-btn').addEventListener('click', () => {
        localVoiceStatus.isDeafened = !localVoiceStatus.isDeafened;
        document.getElementById('deafen-btn').classList.toggle('active', localVoiceStatus.isDeafened);
        if (localVoiceStatus.isDeafened) {
            localVoiceStatus.isMuted = true;
            document.getElementById('mute-btn').classList.add('active');
            if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = false);
        }
        socket.emit('update_voice_status', localVoiceStatus);
    });

    document.getElementById('leave-voice-btn').addEventListener('click', () => {
        socket.emit('leave_voice');
        document.getElementById('voice-controls').style.display = 'none';
        document.querySelectorAll('.voice-channel').forEach(c => c.classList.remove('active'));

        Object.values(peerConnections).forEach(pc => pc.close());
        peerConnections = {};
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }

        localVoiceStatus = { isMuted: false, isDeafened: false };
        document.getElementById('mute-btn').classList.remove('active');
        document.getElementById('deafen-btn').classList.remove('active');
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
}

function sendMessage(text, attachment = null) {
    if (!socket) return;

    const payload = {
        text: text,
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
    container.scrollTop = container.scrollHeight;
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
        if (msg.fileType && msg.fileType.startsWith('image/')) {
            mediaHtml = `<img src="${msg.file}" class="message-image" onclick="window.open('${msg.file}')">`;
        } else {
            mediaHtml = `<div class="file-attachment">📂 <a href="${msg.file}" download="${msg.fileName}">${msg.fileName}</a></div>`;
        }
    }

    messageDiv.innerHTML = `
        <div class="message-avatar">
            <img src="${avatarSrc}" style="width:100%; height:100%; object-fit: cover; border-radius:50%">
        </div>
        <div class="message-content">
            <div class="message-header">
                <span class="author" style="${authorColor}">${authorName}</span>
                <span class="user-level-badge">Lvl ${msg.level || 1}</span>
                ${verifiedHtml}
                ${tagHtml}
                <span class="timestamp">${time}</span>
                ${deleteHtml}
            </div>
            <p class="text">${msg.text || ''}</p>
            ${mediaHtml}
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
