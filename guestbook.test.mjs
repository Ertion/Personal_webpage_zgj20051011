import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker.js';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const env = {
    ADMIN_PASSWORD: 'test-only-password',
    SESSION_SECRET: 'test-only-session-secret-with-more-than-32-characters',
    ASSETS: { fetch: (request) => new Response(`asset:${new URL(request.url).pathname}`) }
};

async function ownerCookie() {
    const response = await worker.fetch(new Request('https://example.com/api/auth', {
        method: 'POST',
        headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username: 'zgj20051011', password: env.ADMIN_PASSWORD })
    }), env);
    return response.headers.get('Set-Cookie').split(';', 1)[0];
}

test('留言板作为第三个公开应用并加载独立交互资源', async () => {
    const [html, script, css, migration] = await Promise.all([
        readFile(join(projectRoot, 'index.html'), 'utf8'),
        readFile(join(projectRoot, 'guestbook-ui.js'), 'utf8'),
        readFile(join(projectRoot, 'guestbook-ui.css'), 'utf8'),
        readFile(join(projectRoot, 'migrations', '0006_guestbook.sql'), 'utf8')
    ]);
    assert.match(html, /data-archive-app="guestbook"/);
    assert.match(html, /id="guestbookShowOthers"[^>]+checked/);
    assert.match(html, /id="guestbookName"[^>]+placeholder="匿名访客"/);
    assert.match(html, /src="guestbook-ui\.js\?v=20260901-2"/);
    assert.match(script, /event\.detail\?\.app === 'guestbook'/);
    assert.match(script, /textContent = comment\.message/);
    assert.match(script, /loadComments\(true, true\)/);
    assert.match(script, /window\.setInterval/);
    assert.match(script, /留言已保存，网络恢复后会自动同步完整列表/);
    assert.match(css, /guestbook-owner-tag/);
    assert.match(migration, /REFERENCES guestbook_comments\(id\) ON DELETE CASCADE/);
});

test('游客可以匿名发布留言，接口记录访客身份但不会向前端暴露', async () => {
    const calls = [];
    const database = {
        prepare(sql) {
            if (/FROM guestbook_comments WHERE id = \?/.test(sql)) {
                return { bind() { return { async first() { return null; } }; } };
            }
            if (/SELECT window_started_at/.test(sql)) {
                return { bind() { return { async first() { return null; } }; } };
            }
            if (/INSERT INTO guestbook_rate_limits/.test(sql)) {
                return { bind(...values) { calls.push(['rate', values]); return { async run() { return { success: true }; } }; } };
            }
            if (/INSERT(?: OR IGNORE)? INTO guestbook_comments/.test(sql)) {
                return { bind(...values) { calls.push(['insert', values]); return { async run() { return { meta: { changes: 1 } }; } }; } };
            }
            throw new Error(`未预期的 SQL: ${sql}`);
        }
    };
    const response = await worker.fetch(new Request('https://example.com/api/guestbook', {
        method: 'POST',
        headers: { Origin: 'https://example.com', 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
        body: JSON.stringify({ request_id: 'request_1234567890', visitor_id: 'visitor_1234567890', author_name: '', message: '你好，世界！' })
    }), { ...env, DB: database });
    const data = await response.json();
    assert.equal(response.status, 201);
    assert.equal(data.comment.author_name, '匿名访客');
    assert.equal(data.comment.role, 'guest');
    assert.equal(data.comment.message, '你好，世界！');
    assert.equal('visitor_id' in data.comment, false);
    assert.equal(data.comment.id, 'request_1234567890');
    assert.equal(calls.find(([kind]) => kind === 'insert')[1][2], 'visitor_1234567890');
});

test('网络重试使用同一请求标识时不会重复创建留言', async () => {
    let writes = 0;
    const database = {
        prepare(sql) {
            if (/FROM guestbook_comments WHERE id = \?/.test(sql)) {
                return {
                    bind(visitorId, requestId) {
                        assert.equal(visitorId, 'visitor_1234567890');
                        assert.equal(requestId, 'request_retry_123456');
                        return { async first() { return {
                            id: requestId, parent_id: null, author_name: '小林', role: 'guest',
                            message: '已经保存', created_at: '2026-09-01T12:00:00.000Z', is_mine: 1
                        }; } };
                    }
                };
            }
            writes += 1;
            throw new Error(`重试不应再次写入: ${sql}`);
        }
    };
    const response = await worker.fetch(new Request('https://example.com/api/guestbook', {
        method: 'POST',
        headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            request_id: 'request_retry_123456', visitor_id: 'visitor_1234567890',
            author_name: '小林', message: '已经保存'
        })
    }), { ...env, DB: database });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.comment.id, 'request_retry_123456');
    assert.equal(writes, 0);
});

test('留言列表标记当前访客自己的留言并保留回复关系', async () => {
    let visitorBinding = '';
    const database = {
        prepare(sql) {
            assert.match(sql, /CASE WHEN visitor_id = \?/);
            return {
                bind(visitor) {
                    visitorBinding = visitor;
                    return { async all() { return { results: [{
                        id: 'reply-1', parent_id: 'root-1', author_name: '小林', role: 'guest',
                        message: '我也这样想', created_at: '2026-09-01T12:00:00.000Z', is_mine: 1
                    }] }; } };
                }
            };
        }
    };
    const response = await worker.fetch(new Request('https://example.com/api/guestbook?visitor=visitor_1234567890'), { ...env, DB: database });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(visitorBinding, 'visitor_1234567890');
    assert.equal(data.comments[0].parent_id, 'root-1');
    assert.equal(data.comments[0].is_mine, 1);
});

test('所有者回复自动带所有者身份，且只有所有者可以删除留言', async () => {
    const inserted = [];
    const database = {
        prepare(sql) {
            if (/SELECT id FROM guestbook_comments/.test(sql)) {
                return { bind(id) { assert.equal(id, 'root-1'); return { async first() { return { id }; } }; } };
            }
            if (/INSERT(?: OR IGNORE)? INTO guestbook_comments/.test(sql)) {
                return { bind(...values) { inserted.push(values); return { async run() { return { meta: { changes: 1 } }; } }; } };
            }
            if (/DELETE FROM guestbook_comments/.test(sql)) {
                return { bind(id) { assert.equal(id, 'root-1'); return { async run() { return { meta: { changes: 1 } }; } }; } };
            }
            throw new Error(`未预期的 SQL: ${sql}`);
        }
    };
    const cookie = await ownerCookie();
    const reply = await worker.fetch(new Request('https://example.com/api/guestbook', {
        method: 'POST',
        headers: { Origin: 'https://example.com', 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ parent_id: 'root-1', message: '谢谢你的留言' })
    }), { ...env, DB: database });
    const replyData = await reply.json();
    assert.equal(reply.status, 201);
    assert.equal(replyData.comment.role, 'owner');
    assert.equal(replyData.comment.author_name, '站点所有者');
    assert.equal(inserted[0][1], 'root-1');

    const guestDelete = await worker.fetch(new Request('https://example.com/api/guestbook/root-1', {
        method: 'DELETE', headers: { Origin: 'https://example.com' }
    }), { ...env, DB: database });
    assert.equal(guestDelete.status, 401);

    const ownerDelete = await worker.fetch(new Request('https://example.com/api/guestbook/root-1', {
        method: 'DELETE', headers: { Origin: 'https://example.com', Cookie: cookie }
    }), { ...env, DB: database });
    assert.equal(ownerDelete.status, 200);
    assert.deepEqual(await ownerDelete.json(), { deleted: true });
});
