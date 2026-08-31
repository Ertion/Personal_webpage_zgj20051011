import puppeteer from '@cloudflare/puppeteer';

const OWNER_USERNAME = 'zgj20051011';
const SESSION_COOKIE = 'zgj_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const OWNER_STEAM_ID = '76561199258285994';
const STEAM_CACHE_TTL_SECONDS = 30 * 60;
const STEAM_QUERY_WINDOW_SECONDS = 10 * 60;
const STEAM_QUERY_LIMIT = 12;
const EH_LOFI_ORIGIN = 'https://e-hentai.org';
const EH_API_URL = 'https://api.e-hentai.org/api.php';
const EH_GALLERY_PAGE_SIZE = 20;
const EH_MEDIA_MAX_BYTES = 32 * 1024 * 1024;
const EH_DEV_API_ORIGIN = 'https://zgj20051011.top';
const EH_BLOCKED_TAGS = new Set(['female:lolicon', 'male:shotacon', 'female:underage', 'male:underage']);
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

function xmlText(xml, tag) {
    const cdata = xml.match(new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'));
    if (cdata) return cdata[1].trim();
    const plain = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
    return plain ? plain[1].replace(/<[^>]*>/g, '').trim() : '';
}

async function fetchSteamPublicProfile(parsed) {
    const profilePath = parsed.steamId
        ? `/profiles/${parsed.steamId}/`
        : `/id/${encodeURIComponent(parsed.vanity)}/`;
    const url = new URL(profilePath, 'https://steamcommunity.com');
    url.searchParams.set('xml', '1');
    let response;
    try {
        response = await fetch(url, { headers: { Accept: 'application/xml,text/xml;q=0.9' } });
    } catch (error) {
        throw Object.assign(new Error('暂时无法连接 Steam，请稍后重试'), { status: 502 });
    }
    if (!response.ok) throw Object.assign(new Error('Steam 公开资料暂时不可用'), { status: 502 });
    const xml = await response.text();
    const steamId = xmlText(xml, 'steamID64');
    if (!/^\d{17}$/.test(steamId)) {
        const errorMessage = xmlText(xml, 'error');
        throw Object.assign(new Error(errorMessage || '没有找到这个 Steam 公开资料'), { status: 404 });
    }

    const games = [...xml.matchAll(/<mostPlayedGame>([\s\S]*?)<\/mostPlayedGame>/gi)]
        .map((match) => {
            const block = match[1];
            const gameLink = xmlText(block, 'gameLink');
            const appId = Number(xmlText(block, 'statsName') || gameLink.match(/\/app\/(\d+)/)?.[1]) || 0;
            const hours = Number(xmlText(block, 'hoursOnRecord').replace(/,/g, '')) || 0;
            return {
                appId,
                name: cleanString(xmlText(block, 'gameName'), 240, `App ${appId}`),
                playtimeMinutes: Math.max(0, Math.round(hours * 60)),
                iconUrl: cleanString(xmlText(block, 'gameIcon'), 600)
            };
        })
        .sort((left, right) => right.playtimeMinutes - left.playtimeMinutes || left.name.localeCompare(right.name, 'zh-CN'));
    const onlineState = xmlText(xml, 'onlineState').toLowerCase();
    const stateMessage = cleanString(xmlText(xml, 'stateMessage'), 240);
    const isOnline = onlineState !== '' && onlineState !== 'offline';

    return {
        steamId,
        name: cleanString(xmlText(xml, 'steamID'), 160, steamId),
        avatarUrl: cleanString(xmlText(xml, 'avatarFull') || xmlText(xml, 'avatarMedium'), 600),
        profileUrl: `https://steamcommunity.com/profiles/${steamId}/`,
        personaState: isOnline ? 1 : 0,
        statusLabel: stateMessage || (isOnline ? '在线' : '离线'),
        inGame: onlineState === 'in-game',
        gameCount: games.length,
        playedGameCount: games.filter((game) => game.playtimeMinutes > 0).length,
        totalPlaytimeMinutes: games.reduce((total, game) => total + game.playtimeMinutes, 0),
        games,
        isPartial: true
    };
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
        games,
        isPartial: false
    };
}

