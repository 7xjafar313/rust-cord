document.addEventListener('DOMContentLoaded', () => {
    const BOT_TOKEN = '6780979570:AAEpS358Uxk_FuegiXu80-ElfxnVFE_AQrU';
    let CHAT_ID = '1680454327'; // تمت إضافة معرف الدردشة
    let lastUpdateId = 0;
    const authScreen = document.getElementById('auth-screen');
    const authForm = document.getElementById('auth-form');
    const authEmail = document.getElementById('auth-email');
    const authPass = document.getElementById('auth-pass');
    const authUsername = document.getElementById('auth-username');
    const authSubmit = document.getElementById('auth-submit');
    const authTitle = document.getElementById('auth-title');
    const authSubtitle = document.getElementById('auth-subtitle');
    const authSwitchLink = document.getElementById('auth-switch-link');
    const authSwitchText = document.getElementById('auth-switch-text');
    const authFullname = document.getElementById('auth-fullname');
    const authBio = document.getElementById('auth-bio');
    const authAvatar = document.getElementById('auth-avatar');
    const usernameGroup = document.getElementById('username-group');
    const nameGroup = document.getElementById('name-group');
    const bioGroup = document.getElementById('bio-group');
    const avatarGroup = document.getElementById('avatar-group');
    const mainApp = document.getElementById('main-app');

    const settingsModal = document.getElementById('settings-modal');
    const settingsForm = document.getElementById('settings-form');
    const settingsFullname = document.getElementById('settings-fullname');
    const settingsBio = document.getElementById('settings-bio');
    const settingsAvatar = document.getElementById('settings-avatar');
    const closeSettings = document.getElementById('close-settings');
    const logoutBtn = document.getElementById('logout-btn');
    const userInfoArea = document.querySelector('.user-info');

    let isAdmin = false;
    let isLoginMode = true;
    let currentUser = JSON.parse(localStorage.getItem('rust_cord_user')) || null;

    // تهيئة حالة الدخول
    if (currentUser) {
        loginUser(currentUser);
    }

    // التبديل بين الدخول والتسجيل
    authSwitchLink.onclick = (e) => {
        e.preventDefault();
        isLoginMode = !isLoginMode;
        const display = isLoginMode ? 'none' : 'block';
        usernameGroup.style.display = display;
        nameGroup.style.display = display;
        bioGroup.style.display = display;
        avatarGroup.style.display = display;

        if (isLoginMode) {
            authTitle.innerText = 'مرحباً بعودتك!';
            authSubtitle.innerText = 'يسعدنا رؤيتك مجدداً!';
            authSubmit.innerText = 'تسجيل الدخول';
            authSwitchText.innerText = 'تحتاج إلى حساب؟';
            authSwitchLink.innerText = 'سجل الآن';
        } else {
            authTitle.innerText = 'إنشاء حساب';
            authSubtitle.innerText = 'انضم إلى مجتمع راست كورد اليوم!';
            authSubmit.innerText = 'إنشاء حساب';
            authSwitchText.innerText = 'لديك حساب بالفعل؟';
            authSwitchLink.innerText = 'تسجيل الدخول';
        }
    };

    // معالجة النموذج (Login/Register)
    authForm.onsubmit = (e) => {
        e.preventDefault();
        const email = authEmail.value;
        const pass = authPass.value;
        const users = JSON.parse(localStorage.getItem('rust_cord_users')) || [];

        if (isLoginMode) {
            const user = users.find(u => u.email === email && u.pass === pass);
            if (user) {
                loginUser(user);
            } else {
                alert('البريد الإلكتروني أو كلمة المرور غير صحيحة!');
            }
        } else {
            const username = authUsername.value;
            const fullname = authFullname.value;
            const bio = authBio.value;
            const avatar = authAvatar.value;

            const existing = users.find(u => u.email === email);
            if (existing) {
                alert('هذا البريد الإلكتروني مسجل بالفعل!');
            } else {
                const newUser = { email, pass, username, fullname, bio, avatar };
                users.push(newUser);
                localStorage.setItem('rust_cord_users', JSON.stringify(users));
                loginUser(newUser);
            }
        }
    };

    function loginUser(user) {
        localStorage.setItem('rust_cord_user', JSON.stringify(user));
        myUsername = user.username;
        isAdmin = getRoleClass(user.username) === 'role-owner' || getRoleClass(user.username) === 'role-admin';

        document.querySelector('.username').innerText = user.fullname || user.username;
        document.querySelector('.user-tag').innerText = `@${user.username}`;

        if (user.avatar) {
            document.querySelector('.user-info img').src = user.avatar;
        }

        authScreen.style.display = 'none';
        mainApp.style.display = 'flex';

        // تحديث حقول الإعدادات بالقيم الحالية
        settingsFullname.value = user.fullname || '';
        settingsBio.value = user.bio || '';
        settingsAvatar.value = user.avatar || '';
    }

    // فتح الإعدادات
    userInfoArea.onclick = () => {
        settingsModal.style.display = 'flex';
    };

    closeSettings.onclick = () => {
        settingsModal.style.display = 'none';
    };

    // حفظ الإعدادات
    settingsForm.onsubmit = (e) => {
        e.preventDefault();
        const users = JSON.parse(localStorage.getItem('rust_cord_users')) || [];
        const userIndex = users.findIndex(u => u.email === currentUser.email);

        if (userIndex !== -1) {
            currentUser.fullname = settingsFullname.value;
            currentUser.bio = settingsBio.value;
            currentUser.avatar = settingsAvatar.value;

            users[userIndex] = currentUser;
            localStorage.setItem('rust_cord_users', JSON.stringify(users));
            localStorage.setItem('rust_cord_user', JSON.stringify(currentUser));

            loginUser(currentUser);
            settingsModal.style.display = 'none';
            alert('تم تحديث الملف الشخصي بنجاح!');
        }
    };

    // تسجيل الخروج
    logoutBtn.onclick = () => {
        localStorage.removeItem('rust_cord_user');
        location.reload();
    };

    let myUsername = currentUser ? currentUser.username : '';
    const input = document.querySelector('.message-input input');
    const messagesContainer = document.querySelector('.messages-container');
    const attachmentBtn = document.querySelector('.fa-plus-circle');

    // إنشاء مدخل ملف مخفي
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // دالة جلب رابط الصورة من تيليجرام
    async function getFilePath(fileId) {
        try {
            const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
            const data = await response.json();
            if (data.ok) {
                return `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`;
            }
        } catch (error) {
            console.error('Error getting file path:', error);
        }
        return null;
    }

    // دالة إرسال صورة إلى تيليجرام
    async function sendImageToTelegram(file) {
        const formData = new FormData();
        formData.append('chat_id', CHAT_ID);
        formData.append('photo', file);
        formData.append('caption', `[${myUsername}]: أرسل صورة`);

        try {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
                method: 'POST',
                body: formData
            });
        } catch (error) {
            console.error('Error sending photo:', error);
        }
    }

    // دالة إرسال رسالة إلى تيليجرام
    async function sendMessageToTelegram(text) {
        if (!CHAT_ID) return;
        const messageData = {
            chat_id: CHAT_ID,
            text: `[${myUsername}]: ${text}`
        };

        try {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(messageData)
            });
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }

    // دالة جلب الرسائل من تيليجرام
    async function fetchMessagesFromTelegram() {
        try {
            const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}`);
            const data = await response.json();

            if (data.ok && data.result.length > 0) {
                for (const update of data.result) {
                    lastUpdateId = update.update_id;
                    const msg = update.message;
                    if (!msg) continue;

                    let authorName = 'تيليجرام';
                    let text = msg.text || '';
                    let imageUrl = null;

                    if (msg.photo) {
                        const photo = msg.photo[msg.photo.length - 1]; // الحصول على أعلى دقة
                        imageUrl = await getFilePath(photo.file_id);
                        text = msg.caption || '';
                    }

                    if (text.includes(']: ')) {
                        const parts = text.split(']: ');
                        authorName = parts[0].replace('[', '');
                        text = parts.slice(1).join(']: ');
                    }

                    if (authorName !== myUsername || (msg.from && !text.startsWith(`[${myUsername}]`))) {
                        addMessage(authorName, text, false, imageUrl);
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching messages:', error);
        }
    }

    // قائمة إيموجي بسيطة
    const emojiBtn = document.querySelector('.fa-smile');
    const inputWrapper = document.querySelector('.message-input');
    const emojis = ['😊', '😂', '🔥', '❤', '👍', '🎮', '🛠', '🤖', '👑', '⭐'];
    const emojiPicker = document.createElement('div');
    emojiPicker.className = 'emoji-picker';
    emojiPicker.style.cssText = 'position:absolute; bottom:60px; left:20px; background:#232428; padding:10px; border-radius:8px; display:none; grid-template-columns: repeat(5, 1fr); gap:5px; z-index:100; box-shadow: 0 4px 15px rgba(0,0,0,0.5);';
    emojis.forEach(e => {
        const span = document.createElement('span');
        span.innerText = e;
        span.style.cssText = 'cursor:pointer; font-size: 20px; padding: 5px;';
        span.onclick = () => {
            input.value += e;
            emojiPicker.style.display = 'none';
        };
        emojiPicker.appendChild(span);
    });
    inputWrapper.parentElement.style.position = 'relative';
    inputWrapper.parentElement.appendChild(emojiPicker);

    emojiBtn.onclick = () => {
        emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'grid' : 'none';
    };

    // دالة تحديد الرتبة بناءً على الاسم
    function getRoleClass(author) {
        if (author.includes('المطور') || author.includes('sww')) return 'role-owner';
        if (author.toLowerCase().includes('admin')) return 'role-admin';
        if (author.includes('مشرف')) return 'role-mod';
        return 'role-member';
    }

    // إضافة رسالة للواجهة
    function addMessage(author, text, isUser = false, imageUrl = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';

        const timestamp = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
        const roleClass = getRoleClass(author);

        // استخدام صورة المستخدم المحلي إذا كان هو الكاتب
        let avatarUrl = `https://ui-avatars.com/api/?name=${author}&background=random&color=fff`;
        if (isUser && currentUser && currentUser.avatar) {
            avatarUrl = currentUser.avatar;
        } else if (author === myUsername && currentUser && currentUser.avatar) {
            avatarUrl = currentUser.avatar;
        }

        let contentHtml = `<div class="message-text">${text}</div>`;
        if (imageUrl) {
            contentHtml += `<div class="message-image"><img src="${imageUrl}" class="chat-img" onclick="window.open('${imageUrl}')"></div>`;
        }

        messageDiv.innerHTML = `
            <div class="message-avatar">
                <img src="${avatarUrl}" alt="Avatar">
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author ${roleClass}">${author}</span>
                    <span class="message-timestamp">اليوم الساعة ${timestamp}</span>
                </div>
                ${contentHtml}
            </div>
        `;

        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // التعامل مع رفع الملفات
    attachmentBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const reader = new FileReader();
            reader.onload = (e) => addMessage(myUsername, 'أرسل صورة', true, e.target.result);
            reader.readAsDataURL(file);
            await sendImageToTelegram(file);
            fileInput.value = '';
        }
    });

    // التعامل مع الإدخال
    input.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter' && input.value.trim() !== '') {
            const text = input.value.trim();
            addMessage(myUsername, text, true);
            input.value = '';

            if (CHAT_ID) {
                await sendMessageToTelegram(text);
            } else {
                console.warn('يرجى تزويد معرف الدردشة (CHAT_ID) لتفعيل المزامنة');
            }
        }
    });

    // بدء سحب الرسائل دورياً (كل 3 ثواني)
    setInterval(fetchMessagesFromTelegram, 3000);

    // --- Voice, Video & Screen Share Logic (PeerJS) ---
    const voicePanel = document.getElementById('voice-panel');
    const disconnectBtn = document.getElementById('disconnect-voice');
    const toggleCameraBtn = document.getElementById('toggle-camera');
    const toggleScreenBtn = document.getElementById('toggle-screen');
    const videoGrid = document.getElementById('video-grid');

    let localStream = null;
    let peer = null;
    let currentCall = null;
    let isCameraOn = false;
    let isScreenSharing = false;

    // تهيئة PeerJS بمعرف عشوائي
    function initPeer() {
        if (peer) return;
        peer = new Peer();
        peer.on('open', (id) => console.log('Peer ID:', id));
        peer.on('call', (call) => {
            call.answer(localStream || new MediaStream());
            call.on('stream', (remoteStream) => handleRemoteStream(remoteStream, call.peer));
            currentCall = call;
        });
    }

    const audioContexts = {};

    function handleRemoteStream(stream, peerId) {
        if (stream.getVideoTracks().length > 0) {
            videoGrid.style.display = 'grid';
            let videoEl = document.getElementById(`video-${peerId}`);
            if (!videoEl) {
                const container = document.createElement('div');
                container.className = 'video-item';
                container.id = `container-${peerId}`;
                videoEl = document.createElement('video');
                videoEl.id = `video-${peerId}`;
                videoEl.autoplay = true;
                videoEl.playsinline = true;

                // إضافة أدوات التحكم للأدمن فقط
                if (isAdmin) {
                    const tools = document.createElement('div');
                    tools.style.cssText = 'position:absolute; top:5px; right:5px; display:flex; gap:5px; z-index:10;';
                    tools.innerHTML = `
                        <button onclick="window.sendAdminCommand('MUTE', '${peerId}')" title="كتم إجباري" style="background:rgba(255,0,0,0.5); border:none; color:white; padding:5px; border-radius:3px; cursor:pointer;"><i class="fas fa-volume-mute"></i></button>
                        <button onclick="window.sendAdminCommand('VOICE', '${peerId}')" title="تغيير الصوت" style="background:rgba(0,0,255,0.5); border:none; color:white; padding:5px; border-radius:3px; cursor:pointer;"><i class="fas fa-robot"></i></button>
                    `;
                    container.appendChild(tools);
                }

                const label = document.createElement('div');
                label.className = 'video-label';
                label.innerText = `مستخدم #${peerId.substring(0, 4)}`;
                container.appendChild(videoEl);
                container.appendChild(label);
                videoGrid.appendChild(container);
            }
            videoEl.srcObject = stream;
        }

        // معالجة الصوت باستخدام AudioContext للتحكم المتقدم (للأدمن)
        if (stream.getAudioTracks().length > 0) {
            if (!audioContexts[peerId]) {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const source = ctx.createMediaStreamSource(stream);
                const filter = ctx.createBiquadFilter();
                filter.type = 'allpass';
                source.connect(filter).connect(ctx.destination);
                audioContexts[peerId] = { ctx, filter, stream };
            }
        }
    }

    // وظيفة إرسال أوامر الأدمن
    window.sendAdminCommand = async (type, targetId) => {
        if (!isAdmin) return;
        await sendMessageToTelegram(`[SYSTEM]:ADMIN_CMD|${type}|${targetId}`);
    };

    async function toggleCamera() {
        try {
            if (!isCameraOn) {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                replaceLocalStream(stream);
                isCameraOn = true;
                toggleCameraBtn.classList.add('active');
            } else {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                replaceLocalStream(stream);
                isCameraOn = false;
                toggleCameraBtn.classList.remove('active');
            }
            updateVideoUI();
        } catch (err) { alert('تعذر الوصول للكاميرا'); }
    }

    async function toggleScreenShare() {
        try {
            if (!isScreenSharing) {
                const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                replaceLocalStream(stream);
                isScreenSharing = true;
                toggleScreenBtn.classList.add('active');
                stream.getVideoTracks()[0].onended = () => toggleScreenShare();
            } else {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                replaceLocalStream(stream);
                isScreenSharing = false;
                toggleScreenBtn.classList.remove('active');
            }
            updateVideoUI();
        } catch (err) { console.error(err); }
    }

    function replaceLocalStream(newStream) {
        if (localStream) localStream.getTracks().forEach(t => t.stop());
        localStream = newStream;
        if (currentCall && currentCall.peerConnection) {
            const videoTrack = newStream.getVideoTracks()[0];
            const sender = currentCall.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender && videoTrack) sender.replaceTrack(videoTrack);
        }
    }

    function updateVideoUI() {
        if (isCameraOn || isScreenSharing) {
            videoGrid.style.display = 'grid';
            let myVideo = document.getElementById('local-video');
            if (!myVideo) {
                const container = document.createElement('div');
                container.className = 'video-item';
                container.id = 'container-local';
                myVideo = document.createElement('video');
                myVideo.id = 'local-video';
                myVideo.muted = true;
                myVideo.autoplay = true;
                myVideo.playsinline = true;
                const label = document.createElement('div');
                label.className = 'video-label';
                label.innerText = 'أنت (مشاركة)';
                container.appendChild(myVideo);
                container.appendChild(label);
                videoGrid.prepend(container);
            }
            myVideo.srcObject = localStream;
        } else {
            const local = document.getElementById('container-local');
            if (local) local.remove();
            if (videoGrid.children.length === 0) videoGrid.style.display = 'none';
        }
    }

    async function joinVoiceChannel(channelName) {
        initPeer();
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            voicePanel.style.display = 'flex';
            voicePanel.querySelector('.channel-name').innerText = channelName;
            if (peer.id) await sendMessageToTelegram(`[SYSTEM]:VOICE_JOIN|${peer.id}`);
        } catch (err) { alert('يرجى السماح بالوصول للميكروفون'); }
    }

    function leaveVoice() {
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }
        if (currentCall) currentCall.close();

        // تنظيف سياقات الصوت
        Object.values(audioContexts).forEach(obj => obj.ctx.close());
        for (let key in audioContexts) delete audioContexts[key];

        isCameraOn = isScreenSharing = false;
        toggleCameraBtn.classList.remove('active');
        toggleScreenBtn.classList.remove('active');
        videoGrid.innerHTML = '';
        videoGrid.style.display = 'none';
        voicePanel.style.display = 'none';
    }

    disconnectBtn.addEventListener('click', leaveVoice);
    toggleCameraBtn.addEventListener('click', toggleCamera);
    toggleScreenBtn.addEventListener('click', toggleScreenShare);

    const channels = document.querySelectorAll('.channel');
    channels.forEach(channel => {
        channel.addEventListener('click', () => {
            const isVoice = channel.classList.contains('voice-channel');
            const name = channel.querySelector('span').innerText;
            if (isVoice) joinVoiceChannel(name);
            else {
                channels.forEach(c => c.classList.remove('active'));
                channel.classList.add('active');
                document.querySelector('.header-info h2').innerText = name;
                input.placeholder = `إرسال رسالة إلى #${name}`;
            }
        });
    });

    async function handleSystemMessage(text) {
        if (text.startsWith('[SYSTEM]:VOICE_JOIN|')) {
            const peerId = text.split('|')[1];
            if (peer.id && peerId !== peer.id && localStream) {
                const call = peer.call(peerId, localStream);
                call.on('stream', (rs) => handleRemoteStream(rs, peerId));
                currentCall = call;
            }
        } else if (text.startsWith('[SYSTEM]:ADMIN_CMD|')) {
            const parts = text.split('|');
            const cmdType = parts[1];
            const targetId = parts[2];

            // إذا كنت أنا المستهدف بالكتم
            if (targetId === peer.id && cmdType === 'MUTE') {
                if (localStream) {
                    localStream.getAudioTracks().forEach(t => t.enabled = false);
                    alert('⚠️ قام الأدمن بكتم الميكروفون الخاص بك!');
                }
            }

            // تطبيق المؤثرات الصوتية على المستهدف عند جميع المستخدمين
            if (cmdType === 'VOICE' && audioContexts[targetId]) {
                const filter = audioContexts[targetId].filter;
                // تبديل بين وضع عادي ووضع "صوت فضائي"
                if (filter.type === 'allpass') {
                    filter.type = 'lowshelf';
                    filter.frequency.value = 1000;
                    filter.gain.value = 25;
                } else {
                    filter.type = 'allpass';
                }
            }
        }
    }

    async function fetchMessagesFromTelegram() {
        try {
            const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}`);
            const data = await response.json();
            if (data.ok && data.result.length > 0) {
                for (const update of data.result) {
                    lastUpdateId = update.update_id;
                    const msg = update.message;
                    if (!msg) continue;
                    let text = msg.text || '';
                    if (text.startsWith('[SYSTEM]:')) { handleSystemMessage(text); continue; }
                    let authorName = 'تيليجرام', imageUrl = null;
                    if (msg.photo) {
                        const photo = msg.photo[msg.photo.length - 1];
                        imageUrl = await getFilePath(photo.file_id);
                        text = msg.caption || '';
                    }
                    if (text.includes(']: ')) {
                        const parts = text.split(']: ');
                        authorName = parts[0].replace('[', '');
                        text = parts.slice(1).join(']: ');
                    }
                    if (authorName !== myUsername || (msg.from && !text.startsWith(`[${myUsername}]`))) {
                        addMessage(authorName, text, false, imageUrl);
                    }
                }
            }
        } catch (error) { console.error(error); }
    }
});
