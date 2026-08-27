import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

const env = {
    ADMIN_PASSWORD: 'test-only-password',
    SESSION_SECRET: 'test-only-session-secret-with-more-than-32-characters',
    ASSETS: {
        fetch(request) {
            return new Response(`asset:${new URL(request.url).pathname}`);
        }
    }
};

test('静态页面请求交给 Assets 服务', async () => {
    const response = await worker.fetch(new Request('https://example.com/index.html'), env);
    assert.equal(await response.text(), 'asset:/index.html');
});

test('Worker 正确处理登录接口', async () => {
    const response = await worker.fetch(new Request('https://example.com/api/auth'), env);
    assert.deepEqual(await response.json(), { authenticated: false, username: null });
});

test('未知 API 不会退回首页', async () => {
    const response = await worker.fetch(new Request('https://example.com/api/unknown'), env);
    assert.equal(response.status, 404);
});
