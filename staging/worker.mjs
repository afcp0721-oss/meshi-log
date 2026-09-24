import app from '../worker.js';
import html from '../index.html';
import script from '../app.js';

// Separate entry point: production never imports this staging-only gate.
export default {
  async fetch(request, env, ctx) {
    if (!env.STAGING_PASSWORD || !env.GEMINI_API_KEY || !env.DISCORD_WEBHOOK_URL) {
      return new Response('テスト環境は準備中です。', { status: 503 });
    }
    const expected = 'Basic ' + btoa('tester:' + env.STAGING_PASSWORD);
    const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    const [actual, wanted] = await Promise.all([
      digest(request.headers.get('Authorization') || ''), digest(expected)
    ]);
    const a = new Uint8Array(actual), b = new Uint8Array(wanted);
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    if (difference) return new Response('テスト用のログインが必要です。', {
      status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Meshi Log test", charset="UTF-8"', 'Cache-Control': 'no-store' }
    });
    const url = new URL(request.url);
    let response;
    if (request.method === 'GET' && url.pathname === '/') {
      response = new Response(html.replace('<body>', '<body><div style="position:fixed;bottom:0;left:0;right:0;background:#713f12;padding:6px;text-align:center;z-index:9999">テスト環境・本番とは別の記録です</div>'), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } else if (request.method === 'GET' && url.pathname === '/app.js') {
      response = new Response(script.replace('"https://icy-silence-6539.afcp0721.workers.dev"', 'location.origin').replaceAll('meshi_', 'meshi_staging_').replaceAll('Authorization', 'X-Meshi-Invite'), { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } });
    } else {
      const forwardedHeaders = new Headers(request.headers);
      forwardedHeaders.set("Authorization", request.headers.get("X-Meshi-Invite") || "");
      forwardedHeaders.delete("X-Meshi-Invite");
      response = await app.fetch(new Request(request, {headers:forwardedHeaders}), env, ctx);
    }
    const secured = new Response(response.body, response);
    secured.headers.set('Cache-Control', 'no-store');
    secured.headers.delete('Access-Control-Allow-Origin');
    secured.headers.set('X-Robots-Tag', 'noindex, nofollow');
    secured.headers.set('Referrer-Policy', 'no-referrer');
    return secured;
  }
};
