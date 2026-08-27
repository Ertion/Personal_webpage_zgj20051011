import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/auth.js';

const env = {
    ADMIN_PASSWORD: 'test-only-password',
    SESSION_SECRET: 'test-only-session-secret-with-more-than-32-characters'
};

function request(method = 'GET', body, headers = {}) {
    return new Request('https://example.com/api/auth', {
        method,
        headers: {
            Origin: 'https://example.com',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...headers
        },
        body: body ? JSON.stringify(body) : undefined
    });
}

test('未配置服务时保持未登录', async () => {
    const response = await onRequestGet({ request: request(), env: {} });
    assert.deepEqual(await response.json(), { authenticated: false });
});

test('错误密码不能登录', async () => {
    const response = await onRequestPost({
        request: request('POST', { action: 'login', username: 'zgj20051011', password: 'wrong' }),
        env
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).authenticated, false);
});

test('正确登录后签发并验证安全会话', async () => {
    const loginResponse = await onRequestPost({
        request: request('POST', { action: 'login', username: 'zgj20051011', password: env.ADMIN_PASSWORD }),
        env
    });
    assert.equal(loginResponse.status, 200);
    const setCookie = loginResponse.headers.get('Set-Cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Secure/);

    const cookie = setCookie.split(';', 1)[0];
    const sessionResponse = await onRequestGet({ request: request('GET', undefined, { Cookie: cookie }), env });
    assert.deepEqual(await sessionResponse.json(), { authenticated: true, username: 'zgj20051011' });
});

test('退出会清除会话 Cookie', async () => {
    const response = await onRequestPost({
        request: request('POST', { action: 'logout' }),
        env
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
});
