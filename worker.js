const OWNER_USERNAME = 'zgj20051011';
const SESSION_COOKIE = 'zgj_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
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
