import {jwks, tokens, project, emailUsers} from './email-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeMealReport, normalizeXDraft, profileEntry } from '../analysis.mjs';
import { DatabaseSync } from 'node:sqlite';
const source = (await readFile(new URL('../worker.js', import.meta.url), 'utf8'))
  .replace('"./usage.mjs"', JSON.stringify(new URL('../usage.mjs', import.meta.url).href))
  .replace('"./email-auth.mjs"', JSON.stringify(new URL('../email-auth.mjs', import.meta.url).href))
  .replace('"./analysis.mjs"', JSON.stringify(new URL('../analysis.mjs', import.meta.url).href));
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const photo = 'data:image/jpeg;base64,aGk=';
const record = { record_id: 1, user_id: 'alice', post_text: '昼ごはん', category_major: 'food', category_minor: 'meat', discord_image_url: 'https://cdn.discordapp.com/attachments/a/b.jpg', created_at: '2026-09-21' };
const meal = { is_food: true, meal_name: '定食', estimated_calories_min: 500, estimated_calories_max: 750, ingredients: ['鶏肉'], nutrition_balance: '野菜も見えます', comment: '彩りのある一皿。' };
function setup(t, options = {}) {
  t.mock.method(console, "error", () => {});
  const quota = new DatabaseSync(':memory:');
  quota.exec('CREATE TABLE ai_daily_usage(day TEXT,user_id TEXT,requests INTEGER,units INTEGER,PRIMARY KEY(day,user_id))');
  t.after(()=>quota.close());
  const rows = options.rows || [{ ...record }];
  const calls = [];
  const statements = [];
  const jobs = [];
  const env = { GLOBAL_DAILY_AI_UNITS:150, EMAIL_USERS: emailUsers, FIREBASE_PROJECT_ID:project, ACCESS_LIMITER:{async limit(){return {success:true}}}, AI_LIMITER:{async limit(){return {success:true}}}, GEMINI_API_KEY: 'test-key', DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/test', DB: {
    prepare(sql) { return { bind(...args) {
      if(sql.includes("ai_daily_usage")) return {async first(){return quota.prepare(sql).get(...args)}};
      statements.push({ sql, args });
      return {
        async all() { return { results: rows.filter(r => r.user_id === args[0]) }; },
        async first() { if(sql.includes('discord_image_url = ?')) return rows.find(r=>r.user_id===args[0] && r.discord_image_url===args[1]) || null; return rows.find(r => r.user_id === args[0] && r.record_id === args[1]) || null; },
        async run() {
          if (options.dbFailure) throw new Error('test database unavailable');
          rows.push({ record_id: rows.length + 1, user_id: args[0], post_text: args[1], ai_comment: args[1], discord_image_url: args[2], photo_thumb: args[2], short_memo: args[3], category_major: args[4], category_minor: args[5] });
        }
      };
    } }; }
  } };
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (init.redirect === 'error') throw new TypeError('Invalid redirect value, must be follow or manual');
    if (String(url).includes('/service_accounts/v1/jwk/')) return Response.json(jwks,{headers:{'Cache-Control':'max-age=3600'}});
    calls.push({ url: String(url), init });
    if (String(url).includes('generativelanguage')) {
      if (options.aiFailure) return Response.json({ error: { message: 'unavailable' } }, { status: 503 });
      return Response.json({ candidates: [{ content: { parts: [{ text: options.raw ?? JSON.stringify(options.ai || meal) }] } }] });
    }
    if (String(url).startsWith('https://cdn.discordapp.com')) {
      return new Response('image bytes', { status: options.imageStatus || 200, headers: { 'Content-Type': options.imageType || 'image/jpeg' } });
    }
    if (String(url).startsWith(env.DISCORD_WEBHOOK_URL) || String(url).startsWith('https://discord.com/api/webhooks/123/personal')) {
      if (options.discordStatus) return Response.json({message:'secret must not be exposed'}, {status:options.discordStatus});
      return Response.json({ attachments: [{ url: record.discord_image_url }] });
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
  const ctx = { waitUntil(promise) { jobs.push(promise); } };
  async function request(path, body) {
    const id = body?.userId || new URL('https://worker.test'+path).searchParams.get('userId') || 'alice';
    const headers = {'Authorization':'Bearer '+tokens[id],'Content-Type':'application/json'};
    return worker.fetch(new Request(`https://worker.test${path}`, body === undefined ? {headers} : { method: 'POST', headers, body: JSON.stringify(body) }), env, ctx);
  }
  return { request, rows, calls, statements, jobs, env, ctx };
}
const assist = (action = 'meal_report', extra = {}) => ({ userId: 'alice', recordId: 1, action, ...extra });

