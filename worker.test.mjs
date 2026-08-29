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

async function ownerCookie() {
    const response = await worker.fetch(new Request('https://example.com/api/auth', {
        method: 'POST',
        headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'login',
            username: 'zgj20051011',
            password: env.ADMIN_PASSWORD
        })
    }), env);
    return response.headers.get('Set-Cookie').split(';', 1)[0];
}

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

test('未绑定 D1 时内容接口返回明确错误', async () => {
    const response = await worker.fetch(new Request('https://example.com/api/content?section=blog'), env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).message, 'D1 数据库尚未绑定');
});

test('内容接口按栏目读取 D1 记录', async () => {
    let receivedSection;
    let receivedSql;
    const database = {
        prepare(sql) {
            receivedSql = sql;
            assert.match(sql, /FROM content_items/);
            return {
                bind(section) {
                    receivedSection = section;
                    return {
                        async all() {
                            return {
                                results: [{
                                    id: 'content-1',
                                    section: 'blog',
                                    title: '测试文章',
                                    summary: '',
                                    body: '正文',
                                    status: 'published',
                                    visibility: 'public',
                                    created_at: '2026-08-29T00:00:00.000Z',
                                    updated_at: '2026-08-29T00:00:00.000Z'
                                }]
                            };
                        }
                    };
                }
            };
        }
    };
    const response = await worker.fetch(
        new Request('https://example.com/api/content?section=blog'),
        { ...env, DB: database }
    );
    assert.equal(response.status, 200);
    assert.equal(receivedSection, 'blog');
    assert.match(receivedSql, /status = 'published'/);
    assert.match(receivedSql, /visibility = 'public'/);
    assert.equal((await response.json()).items[0].title, '测试文章');
});

test('所有者读取内容时可以看到草稿和私有记录', async () => {
    let receivedSql;
    const database = {
        prepare(sql) {
            receivedSql = sql;
            return {
                bind() {
                    return { async all() { return { results: [] }; } };
                }
            };
        }
    };
    const response = await worker.fetch(new Request('https://example.com/api/content?section=blog', {
        headers: { Cookie: await ownerCookie() }
    }), { ...env, DB: database });
    assert.equal(response.status, 200);
    assert.doesNotMatch(receivedSql, /status = 'published'/);
    assert.doesNotMatch(receivedSql, /visibility = 'public'/);
});

test('游客不能新增内容', async () => {
    const request = new Request('https://example.com/api/content', {
        method: 'POST',
        headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'blog', title: '不应写入' })
    });
    const response = await worker.fetch(request, {
        ...env,
        DB: { prepare() { throw new Error('游客请求不应访问数据库'); } }
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).message, '只有所有者可以修改数据');
});

test('所有者可以新增内容', async () => {
    let insertedValues;
    const database = {
        prepare(sql) {
            assert.match(sql, /INSERT INTO content_items/);
            return {
                bind(...values) {
                    insertedValues = values;
                    return { async run() { return { meta: { changes: 1 } }; } };
                }
            };
        }
    };
    const request = new Request('https://example.com/api/content', {
        method: 'POST',
        headers: {
            Origin: 'https://example.com',
            'Content-Type': 'application/json',
            Cookie: await ownerCookie()
        },
        body: JSON.stringify({
            section: 'engineering',
            title: '飞控项目',
            summary: '工程记录',
            body: '正文',
            status: 'draft',
            visibility: 'private'
        })
    });
    const response = await worker.fetch(request, { ...env, DB: database });
    const data = await response.json();
    assert.equal(response.status, 201);
    assert.equal(data.item.title, '飞控项目');
    assert.equal(insertedValues[1], 'engineering');
});

test('内容写入仍拒绝跨站请求', async () => {
    const request = new Request('https://example.com/api/content', {
        method: 'POST',
        headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'blog', title: '测试' })
    });
    const response = await worker.fetch(request, {
        ...env,
        DB: { prepare() { throw new Error('不应访问数据库'); } }
    });
    assert.equal(response.status, 403);
});

test('游客不能修改或删除内容和日程', async () => {
    const cases = [
        ['PATCH', '/api/content/content-1'],
        ['DELETE', '/api/content/content-1'],
        ['POST', '/api/events'],
        ['PATCH', '/api/events/event-1'],
        ['DELETE', '/api/events/event-1']
    ];

    for (const [method, path] of cases) {
        const response = await worker.fetch(new Request(`https://example.com${path}`, {
            method,
            headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
            body: method === 'DELETE' ? undefined : JSON.stringify({})
        }), {
            ...env,
            DB: { prepare() { throw new Error('游客请求不应访问数据库'); } }
        });
        assert.equal(response.status, 401, `${method} ${path}`);
    }
});

test('日程接口拒绝不存在的日期', async () => {
    const request = new Request('https://example.com/api/events', {
        method: 'POST',
        headers: {
            Origin: 'https://example.com',
            'Content-Type': 'application/json',
            Cookie: await ownerCookie()
        },
        body: JSON.stringify({ title: '无效日期', event_date: '2026-02-31' })
    });
    const response = await worker.fetch(request, {
        ...env,
        DB: { prepare() { throw new Error('不应访问数据库'); } }
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, '日程日期无效');
});
