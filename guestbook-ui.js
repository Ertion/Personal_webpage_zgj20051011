(() => {
    const panel = document.getElementById('archiveGuestbookPanel');
    const form = document.getElementById('guestbookForm');
    const nameInput = document.getElementById('guestbookName');
    const messageInput = document.getElementById('guestbookMessage');
    const submitButton = document.getElementById('guestbookSubmit');
    const status = document.getElementById('guestbookStatus');
    const count = document.getElementById('guestbookCount');
    const list = document.getElementById('guestbookList');
    const showOthers = document.getElementById('guestbookShowOthers');
    const characterCount = document.getElementById('guestbookCharacterCount');
    const replying = document.getElementById('guestbookReplying');
    const replyName = document.getElementById('guestbookReplyName');
    const cancelReply = document.getElementById('guestbookCancelReply');
    if (!panel || !form || !list) return;

    const storageKey = 'zgjGuestbookVisitor';
    const nameStorageKey = 'zgjGuestbookName';
    let visitorId = '';
    let comments = [];
    let replyTarget = null;
    let loaded = false;
    let pendingLoad = null;
    let syncIssue = false;
    let isOwner = document.body.dataset.authMode === 'owner';

    function createClientId() {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID().replace(/-/g, '');
        if (window.crypto?.getRandomValues) {
            const bytes = new Uint8Array(16);
            window.crypto.getRandomValues(bytes);
            return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        }
        return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    }

    try {
        visitorId = localStorage.getItem(storageKey) || '';
        if (!/^[A-Za-z0-9_-]{16,80}$/.test(visitorId)) {
            visitorId = createClientId();
            localStorage.setItem(storageKey, visitorId);
        }
        nameInput.value = localStorage.getItem(nameStorageKey) || '';
    } catch (error) {
        visitorId = createClientId();
    }

    const formatter = new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    function xhrJson(url, options = {}) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(options.method || 'GET', url, true);
            xhr.timeout = 18000;
            xhr.withCredentials = true;
            for (const [name, value] of Object.entries(options.headers || {})) xhr.setRequestHeader(name, value);
            xhr.onload = () => {
                let data = {};
                try { data = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch (error) {}
                if (xhr.status >= 200 && xhr.status < 300) resolve(data);
                else {
                    const error = new Error(data.message || `请求失败（${xhr.status}）`);
                    error.status = xhr.status;
                    reject(error);
                }
            };
            xhr.onerror = () => reject(new Error('网络连接中断'));
            xhr.ontimeout = () => reject(new Error('网络响应超时'));
            xhr.send(options.body || null);
        });
    }

    async function fetchJson(url, options = {}) {
        if (typeof window.fetch !== 'function' || typeof AbortController !== 'function') return xhrJson(url, options);
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 15000);
        try {
            const response = await window.fetch(url, {
                ...options,
                cache: 'no-store',
                credentials: 'same-origin',
                signal: controller.signal
            });
            let data = {};
            try { data = await response.json(); } catch (error) {}
            if (!response.ok) {
                const error = new Error(data.message || `请求失败（${response.status}）`);
                error.status = response.status;
                throw error;
            }
            return data;
        } finally {
            window.clearTimeout(timer);
        }
    }

    async function requestJson(url, options = {}, attempts = 2) {
        let lastError;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                return await fetchJson(url, options);
            } catch (error) {
                if (error.status && error.status < 500 && error.status !== 429) throw error;
                lastError = error;
            }
            try {
                return await xhrJson(url, options);
            } catch (error) {
                if (error.status && error.status < 500 && error.status !== 429) throw error;
                lastError = error;
            }
            if (attempt + 1 < attempts) await new Promise((resolve) => window.setTimeout(resolve, 600 * (attempt + 1)));
        }
        throw new Error(lastError?.message || '网络连接不稳定，请稍后重试');
    }

    function setStatus(message = '', error = false) {
        status.textContent = message;
        status.dataset.error = error ? 'true' : 'false';
    }

    function formatTime(value) {
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? formatter.format(date) : value;
    }

    function setReply(comment) {
        replyTarget = comment;
        replying.hidden = !comment;
        replyName.textContent = comment?.author_name || '';
        submitButton.textContent = comment ? '发布回复' : '发布留言';
        if (comment) messageInput.focus();
    }

    function actionButton(label, action, comment) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'guestbook-comment-button';
        button.dataset.action = action;
        button.textContent = label;
        button.addEventListener('click', () => {
            if (action === 'reply') setReply(comment);
            if (action === 'delete') removeComment(comment);
        });
        return button;
    }

    function commentNode(comment, reply = false) {
        const article = document.createElement('article');
        article.className = reply ? 'guestbook-reply' : 'guestbook-thread';
        article.dataset.mine = comment.is_mine ? 'true' : 'false';

        const head = document.createElement('header');
        head.className = 'guestbook-comment-head';
        const author = document.createElement('strong');
        author.className = 'guestbook-author';
        author.textContent = comment.author_name;
        head.append(author);
        if (comment.role === 'owner') {
            const badge = document.createElement('span');
            badge.className = 'guestbook-owner-tag';
            badge.textContent = '所有者';
            head.append(badge);
        }
        const time = document.createElement('time');
        time.className = 'guestbook-time';
        time.dateTime = comment.created_at;
        time.textContent = formatTime(comment.created_at);
        head.append(time);

        const body = document.createElement('p');
        body.className = 'guestbook-comment-body';
        body.textContent = comment.message;
        const actions = document.createElement('footer');
        actions.className = 'guestbook-comment-actions';
        actions.append(actionButton('回复', 'reply', comment));
        if (isOwner) actions.append(actionButton('删除', 'delete', comment));
        article.append(head, body, actions);
        return article;
    }

    function render() {
        list.replaceChildren();
        const byParent = new Map();
        for (const comment of comments) {
            const key = comment.parent_id || '';
            if (!byParent.has(key)) byParent.set(key, []);
            byParent.get(key).push(comment);
        }
        const roots = [...(byParent.get('') || [])].reverse();
        const threadHasMine = (commentId, seen = new Set()) => {
            if (seen.has(commentId)) return false;
            const nextSeen = new Set(seen).add(commentId);
            return (byParent.get(commentId) || []).some((comment) => comment.is_mine || threadHasMine(comment.id, nextSeen));
        };
        const visibleRoots = showOthers.checked
            ? roots
            : roots.filter((comment) => Boolean(comment.is_mine) || threadHasMine(comment.id));
        count.textContent = `${comments.length} 条对话`;

        if (!visibleRoots.length) {
            const empty = document.createElement('p');
            empty.className = 'guestbook-empty';
            empty.textContent = comments.length && !showOthers.checked
                ? '你还没有留言。勾选右上方选项，可以看看其他访客说了什么。'
                : '还没有人留言，来写下第一句话吧。';
            list.append(empty);
            return;
        }

        const appendReplies = (container, parentId, seen = new Set()) => {
            for (const reply of byParent.get(parentId) || []) {
                if (seen.has(reply.id)) continue;
                const nextSeen = new Set(seen).add(reply.id);
                container.append(commentNode(reply, true));
                appendReplies(container, reply.id, nextSeen);
            }
        };

        for (const root of visibleRoots) {
            const thread = commentNode(root);
            const replies = document.createElement('div');
            replies.className = 'guestbook-replies';
            appendReplies(replies, root.id, new Set([root.id]));
            if (replies.childElementCount) thread.append(replies);
            list.append(thread);
        }
    }

    function loadComments(force = false, silent = false) {
        if (loaded && !force) return Promise.resolve(true);
        if (pendingLoad) return pendingLoad;
        if (!silent) setStatus('正在同步留言……');
        pendingLoad = (async () => {
            try {
                const data = await requestJson(`/api/guestbook?visitor=${encodeURIComponent(visitorId)}`, {
                    headers: { Accept: 'application/json' }
                });
                comments = Array.isArray(data.comments) ? data.comments : [];
                loaded = true;
                if (syncIssue) {
                    syncIssue = false;
                    setStatus('已同步最新留言');
                } else if (!silent) setStatus('');
                render();
                return true;
            } catch (error) {
                syncIssue = true;
                if (!silent) setStatus('网络暂时不稳定，页面会自动重试同步', true);
                if (!loaded) list.innerHTML = '<p class="guestbook-empty">正在等待网络恢复，留言会自动重新加载。</p>';
                return false;
            } finally {
                pendingLoad = null;
            }
        })();
        return pendingLoad;
    }

    async function removeComment(comment) {
        if (!isOwner || !window.confirm(`确认删除 ${comment.author_name} 的这条留言及其回复吗？`)) return;
        setStatus('正在删除……');
        try {
            await requestJson(`/api/guestbook/${encodeURIComponent(comment.id)}`, {
                method: 'DELETE', headers: { Accept: 'application/json' }
            });
            if (replyTarget?.id === comment.id) setReply(null);
            const removed = new Set([comment.id]);
            let changed = true;
            while (changed) {
                changed = false;
                for (const item of comments) {
                    if (item.parent_id && removed.has(item.parent_id) && !removed.has(item.id)) {
                        removed.add(item.id);
                        changed = true;
                    }
                }
            }
            comments = comments.filter((item) => !removed.has(item.id));
            render();
            setStatus('留言已删除');
            loadComments(true, true);
        } catch (error) {
            setStatus(error.message || '删除失败，请稍后再试', true);
        }
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const message = messageInput.value.trim();
        if (!message) {
            setStatus('请先写下留言内容', true);
            messageInput.focus();
            return;
        }
        submitButton.disabled = true;
        setStatus(replyTarget ? '正在发布回复……' : '正在发布留言……');
        const requestId = createClientId();
        try {
            const data = await requestJson('/api/guestbook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    request_id: requestId,
                    visitor_id: visitorId,
                    author_name: nameInput.value,
                    message,
                    parent_id: replyTarget?.id || null
                })
            });
            try { localStorage.setItem(nameStorageKey, nameInput.value.trim()); } catch (error) {}
            if (data.comment) {
                comments = comments.filter((item) => item.id !== data.comment.id);
                comments.push(data.comment);
                loaded = true;
                render();
            }
            messageInput.value = '';
            characterCount.textContent = '0 / 1000';
            setReply(null);
            setStatus('已发布，谢谢你的留言');
            loadComments(true, true).then((synced) => {
                if (!synced) setStatus('留言已保存，网络恢复后会自动同步完整列表');
            });
        } catch (error) {
            setStatus(error.message || '发布失败，请稍后再试', true);
        } finally {
            submitButton.disabled = false;
        }
    });

    messageInput.addEventListener('input', () => {
        characterCount.textContent = `${messageInput.value.length} / 1000`;
    });
    cancelReply.addEventListener('click', () => setReply(null));
    showOthers.addEventListener('change', render);
    document.addEventListener('archiveappopen', (event) => {
        if (event.detail?.app === 'guestbook') loadComments();
    });
    document.addEventListener('auth-mode-changed', (event) => {
        isOwner = event.detail?.mode === 'owner';
        render();
    });
    window.addEventListener('online', () => {
        if (!panel.hidden) loadComments(true, true);
    });
    window.addEventListener('focus', () => {
        if (!panel.hidden) loadComments(true, true);
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && !panel.hidden) loadComments(true, true);
    });
    window.setInterval(() => {
        if (!document.hidden && !panel.hidden) loadComments(true, true);
    }, 12000);
})();