test('deposit → background analysis → Discord → D1 → user history → image proxy', async t => {
  const s = setup(t, { rows: [], ai: { post_text: 'おいしそうな定食。', category_major: 'food', category_minor: 'meat' } });
  const accepted = await s.request('/', { userId: 'alice', images: [photo, photo, photo], shortMemo: '昼食' });
  assert.equal(accepted.status, 202);
  await Promise.all(s.jobs);
  assert.equal(s.rows.length, 1);
  const insert = s.statements.find(x => x.sql.startsWith('INSERT'));
  assert.equal(insert.args.length, 10); // Existing columns and binding order are preserved.
  assert.equal(insert.args[1], 'おいしそうな定食。');
  assert.equal(insert.args[2], record.discord_image_url);
  const gemini = s.calls.find(x => x.url.includes('generativelanguage'));
  assert.equal(JSON.parse(gemini.init.body).contents[0].parts.filter(p => p.inlineData).length, 3);
  assert.equal(s.calls.filter(x => x.init.body instanceof FormData).length, 3);
  assert(s.calls.some(x => typeof x.init.body === 'string' && x.init.body.includes('おいしそうな定食。') && x.url.includes('discord.com')));
  const history = await (await s.request('/api/logs?userId=alice')).json();
  assert.equal(history.results[0].profile_entry.source.record_id, 1);
  assert.equal(history.results[0].profile_entry.meal, null);
  assert.deepEqual((await (await s.request('/api/logs?userId=bob')).json()).results, []);
  const image = await s.request('/api/image?url=' + encodeURIComponent(history.results[0].photo_thumb));
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
});

test('reject invalid photo counts without a background job', async t => {
  const s = setup(t);
  for (const images of [[], [photo, photo, photo, photo], ['data:text/html;base64,aA==']]) {
    assert.equal((await s.request('/', { userId: 'alice', images })).status, 400);
  }
  assert.equal(s.jobs.length, 0);
});

test('food report and provisional profile use the same normalized estimate', async t => {
  const s = setup(t);
  const res = await s.request('/api/assist', assist());
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.meal_report.estimated_calories_min, 500);
  assert.equal(data.meal_report.image_scope, 'first_saved_photo');
  assert.equal(data.profile_entry.meal.is_estimate, true);
  assert.equal(data.profile_entry.source.record_id, 1);
  assert.equal(data.profile_entry.meal.estimated_calories_max, 750);
  assert(!s.statements.some(x => /INSERT|UPDATE|CREATE|ALTER|DELETE/.test(x.sql)));
});

test('X draft works without fetching the photo and is scoped to its record', async t => {
  const s = setup(t, { ai: { x_post_text: '今日の昼食。' } });
  const res = await s.request('/api/assist', assist('x_post'));
  assert.equal((await res.json()).x_post_text, '今日の昼食。');
  assert.equal(s.calls.length, 1);
  assert(s.statements[0].sql.includes('WHERE user_id = ? AND record_id = ?'));
});

test('other users cannot obtain assistance for a record', async t => {
  const s = setup(t);
  assert.equal((await s.request('/api/assist', assist('x_post', { userId: 'bob' }))).status, 404);
  assert.equal(s.calls.length, 0);
});

test('nonfood is rejected before downloading or analysing an image', async t => {
  const s = setup(t, { rows: [{ ...record, category_major: 'scene' }] });
  assert.equal((await s.request('/api/assist', assist())).status, 400);
  assert.equal(s.calls.length, 0);
});

test('invalid assist IDs and actions cause no work', async t => {
  const s = setup(t);
  for (const recordId of [null, true, [], {}, '', 0, -1, 1.5, 'NaN', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await s.request('/api/assist', assist('meal_report', { recordId }))).status, 400);
  }
  assert.equal((await s.request('/api/assist', assist('delete'))).status, 400);
  assert.equal((await s.request('/api/assist', null)).status, 400);
  assert.equal(s.calls.length, 0);
});

