const OWNER_USERNAME = 'zgj20051011';
const SESSION_COOKIE = 'zgj_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const OWNER_STEAM_ID = '76561199258285994';
const STEAM_CACHE_TTL_SECONDS = 30 * 60;
const STEAM_QUERY_WINDOW_SECONDS = 10 * 60;
const STEAM_QUERY_LIMIT = 12;
const CONTENT_SECTIONS = new Set(['admin', 'blog', 'engineering', 'laboratory', 'chatgpt', 'more']);
const CONTENT_STATUSES = new Set(['draft', 'published']);
const EVENT_STATUSES = new Set(['planned', 'in_progress', 'completed']);
const VISIBILITIES = new Set(['public', 'private']);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function json(body, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            ...extraHeaders
        }
    });
}

function bytesToBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value, secret) {
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

async function digest(value) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function timingSafeEqual(left, right) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
    return difference === 0;
}

async function createSessionToken(secret) {
    const payload = {
        sub: OWNER_USERNAME,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
    };
    const encodedPayload = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
    const signature = bytesToBase64Url(await hmac(encodedPayload, secret));
    return `${encodedPayload}.${signature}`;
}

async function verifySessionToken(token, secret) {
    if (!token || !secret) return false;
    const [encodedPayload, encodedSignature, extra] = token.split('.');
    if (!encodedPayload || !encodedSignature || extra) return false;

    try {
        const expected = await hmac(encodedPayload, secret);
        const received = base64UrlToBytes(encodedSignature);
        if (!timingSafeEqual(expected, received)) return false;
        const payload = JSON.parse(decoder.decode(base64UrlToBytes(encodedPayload)));
        return payload.sub === OWNER_USERNAME && Number.isFinite(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
    } catch (error) {
        return false;
    }
}

function readCookie(request, name) {
    const cookieHeader = request.headers.get('Cookie') || '';
    for (const part of cookieHeader.split(';')) {
        const separator = part.indexOf('=');
        if (separator === -1) continue;
        if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
    }
    return '';
}

function sessionCookie(request, value, maxAge) {
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function isSameOrigin(request) {
    const origin = request.headers.get('Origin');
    return !origin || origin === new URL(request.url).origin;
}

function hasDatabase(env) {
    return env.DB && typeof env.DB.prepare === 'function';
}

async function readJson(request) {
    try {
        return await request.json();
    } catch (error) {
        return null;
    }
}

function cleanString(value, maximum, fallback = '') {
    if (typeof value !== 'string') return fallback;
    return value.trim().slice(0, maximum);
}

function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

function databaseRequired(env) {
    return hasDatabase(env) ? null : json({ message: 'D1 数据库尚未绑定' }, 503);
}

function steamDatabaseError(error) {
    const message = String(error?.message || error || '');
    if (/no such table|steam_profile_cache|steam_query_limits/i.test(message)) {
        return json({ message: 'Steam 数据库尚未初始化，请先应用最新 D1 迁移' }, 503);
    }
    console.error('Steam database error', error);
    return json({ message: 'Steam 缓存暂时不可用，请稍后重试' }, 503);
}

function parseSteamLookup(value) {
    const lookup = cleanString(value, 256);
    if (!lookup) return { error: '请输入 Steam 主页链接、SteamID64 或自定义 ID' };
    if (/^\d{17}$/.test(lookup)) return { steamId: lookup };

    if (/^[A-Za-z0-9_-]{2,64}$/.test(lookup)) return { vanity: lookup };

    let url;
    try {
        url = new URL(lookup.startsWith('http') ? lookup : `https://${lookup}`);
    } catch (error) {
        return { error: 'Steam 主页格式无效' };
    }

    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname !== 'steamcommunity.com') return { error: '请输入 steamcommunity.com 的个人主页链接' };
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'profiles' && /^\d{17}$/.test(parts[1] || '')) return { steamId: parts[1] };
    if (parts[0] === 'id' && /^[A-Za-z0-9_-]{2,64}$/.test(parts[1] || '')) return { vanity: parts[1] };
    return { error: '无法从该链接识别 Steam 账号' };
}

