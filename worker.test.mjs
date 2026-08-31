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

test('未绑定 D1 时 Steam 接口返回明确错误', async () => {
    const response = await worker.fetch(new Request('https://example.com/api/steam'), env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).message, 'D1 数据库尚未绑定');
});

test('首页 Steam 接口读取站长最后一次缓存', async () => {
    const database = {
        prepare(sql) {
            assert.match(sql, /FROM steam_profile_cache/);
            return {
                bind(steamId) {
                    assert.equal(steamId, '76561199258285994');
                    return {
                        async first() {
                            return {
                                steam_id: steamId,
                                profile_name: '测试玩家',
                                avatar_url: 'https://example.com/avatar.jpg',
                                profile_url: `https://steamcommunity.com/profiles/${steamId}/`,
                                persona_state: 1,
                                status_label: '在线',
                                game_count: 2,
                                played_game_count: 1,
                                total_playtime_minutes: 600,
                                games_json: JSON.stringify([
                                    { appId: 1, name: 'Test Game', playtimeMinutes: 600, iconUrl: '' }
                                ]),
                                queried_at: '2026-08-31T00:00:00.000Z'
                            };
                        }
                    };
                }
            };
        }
    };
    const response = await worker.fetch(
        new Request('https://example.com/api/steam'),
        { ...env, DB: database }
    );
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.source, 'cache');
    assert.equal(data.isOwner, true);
    assert.equal(data.profile.name, '测试玩家');
    assert.equal(data.profile.totalPlaytimeMinutes, 600);
});