test('expired image gives actionable failure without calling AI', async t => {
  const s = setup(t, { imageStatus: 404 });
  assert.equal((await s.request('/api/assist', assist())).status, 422);
  assert.equal(s.calls.length, 1);
});

test('foreign image hosts and nonimage responses are not used', async t => {
  const s = setup(t, { rows: [{ ...record, discord_image_url: 'https://example.com/private' }] });
  assert.equal((await s.request('/api/assist', assist())).status, 422);
  assert.equal((await s.request('/api/image?url=https://cdn.discordapp.com.evil.test/a')).status, 400);
  assert.equal(s.calls.length, 0);
});

test('image retrieval prohibits redirects out of the allowlist', async t => {
  const s = setup(t);
  await s.request('/api/assist', assist());
  await s.request('/api/image?url=' + encodeURIComponent(record.discord_image_url));
  for (const call of s.calls.filter(x => x.url.includes('cdn.discordapp'))) assert.equal(call.init.redirect, 'manual');
});

for (const raw of ['null', '[]', '{}', 'plain text', '{bad']) {
  test(`malformed AI output does not masquerade as a report: ${raw}`, async t => {
    const s = setup(t, { raw });
    assert.equal((await s.request('/api/assist', assist())).status, 500);
  });
}

test('AI can reject an incorrectly classified food photograph', async t => {
  const s = setup(t, { ai: { is_food: false } });
  assert.equal((await s.request('/api/assist', assist())).status, 422);
});

test('AI failure surfaces without fabricated success', async t => {
  const s = setup(t, { aiFailure: true });
  assert.equal((await s.request('/api/assist', assist())).status, 500);
});

test('normalizer preserves uncertainty and bounds text instead of inventing calories', () => {
  for (const [min, max] of [[null, 600], [0, 0], [-20, 300], [600, 500], ['500', 600], [500, Infinity], [500, 20000]]) {
    const report = normalizeMealReport({ estimated_calories_min: min, estimated_calories_max: max });
    assert.equal(report.estimated_calories_min, null);
    assert.equal(report.estimated_calories_max, null);
  }
  const report = normalizeMealReport({ ingredients: [null, {}, '鶏肉', '鶏肉'], meal_name: {}, disclaimer: '確定値' });
  assert.deepEqual(report.ingredients, ['鶏肉']);
  assert.equal(report.meal_name, '食事');
  assert(report.disclaimer.includes('概算'));
});

test('profile entry excludes unknown traits and nonfood nutrition', () => {
  const entry = profileEntry({ ...record, category_major: 'scene', companion_type: 'unknown', interest_tag: 'none', location_type: 'invented' }, meal);
  assert.equal(entry.schema_version, 'profile-entry.v0');
  assert.equal(entry.meal, null);
  assert(entry.observations.every(x => x.verified === false));
  assert(!entry.observations.some(x => ['companion_type', 'interest_tag', 'location_type'].includes(x.field)));
  assert(!JSON.stringify(entry).includes('discordapp'));
});


test('D1 insert failure rejects the background job instead of reporting saved success', async t => {
  const s = setup(t, { dbFailure: true });
  assert.equal((await s.request('/', { userId: 'alice', images: [photo] })).status, 202);
  await assert.rejects(s.jobs[0], /Save failed/);
  assert.equal(s.rows.length, 1);
});

test('HTML image responses are rejected by both report and proxy', async t => {
  const s = setup(t, { imageType: 'text/html' });
  assert.equal((await s.request('/api/assist', assist())).status, 422);
  assert.equal((await s.request('/api/image?url=' + encodeURIComponent(record.discord_image_url))).status, 502);
});


test('X draft stays within 130 visible characters without breaking emoji', () => {
  assert.equal(normalizeXDraft('  短い記録。  '), '短い記録。');
  assert.equal(normalizeXDraft('あ'.repeat(130)), 'あ'.repeat(130));
  assert.equal(normalizeXDraft('あ'.repeat(131)), 'あ'.repeat(129) + '…');
  const family = '👨‍👩‍👧‍👦';
  assert.equal(normalizeXDraft(family.repeat(131)), family.repeat(129) + '…');
});

