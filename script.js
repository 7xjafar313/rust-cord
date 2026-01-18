document.addEventListener('DOMContentLoaded', () => {
    const BOT_TOKEN = '6780979570:AAEpS358Uxk_FuegiXu80-ElfxnVFE_AQrU';
    let CHAT_ID = '1680454327'; // تمت إضافة معرف الدردشة
    let lastUpdateId = 0;
    let myUsername = localStorage.getItem('rust_cord_username') || '';

    const input = document.querySelector('.message-input input');
    const messagesContainer = document.querySelector('.messages-container');
    const attachmentBtn = document.querySelector('.fa-plus-circle');

    // إنشاء مدخل ملف مخفي
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // إعداد اسم المستخدم عند الدخول لأول مرة
    if (!myUsername) {
        myUsername = prompt('مرحباً بك في راست كورد! الرجاء إدخال اسمك المستعار:') || 'مستخدم مجهول';
        localStorage.setItem('rust_cord_username', myUsername);
    }

    document.querySelector('.username').innerText = myUsername;

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

        let contentHtml = `<div class="message-text">${text}</div>`;
        if (imageUrl) {
            contentHtml += `<div class="message-image"><img src="${imageUrl}" class="chat-img" onclick="window.open('${imageUrl}')"></div>`;
        }

        messageDiv.innerHTML = `
            <div class="message-avatar">
                <img src="https://ui-avatars.com/api/?name=${author}&background=random&color=fff" alt="Avatar">
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

    // تبديل القنوات (بشكل صوري حالياً)
    const channels = document.querySelectorAll('.channel');
    channels.forEach(channel => {
        channel.addEventListener('click', () => {
            channels.forEach(c => c.classList.remove('active'));
            channel.classList.add('active');
            const name = channel.querySelector('span').innerText;
            document.querySelector('.header-info h2').innerText = name;
            input.placeholder = `إرسال رسالة إلى #${name}`;
        });
    });
});
