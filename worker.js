const OWNER_USERNAME = 'zgj20051011';
const SESSION_COOKIE = 'zgj_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
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

function methodNotAllowed() {
    return json({ message: '请求方法不受支持' }, 405, { Allow: 'GET, POST' });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (/^\/api\/auth\/?$/.test(url.pathname)) {
            if (request.method === 'GET') return getAuth(request, env);
            if (request.method === 'POST') return postAuth(request, env);
            return methodNotAllowed();
        }

        if (url.pathname.startsWith('/api/')) return json({ message: '接口不存在' }, 404);
        return env.ASSETS.fetch(request);
    }
};