test('X API enforces the length even when AI ignores the prompt', async t => {
  const s = setup(t, { ai: { x_post_text: 'あ'.repeat(200) } });
  const res = await s.request('/api/assist', assist('x_post'));
  assert.equal((await res.json()).x_post_text, 'あ'.repeat(129) + '…');
  assert(s.calls[0].init.body.includes('120〜130文字程度'));
});

const previewAnalysis = {
  post_text: '野菜と鶏肉の定食ですね。', category_major: 'food', category_minor: 'meat',
  x_post_text: '今日の昼食は鶏肉と野菜の定食。', meal_report: meal
};

test('preview returns comments, X draft and food report without saving or uploading', async t => {
  const s = setup(t, { rows: [], ai: previewAnalysis });
  const res = await s.request('/api/preview', { userId: 'alice', images: [photo, photo], shortMemo: '昼食' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'preview');
  assert.equal(data.analysis.post_text, previewAnalysis.post_text);
  assert.equal(data.x_post_text, previewAnalysis.x_post_text);
  assert.equal(data.meal_report.estimated_calories_min, 500);
  assert.equal(s.rows.length, 0);
  assert.equal(s.jobs.length, 0);
  assert.equal(s.calls.length, 1);
  assert(s.calls[0].url.includes('generativelanguage'));
  assert(s.statements.every(x => x.sql.startsWith('SELECT')));
});

test('reviewed save preserves edited comment exactly without another AI call', async t => {
  const s = setup(t, { rows: [], ai: previewAnalysis });
  const payload = { userId: 'alice', images: [photo, photo], shortMemo: '昼食' };
  const preview = await (await s.request('/api/preview', payload)).json();
  const edited = ' 自分で直したコメントです。\n量もちょうどよかった。 ';
  const res = await s.request('/api/deposit-reviewed', { ...payload, confirmed: true,
    reviewedAnalysis: { ...preview.analysis, post_text: edited } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'saved');
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].post_text, edited);
  assert.equal(s.rows[0].short_memo, '昼食');
  assert.equal(s.calls.filter(x => x.url.includes('generativelanguage')).length, 1);
  assert.equal(s.calls.filter(x => x.init.body instanceof FormData).length, 2);
  assert.equal(s.jobs.length, 0); // The saved response waits for the D1 write.
});

test('reviewed save requires explicit confirmation and valid nonempty text before side effects', async t => {
  const s = setup(t, { rows: [] });
  const payload = { userId: 'alice', images: [photo], reviewedAnalysis: previewAnalysis };
  assert.equal((await s.request('/api/deposit-reviewed', payload)).status, 400);
  for (const post_text of ['', '   ', null, {}, 'a'.repeat(2001)]) {
    assert.equal((await s.request('/api/deposit-reviewed', { ...payload, confirmed: true,
      reviewedAnalysis: { post_text } })).status, 400);
  }
  assert.equal(s.rows.length, 0);
  assert.equal(s.calls.length, 0);
});

test('new routes enforce the same 1–3 photo contract as quick deposit', async t => {
  const s = setup(t);
  for (const path of ['/api/preview', '/api/deposit-reviewed']) {
    for (const images of [[], [photo, photo, photo, photo], ['data:text/html;base64,aA==']]) {
      assert.equal((await s.request(path, { userId: 'alice', images, confirmed: true, reviewedAnalysis: previewAnalysis })).status, 400);
    }
  }
  assert.equal(s.calls.length, 0);
});

test('client-returned classification is bounded and cannot override user or stored fields', async t => {
  const s = setup(t, { rows: [] });
  const res = await s.request('/api/deposit-reviewed', { userId: 'alice', images: [photo], confirmed: true,
    reviewedAnalysis: { post_text: '確認済み', category_major: 'invented', userId: 'bob', discord_image_url: 'https://evil.test/' } });
  assert.equal(res.status, 200);
  const insert = s.statements.find(x => x.sql.startsWith('INSERT'));
  assert.equal(insert.args[0], 'alice');
  assert.equal(insert.args[2], record.discord_image_url);
  assert.equal(insert.args[4], 'life');
  assert.equal(s.calls.filter(x => x.url.includes('generativelanguage')).length, 0);
});