async function steamApi(path, parameters, apiKey) {
    if (!apiKey) throw Object.assign(new Error('Steam API Key 尚未配置'), { status: 503 });
    const url = new URL(path, 'https://api.steampowered.com');
    url.search = new URLSearchParams({ key: apiKey, format: 'json', ...parameters }).toString();
    let response;
    try {
        response = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (error) {
        throw Object.assign(new Error('暂时无法连接 Steam，请稍后重试'), { status: 502 });
    }
    if (!response.ok) {
        const message = response.status === 401 || response.status === 403
            ? 'Steam API Key 无效或没有访问权限'
            : 'Steam 暂时没有返回有效数据';
        throw Object.assign(new Error(message), { status: 502 });
    }
    try {
        return await response.json();
    } catch (error) {
        throw Object.assign(new Error('Steam 返回的数据格式无效'), { status: 502 });
    }
}

async function resolveSteamId(lookup, apiKey) {
    const parsed = parseSteamLookup(lookup);
    if (parsed.error) throw Object.assign(new Error(parsed.error), { status: 400 });
    if (parsed.steamId) return parsed.steamId;
    const data = await steamApi('/ISteamUser/ResolveVanityURL/v1/', { vanityurl: parsed.vanity }, apiKey);
    if (data?.response?.success !== 1 || !/^\d{17}$/.test(data.response.steamid || '')) {
        throw Object.assign(new Error('没有找到这个 Steam 自定义 ID'), { status: 404 });
    }
    return data.response.steamid;
}

function steamStatusLabel(player) {
    if (player?.gameextrainfo) return `游戏中 · ${player.gameextrainfo}`;
    const labels = ['离线', '在线', '忙碌', '离开', '暂离', '愿意交易', '愿意游戏'];
    return labels[Number(player?.personastate)] || '离线';
}

async function fetchSteamProfile(steamId, apiKey) {
    const [summaryData, gamesData] = await Promise.all([
        steamApi('/ISteamUser/GetPlayerSummaries/v0002/', { steamids: steamId }, apiKey),
        steamApi('/IPlayerService/GetOwnedGames/v0001/', {
            steamid: steamId,
            include_appinfo: 'true',
            include_played_free_games: 'true'
        }, apiKey)
    ]);
    const player = summaryData?.response?.players?.[0];
    if (!player) throw Object.assign(new Error('没有找到这个 Steam 账号'), { status: 404 });

    const gamesResponse = gamesData?.response || {};
    if (!Number.isFinite(gamesResponse.game_count) && !Array.isArray(gamesResponse.games)) {
        throw Object.assign(new Error('该账号的“游戏详情”未公开，无法读取游戏时长'), { status: 403 });
    }

    const games = (Array.isArray(gamesResponse.games) ? gamesResponse.games : [])
        .map((game) => {
            const appId = Number(game.appid) || 0;
            const iconHash = typeof game.img_icon_url === 'string' ? game.img_icon_url : '';
            return {
                appId,
                name: cleanString(game.name, 240, `App ${appId}`),
                playtimeMinutes: Math.max(0, Math.round(Number(game.playtime_forever) || 0)),
                iconUrl: appId && iconHash
                    ? `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${iconHash}.jpg`
                    : ''
            };
        })
        .sort((left, right) => right.playtimeMinutes - left.playtimeMinutes || left.name.localeCompare(right.name, 'zh-CN'));

    return {
        steamId,
        name: cleanString(player.personaname, 160, steamId),
        avatarUrl: cleanString(player.avatarfull || player.avatarmedium, 600),
        profileUrl: cleanString(player.profileurl, 600, `https://steamcommunity.com/profiles/${steamId}/`),
        personaState: Number(player.personastate) || 0,
        statusLabel: steamStatusLabel(player),
        inGame: cleanString(player.gameextrainfo, 240),
        gameCount: Number.isFinite(gamesResponse.game_count) ? gamesResponse.game_count : games.length,
        playedGameCount: games.filter((game) => game.playtimeMinutes > 0).length,
        totalPlaytimeMinutes: games.reduce((total, game) => total + game.playtimeMinutes, 0),
        games
    };
}

async function readSteamSnapshot(env, steamId) {
    const row = await env.DB.prepare(`
        SELECT steam_id, profile_name, avatar_url, profile_url, persona_state, status_label,
               game_count, played_game_count, total_playtime_minutes, games_json, queried_at
        FROM steam_profile_cache WHERE steam_id = ?
    `).bind(steamId).first();
    if (!row) return null;
    let games;
    try {
        games = JSON.parse(row.games_json);
    } catch (error) {
        games = [];
    }
    return {
        profile: {
            steamId: row.steam_id,
            name: row.profile_name,
            avatarUrl: row.avatar_url,
            profileUrl: row.profile_url,
            personaState: Number(row.persona_state) || 0,
            statusLabel: row.status_label,
            inGame: String(row.status_label || '').startsWith('游戏中'),
            gameCount: Number(row.game_count) || 0,
            playedGameCount: Number(row.played_game_count) || 0,
            totalPlaytimeMinutes: Number(row.total_playtime_minutes) || 0,
            games: Array.isArray(games) ? games : []
        },
        queriedAt: row.queried_at
    };
}

async function storeSteamSnapshot(env, profile) {
    const queriedAt = new Date().toISOString();
    await env.DB.prepare(`
        INSERT INTO steam_profile_cache
        (steam_id, profile_name, avatar_url, profile_url, persona_state, status_label,
         game_count, played_game_count, total_playtime_minutes, games_json, queried_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(steam_id) DO UPDATE SET
            profile_name = excluded.profile_name,
            avatar_url = excluded.avatar_url,
            profile_url = excluded.profile_url,
            persona_state = excluded.persona_state,
            status_label = excluded.status_label,
            game_count = excluded.game_count,
            played_game_count = excluded.played_game_count,
            total_playtime_minutes = excluded.total_playtime_minutes,
            games_json = excluded.games_json,
            queried_at = excluded.queried_at
    `).bind(
        profile.steamId, profile.name, profile.avatarUrl, profile.profileUrl,
        profile.personaState, profile.statusLabel, profile.gameCount, profile.playedGameCount,
        profile.totalPlaytimeMinutes, JSON.stringify(profile.games), queriedAt
    ).run();
    return queriedAt;
}

function steamCacheIsFresh(snapshot) {
    const queriedAt = new Date(snapshot?.queriedAt).getTime();
    return Number.isFinite(queriedAt) && Date.now() - queriedAt < STEAM_CACHE_TTL_SECONDS * 1000;
}

async function enforceSteamRateLimit(request, env) {
    const address = request.headers.get('CF-Connecting-IP')
        || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
        || 'local';
    const clientKey = bytesToBase64Url(await digest(`steam-query:${address}`)).slice(0, 32);
    const now = new Date();
    const existing = await env.DB.prepare(
        'SELECT window_started_at, query_count FROM steam_query_limits WHERE client_key = ?'
    ).bind(clientKey).first();
    const windowStart = new Date(existing?.window_started_at).getTime();
    const expired = !Number.isFinite(windowStart) || now.getTime() - windowStart >= STEAM_QUERY_WINDOW_SECONDS * 1000;

    if (expired) {
        await env.DB.prepare(`
            INSERT INTO steam_query_limits (client_key, window_started_at, query_count)
            VALUES (?, ?, 1)
            ON CONFLICT(client_key) DO UPDATE SET window_started_at = excluded.window_started_at, query_count = 1
        `).bind(clientKey, now.toISOString()).run();
        return null;
    }

    if (Number(existing.query_count) >= STEAM_QUERY_LIMIT) {
        const retryAfter = Math.max(1, Math.ceil((windowStart + STEAM_QUERY_WINDOW_SECONDS * 1000 - now.getTime()) / 1000));
        return json({ message: '查询过于频繁，请稍后再试' }, 429, { 'Retry-After': String(retryAfter) });
    }
    await env.DB.prepare(
        'UPDATE steam_query_limits SET query_count = query_count + 1 WHERE client_key = ?'
    ).bind(clientKey).run();
    return null;
}

function steamPayload(snapshot, source, warning = '') {
    return {
        ...snapshot,
        source,
        isOwner: snapshot.profile.steamId === OWNER_STEAM_ID,
        ...(warning ? { warning } : {})
    };
}

async function getOwnerSteamProfile(env) {
    const missing = databaseRequired(env);
    if (missing) return missing;
    try {
        const cached = await readSteamSnapshot(env, OWNER_STEAM_ID);
        if (cached) return json(steamPayload(cached, 'cache'));
        if (!env.STEAM_API_KEY) {
            return json({ message: 'Steam API Key 尚未配置，暂时没有站长缓存数据' }, 503);
        }
        const profile = await fetchSteamProfile(OWNER_STEAM_ID, env.STEAM_API_KEY);
        const queriedAt = await storeSteamSnapshot(env, profile);
        return json(steamPayload({ profile, queriedAt }, 'live'));
    } catch (error) {
        if (/no such table|steam_profile_cache/i.test(String(error?.message || ''))) return steamDatabaseError(error);
        return json({ message: error?.message || 'Steam 数据暂时不可用' }, error?.status || 502);
    }
}

async function querySteamProfile(request, env) {
    const missing = databaseRequired(env);
    if (missing) return missing;
    if (!isSameOrigin(request)) return json({ message: '请求来源无效' }, 403);
    const body = await readJson(request);
    const parsed = parseSteamLookup(body?.profile);
    if (parsed.error) return json({ message: parsed.error }, 400);

    try {
        const limited = await enforceSteamRateLimit(request, env);
        if (limited) return limited;
        const steamId = parsed.steamId || await resolveSteamId(parsed.vanity, env.STEAM_API_KEY);
        const cached = await readSteamSnapshot(env, steamId);
        if (cached && steamCacheIsFresh(cached)) return json(steamPayload(cached, 'cache'));
        if (!env.STEAM_API_KEY) {
            if (cached) return json(steamPayload(cached, 'cache', 'Steam API 尚未配置，已展示旧缓存'));
            return json({ message: 'Steam API Key 尚未配置' }, 503);
        }

        try {
            const profile = await fetchSteamProfile(steamId, env.STEAM_API_KEY);
            const queriedAt = await storeSteamSnapshot(env, profile);
            return json(steamPayload({ profile, queriedAt }, 'live'));
        } catch (error) {
            if (cached) return json(steamPayload(cached, 'cache', 'Steam 暂时不可用，已展示旧缓存'));
            throw error;
        }
    } catch (error) {
        if (/no such table|steam_profile_cache|steam_query_limits/i.test(String(error?.message || ''))) return steamDatabaseError(error);
        return json({ message: error?.message || 'Steam 查询失败，请稍后重试' }, error?.status || 502);
    }
}

async function isOwner(request, env) {
    if (!env.SESSION_SECRET) return false;
    return verifySessionToken(readCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
}

async function authorizeMutation(request, env) {
    if (!isSameOrigin(request)) return json({ message: '请求来源无效' }, 403);
    if (!await isOwner(request, env)) return json({ message: '只有所有者可以修改数据' }, 401);
    return null;
}

function contentFromBody(body, existing = {}) {
    const section = cleanString(body?.section, 32, existing.section || '');
    const title = cleanString(body?.title, 160, existing.title || '');
    const summary = cleanString(body?.summary, 600, existing.summary || '');
    const contentBody = typeof body?.body === 'string' ? body.body.trim().slice(0, 200000) : (existing.body || '');
    const status = cleanString(body?.status, 24, existing.status || 'draft');
    const visibility = cleanString(body?.visibility, 24, existing.visibility || 'public');

    if (!CONTENT_SECTIONS.has(section)) return { error: '内容栏目无效' };
    if (!title) return { error: '标题不能为空' };
    if (!CONTENT_STATUSES.has(status)) return { error: '内容状态无效' };
    if (!VISIBILITIES.has(visibility)) return { error: '可见范围无效' };
    return { value: { section, title, summary, body: contentBody, status, visibility } };
}

function eventFromBody(body, existing = {}) {
    const title = cleanString(body?.title, 160, existing.title || '');
    const description = typeof body?.description === 'string'
        ? body.description.trim().slice(0, 20000)
        : (existing.description || '');
    const eventDate = cleanString(body?.event_date, 10, existing.event_date || '');
    const status = cleanString(body?.status, 24, existing.status || 'planned');
    const visibility = cleanString(body?.visibility, 24, existing.visibility || 'private');

    if (!title) return { error: '日程标题不能为空' };
    if (!validDate(eventDate)) return { error: '日程日期无效' };
    if (!EVENT_STATUSES.has(status)) return { error: '日程状态无效' };
    if (!VISIBILITIES.has(visibility)) return { error: '可见范围无效' };
    return { value: { title, description, event_date: eventDate, status, visibility } };
}

async function listContent(request, env) {
    const missing = databaseRequired(env);
    if (missing) return missing;
    const url = new URL(request.url);
    const section = url.searchParams.get('section');
    if (section && !CONTENT_SECTIONS.has(section)) return json({ message: '内容栏目无效' }, 400);

    const owner = await isOwner(request, env);
    const fields = 'id, section, title, summary, body, status, visibility, created_at, updated_at';
    let statement;
    if (owner) {
        statement = section
            ? env.DB.prepare(`SELECT ${fields} FROM content_items WHERE section = ? ORDER BY created_at DESC LIMIT 100`).bind(section)
            : env.DB.prepare(`SELECT ${fields} FROM content_items ORDER BY created_at DESC LIMIT 100`);
    } else {
        statement = section
            ? env.DB.prepare(`SELECT ${fields} FROM content_items WHERE section = ? AND status = 'published' AND visibility = 'public' ORDER BY created_at DESC LIMIT 100`).bind(section)
            : env.DB.prepare(`SELECT ${fields} FROM content_items WHERE status = 'published' AND visibility = 'public' ORDER BY created_at DESC LIMIT 100`);
    }
    const result = await statement.all();
    return json({ items: result.results || [] });
}

async function createContent(request, env) {
    const missing = databaseRequired(env);
    if (missing) return missing;
    const denied = await authorizeMutation(request, env);
    if (denied) return denied;
    const parsed = contentFromBody(await readJson(request));
    if (parsed.error) return json({ message: parsed.error }, 400);

    const item = {
        id: crypto.randomUUID(),
        ...parsed.value,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    await env.DB.prepare(`
        INSERT INTO content_items
        (id, section, title, summary, body, status, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        item.id, item.section, item.title, item.summary, item.body,
        item.status, item.visibility, item.created_at, item.updated_at
    ).run();
    return json({ item }, 201);
}

async function getContentItem(request, id, env) {
    const missing = databaseRequired(env);
    if (missing) return missing;
    const owner = await isOwner(request, env);
    const visibilityFilter = owner ? '' : " AND status = 'published' AND visibility = 'public'";
    const item = await env.DB.prepare(`
        SELECT id, section, title, summary, body, status, visibility, created_at, updated_at
        FROM content_items WHERE id = ?${visibilityFilter}
    `).bind(id).first();
    return item ? json({ item }) : json({ message: '内容不存在' }, 404);
}

async function updateContent(request, id, env) {
    const missing = databaseRequired(env);
    if (missing) return missing;
    const denied = await authorizeMutation(request, env);
    if (denied) return denied;
    const existing = await env.DB.prepare('SELECT * FROM content_items WHERE id = ?').bind(id).first();
    if (!existing) return json({ message: '内容不存在' }, 404);
    const parsed = contentFromBody(await readJson(request), existing);
    if (parsed.error) return json({ message: parsed.error }, 400);
    const item = { ...existing, ...parsed.value, updated_at: new Date().toISOString() };
    await env.DB.prepare(`
        UPDATE content_items
        SET section = ?, title = ?, summary = ?, body = ?, status = ?, visibility = ?, updated_at = ?
        WHERE id = ?
    `).bind(
        item.section, item.title, item.summary, item.body,
        item.status, item.visibility, item.updated_at, id
    ).run();
    return json({ item });
}

async function deleteContent(request, id, env) {
    const missing = databaseRequired(env);
    if (missing) return missing;
    const denied = await authorizeMutation(request, env);
    if (denied) return denied;
    const result = await env.DB.prepare('DELETE FROM content_items WHERE id = ?').bind(id).run();
    return result.meta?.changes ? json({ deleted: true }) : json({ message: '内容不存在' }, 404);
}

async function listEvents(request, env) {
    const missing = databaseRequired(env);
    if (missing) return missing;
    const month = new URL(request.url).searchParams.get('month');
    if (month && !/^\d{4}-\d{2}$/.test(month)) return json({ message: '月份格式无效' }, 400);
    const owner = await isOwner(request, env);
    const fields = 'id, title, description, event_date, status, visibility, created_at, updated_at';
    let statement;
    if (owner) {
        statement = month
            ? env.DB.prepare(`SELECT ${fields} FROM calendar_events WHERE event_date LIKE ? ORDER BY event_date, created_at`).bind(`${month}-%`)
            : env.DB.prepare(`SELECT ${fields} FROM calendar_events ORDER BY event_date, created_at LIMIT 200`);
    } else {
        statement = month
            ? env.DB.prepare(`SELECT ${fields} FROM calendar_events WHERE event_date LIKE ? AND visibility = 'public' ORDER BY event_date, created_at`).bind(`${month}-%`)
            : env.DB.prepare(`SELECT ${fields} FROM calendar_events WHERE visibility = 'public' ORDER BY event_date, created_at LIMIT 200`);
    }
    const result = await statement.all();
    return json({ events: result.results || [] });
}

async function createEvent(request, env) {
    const missing = databaseRequired(env);
    if (missing) return missing;
    const denied = await authorizeMutation(request, env);
    if (denied) return denied;
    const parsed = eventFromBody(await readJson(request));
    if (parsed.error) return json({ message: parsed.error }, 400);
    const event = {
        id: crypto.randomUUID(),
        ...parsed.value,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    await env.DB.prepare(`
        INSERT INTO calendar_events
        (id, title, description, event_date, status, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        event.id, event.title, event.description, event.event_date,
        event.status, event.visibility, event.created_at, event.updated_at
    ).run();
    return json({ event }, 201);
}

async function updateEvent(request, id, env) {
    const missing = databaseRequired(env);
    if (missing) return missing;
    const denied = await authorizeMutation(request, env);
    if (denied) return denied;
    const existing = await env.DB.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(id).first();
    if (!existing) return json({ message: '日程不存在' }, 404);
    const parsed = eventFromBody(await readJson(request), existing);
    if (parsed.error) return json({ message: parsed.error }, 400);
    const event = { ...existing, ...parsed.value, updated_at: new Date().toISOString() };
    await env.DB.prepare(`
        UPDATE calendar_events
        SET title = ?, description = ?, event_date = ?, status = ?, visibility = ?, updated_at = ?
        WHERE id = ?
    `).bind(
        event.title, event.description, event.event_date,
        event.status, event.visibility, event.updated_at, id
    ).run();
    return json({ event });
}

async function deleteEvent(request, id, env) {
    const missing = databaseRequired(env);
    if (missing) return missing;
    const denied = await authorizeMutation(request, env);
    if (denied) return denied;
    const result = await env.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(id).run();
    return result.meta?.changes ? json({ deleted: true }) : json({ message: '日程不存在' }, 404);
}

async function getAuth(request, env) {
    if (!env.SESSION_SECRET) return json({ authenticated: false });
    const authenticated = await verifySessionToken(readCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
    return json({ authenticated, username: authenticated ? OWNER_USERNAME : null });
}

async function postAuth(request, env) {
    if (!isSameOrigin(request)) return json({ authenticated: false, message: '请求来源无效' }, 403);

    let body;
    try {
        body = await request.json();
    } catch (error) {
        return json({ authenticated: false, message: '请求格式无效' }, 400);
    }

    if (body.action === 'logout') {
        return json({ authenticated: false }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
    }
    if (body.action !== 'login') return json({ authenticated: false, message: '不支持的操作' }, 400);
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
        return json({ authenticated: false, message: '登录服务尚未完成配置' }, 503);
    }

    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (username.length > 64 || password.length > 128) {
        return json({ authenticated: false, message: '用户名或密码不正确' }, 401);
    }

    const usernameMatches = username === OWNER_USERNAME;
    const passwordMatches = timingSafeEqual(await digest(password), await digest(env.ADMIN_PASSWORD));
    if (!usernameMatches || !passwordMatches) {
        return json({ authenticated: false, message: '用户名或密码不正确' }, 401);
    }

    const token = await createSessionToken(env.SESSION_SECRET);
    return json(
        { authenticated: true, username: OWNER_USERNAME },
        200,
        { 'Set-Cookie': sessionCookie(request, token, SESSION_TTL_SECONDS) }
    );
}

function methodNotAllowed(allow = 'GET, POST') {
    return json({ message: '请求方法不受支持' }, 405, { Allow: allow });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (/^\/api\/auth\/?$/.test(url.pathname)) {
            if (request.method === 'GET') return getAuth(request, env);
            if (request.method === 'POST') return postAuth(request, env);
            return methodNotAllowed();
        }

        if (/^\/api\/steam\/?$/.test(url.pathname)) {
            if (request.method === 'GET') return getOwnerSteamProfile(env);
            return methodNotAllowed('GET');
        }

        if (/^\/api\/steam\/query\/?$/.test(url.pathname)) {
            if (request.method === 'POST') return querySteamProfile(request, env);
            return methodNotAllowed('POST');
        }

        if (/^\/api\/content\/?$/.test(url.pathname)) {
            if (request.method === 'GET') return listContent(request, env);
            if (request.method === 'POST') return createContent(request, env);
            return methodNotAllowed('GET, POST');
        }

        const contentMatch = url.pathname.match(/^\/api\/content\/([^/]+)\/?$/);
        if (contentMatch) {
            const id = decodeURIComponent(contentMatch[1]);
            if (request.method === 'GET') return getContentItem(request, id, env);
            if (request.method === 'PATCH') return updateContent(request, id, env);
            if (request.method === 'DELETE') return deleteContent(request, id, env);
            return methodNotAllowed('GET, PATCH, DELETE');
        }

        if (/^\/api\/events\/?$/.test(url.pathname)) {
            if (request.method === 'GET') return listEvents(request, env);
            if (request.method === 'POST') return createEvent(request, env);
            return methodNotAllowed('GET, POST');
        }

        const eventMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/?$/);
        if (eventMatch) {
            const id = decodeURIComponent(eventMatch[1]);
            if (request.method === 'PATCH') return updateEvent(request, id, env);
            if (request.method === 'DELETE') return deleteEvent(request, id, env);
            return methodNotAllowed('PATCH, DELETE');
        }

        if (url.pathname.startsWith('/api/')) return json({ message: '接口不存在' }, 404);
        return env.ASSETS.fetch(request);
    }
};
