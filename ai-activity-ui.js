(() => {
    const panel = document.getElementById('archiveAiPanel');
    const grid = document.getElementById('aiActivityGrid');
    const months = document.getElementById('aiActivityMonths');
    const status = document.getElementById('aiActivityStatus');
    const detail = document.getElementById('aiActivityDetail');
    const summary = document.getElementById('aiActivitySummary');
    const title = document.getElementById('aiCalendarTitle');
    const yearButtons = Array.from(document.querySelectorAll('[data-ai-year]'));
    if (!panel || !grid || !months || !status || !detail || !yearButtons.length) return;

    const numberFormat = new Intl.NumberFormat('zh-CN');
    let activityData = null;
    let loadPromise = null;
    let selectedYear = 2026;

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function utcDateKey(date) {
        return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    }

    function readableDate(dateKey) {
        const [year, month, day] = dateKey.split('-').map(Number);
        return `${year}年${month}月${day}日`;
    }

    function levelFor(day) {
        if (!day.n) return 'unavailable';
        if (day.c === 0) return '0';
        if (day.c <= 4) return '1';
        if (day.c <= 9) return '2';
        if (day.c <= 14) return '3';
        return '4';
    }

    function selectCell(cell, day) {
        grid.querySelector('.is-selected')?.classList.remove('is-selected');
        grid.querySelectorAll('.ai-contribution-cell').forEach((item) => { item.tabIndex = -1; });
        cell.classList.add('is-selected');
        cell.tabIndex = 0;
        if (!day.n) {
            detail.textContent = `${readableDate(day.d)} · 数据范围外`;
            return;
        }
        detail.textContent = `${readableDate(day.d)} · ${numberFormat.format(day.c)} 条用户消息 · ${numberFormat.format(day.a)} 条助手回复`;
    }

    function focusSlot(slot) {
        const target = grid.querySelector(`[data-slot="${slot}"]`);
        if (!target) return;
        target.focus();
        target.click();
    }

    function renderMonths(year, weekCount, startOffset) {
        months.replaceChildren();
        months.style.setProperty('--ai-week-count', weekCount);
        for (let month = 0; month < 12; month += 1) {
            const daysBefore = Math.round((Date.UTC(year, month, 1) - Date.UTC(year, 0, 1)) / 86400000);
            const label = document.createElement('span');
            label.textContent = `${month + 1}月`;
            label.style.gridColumn = `${Math.floor((startOffset + daysBefore) / 7) + 1}`;
            months.appendChild(label);
        }
    }

    function renderYear(year) {
        const yearData = activityData?.years?.[year];
        if (!yearData) return;
        selectedYear = year;
        yearButtons.forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.aiYear) === year)));

        const dayMap = new Map(yearData.days.map((day) => [day.d, day]));
        const firstDay = new Date(Date.UTC(year, 0, 1));
        const startOffset = (firstDay.getUTCDay() + 6) % 7;
        const dayCount = Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000);
        const weekCount = Math.ceil((startOffset + dayCount) / 7);
        const gridStart = Date.UTC(year, 0, 1 - startOffset);
        const fragment = document.createDocumentFragment();

        grid.replaceChildren();
        grid.style.setProperty('--ai-week-count', weekCount);
        renderMonths(year, weekCount, startOffset);

        for (let slot = 0; slot < weekCount * 7; slot += 1) {
            const date = new Date(gridStart + slot * 86400000);
            const dateKey = utcDateKey(date);
            const day = dayMap.get(dateKey);
            if (!day) {
                const outside = document.createElement('span');
                outside.className = 'ai-contribution-outside';
                outside.setAttribute('aria-hidden', 'true');
                fragment.appendChild(outside);
                continue;
            }

            const cell = document.createElement('button');
            const description = day.n
                ? `${readableDate(day.d)}，${day.c} 条用户消息`
                : `${readableDate(day.d)}，数据范围外`;
            cell.type = 'button';
            cell.className = 'ai-contribution-cell';
            cell.dataset.level = levelFor(day);
            cell.dataset.slot = String(slot);
            cell.tabIndex = -1;
            cell.title = description;
            cell.setAttribute('role', 'gridcell');
            cell.setAttribute('aria-label', description);
            cell.addEventListener('click', () => selectCell(cell, day));
            cell.addEventListener('keydown', (event) => {
                const movements = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
                if (!(event.key in movements)) return;
                event.preventDefault();
                focusSlot(slot + movements[event.key]);
            });
            fragment.appendChild(cell);
        }

        grid.appendChild(fragment);
        const initialDay = [...yearData.days].reverse().find((day) => day.n) || yearData.days[0];
        const initialCell = Array.from(grid.querySelectorAll('.ai-contribution-cell'))
            .find((cell) => utcDateKey(new Date(gridStart + Number(cell.dataset.slot) * 86400000)) === initialDay.d);
        if (initialCell) selectCell(initialCell, initialDay);

        title.textContent = `${year} 年贡献度`;
        status.textContent = `${numberFormat.format(yearData.activeDays)} 个活跃日 · ${numberFormat.format(yearData.userMessages)} 条用户消息`;
        summary.textContent = `${year} 年共 ${numberFormat.format(yearData.userMessages)} 条用户消息，峰值 ${readableDate(yearData.peakDate)}`;
        document.getElementById('aiActiveDays').textContent = numberFormat.format(yearData.activeDays);
        document.getElementById('aiUserMessages').textContent = numberFormat.format(yearData.userMessages);
        document.getElementById('aiAssistantReplies').textContent = numberFormat.format(yearData.assistantReplies);
    }

    async function ensureLoaded() {
        if (activityData) return activityData;
        if (loadPromise) return loadPromise;
        status.textContent = '正在读取年度活跃度…';
        loadPromise = fetch('ai-activity-data.json', { cache: 'force-cache' })
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then((data) => {
                if (!data?.years?.['2025'] || !data?.years?.['2026']) throw new Error('年度数据不完整');
                activityData = data;
                renderYear(selectedYear);
                return data;
            })
            .catch((error) => {
                console.error('AI activity data failed to load', error);
                status.textContent = '活跃度数据暂时无法读取，请稍后重试。';
                summary.textContent = '数据加载失败';
                loadPromise = null;
                throw error;
            });
        return loadPromise;
    }

    yearButtons.forEach((button) => {
        button.addEventListener('click', () => {
            selectedYear = Number(button.dataset.aiYear);
            ensureLoaded().then(() => renderYear(selectedYear)).catch(() => {});
        });
    });

    document.addEventListener('archiveappopen', (event) => {
        if (event.detail?.app !== 'ai') return;
        ensureLoaded().catch(() => {});
    });
})();
