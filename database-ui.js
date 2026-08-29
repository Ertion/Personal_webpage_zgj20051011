(() => {
    const sectionNames = {
        admin: '行政内容',
        blog: '博客文章',
        engineering: '工程记录',
        laboratory: '实验记录',
        chatgpt: '交互记录',
        more: '其他内容'
    };
    const contentState = new Map();
    let calendarEvents = [];

    async function api(path, options = {}) {
        const response = await fetch(path, {
            cache: 'no-store',
            credentials: 'same-origin',
            ...options,
            headers: {
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...(options.headers || {})
            }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || `请求失败（${response.status}）`);
        return data;
    }

    function setMessage(element, message = '', isError = false) {
        element.textContent = message;
        element.classList.toggle('is-error', isError);
    }

    function makeButton(label, className, handler) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', handler);
        return button;
    }

    function appendBadge(container, label) {
        const badge = document.createElement('span');
        badge.className = 'database-badge';
        badge.textContent = label;
        container.appendChild(badge);
    }

    function formatTimestamp(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
    }

    function emptyState(message) {
        const element = document.createElement('div');
        element.className = 'database-empty';
        element.textContent = message;
        return element;
    }

    function renderContent(section) {
        const container = document.querySelector(`[data-content-list="${section}"]`);
        const items = contentState.get(section) || [];
        container.replaceChildren();
        if (!items.length) {
            container.appendChild(emptyState(`暂无${sectionNames[section] || '内容'}`));
            return;
        }

        items.forEach((item) => {
            const article = document.createElement('article');
            article.className = 'database-item';
            const head = document.createElement('div');
            head.className = 'database-item-head';
            const headingWrap = document.createElement('div');
            const heading = document.createElement('h3');
            heading.textContent = item.title;
            headingWrap.appendChild(heading);
            if (item.summary) {
                const summary = document.createElement('p');
                summary.className = 'database-item-summary';
                summary.textContent = item.summary;
                headingWrap.appendChild(summary);
            }
            const actions = document.createElement('div');
            actions.className = 'database-item-actions';
            actions.append(
                makeButton('编辑', 'database-item-button', () => openContentDialog(section, item)),
                makeButton('删除', 'database-item-button is-danger', () => removeContent(section, item))
            );
            head.append(headingWrap, actions);
            article.appendChild(head);
            if (item.body) {
                const body = document.createElement('p');
                body.className = 'database-item-body';
                body.textContent = item.body;
                article.appendChild(body);
            }
            const meta = document.createElement('div');
            meta.className = 'database-item-meta';
            appendBadge(meta, item.status === 'published' ? '已发布' : '草稿');
            appendBadge(meta, item.visibility === 'public' ? '公开' : '私有');
            const time = document.createElement('span');
            time.textContent = `更新于 ${formatTimestamp(item.updated_at)}`;
            meta.appendChild(time);
            article.appendChild(meta);
            container.appendChild(article);
        });
    }

    async function loadContent(section) {
        const status = document.querySelector(`[data-content-status="${section}"]`);
        setMessage(status, '正在读取数据库…');
        try {
            const data = await api(`/api/content?section=${encodeURIComponent(section)}`);
            contentState.set(section, data.items || []);
            renderContent(section);
            setMessage(status, `${(data.items || []).length} 条记录`);
        } catch (error) {
            contentState.set(section, []);
            renderContent(section);
            setMessage(status, `${error.message}；请先应用 D1 迁移。`, true);
        }
    }

    const contentDialog = document.getElementById('contentDialog');
    const contentForm = document.getElementById('contentForm');
    const contentFormMessage = document.getElementById('contentFormMessage');
    const contentSaveButton = document.getElementById('contentSaveButton');

    function openContentDialog(section, item = null) {
        contentForm.reset();
        document.getElementById('contentId').value = item?.id || '';
        document.getElementById('contentSection').value = section;
        document.getElementById('contentTitle').value = item?.title || '';
        document.getElementById('contentSummary').value = item?.summary || '';
        document.getElementById('contentBody').value = item?.body || '';
        document.getElementById('contentStatus').value = item?.status || 'draft';
        document.getElementById('contentVisibility').value = item?.visibility || 'public';
        document.getElementById('contentDialogTitle').textContent = item
            ? `编辑${sectionNames[section]}`
            : `新增${sectionNames[section]}`;
        setMessage(contentFormMessage);
        contentDialog.showModal();
        requestAnimationFrame(() => document.getElementById('contentTitle').focus());
    }

    contentForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const id = document.getElementById('contentId').value;
        const section = document.getElementById('contentSection').value;
        const payload = {
            section,
            title: document.getElementById('contentTitle').value,
            summary: document.getElementById('contentSummary').value,
            body: document.getElementById('contentBody').value,
            status: document.getElementById('contentStatus').value,
            visibility: document.getElementById('contentVisibility').value
        };
        contentSaveButton.disabled = true;
        contentSaveButton.textContent = '保存中…';
        setMessage(contentFormMessage);
        try {
            await api(id ? `/api/content/${encodeURIComponent(id)}` : '/api/content', {
                method: id ? 'PATCH' : 'POST',
                body: JSON.stringify(payload)
            });
            contentDialog.close();
            await loadContent(section);
        } catch (error) {
            setMessage(contentFormMessage, error.message, true);
        } finally {
            contentSaveButton.disabled = false;
            contentSaveButton.textContent = '保存';
        }
    });

    async function removeContent(section, item) {
        if (!window.confirm(`确定删除“${item.title}”吗？`)) return;
        const status = document.querySelector(`[data-content-status="${section}"]`);
        setMessage(status, '正在删除…');
        try {
            await api(`/api/content/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
            await loadContent(section);
        } catch (error) {
            setMessage(status, error.message, true);
        }
    }

    const grid = document.getElementById('calendarGrid');
    const eventList = document.getElementById('eventList');
    const eventStatus = document.getElementById('eventStatus');
    const eventDialog = document.getElementById('eventDialog');
    const eventForm = document.getElementById('eventForm');
    const eventFormMessage = document.getElementById('eventFormMessage');
    const eventSaveButton = document.getElementById('eventSaveButton');

    function decorateCalendar() {
        const counts = new Map();
        calendarEvents.forEach((item) => counts.set(item.event_date, (counts.get(item.event_date) || 0) + 1));
        grid.querySelectorAll('.calendar-day').forEach((cell) => {
            cell.querySelector('.calendar-event-count')?.remove();
            const count = counts.get(cell.dataset.date) || 0;
            if (!count) return;
            const marker = document.createElement('span');
            marker.className = 'calendar-event-count';
            marker.textContent = String(count);
            marker.setAttribute('aria-label', `${count}项日程`);
            cell.appendChild(marker);
        });
    }

    function renderEvents() {
        eventList.replaceChildren();
        if (!calendarEvents.length) {
            eventList.appendChild(emptyState('本月暂无日程，点击日期或“新增日程”开始记录。'));
            decorateCalendar();
            return;
        }

        calendarEvents.forEach((item) => {
            const article = document.createElement('article');
            article.className = 'database-item';
            const head = document.createElement('div');
            head.className = 'database-item-head';
            const titleWrap = document.createElement('div');
            const title = document.createElement('h3');
            title.textContent = `${item.event_date} · ${item.title}`;
            titleWrap.appendChild(title);
            if (item.description) {
                const description = document.createElement('p');
                description.className = 'database-item-summary';
                description.textContent = item.description;
                titleWrap.appendChild(description);
            }
            const actions = document.createElement('div');
            actions.className = 'database-item-actions';
            actions.append(
                makeButton('编辑', 'database-item-button', () => openEventDialog(item.event_date, item)),
                makeButton('删除', 'database-item-button is-danger', () => removeEvent(item))
            );
            head.append(titleWrap, actions);
            const meta = document.createElement('div');
            meta.className = 'database-item-meta';
            const statusLabels = { planned: '计划中', in_progress: '进行中', completed: '已完成' };
            appendBadge(meta, statusLabels[item.status] || item.status);
            appendBadge(meta, item.visibility === 'public' ? '公开' : '私有');
            article.append(head, meta);
            eventList.appendChild(article);
        });
        decorateCalendar();
    }

    async function loadEvents(month = grid.dataset.month) {
        if (!month) return;
        setMessage(eventStatus, '正在读取日程…');
        try {
            const data = await api(`/api/events?month=${encodeURIComponent(month)}`);
            calendarEvents = data.events || [];
            renderEvents();
            setMessage(eventStatus, `${month} · ${calendarEvents.length} 项日程`);
        } catch (error) {
            calendarEvents = [];
            renderEvents();
            setMessage(eventStatus, `${error.message}；请先应用 D1 迁移。`, true);
        }
    }

    function defaultEventDate() {
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        return grid.dataset.month === currentMonth
            ? `${currentMonth}-${String(now.getDate()).padStart(2, '0')}`
            : `${grid.dataset.month}-01`;
    }

    function openEventDialog(date = defaultEventDate(), item = null) {
        eventForm.reset();
        document.getElementById('eventId').value = item?.id || '';
        document.getElementById('eventDate').value = item?.event_date || date;
        document.getElementById('eventTitle').value = item?.title || '';
        document.getElementById('eventDescription').value = item?.description || '';
        document.getElementById('eventState').value = item?.status || 'planned';
        document.getElementById('eventVisibility').value = item?.visibility || 'private';
        document.getElementById('eventDialogTitle').textContent = item ? '编辑日程' : '新增日程';
        setMessage(eventFormMessage);
        eventDialog.showModal();
        requestAnimationFrame(() => document.getElementById('eventTitle').focus());
    }

    eventForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const id = document.getElementById('eventId').value;
        const payload = {
            event_date: document.getElementById('eventDate').value,
            title: document.getElementById('eventTitle').value,
            description: document.getElementById('eventDescription').value,
            status: document.getElementById('eventState').value,
            visibility: document.getElementById('eventVisibility').value
        };
        eventSaveButton.disabled = true;
        eventSaveButton.textContent = '保存中…';
        setMessage(eventFormMessage);
        try {
            await api(id ? `/api/events/${encodeURIComponent(id)}` : '/api/events', {
                method: id ? 'PATCH' : 'POST',
                body: JSON.stringify(payload)
            });
            eventDialog.close();
            await loadEvents();
        } catch (error) {
            setMessage(eventFormMessage, error.message, true);
        } finally {
            eventSaveButton.disabled = false;
            eventSaveButton.textContent = '保存';
        }
    });

    async function removeEvent(item) {
        if (!window.confirm(`确定删除“${item.title}”吗？`)) return;
        setMessage(eventStatus, '正在删除…');
        try {
            await api(`/api/events/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
            await loadEvents();
        } catch (error) {
            setMessage(eventStatus, error.message, true);
        }
    }

    document.querySelectorAll('[data-content-create]').forEach((button) => {
        button.addEventListener('click', () => openContentDialog(button.dataset.contentCreate));
    });
    document.querySelectorAll('[data-close-dialog]').forEach((button) => {
        button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog).close());
    });
    document.getElementById('createEventButton').addEventListener('click', () => openEventDialog());
    grid.addEventListener('calendar-rendered', (event) => loadEvents(event.detail.month));
    grid.addEventListener('click', (event) => {
        const cell = event.target.closest('.calendar-day');
        if (cell) openEventDialog(cell.dataset.date);
    });
    grid.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const cell = event.target.closest('.calendar-day');
        if (!cell) return;
        event.preventDefault();
        openEventDialog(cell.dataset.date);
    });

    document.querySelectorAll('[data-content-list]').forEach((container) => loadContent(container.dataset.contentList));
    loadEvents();
})();
