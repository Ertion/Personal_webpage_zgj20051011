(() => {
    const OWNER_STEAM_ID = '76561199258285994';
    const INITIAL_GAME_LIMIT = 10;
    const form = document.getElementById('steamQueryForm');
    const input = document.getElementById('steamQueryInput');
    const submitButton = document.getElementById('steamQueryButton');
    const status = document.getElementById('steamStatus');
    const result = document.getElementById('steamResult');
    const avatar = document.getElementById('steamAvatar');
    const profileName = document.getElementById('steamProfileName');
    const presenceDot = document.getElementById('steamPresenceDot');
    const presence = document.getElementById('steamPresence');
    const totalTime = document.getElementById('steamTotalTime');
    const totalLabel = document.getElementById('steamTotalLabel');
    const rankingMeta = document.getElementById('steamRankingMeta');
    const rankingTitle = document.getElementById('steamRankingTitle');
    const gameList = document.getElementById('steamGameList');
    const showZero = document.getElementById('steamShowZero');
    const expandButton = document.getElementById('steamExpandButton');
    const ownerButton = document.getElementById('steamOwnerButton');
    let currentData = null;
    let expanded = false;
    let ownerLoadStarted = false;

    function formatDuration(minutes) {
        const value = Number(minutes) || 0;
        if (value < 60) return `${value} 分钟`;
        const hours = value / 60;
        return `${hours < 100 ? hours.toFixed(1) : Math.round(hours).toLocaleString('zh-CN')} 小时`;
    }

    function formatUpdatedAt(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value || '未知';
        return date.toLocaleString('zh-CN', { hour12: false });
    }

    function setStatus(message = '', isError = false) {
        status.textContent = message;
        status.classList.toggle('is-error', isError);
    }

    function setBusy(busy) {
        submitButton.disabled = busy;
        submitButton.textContent = busy ? '查询中…' : '查询 Steam';
    }

    function visibleGames() {
        if (!currentData) return [];
        return showZero.checked
            ? currentData.profile.games
            : currentData.profile.games.filter((game) => game.playtimeMinutes > 0);
    }

    function renderGames() {
        const games = visibleGames();
        const shown = expanded ? games : games.slice(0, INITIAL_GAME_LIMIT);
        const maximum = Math.max(1, games[0]?.playtimeMinutes || 0);
        gameList.replaceChildren();

        if (!games.length) {
            const empty = document.createElement('li');
            empty.className = 'steam-empty';
            empty.textContent = showZero.checked ? '该账号没有可展示的游戏。' : '暂无有游玩时长的游戏，可勾选“显示未游玩游戏”查看完整游戏库。';
            gameList.appendChild(empty);
        } else {
            shown.forEach((game, index) => {
                const row = document.createElement('li');
                row.className = 'steam-game-row';
                row.style.setProperty('--steam-progress', `${Math.max(2, (game.playtimeMinutes / maximum) * 100)}%`);

                const rank = document.createElement('span');
                rank.className = 'steam-rank';
                rank.textContent = String(index + 1).padStart(2, '0');

                const icon = document.createElement('img');
                icon.className = 'steam-game-icon';
                icon.alt = '';
                icon.loading = 'lazy';
                icon.width = 42;
                icon.height = 42;
                if (game.iconUrl) icon.src = game.iconUrl;

                const name = document.createElement('span');
                name.className = 'steam-game-name';
                name.textContent = game.name;

                const time = document.createElement('span');
                time.className = 'steam-game-time';
                time.textContent = formatDuration(game.playtimeMinutes);

                row.append(rank, icon, name, time);
                gameList.appendChild(row);
            });
        }

        rankingMeta.textContent = currentData.profile.isPartial
            ? `Steam 公开资料提供了 ${currentData.profile.gameCount} 款代表游戏`
            : `${currentData.profile.playedGameCount} 款有游玩记录 · 共 ${currentData.profile.gameCount} 款游戏`;
        expandButton.hidden = games.length <= INITIAL_GAME_LIMIT;
        expandButton.textContent = expanded ? '收起排行' : `查看全部 ${games.length} 款`;
    }

    function render(data) {
        currentData = data;
        expanded = false;
        const profile = data.profile;
        result.hidden = false;
        avatar.src = profile.avatarUrl;
        avatar.alt = `${profile.name} 的 Steam 头像`;
        profileName.textContent = profile.name;
        profileName.href = profile.profileUrl;
        presence.textContent = profile.statusLabel;
        presenceDot.classList.toggle('is-online', profile.personaState !== 0 || Boolean(profile.inGame));
        const totalMinutes = Number(profile.totalPlaytimeMinutes) || 0;
        const totalHours = totalMinutes / 60;
        totalTime.textContent = totalMinutes >= 60
            ? (totalHours < 100 ? totalHours.toFixed(1) : Math.round(totalHours).toLocaleString('zh-CN'))
            : totalMinutes.toLocaleString('zh-CN');
        totalLabel.textContent = profile.isPartial
            ? (totalMinutes >= 60 ? '公开资料中的小时' : '公开资料中的分钟')
            : (totalMinutes >= 60 ? '累计游戏小时' : '累计游戏分钟');
        rankingTitle.textContent = profile.isPartial ? '公开资料中的游戏' : '累计时长排行';
        showZero.closest('label').hidden = Boolean(profile.isPartial);
        ownerButton.hidden = profile.steamId === OWNER_STEAM_ID;
        showZero.checked = false;
        renderGames();

        const sourceText = data.source === 'live' ? '刚刚从 Steam 更新' : '读取上一次查询缓存';
        const warning = data.warning ? `；${data.warning}` : '';
        setStatus(`${sourceText} · 更新于 ${formatUpdatedAt(data.queriedAt)}${warning}`);
    }

    async function request(path, options = {}) {
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
        if (!response.ok) throw new Error(data.message || `查询失败（${response.status}）`);
        return data;
    }

    async function loadOwner() {
        ownerLoadStarted = true;
        setStatus('正在读取站长的 Steam 数据…');
        ownerButton.hidden = true;
        try {
            render(await request('/api/steam'));
        } catch (error) {
            ownerLoadStarted = false;
            result.hidden = true;
            setStatus(error.message || 'Steam 数据暂时不可用', true);
        }
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const lookup = input.value.trim();
        if (!lookup) {
            setStatus('请输入 Steam 主页链接、SteamID64 或自定义 ID。', true);
            input.focus();
            return;
        }
        setBusy(true);
        setStatus('正在查询公开的 Steam 游戏资料…');
        try {
            render(await request('/api/steam/query', {
                method: 'POST',
                body: JSON.stringify({ profile: lookup })
            }));
        } catch (error) {
            setStatus(error.message || '查询失败，请稍后重试', true);
        } finally {
            setBusy(false);
        }
    });

    showZero.addEventListener('change', () => {
        expanded = false;
        renderGames();
    });
    expandButton.addEventListener('click', () => {
        expanded = !expanded;
        renderGames();
    });
    ownerButton.addEventListener('click', loadOwner);
    document.addEventListener('archiveappopen', (event) => {
        if (event.detail?.app === 'steam' && !ownerLoadStarted) loadOwner();
    });
})();