test('preview generation failure never deposits the photographs', async t => {
  const s = setup(t, { rows: [], aiFailure: true });
  assert.equal((await s.request('/api/preview', { userId: 'alice', images: [photo] })).status, 502);
  assert.equal(s.rows.length, 0);
  assert.equal(s.calls.length, 1);
  assert.equal(s.jobs.length, 0);
});

test('reviewed D1 failure is returned to the confirmation screen', async t => {
  const s = setup(t, { rows: [], dbFailure: true });
  assert.equal((await s.request('/api/deposit-reviewed', { userId: 'alice', images: [photo], confirmed: true, reviewedAnalysis: previewAnalysis })).status, 500);
  assert.equal(s.rows.length, 0);
  assert.equal(s.calls.filter(x => x.url.includes('generativelanguage')).length, 0);
});

test('nonfood preview cannot expose a model-supplied meal report', async t => {
  const s = setup(t, { ai: { ...previewAnalysis, category_major: 'scene' } });
  const data = await (await s.request('/api/preview', { userId: 'alice', images: [photo] })).json();
  assert.equal(data.meal_report, null);
});

test('quick deposit ignores client preview fields and continues server analysis', async t => {
  const s = setup(t, { rows: [], ai: { post_text: 'サーバー生成' } });
  assert.equal((await s.request('/', { userId: 'alice', images: [photo], reviewedAnalysis: { post_text: '差し替え' } })).status, 202);
  await Promise.all(s.jobs);
  assert.equal(s.rows[0].post_text, 'サーバー生成');
});

for (const ai of [{}, { post_text: [] }, { post_text: ' ' }]) {
  test(`invalid preview cannot be saved as a successful generation: ${JSON.stringify(ai)}`, async t => {
    const s = setup(t, { rows: [], ai });
    assert.equal((await s.request('/api/preview', { userId: 'alice', images: [photo] })).status, 502);
    assert.equal(s.rows.length, 0);
  });
}

test('three photo reports stay ordered and are archived with each image without new DB columns', async t => {
 const s = setup(t, {rows:[], ai:previewAnalysis});
 const payload = {userId:'alice',images:[photo,photo,photo],photoReports:true};
 const preview = await (await s.request('/api/preview',payload)).json();
 assert.equal(preview.photo_reports.length,3);
 assert.equal(s.calls.length,3);
 assert.equal(s.rows.length,0);
 preview.photo_reports[1].x_post_text='編集した2枚目の下書き';
 const res=await s.request('/api/deposit-reviewed',{...payload,confirmed:true,reviewedAnalysis:preview.analysis,photo_reports:preview.photo_reports});
 assert.equal(res.status,200);
 const uploads=s.calls.filter(x=>x.init.body instanceof FormData);
 assert.equal(uploads.length,3);
 uploads.forEach((x,i)=>{
  const msg=JSON.parse(x.init.body.get('payload_json'));
  assert.match(msg.embeds[0].title,new RegExp('写真'+(i+1)));
  assert.equal(msg.allowed_mentions.parse.length,0);
 });
 assert.equal(JSON.parse(uploads[1].init.body.get('payload_json')).embeds[0].fields[0].value,'編集した2枚目の下書き');
 assert.equal(s.calls.filter(x=>x.url.includes('generativelanguage')).length,3);
 assert.equal(s.rows.length,1);
 assert.equal(s.statements.filter(x=>x.sql.startsWith('INSERT')).length,1);
});
test('nonfood photos receive life reports without calorie estimates',async t=>{
 const s=setup(t,{rows:[],ai:{...previewAnalysis,category_major:'scene'}});
 const data=await(await s.request('/api/preview',{userId:'alice',images:[photo],photoReports:true})).json();
 assert.equal(data.photo_reports[0].kind,'life');
 assert.equal(data.photo_reports[0].meal_report,null);
});
test('missing or reordered photo reports cannot be saved',async t=>{
 const s=setup(t,{rows:[]});
 const res=await s.request('/api/deposit-reviewed',{userId:'alice',images:[photo],photoReports:true,confirmed:true,reviewedAnalysis:previewAnalysis,photo_reports:[]});
 assert.notEqual(res.status,200);
 assert.equal(s.calls.length,0);
 assert.equal(s.rows.length,0);
});

