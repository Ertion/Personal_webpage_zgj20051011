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
    let isOwner = document.body.dataset.authMode === 'owner';

    try {
        visitorId = localStorage.getItem(storageKey) || '';
        if (!/^[A-Za-z0-9_-]{16,80}$/.test(visitorId)) {
            visitorId = crypto.randomUUID().replaceAll('-', '');
            localStorage.setItem(storageKey, visitorId);
        }
        nameInput.value = localStorage.getItem(nameStorageKey) || '';
    } catch (error) {
        visitorId = crypto.randomUUID().replaceAll('-', '');
    }

    const formatter = new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });

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

    async function loadComments(force = false) {
        if (loaded && !force) return;
        setStatus('正在加载留言……');
        try {
            const response = await fetch(`/api/guestbook?visitor=${encodeURIComponent(visitorId)}`, {
                headers: { Accept: 'application/json' }
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || '留言加载失败');
            comments = Array.isArray(data.comments) ? data.comments : [];
            loaded = true;
            setStatus('');
            render();
        } catch (error) {
            setStatus(error.message || '留言加载失败，请稍后再试', true);
            list.innerHTML = '<p class="guestbook-empty">留言暂时无法加载，请稍后再试。</p>';
        }
    }

    async function removeComment(comment) {
        if (!isOwner || !window.confirm(`确认删除 ${comment.author_name} 的这条留言及其回复吗？`)) return;
        setStatus('正在删除……');
        try {
            const response = await fetch(`/api/guestbook/${encodeURIComponent(comment.id)}`, {
                method: 'DELETE', headers: { Accept: 'application/json' }
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || '删除失败');
            if (replyTarget?.id === comment.id) setReply(null);
            await loadComments(true);
            setStatus('留言已删除');
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
        try {
            const response = await fetch('/api/guestbook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    visitor_id: visitorId,
                    author_name: nameInput.value,
                    message,
                    parent_id: replyTarget?.id || null
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || '发布失败');
            try { localStorage.setItem(nameStorageKey, nameInput.value.trim()); } catch (error) {}
            messageInput.value = '';
            characterCount.textContent = '0 / 1000';
            setReply(null);
            await loadComments(true);
            setStatus('已发布，谢谢你的留言');
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
})();