async function readSteamSnapshot(env, steamId) {
    const row = await env.DB.prepare(`
        SELECT steam_id, profile_name, avatar_url, profile_url, persona_state, status_label,
               game_count, played_game_count, total_playtime_minutes, games_json, queried_at, is_partial
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
            games: Array.isArray(games) ? games : [],
            isPartial: Number(row.is_partial) === 1
        },
        queriedAt: row.queried_at
    };
}

async function storeSteamSnapshot(env, profile) {
    const queriedAt = new Date().toISOString();
    await env.DB.prepare(`
        INSERT INTO steam_profile_cache
        (steam_id, profile_name, avatar_url, profile_url, persona_state, status_label,
         game_count, played_game_count, total_playtime_minutes, games_json, queried_at, is_partial)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            queried_at = excluded.queried_at,
            is_partial = excluded.is_partial
    `).bind(
        profile.steamId, profile.name, profile.avatarUrl, profile.profileUrl,
        profile.personaState, profile.statusLabel, profile.gameCount, profile.playedGameCount,
        profile.totalPlaytimeMinutes, JSON.stringify(profile.games), queriedAt, profile.isPartial ? 1 : 0
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
        if (cached && !(cached.profile.isPartial && env.STEAM_API_KEY)) {
            return json(steamPayload(cached, 'cache'));
        }
        try {
            const profile = env.STEAM_API_KEY
                ? await fetchSteamProfile(OWNER_STEAM_ID, env.STEAM_API_KEY)
                : await fetchSteamPublicProfile({ steamId: OWNER_STEAM_ID });
            const queriedAt = await storeSteamSnapshot(env, profile);
            const warning = profile.isPartial ? '未配置 Steam API Key，仅展示公开资料中的代表游戏' : '';
            return json(steamPayload({ profile, queriedAt }, 'live', warning));
        } catch (error) {
            if (cached) return json(steamPayload(cached, 'cache', '完整游戏库刷新失败，已展示原缓存'));
            throw error;
        }
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
        let steamId = parsed.steamId || '';
        if (!steamId && env.STEAM_API_KEY) steamId = await resolveSteamId(parsed.vanity, env.STEAM_API_KEY);
        const cached = steamId ? await readSteamSnapshot(env, steamId) : null;
        if (cached && steamCacheIsFresh(cached) && !(cached.profile.isPartial && env.STEAM_API_KEY)) {
            return json(steamPayload(cached, 'cache'));
        }
        if (!env.STEAM_API_KEY) {
            if (cached && !cached.profile.isPartial) {
                return json(steamPayload(cached, 'cache', '未配置 Steam API Key，已展示上一次完整缓存'));
            }
            const profile = await fetchSteamPublicProfile(parsed);
            const queriedAt = await storeSteamSnapshot(env, profile);
            return json(steamPayload(
                { profile, queriedAt },
                'live',
                '未配置 Steam API Key，仅展示公开资料中的代表游戏'
            ));
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

function decodeHtml(value) {
    const named = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0'
    };
    return String(value || '')
        .replace(/&#x([0-9a-f]+);/gi, (match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&#(\d+);/g, (match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
        .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function stripHtml(value) {
    return decodeHtml(String(value || '').replace(/<[^>]*>/g, '')).replace(/\u00a0/g, ' ').trim();
}

function safeEhImageUrl(value) {
    try {
        const url = new URL(decodeHtml(value));
        const hostname = url.hostname.toLowerCase();
        const allowed = hostname === 'ehgt.org'
            || hostname.endsWith('.ehgt.org')
            || hostname === 'hath.network'
            || hostname.endsWith('.hath.network');
        return url.protocol === 'https:' && allowed ? url.toString() : '';
    } catch (error) {
        return '';
    }
}

function ehGalleryIsAllowed(tags) {
    return !tags.some((tag) => EH_BLOCKED_TAGS.has(String(tag || '').trim().toLowerCase()));
}

function ehMediaProxyUrl(request, remoteUrl) {
    if (!remoteUrl) return '';
    const proxy = new URL('/api/ehviewer/media', request.url);
    proxy.searchParams.set('url', remoteUrl);
    return proxy.toString();
}

async function maybeProxyEhApi(request, env) {
    if (env?.EHVIEWER_API_ORIGIN !== EH_DEV_API_ORIGIN) return null;
    const source = new URL(request.url);
    if (source.origin === EH_DEV_API_ORIGIN) return null;
    const upstream = new URL(`${source.pathname}${source.search}`, EH_DEV_API_ORIGIN);
    let response;
    try {
        response = await fetch(upstream, {
            redirect: 'follow',
            headers: { Accept: request.headers.get('Accept') || 'application/json' }
        });
    } catch (error) {
        return json({ message: '暂时无法连接云端画廊接口，请稍后重试' }, 502);
    }
    const headers = new Headers();
    for (const name of ['Content-Type', 'Content-Length', 'Cache-Control', 'ETag', 'Last-Modified']) {
        const value = response.headers.get(name);
        if (value) headers.set(name, value);
    }
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
}

async function fetchEhUpstream(url, options, env, locationHint = 'wnam') {
    if (!env?.EH_GATEWAY) return fetch(url, options);
    const gatewayUrl = new URL('/fetch', 'https://eh-gateway.internal');
    gatewayUrl.searchParams.set('url', String(url));
    const headers = new Headers(options?.headers || {});
    headers.set('X-Eh-Redirect-Mode', options?.redirect === 'manual' ? 'manual' : 'follow');
    headers.set('X-Eh-Cache-Ttl', String(Math.max(0, Number(options?.cf?.cacheTtl) || 0)));
    const stub = env.EH_GATEWAY.getByName(`public-${locationHint}-v1`, { locationHint });
    return stub.fetch(gatewayUrl, {
        method: options?.method || 'GET',
        headers,
        body: options?.body
    });
}

async function renderEhHtmlPage(browser, url) {
    let page;
    try {
        page = await browser.newPage();
        await page.setCookie({
            name: 'nw',
            value: '1',
            domain: '.e-hentai.org',
            path: '/',
            secure: true
        });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36');
        await page.goto(String(url), { waitUntil: 'domcontentloaded', timeout: 30_000 });
        return await page.content();
    } finally {
        if (page) await page.close().catch(() => {});
    }
}

async function fetchEhHtmlWithBrowser(url, env) {
    try {
        if (env?.EH_GATEWAY) {
            const gatewayUrl = new URL('/browser', 'https://eh-gateway.internal');
            gatewayUrl.searchParams.set('url', String(url));
            const stub = env.EH_GATEWAY.getByName('browser-session-v1');
            const response = await stub.fetch(gatewayUrl);
            const body = await response.text();
            if (!response.ok) throw new Error(body || 'browser gateway failed');
            return body;
        }

        const browser = await puppeteer.launch(env.BROWSER);
        try {
            return await renderEhHtmlPage(browser, url);
        } finally {
            await browser.close().catch(() => {});
        }
    } catch (error) {
        throw Object.assign(new Error('云端浏览器暂时无法读取公开画廊'), { status: 502 });
    }
}

function ehHtmlIsBlocked(html) {
    return /temporarily banned due to an excessive request rate|cf-chl-|just a moment\.\.\.|captcha|access denied/i.test(html);
}

async function fetchEhHtmlOverHttp(url, cacheTtl, env) {
    const locations = env?.EH_GATEWAY ? ['wnam', 'enam', 'weur'] : [''];
    for (const locationHint of locations) {
        let response;
        try {
            response = await fetchEhUpstream(url, {
                redirect: 'follow',
                headers: {
                    Accept: 'text/html,application/xhtml+xml',
                    'User-Agent': 'ZGJ-Archive/1.0 (public gallery reader; no account authentication)',
                    // Preference-only cookie: no account id, password hash, or login session.
                    Cookie: 'nw=1'
                },
                cf: { cacheEverything: true, cacheTtl }
            }, env, locationHint || 'wnam');
        } catch (error) {
            if (locationHint && locationHint !== locations.at(-1)) continue;
            throw Object.assign(new Error('暂时无法连接公开画廊，请稍后重试'), { status: 502 });
        }
        if (!response.ok) {
            const retryable = [403, 429, 509].includes(response.status) || response.status >= 500;
            if (retryable && locationHint && locationHint !== locations.at(-1)) continue;
            const message = response.status === 509
                ? '公开画廊已触发临时流量限制，请稍后再试'
                : '公开画廊暂时没有返回有效内容';
            throw Object.assign(new Error(message), { status: response.status === 404 ? 404 : 502 });
        }
        const length = Number(response.headers.get('Content-Length')) || 0;
        if (length > 2_000_000) throw Object.assign(new Error('公开画廊返回内容过大'), { status: 502 });
        const html = await response.text();
        if (ehHtmlIsBlocked(html) && locationHint !== locations.at(-1)) continue;
        if (ehHtmlIsBlocked(html)) {
            throw Object.assign(new Error('公开画廊出口暂时受限，请稍后重试'), { status: 503 });
        }
        return html;
    }
    throw Object.assign(new Error('暂时无法连接公开画廊，请稍后重试'), { status: 502 });
}

async function fetchEhHtml(url, cacheTtl = 60, env) {
    let httpError;
    try {
        return await fetchEhHtmlOverHttp(url, cacheTtl, env);
    } catch (error) {
        httpError = error;
    }

    if (!env?.BROWSER) throw httpError;

    const html = await fetchEhHtmlWithBrowser(url, env);
    if (ehHtmlIsBlocked(html)) {
        throw Object.assign(new Error('公开画廊浏览器出口暂时受限，请稍后重试'), { status: 503 });
    }
    if (html.length > 2_000_000) throw Object.assign(new Error('公开画廊返回内容过大'), { status: 502 });
    return html;
}

function parseEhList(html) {
    const items = [];
    const pattern = /<div><div><a href="https:\/\/e-hentai\.org\/lofi\/s\/([a-f0-9]{10})\/(\d+)-1"><img src="([^"]+)"[^>]*><\/a><\/div><div><h2><a href="https:\/\/e-hentai\.org\/lofi\/g\/\2\/([a-f0-9]{10})\/">([\s\S]*?)<\/a><\/h2><p>([\s\S]*?)<\/p>([\s\S]*?)(?=<\/div><\/div>)/gi;
    for (const match of html.matchAll(pattern)) {
        const metaParts = stripHtml(match[6].replace(/&nbsp;/gi, '  '))
            .split(/\s{2,}/)
            .map((part) => part.trim())
            .filter(Boolean);
        const tags = [];
        const tagPattern = /<tr><td>([^<]+):?<\/td><td>([\s\S]*?)<\/td><\/tr>/gi;
        for (const tagMatch of match[7].matchAll(tagPattern)) {
            const namespace = stripHtml(tagMatch[1]).replace(/:$/, '');
            const values = stripHtml(tagMatch[2]).split(',').map((tag) => tag.trim()).filter(Boolean);
            values.forEach((tag) => tags.push(namespace ? `${namespace}:${tag}` : tag));
        }
        const pagesText = metaParts.find((part) => /^\d+p$/i.test(part)) || '0p';
        const pagesIndex = metaParts.indexOf(pagesText);
        items.push({
            gid: match[2],
            token: match[4],
            firstPageToken: match[1],
            title: stripHtml(match[5]),
            thumbUrl: safeEhImageUrl(match[3]),
            posted: metaParts[0] || '',
            category: pagesIndex > 1 ? metaParts.slice(1, pagesIndex).join(' ') : (metaParts[1] || ''),
            pages: Number.parseInt(pagesText, 10) || 0,
            uploader: pagesIndex >= 0 ? (metaParts[pagesIndex + 1] || '') : '',
            tags
        });
    }

    const pager = html.match(/<div id="ia">([\s\S]*?)<\/div>/i)?.[1] || '';
    const nextCursor = pager.match(/[?&](?:amp;)?next=(\d+)/i)?.[1] || null;
    return { items: items.filter((item) => ehGalleryIsAllowed(item.tags)), nextCursor };
}

function parseEhPreviews(html) {
    const previews = [];
    const pattern = /<a href="https:\/\/e-hentai\.org\/lofi\/s\/([a-f0-9]{10})\/(\d+)-(\d+)"><div title="Page (\d+)" style="[^"]*?url\((https:\/\/[^)]+)\)[^"]*"><\/div><\/a>/gi;
    for (const match of html.matchAll(pattern)) {
        const thumbUrl = safeEhImageUrl(match[5]);
        if (!thumbUrl) continue;
        previews.push({
            pageToken: match[1],
            pageNumber: Number(match[3]) || Number(match[4]) || 1,
            thumbUrl
        });
    }
    return previews;
}

async function fetchEhMetadata(gid, token, env) {
    let response;
    try {
        response = await fetchEhUpstream(EH_API_URL, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'ZGJ-Archive/1.0 (public gallery reader; no account cookies)'
            },
            body: JSON.stringify({ method: 'gdata', gidlist: [[Number(gid), token]], namespace: 1 })
        }, env);
    } catch (error) {
        throw Object.assign(new Error('暂时无法读取画廊资料，请稍后重试'), { status: 502 });
    }
    if (!response.ok) throw Object.assign(new Error('画廊资料暂时不可用'), { status: 502 });
    let data;
    try {
        data = await response.json();
    } catch (error) {
        throw Object.assign(new Error('画廊资料格式无效'), { status: 502 });
    }
    const metadata = data?.gmetadata?.[0];
    if (!metadata || metadata.error) {
        throw Object.assign(new Error(metadata?.error || '没有找到这个公开画廊'), { status: 404 });
    }
    return metadata;
}

function validEhGalleryId(value) {
    return /^\d{1,10}$/.test(value || '');
}

function validEhToken(value) {
    return /^[a-f0-9]{10}$/i.test(value || '');
}

async function listEhGalleries(request, env) {
    const requestUrl = new URL(request.url);
    const search = cleanString(requestUrl.searchParams.get('search'), 120);
    const next = cleanString(requestUrl.searchParams.get('next'), 12);
    if (next && !/^\d{1,10}$/.test(next)) return json({ message: '画廊分页参数无效' }, 400);

    const upstream = new URL('/lofi/', EH_LOFI_ORIGIN);
    if (search) upstream.searchParams.set('f_search', search);
    if (next) upstream.searchParams.set('next', next);
    try {
        const html = await fetchEhHtml(upstream, 60, env);
        const parsed = parseEhList(html);
        if (!parsed.items.length && !/No hits found/i.test(html)) {
            throw Object.assign(new Error('公开画廊页面结构暂时无法识别'), { status: 502 });
        }
        return json({
            items: parsed.items.map((item) => ({
                ...item,
                thumbUrl: ehMediaProxyUrl(request, item.thumbUrl)
            })),
            nextCursor: parsed.nextCursor,
            search,
            fetchedAt: new Date().toISOString()
        }, 200, { 'Cache-Control': 'private, max-age=30' });
    } catch (error) {
        return json({ message: error?.message || '公开画廊暂时不可用' }, error?.status || 502);
    }
}

async function getEhGallery(request, env) {
    const requestUrl = new URL(request.url);
    const gid = cleanString(requestUrl.searchParams.get('gid'), 10);
    const token = cleanString(requestUrl.searchParams.get('token'), 10).toLowerCase();
    const batchValue = cleanString(requestUrl.searchParams.get('batch'), 4, '0');
    const knownCountValue = cleanString(requestUrl.searchParams.get('count'), 7);
    if (!validEhGalleryId(gid) || !validEhToken(token) || !/^\d{1,3}$/.test(batchValue)) {
        return json({ message: '画廊地址参数无效' }, 400);
    }
    const batch = Number(batchValue);
    if (batch > 999) return json({ message: '画廊分页超出范围' }, 400);
    if (batch > 0 && !/^\d{1,7}$/.test(knownCountValue)) return json({ message: '画廊页数参数无效' }, 400);

    const galleryPath = `/lofi/g/${gid}/${token}/${batch ? batch : ''}`;
    try {
        if (batch > 0) {
            const fileCount = Number(knownCountValue);
            const batchCount = Math.max(1, Math.ceil(fileCount / EH_GALLERY_PAGE_SIZE));
            if (batch >= batchCount) return json({ message: '画廊分页超出范围' }, 404);
            const html = await fetchEhHtml(new URL(galleryPath, EH_LOFI_ORIGIN), 300, env);
            const previews = parseEhPreviews(html);
            if (!previews.length) throw Object.assign(new Error('该组暂时没有可读取的公开图片'), { status: 404 });
            return json({
                previews: previews.map((preview) => ({
                    ...preview,
                    thumbUrl: ehMediaProxyUrl(request, preview.thumbUrl)
                })),
                batch,
                batchCount
            }, 200, { 'Cache-Control': 'private, max-age=120' });
        }

        const [metadata, html] = await Promise.all([
            fetchEhMetadata(gid, token, env),
            fetchEhHtml(new URL(galleryPath, EH_LOFI_ORIGIN), 300, env)
        ]);
        const metadataTags = Array.isArray(metadata.tags)
            ? metadata.tags.map((tag) => cleanString(decodeHtml(tag), 180)).filter(Boolean)
            : [];
        if (!ehGalleryIsAllowed(metadataTags)) {
            return json({ message: '该画廊不在本站允许展示的范围内' }, 451);
        }
        const previews = parseEhPreviews(html);
        if (!previews.length) throw Object.assign(new Error('该画廊暂时没有可读取的公开图片'), { status: 404 });
        const fileCount = Math.max(0, Number(metadata.filecount) || 0);
        const batchCount = Math.max(1, Math.ceil(fileCount / EH_GALLERY_PAGE_SIZE));
        if (batch >= batchCount) return json({ message: '画廊分页超出范围' }, 404);
        const proxiedPreviews = previews.map((preview) => ({
            ...preview,
            thumbUrl: ehMediaProxyUrl(request, preview.thumbUrl)
        }));
        return json({
            gallery: {
                gid,
                token,
                title: cleanString(decodeHtml(metadata.title), 500, `Gallery ${gid}`),
                japaneseTitle: cleanString(decodeHtml(metadata.title_jpn), 500),
                category: cleanString(metadata.category, 60),
                thumbUrl: ehMediaProxyUrl(request, safeEhImageUrl(metadata.thumb)),
                uploader: cleanString(metadata.uploader, 160),
                postedAt: Number(metadata.posted) > 0 ? new Date(Number(metadata.posted) * 1000).toISOString() : '',
                fileCount,
                fileSize: Math.max(0, Number(metadata.filesize) || 0),
                rating: Number(metadata.rating) || 0,
                tags: metadataTags,
                externalUrl: `${EH_LOFI_ORIGIN}/g/${gid}/${token}/`
            },
            previews: proxiedPreviews,
            batch,
            batchCount
        }, 200, { 'Cache-Control': 'private, max-age=120' });
    } catch (error) {
        return json({ message: error?.message || '画廊资料暂时不可用' }, error?.status || 502);
    }
}

async function getEhImage(request, env) {
    const requestUrl = new URL(request.url);
    const gid = cleanString(requestUrl.searchParams.get('gid'), 10);
    const pageToken = cleanString(requestUrl.searchParams.get('token'), 10).toLowerCase();
    const pageValue = cleanString(requestUrl.searchParams.get('page'), 8);
    if (!validEhGalleryId(gid) || !validEhToken(pageToken) || !/^\d{1,6}$/.test(pageValue)) {
        return json({ message: '图片页参数无效' }, 400);
    }
    const pageNumber = Number(pageValue);
    if (pageNumber < 1) return json({ message: '图片页参数无效' }, 400);

    try {
        const html = await fetchEhHtml(new URL(`/lofi/s/${pageToken}/${gid}-${pageNumber}`, EH_LOFI_ORIGIN), 30, env);
        const imageMatch = html.match(/<img id="sm" src="([^"]+)" alt="([^"]*)"/i);
        const imageUrl = safeEhImageUrl(imageMatch?.[1]);
        if (!imageUrl) throw Object.assign(new Error('该图片暂时无法读取'), { status: 404 });
        const navigation = [];
        const linkPattern = /href="https:\/\/e-hentai\.org\/lofi\/s\/([a-f0-9]{10})\/\d+-(\d+)"/gi;
        for (const match of html.matchAll(linkPattern)) {
            navigation.push({ pageToken: match[1], pageNumber: Number(match[2]) });
        }
        const previous = navigation.find((item) => item.pageNumber === pageNumber - 1) || null;
        const next = navigation.find((item) => item.pageNumber === pageNumber + 1) || null;
        return json({
            imageUrl: ehMediaProxyUrl(request, imageUrl),
            fileName: cleanString(decodeHtml(imageMatch?.[2]), 300, `page-${pageNumber}`),
            pageNumber,
            previous,
            next
        });
    } catch (error) {
        return json({ message: error?.message || '图片暂时不可用' }, error?.status || 502);
    }
}

async function getEhMedia(request, env) {
    const requestUrl = new URL(request.url);
    let imageUrl = safeEhImageUrl(cleanString(requestUrl.searchParams.get('url'), 2048));
    if (!imageUrl) return json({ message: '图片来源无效' }, 400);

    let response;
    try {
        for (let redirects = 0; redirects <= 3; redirects += 1) {
            response = await fetchEhUpstream(imageUrl, {
                redirect: 'manual',
                headers: {
                    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                    Referer: `${EH_LOFI_ORIGIN}/`,
                    'User-Agent': 'ZGJ-Archive/1.0 (public gallery reader; no account authentication)',
                    Cookie: 'nw=1'
                },
                cf: { cacheEverything: true, cacheTtl: 3600 }
            }, env);
            if (![301, 302, 303, 307, 308].includes(response.status)) break;
            const location = response.headers.get('Location');
            const redirected = location ? safeEhImageUrl(new URL(location, imageUrl).toString()) : '';
            if (!redirected) return json({ message: '图片跳转地址无效' }, 502);
            imageUrl = redirected;
        }
    } catch (error) {
        return json({ message: '暂时无法读取图片' }, 502);
    }

    if (!response?.ok) return json({ message: '图片暂时不可用' }, response?.status === 404 ? 404 : 502);
    const contentType = response.headers.get('Content-Type') || '';
    const contentLength = Number(response.headers.get('Content-Length')) || 0;
    if (!/^image\//i.test(contentType)) return json({ message: '上游返回的不是图片' }, 502);
    if (contentLength > EH_MEDIA_MAX_BYTES) return json({ message: '图片文件过大' }, 413);

    const headers = new Headers({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff'
    });
    if (contentLength) headers.set('Content-Length', String(contentLength));
    for (const name of ['ETag', 'Last-Modified']) {
        const value = response.headers.get(name);
        if (value) headers.set(name, value);
    }
    return new Response(response.body, { status: 200, headers });
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

export class EhGateway {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        this.browser = null;
        this.browserQueue = Promise.resolve();
    }

    async browserHtml(target) {
        if (!this.browser?.connected) {
            const sessions = await puppeteer.sessions(this.env.BROWSER).catch(() => []);
            const reusable = sessions.find((session) => !session.connectionId);
            if (reusable) {
                this.browser = await puppeteer.connect(this.env.BROWSER, reusable.sessionId).catch(() => null);
            }
            if (!this.browser) {
                this.browser = await puppeteer.launch(this.env.BROWSER, {
                    keep_alive: 60_000,
                    guardrails: {
                        allowedDomains: [
                            'e-hentai.org', '*.e-hentai.org',
                            'ehgt.org', '*.ehgt.org',
                            'hath.network', '*.hath.network'
                        ]
                    }
                });
            }
        }
        return renderEhHtmlPage(this.browser, target);
    }

    async fetch(request) {
        const requestUrl = new URL(request.url);
        const targetValue = requestUrl.searchParams.get('url') || '';
        let target;
        try {
            target = new URL(targetValue);
        } catch (error) {
            return json({ message: '上游地址无效' }, 400);
        }
        const galleryHost = target.hostname === 'e-hentai.org' && target.pathname.startsWith('/lofi/');
        const metadataHost = target.href === EH_API_URL;
        const imageHost = Boolean(safeEhImageUrl(target.href));
        if (target.protocol !== 'https:' || (!galleryHost && !metadataHost && !imageHost)) {
            return json({ message: '上游地址不受信任' }, 403);
        }

        if (requestUrl.pathname === '/browser') {
            if (!galleryHost || !this.env?.BROWSER) return json({ message: '浏览器上游地址无效' }, 403);
            const task = this.browserQueue.then(() => this.browserHtml(target));
            this.browserQueue = task.catch(() => {});
            try {
                return new Response(await task, {
                    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
                });
            } catch (error) {
                if (this.browser) await this.browser.disconnect().catch(() => {});
                this.browser = null;
                return new Response(cleanString(error?.message || error, 180, 'browser error'), { status: 502 });
            }
        }

        const headers = new Headers();
        for (const name of ['Accept', 'Content-Type', 'User-Agent', 'Cookie', 'Referer']) {
            const value = request.headers.get(name);
            if (value) headers.set(name, value);
        }
        const redirect = request.headers.get('X-Eh-Redirect-Mode') === 'manual' ? 'manual' : 'follow';
        const cacheTtl = Math.min(3600, Math.max(0, Number(request.headers.get('X-Eh-Cache-Ttl')) || 0));
        return fetch(target, {
            method: request.method,
            headers,
            body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
            redirect,
            cf: cacheTtl ? { cacheEverything: true, cacheTtl } : undefined
        });
    }
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

        if (/^\/api\/ehviewer\/?$/.test(url.pathname)) {
            if (request.method === 'GET') return await maybeProxyEhApi(request, env) || listEhGalleries(request, env);
            return methodNotAllowed('GET');
        }

        if (/^\/api\/ehviewer\/gallery\/?$/.test(url.pathname)) {
            if (request.method === 'GET') return await maybeProxyEhApi(request, env) || getEhGallery(request, env);
            return methodNotAllowed('GET');
        }

        if (/^\/api\/ehviewer\/image\/?$/.test(url.pathname)) {
            if (request.method === 'GET') return await maybeProxyEhApi(request, env) || getEhImage(request, env);
            return methodNotAllowed('GET');
        }

        if (/^\/api\/ehviewer\/media\/?$/.test(url.pathname)) {
            if (request.method === 'GET') return await maybeProxyEhApi(request, env) || getEhMedia(request, env);
            return methodNotAllowed('GET');
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
