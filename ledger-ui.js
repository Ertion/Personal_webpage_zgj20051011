(() => {
    const root = document.getElementById('ledgerApp');
    if (!root) return;

    const categories = ['餐饮食品', '日用购物', '交通出行', '数码学习', '生活健康', '娱乐订阅', '人情往来', '资金流转'];
    const categoryColors = {
        餐饮食品: '#d36d4d', 日用购物: '#d6a341', 交通出行: '#4f83b5', 数码学习: '#6c69b7',
        生活健康: '#4e9b80', 娱乐订阅: '#b06c9b', 人情往来: '#d78378', 资金流转: '#71818d',
        支出: '#c85b4c', 收入: '#3d8d74', 不计收支: '#9aa3a9'
    };
    const directionLabels = { expense: '支出', income: '收入', neutral: '不计收支' };
    const categoryMarks = { 餐饮食品: '食', 日用购物: '购', 交通出行: '行', 数码学习: '数', 生活健康: '生', 娱乐订阅: '娱', 人情往来: '礼', 资金流转: '转' };
    const state = { account: '微信', month: '2026-08', transactions: [], balance: null, initialized: false, request: 0 };

    const accountTabs = Array.from(root.querySelectorAll('[data-ledger-account]'));
    const monthInput = document.getElementById('ledgerMonth');
    const status = document.getElementById('ledgerStatus');
    const list = document.getElementById('ledgerTransactionList');
    const pie = document.getElementById('ledgerPie');
    const legend = document.getElementById('ledgerChartLegend');
    const chartGroup = document.getElementById('ledgerChartGroup');
    const editDialog = document.getElementById('ledgerEditDialog');
    const balanceDialog = document.getElementById('ledgerBalanceDialog');

    function money(cents) {
        return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format((Number(cents) || 0) / 100);
    }

    function displayTime(value) {
        const [date, time = ''] = String(value || '').split('T');
        return `${date || ''} ${time.slice(0, 5)}`.trim();
    }

    async function request(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || '请求失败，请稍后重试');
        return body;
    }

    function setActiveAccount() {
        accountTabs.forEach((button) => {
            const active = button.dataset.ledgerAccount === state.account;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        });
    }

    function renderSummary() {
        const expense = state.transactions.filter((item) => item.direction === 'expense').reduce((sum, item) => sum + item.amount_cents, 0);
        const income = state.transactions.filter((item) => item.direction === 'income').reduce((sum, item) => sum + item.amount_cents, 0);
        document.getElementById('ledgerExpense').textContent = money(expense);
        document.getElementById('ledgerIncome').textContent = money(income);
        document.getElementById('ledgerCount').textContent = String(state.transactions.length);
        document.getElementById('ledgerBalance').textContent = state.balance === null ? '未设置' : money(state.balance);
    }

    function renderChart() {
        const grouped = new Map();
        if (chartGroup.value === 'direction') {
            for (const item of state.transactions) {
                const label = directionLabels[item.direction];
                grouped.set(label, (grouped.get(label) || 0) + item.amount_cents);
            }
        } else {
            for (const item of state.transactions.filter((transaction) => transaction.direction === 'expense')) {
                grouped.set(item.subcategory, (grouped.get(item.subcategory) || 0) + item.amount_cents);
            }
        }

        const entries = Array.from(grouped.entries()).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
        const total = entries.reduce((sum, [, value]) => sum + value, 0);
        legend.replaceChildren();
        if (!total) {
            pie.style.background = 'conic-gradient(#d6c8b8 0 100%)';
            pie.replaceChildren(Object.assign(document.createElement('span'), { textContent: '暂无金额' }));
            legend.append(Object.assign(document.createElement('p'), { textContent: '当前月份没有可用于饼图的交易' }));
            return;
        }

        let offset = 0;
        const stops = entries.map(([label, value]) => {
            const start = offset;
            offset += value / total * 100;
            return `${categoryColors[label] || '#71818d'} ${start.toFixed(2)}% ${offset.toFixed(2)}%`;
        });
        pie.style.background = `conic-gradient(${stops.join(', ')})`;
        const center = document.createElement('span');
        center.innerHTML = `<small>${chartGroup.value === 'subcategory' ? '支出合计' : '金额合计'}</small><strong>${money(total)}</strong>`;
        pie.replaceChildren(center);

        for (const [label, value] of entries) {
            const row = document.createElement('div');
            row.className = 'ledger-legend-row';
            const name = document.createElement('span');
            name.innerHTML = `<i style="--legend-color:${categoryColors[label] || '#71818d'}"></i>${label}`;
            const amount = document.createElement('strong');
            amount.textContent = `${money(value)} · ${(value / total * 100).toFixed(1)}%`;
            row.append(name, amount);
            legend.append(row);
        }
    }

    function openTransaction(item) {
        document.getElementById('ledgerEditId').value = item.id;
        document.getElementById('ledgerEditNote').value = item.note || '';
        document.getElementById('ledgerEditAccount').value = item.account;
        document.getElementById('ledgerEditCategory').value = item.subcategory;
        document.getElementById('ledgerEditDirection').value = item.direction;
        document.getElementById('ledgerEditAmount').value = (item.amount_cents / 100).toFixed(2);
        document.getElementById('ledgerEditTime').value = item.occurred_at;
        document.getElementById('ledgerEditSource').textContent = item.source_detail ? `原始流水：${item.source_detail}` : '';
        document.getElementById('ledgerEditStatus').textContent = '';
        editDialog.showModal();
    }

    function renderTransactions() {
        list.replaceChildren();
        status.textContent = `${state.month} · ${state.transactions.length} 笔`;
        if (!state.transactions.length) {
            list.append(Object.assign(document.createElement('p'), { className: 'ledger-empty', textContent: '这个账户在当前月份没有交易。' }));
            return;
        }

        let currentDate = '';
        for (const item of state.transactions) {
            const date = item.occurred_at.slice(0, 10);
            if (date !== currentDate) {
                currentDate = date;
                const heading = document.createElement('h4');
                heading.className = 'ledger-date-heading';
                heading.textContent = date;
                list.append(heading);
            }
            const row = document.createElement('article');
            row.className = 'ledger-transaction-row';
            const mark = document.createElement('span');
            mark.className = 'ledger-category-mark';
            mark.style.setProperty('--category-color', categoryColors[item.subcategory]);
            mark.textContent = categoryMarks[item.subcategory] || '账';
            const copy = document.createElement('div');
            copy.className = 'ledger-transaction-copy';
            const title = document.createElement('strong');
            title.textContent = item.note || '无备注';
            const meta = document.createElement('p');
            meta.textContent = `${displayTime(item.occurred_at).slice(11)} · ${item.subcategory}${item.source_status ? ` · ${item.source_status}` : ''}`;
            copy.append(title, meta);
            const amount = document.createElement('strong');
            amount.className = `ledger-transaction-amount is-${item.direction}`;
            amount.textContent = `${item.direction === 'expense' ? '−' : item.direction === 'income' ? '+' : ''}${money(item.amount_cents)}`;
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.textContent = '编辑';
            edit.addEventListener('click', () => openTransaction(item));
            row.append(mark, copy, amount, edit);
            list.append(row);
        }
    }

    function renderAll() {
        renderSummary();
        renderChart();
        renderTransactions();
    }

    async function loadLedger() {
        const currentRequest = ++state.request;
        status.textContent = '正在载入账单…';
        list.replaceChildren(Object.assign(document.createElement('p'), { className: 'ledger-empty', textContent: '正在读取已去重流水…' }));
        try {
            const data = await request(`/api/ledger?account=${encodeURIComponent(state.account)}&month=${encodeURIComponent(state.month)}`);
            if (currentRequest !== state.request) return;
            state.transactions = data.transactions || [];
            state.balance = data.balance?.balance_cents ?? null;
            renderAll();
        } catch (error) {
            if (currentRequest !== state.request) return;
            state.transactions = [];
            state.balance = null;
            renderSummary();
            renderChart();
            status.textContent = error.message;
            list.replaceChildren(Object.assign(document.createElement('p'), { className: 'ledger-empty ledger-error', textContent: error.message }));
        }
    }

    function shiftMonth(delta) {
        const [year, month] = state.month.split('-').map(Number);
        const date = new Date(year, month - 1 + delta, 1);
        const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (next < monthInput.min || next > monthInput.max) return;
        state.month = next;
        monthInput.value = next;
        loadLedger();
    }

    accountTabs.forEach((button) => button.addEventListener('click', () => {
        if (state.account === button.dataset.ledgerAccount) return;
        state.account = button.dataset.ledgerAccount;
        setActiveAccount();
        loadLedger();
    }));
    monthInput.addEventListener('change', () => {
        if (!monthInput.value) return;
        state.month = monthInput.value;
        loadLedger();
    });
    document.getElementById('ledgerPrevMonth').addEventListener('click', () => shiftMonth(-1));
    document.getElementById('ledgerNextMonth').addEventListener('click', () => shiftMonth(1));
    chartGroup.addEventListener('change', renderChart);

    const categorySelect = document.getElementById('ledgerEditCategory');
    categories.forEach((category) => categorySelect.append(new Option(category, category)));
    root.querySelectorAll('[data-ledger-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));

    document.getElementById('ledgerEditForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const id = document.getElementById('ledgerEditId').value;
        const dialogStatus = document.getElementById('ledgerEditStatus');
        const submit = event.currentTarget.querySelector('[type="submit"]');
        submit.disabled = true;
        dialogStatus.textContent = '正在保存…';
        try {
            await request(`/api/ledger/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    note: document.getElementById('ledgerEditNote').value,
                    account: document.getElementById('ledgerEditAccount').value,
                    subcategory: categorySelect.value,
                    direction: document.getElementById('ledgerEditDirection').value,
                    amount_cents: Math.round(Number(document.getElementById('ledgerEditAmount').value) * 100),
                    occurred_at: document.getElementById('ledgerEditTime').value.length === 16
                        ? `${document.getElementById('ledgerEditTime').value}:00`
                        : document.getElementById('ledgerEditTime').value
                })
            });
            editDialog.close();
            await loadLedger();
        } catch (error) {
            dialogStatus.textContent = error.message;
        } finally {
            submit.disabled = false;
        }
    });

    document.getElementById('ledgerEditBalance').addEventListener('click', () => {
        document.getElementById('ledgerBalanceContext').textContent = `${state.account} · ${state.month}`;
        document.getElementById('ledgerBalanceInput').value = state.balance === null ? '' : (state.balance / 100).toFixed(2);
        document.getElementById('ledgerBalanceStatus').textContent = '';
        balanceDialog.showModal();
    });
    document.getElementById('ledgerBalanceForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const input = document.getElementById('ledgerBalanceInput');
        const dialogStatus = document.getElementById('ledgerBalanceStatus');
        const submit = event.currentTarget.querySelector('[type="submit"]');
        submit.disabled = true;
        dialogStatus.textContent = '正在保存…';
        try {
            const value = input.value.trim();
            const data = await request('/api/ledger/balance', {
                method: 'PATCH',
                body: JSON.stringify({ account: state.account, month: state.month, balance_cents: value === '' ? null : Math.round(Number(value) * 100) })
            });
            state.balance = data.balance.balance_cents;
            renderSummary();
            balanceDialog.close();
        } catch (error) {
            dialogStatus.textContent = error.message;
        } finally {
            submit.disabled = false;
        }
    });

    document.addEventListener('archiveappopen', (event) => {
        if (event.detail?.app !== 'ledger' || state.initialized) return;
        state.initialized = true;
        loadLedger();
    });
    document.addEventListener('auth-mode-changed', (event) => {
        if (event.detail?.mode !== 'owner') {
            state.initialized = false;
            state.transactions = [];
            state.balance = null;
        }
    });
})();
