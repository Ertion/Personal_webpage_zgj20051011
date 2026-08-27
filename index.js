import { onRequestGet as getAuth, onRequestPost as postAuth } from '../functions/api/auth.js';

function apiNotFound() {
    return new Response(JSON.stringify({ message: '接口不存在' }), {
        status: 404,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        }
    });
}

function methodNotAllowed() {
    return new Response(JSON.stringify({ message: '请求方法不受支持' }), {
        status: 405,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Allow': 'GET, POST'
        }
    });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (/^\/api\/auth\/?$/.test(url.pathname)) {
            if (request.method === 'GET') return getAuth({ request, env });
            if (request.method === 'POST') return postAuth({ request, env });
            return methodNotAllowed();
        }

        if (url.pathname.startsWith('/api/')) return apiNotFound();
        return env.ASSETS.fetch(request);
    }
};