for (const url of ['https://evil.example/api/webhooks/123/token', 'https://discord.com.evil.example/api/webhooks/123/token', 'http://discord.com/api/webhooks/123/token', 'https://discord.com/api/webhooks/123/token?url=evil', 'https://discord.com/api/webhooks/123/token/../other']) {
  test('reject unsafe personal Discord destination: ' + url, async t => {
    const s = setup(t);
    const res = await s.request('/', {userId:'alice', images:[photo], discordWebhookUrl:url});
    assert.equal(res.status,400);
    assert.equal(s.calls.length,0);
    assert.equal(s.jobs.length,0);
  });
}
test('personal destination overrides shared webhook for photos and summary', async t => {
  const s=setup(t,{rows:[],ai:{post_text:'記録',category_major:'life'}});
  const url='https://discord.com/api/webhooks/123/personal';
  const res=await s.request('/',{userId:'alice',images:[photo,photo],discordWebhookUrl:url});
  assert.equal(res.status,202);
  await Promise.all(s.jobs);
  const calls=s.calls.filter(c=>c.url.includes('discord.com/api/webhooks'));
  assert.equal(calls.length,3);
  assert(calls.every(c=>c.url===url || c.url===url+'?wait=true'));
  assert(calls.every(c=>c.init.redirect==='manual'));
  assert.equal(s.rows.length,1);
});

for (const code of [301,302,307,308,400,401,403,404,413,429,500]) {
  test('reviewed Discord failure is actionable without leaking secrets: '+code,async t=>{
    const s=setup(t,{discordStatus:code,rows:[]});
    const res=await s.request('/api/deposit-reviewed',{userId:'alice',images:[photo],confirmed:true,reviewedAnalysis:{post_text:'test'}});
    assert.equal(res.status,500);
    const body=await res.json();
    assert(body.error.includes('Discord '+code));
    assert(!body.error.includes('secret'));
    assert.equal(s.rows.length,0);
  });
}


test('email gate blocks unauthenticated and mismatched identities before side effects', async t => {
 const s=setup(t); const raw=(path,token,body)=>worker.fetch(new Request('https://worker.test'+path,{method:body?'POST':'GET',headers:token?{Authorization:'Bearer '+token}:{},...(body?{body:JSON.stringify(body)}:{})}),s.env,s.ctx);
 assert.equal((await raw('/api/logs?userId=alice')).status,401);
 assert.equal((await raw('/api/logs?userId=bob',tokens.alice)).status,403);
 assert.equal((await raw('/api/preview',tokens.alice,{userId:'bob',images:[photo]})).status,403);
 assert.equal((await raw('/api/image?url='+encodeURIComponent(record.discord_image_url),tokens.bob)).status,404);
 assert.equal((await raw('/api/session','z'.repeat(40))).status,401);
 assert.equal(s.calls.length,0);
});
test('missing security bindings and rate-limit outages fail closed', async t=>{
 const s=setup(t); const req=()=>new Request('https://worker.test/api/session',{headers:{Authorization:'Bearer '+tokens.alice}});
 for(const key of ['EMAIL_USERS','FIREBASE_PROJECT_ID','ACCESS_LIMITER','AI_LIMITER']) assert.equal((await worker.fetch(req(),{...s.env,[key]:undefined},s.ctx)).status,503);
 s.env.ACCESS_LIMITER.limit=async()=>{throw Error('sensitive detail')};
 const response=await worker.fetch(req(),s.env,s.ctx);assert.equal(response.status,503);assert.ok(!(await response.text()).includes('sensitive detail'));
});
test('AI rate limit rejects before Gemini and Discord',async t=>{
 const s=setup(t);s.env.AI_LIMITER.limit=async()=>({success:false});
 assert.equal((await s.request('/api/preview',{userId:'alice',images:[photo]})).status,429);assert.equal(s.calls.length,0);
});
test('Gemini key travels only in a header',async t=>{
 const s=setup(t);await s.request('/api/preview',{userId:'alice',images:[photo]});
 const call=s.calls.find(x=>x.url.includes('generativelanguage'));assert.ok(call);assert.ok(!call.url.includes('key='));assert.equal(call.init.headers['x-goog-api-key'],'test-key');
});
test('untrusted browser origin and oversized streaming body are rejected',async t=>{
 const s=setup(t);assert.equal((await worker.fetch(new Request('https://worker.test/api/session',{headers:{Origin:'https://evil.test'}}),s.env,s.ctx)).status,403);
 const r=await worker.fetch(new Request('https://worker.test/api/preview',{method:'POST',headers:{Authorization:'Bearer '+tokens.alice},body:'x'.repeat(12*1024*1024+1)}),s.env,s.ctx);assert.equal(r.status,413);assert.equal(s.calls.length,0);
});

