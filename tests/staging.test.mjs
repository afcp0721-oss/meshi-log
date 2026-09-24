import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../staging/worker.mjs', import.meta.url), 'utf8'))
 .replace("import app from '../worker.js';", "const app = {fetch() {return new Response('API', {headers: {'Access-Control-Allow-Origin':'*'}})}};")
 .replace("import html from '../index.html';", 'const html = ' + JSON.stringify(await readFile(new URL('../index.html', import.meta.url), 'utf8')) + ';')
 .replace("import emailScript from '../email-auth.js';", 'const emailScript = '+JSON.stringify(await readFile(new URL('../email-auth.js', import.meta.url), 'utf8'))+';')
 .replace("import script from '../app.js';", 'const script = ' + JSON.stringify(await readFile(new URL('../app.js', import.meta.url), 'utf8')) + ';');
const {default: worker} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const env = {STAGING_PASSWORD:'test-only-password', GEMINI_API_KEY:'test', DISCORD_WEBHOOK_URL:'test'};
const req = (path, password='test-only-password') => new Request('https://staging.example' + path, {headers:{Authorization:'Basic ' + btoa('tester:' + password)}});
test('staging remains closed without each required secret', async () => {
 for (const name of Object.keys(env)) assert.equal((await worker.fetch(req('/api/logs'), {...env,[name]:''}, {})).status, 503);
});
test('every staging route requires correct credentials', async () => {
 for (const path of ['/', '/app.js', '/email-auth.js', '/api/auth-config', '/api/logs', '/api/image']) {
  const res = await worker.fetch(req(path, 'wrong'), env, {});
  assert.equal(res.status,401);
  assert.match(res.headers.get('WWW-Authenticate'), /Basic/);
 }
});
test('staging UI uses same origin and separate local storage', async () => {
 const res = await worker.fetch(req('/app.js'), env, {});
 const text = await res.text();
 assert.match(text, /const RELAY_SERVER_URL = location.origin/);
 assert.ok(!text.includes('icy-silence-6539'));
 assert.match(text, /meshi_staging_user_id/);
 assert.equal(res.headers.get('Cache-Control'),'no-store');
 const page = await worker.fetch(req('/'),env,{});
 assert.match(await page.text(), /テスト環境・本番とは別の記録/);
});
test('authenticated API forwards but does not allow cross-origin reads', async () => {
 const res = await worker.fetch(req('/api/logs'),env,{});
 assert.equal(await res.text(),'API');
 assert.equal(res.headers.get('Access-Control-Allow-Origin'),null);
 assert.equal(res.headers.get('Cache-Control'),'no-store');
});