test('首页首次加载会从 Steam 获取并缓存站长数据', async () => {
    let storedValues;
    const database = {
        prepare(sql) {
            if (/FROM steam_profile_cache/.test(sql)) {
                return { bind() { return { async first() { return null; } }; } };
            }
            if (/INSERT INTO steam_profile_cache/.test(sql)) {
                return {
                    bind(...values) {
                        storedValues = values;
                        return { async run() { return { meta: { changes: 1 } }; } };
                    }
                };
            }
            throw new Error(`未预期的 SQL: ${sql}`);
        }
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
        const url = new URL(input);
        if (url.pathname.includes('GetPlayerSummaries')) {
            return Response.json({
                response: {
                    players: [{
                        steamid: '76561199258285994',
                        personaname: '测试玩家',
                        avatarfull: 'https://example.com/avatar.jpg',
                        profileurl: 'https://steamcommunity.com/profiles/76561199258285994/',
                        personastate: 1
                    }]
                }
            });
        }
        if (url.pathname.includes('GetOwnedGames')) {
            return Response.json({
                response: {
                    game_count: 2,
                    games: [
                        { appid: 20, name: '短时游戏', playtime_forever: 60, img_icon_url: 'b' },
                        { appid: 10, name: '长时游戏', playtime_forever: 600, img_icon_url: 'a' }
                    ]
                }
            });
        }
        throw new Error(`未预期的请求: ${url}`);
    };

    try {
        const response = await worker.fetch(
            new Request('https://example.com/api/steam'),
            { ...env, DB: database, STEAM_API_KEY: 'test-key' }
        );
        const data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.source, 'live');
        assert.equal(data.profile.totalPlaytimeMinutes, 660);
        assert.equal(data.profile.games[0].name, '长时游戏');
        assert.equal(storedValues[0], '76561199258285994');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('没有 Steam API Key 时使用公开资料降级模式', async () => {
    let storedValues;
    const database = {
        prepare(sql) {
            if (/FROM steam_profile_cache/.test(sql)) {
                return { bind() { return { async first() { return null; } }; } };
            }
            if (/INSERT INTO steam_profile_cache/.test(sql)) {
                return {
                    bind(...values) {
                        storedValues = values;
                        return { async run() { return { meta: { changes: 1 } }; } };
                    }
                };
            }
            throw new Error(`未预期的 SQL: ${sql}`);
        }
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
        const url = new URL(input);
        assert.equal(url.hostname, 'steamcommunity.com');
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
            <profile>
                <steamID64>76561199258285994</steamID64>
                <steamID><![CDATA[公开玩家]]></steamID>
                <onlineState>online</onlineState>
                <stateMessage><![CDATA[Online]]></stateMessage>
                <avatarFull><![CDATA[https://example.com/avatar.jpg]]></avatarFull>
                <mostPlayedGames><mostPlayedGame>
                    <gameName><![CDATA[Example Game]]></gameName>
                    <gameLink><![CDATA[https://steamcommunity.com/app/10]]></gameLink>
                    <gameIcon><![CDATA[https://example.com/game.jpg]]></gameIcon>
                    <hoursOnRecord>12.5</hoursOnRecord>
                    <statsName><![CDATA[10]]></statsName>
                </mostPlayedGame></mostPlayedGames>
            </profile>`, { headers: { 'Content-Type': 'application/xml' } });
    };

    try {
        const response = await worker.fetch(
            new Request('https://example.com/api/steam'),
            { ...env, DB: database }
        );
        const data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.profile.isPartial, true);
        assert.equal(data.profile.name, '公开玩家');
        assert.equal(data.profile.games[0].playtimeMinutes, 750);
        assert.match(data.warning, /仅展示公开资料/);
        assert.equal(storedValues.at(-1), 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('配置 Steam API Key 后会把部分缓存升级为完整游戏库', async () => {
    let stored = false;
    const partialRow = {
        steam_id: '76561199258285994',
        profile_name: '部分缓存玩家',
        avatar_url: 'https://example.com/avatar.jpg',
        profile_url: 'https://steamcommunity.com/profiles/76561199258285994/',
        persona_state: 1,
        status_label: '在线',
        game_count: 1,
        played_game_count: 1,
        total_playtime_minutes: 60,
        games_json: '[]',
        queried_at: new Date().toISOString(),
        is_partial: 1
    };
    const database = {
        prepare(sql) {
            if (/FROM steam_profile_cache/.test(sql)) {
                return { bind() { return { async first() { return partialRow; } }; } };
            }
            if (/INSERT INTO steam_profile_cache/.test(sql)) {
                return { bind() { return { async run() { stored = true; return { meta: { changes: 1 } }; } }; } };
            }
            throw new Error(`未预期的 SQL: ${sql}`);
        }
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
        const url = new URL(input);
        if (url.pathname.includes('GetPlayerSummaries')) {
            return Response.json({ response: { players: [{
                steamid: '76561199258285994', personaname: '完整玩家',
                avatarfull: 'https://example.com/avatar.jpg',
                profileurl: 'https://steamcommunity.com/profiles/76561199258285994/', personastate: 1
            }] } });
        }
        if (url.pathname.includes('GetOwnedGames')) {
            return Response.json({ response: { game_count: 2, games: [
                { appid: 10, name: '完整游戏一', playtime_forever: 600, img_icon_url: 'a' },
                { appid: 20, name: '完整游戏二', playtime_forever: 300, img_icon_url: 'b' }
            ] } });
        }
        throw new Error(`未预期的请求: ${url}`);
    };

    try {
        const response = await worker.fetch(
            new Request('https://example.com/api/steam'),
            { ...env, DB: database, STEAM_API_KEY: 'test-key' }
        );
        const data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.source, 'live');
        assert.equal(data.profile.isPartial, false);
        assert.equal(data.profile.gameCount, 2);
        assert.equal(stored, true);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('Steam 查询拒绝无效主页输入', async () => {
    const response = await worker.fetch(new Request('https://example.com/api/steam/query', {
        method: 'POST',
        headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: 'https://attacker.example/player' })
    }), {
        ...env,
        DB: { prepare() { throw new Error('无效输入不应访问数据库'); } }
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, '请输入 steamcommunity.com 的个人主页链接');
});

test('Steam 查询拒绝跨站请求', async () => {
    const response = await worker.fetch(new Request('https://example.com/api/steam/query', {
        method: 'POST',
        headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: '76561199258285994' })
    }), {
        ...env,
        DB: { prepare() { throw new Error('跨站请求不应访问数据库'); } }
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, '请求来源无效');
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