test('expired approval is denied and session returns only canonical identity',async t=>{
 const s=setup(t);const token=tokens.alice;const req=()=>new Request('https://worker.test/api/session',{headers:{Authorization:'Bearer '+token}});
 assert.deepEqual(await (await worker.fetch(req(),s.env,s.ctx)).json(),{userId:'alice'});
 const users=JSON.parse(s.env.EMAIL_USERS);users.alice.expiresAt='2000-01-01';s.env.EMAIL_USERS=JSON.stringify(users);
 assert.equal((await worker.fetch(req(),s.env,s.ctx)).status,403);
});
for (const destination of ['', '   ']) {
 test('empty Discord destination supports preview and reviewed DB-only save: '+JSON.stringify(destination),async t=>{
  const s=setup(t,{rows:[],ai:{post_text:'DBだけの記録',category_major:'life'}});
  const payload={userId:'alice',images:[photo],discordWebhookUrl:destination};
  const preview=await s.request('/api/preview',payload);
  assert.equal(preview.status,200);
  assert.equal(s.rows.length,0); // Generation alone never saves.
  const saved=await s.request('/api/deposit-reviewed',{...payload,confirmed:true,reviewedAnalysis:{post_text:'修正したコメント'}});
  assert.equal(saved.status,200);
  assert.equal(s.rows.length,1);
  assert.equal(s.rows[0].post_text,'修正したコメント');
  assert.equal(s.rows[0].discord_image_url,'');
  assert.equal(s.calls.filter(c=>c.url.includes('discord.com')).length,0); // No shared-webhook fallback.
  const history=await(await s.request('/api/logs?userId=alice')).json();
  assert.equal(history.results.length,1);
 });
}
test('quick DB-only deposit saves without Discord; DB failure does not claim Discord delivery',async t=>{
 const s=setup(t,{rows:[],ai:{post_text:'記録',category_major:'life'}});
 assert.equal((await s.request('/',{userId:'alice',images:[photo],discordWebhookUrl:''})).status,202);
 await Promise.all(s.jobs);
 assert.equal(s.rows.length,1);
 assert.equal(s.calls.filter(c=>c.url.includes('discord.com')).length,0);
});
test('DB-only save reports failure without claiming a Discord upload',async t=>{
 const s=setup(t,{rows:[],dbFailure:true});
 const result=await s.request('/api/deposit-reviewed',{userId:'alice',images:[photo],discordWebhookUrl:'',confirmed:true,reviewedAnalysis:{post_text:'記録'}});
 assert.equal(result.status,500);
 const body=await result.json();
 assert.match(body.error,/DB/); assert.ok(!body.error.includes('Discord'));
 assert.equal(s.rows.length,0); assert.equal(s.calls.length,0);
});

test('preview and history AI share five calls; save/read remain available at cap',async t=>{
 const s=setup(t,{ai:{x_post_text:'今日の記録',post_text:'昼食',category_major:'food'}});
 for(let i=0;i<5;i++) assert.equal((await s.request('/api/assist',assist('x_post'))).status,200);
 const before=s.calls.length;
 assert.equal((await s.request('/api/preview',{userId:'alice',images:[photo],discordWebhook:''})).status,429);
 assert.equal(s.calls.length,before);
 assert.equal((await s.request('/api/logs?userId=alice')).status,200);
 assert.equal((await (await s.request('/api/quota')).json()).remaining,0);
});
