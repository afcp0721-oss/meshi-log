// Run with Node and Playwright installed (Chromium required). No live services used.
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => { if (!localStorage.getItem('email-mock-seeded')) { localStorage.setItem('email-mock-seeded','yes'); localStorage.setItem('email-mock-user','yes'); } });
    let mailCalls = 0;
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let perPhoto = false;
    let assists = 0;
    let failNext = false;
    let previewCalls = 0;
    let saveCalls = 0;
    let quickCalls = 0;
    let failPreview = false;
    let failSave = false;
    let reviewedPayload;
    let quickPayload;
    let releaseSave;
    let saveGate;
    const records = [
      { record_id: 1, category_major: 'food', category_minor: 'meat', ai_comment: '<img src=x onerror=alert(1)>', created_at: '2026-09-21' },
      { record_id: 2, category_major: 'scene', category_minor: 'other', ai_comment: '風景' }
    ];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'www.gstatic.com') {
        const body = url.pathname.endsWith('firebase-app.js') ? 'export function initializeApp(config) {return config}' : `
          const user = {emailVerified:true,getIdToken:async()=> 'test-firebase-token'};
          const auth = {authStateReady:async()=>{},get currentUser(){return localStorage.getItem('email-mock-user')?user:null}};
          export const browserLocalPersistence = {};
          export function getAuth(){return auth}
          export async function setPersistence(){}
          export async function signInWithEmailAndPassword(auth,email,password){if(password==='wrong') throw {code:'auth/invalid-credential'};user.emailVerified=true;localStorage.setItem('email-mock-user','yes')}
          export async function createUserWithEmailAndPassword(){user.emailVerified=false;localStorage.setItem('email-mock-user','yes');return {user}}
          export async function sendEmailVerification(){await fetch('https://mock.test/mail',{method:'POST'})}
          export async function sendPasswordResetEmail(){await fetch('https://mock.test/mail',{method:'POST'})}
          export async function reload(){user.emailVerified=true}
          export async function signOut(){localStorage.removeItem('email-mock-user')}
        `;
        return route.fulfill({contentType:'text/javascript',body});
      }
      if (url.hostname==='mock.test') { mailCalls++; return route.fulfill({json:{ok:true}}); }
      if (url.pathname === '/api/auth-config') return route.fulfill({json:{apiKey:'public',appId:'test',projectId:'test',authDomain:'test.firebaseapp.com'}});
      if (url.hostname === 'app.test') {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1).split('?')[0];
        return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html', body: readFileSync(resolve(__dirname, '..', file)) });
      }
      if (url.pathname === '/api/quota') return route.fulfill({json:{limit:5,remaining:4}});
      if (url.pathname === '/api/session') {
        assert.equal(route.request().headers().authorization,'Bearer test-firebase-token');
        return route.fulfill({json:{userId:'email-alice'}});
      }
      if (url.pathname === '/api/preview') {
        previewCalls++;
        if (perPhoto) return route.fulfill({json:{status:'preview',analysis:{post_text:'3枚の記録',category_major:'food'},photo_reports:[0,1,2].map(i=>({photo_index:i,kind:i===1?'life':'meal',comment:'写真'+(i+1)+'のコメント',x_post_text:'写真'+(i+1)+'のX下書き',life_report:i===1?'日常の記録':null,meal_report:i===1?null:{meal_name:'食事',estimated_calories_min:500,estimated_calories_max:700,image_scope:'this_photo'}}))}});
        if (failPreview) { failPreview = false; return route.fulfill({ status: 502, json: { error: '生成を再試行してください' } }); }
        return route.fulfill({ json: { status: 'preview', analysis: { post_text: 'AIの確認用コメント', category_major: 'food' }, x_post_text: 'X用の下書き', meal_report: { meal_name: '昼ごはん', estimated_calories_min: 500, estimated_calories_max: 700 } } });
      }
      if (url.pathname === '/api/deposit-reviewed') {
        saveCalls++;
        reviewedPayload = route.request().postDataJSON();
        if (saveGate) await saveGate;
        if (failSave) { failSave = false; return route.fulfill({ status: 500, json: { error: '保存失敗テスト' } }); }
        return route.fulfill({ json: { status: 'saved' } });
      }
      if (url.pathname === '/') {
        quickCalls++;
        quickPayload = route.request().postDataJSON();
        return route.fulfill({ status: 202, json: { status: 'accepted' } });
      }
      if (url.pathname === '/api/logs') return route.fulfill({ json: { results: records } });
      if (url.pathname === '/api/assist') {
        assists++;
        if (failNext) { failNext = false; return route.fulfill({ status: 500, json: { error: '再試行してください' } }); }
        const action = route.request().postDataJSON().action;
        return route.fulfill({ json: action === 'x_post' ? { x_post_text: '今日の昼食。' } : { meal_report: { meal_name: '定食', estimated_calories_min: null, estimated_calories_max: null, ingredients: ['鶏肉'], nutrition_balance: '野菜もあります', comment: '彩りのある一皿。' } } });
      }
      throw new Error(`Unexpected network access: ${url}`);
    });
    await page.goto('https://app.test/');
    assert.equal(await page.getByRole('button', { name: 'そのまま預ける', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '🍽️ めしレポ' }).count(), 0);
    await page.getByRole('button', { name: '📖 過去ログ' }).click();
    await page.getByRole('button', { name: '🍽️ めしレポ' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '🍽️ めしレポ' }).count(), 1);
    assert.equal(await page.locator('#historyList img').count(), 0); // AI HTML remains text.
    await page.getByRole('button', { name: '𝕏 投稿下書き' }).first().click();
    const draft = page.getByRole('textbox', { name: 'X投稿の下書き（編集できます）' });
    await draft.fill('🍚' + 'あ'.repeat(129));
    assert.equal(await page.locator('.x-draft-count').textContent(), '130文字（目安130文字）');
    await draft.fill('手直し & 日本語 #昼食');
    let link = page.getByRole('link', { name: '𝕏 でポスト' });
    assert.equal(await link.getAttribute('href'), null);
    await page.getByRole('checkbox', { name: '投稿内容を確認しました' }).check();
    assert.equal(new URL(await link.getAttribute('href')).searchParams.get('text'), '手直し & 日本語 #昼食');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    await draft.fill('編集したら再確認');
    assert.equal(await link.getAttribute('href'), null);
    assert.equal(await page.getByRole('checkbox', { name: '投稿内容を確認しました' }).isChecked(), false);
    await draft.fill('手直し & 日本語 #昼食');
    await page.getByRole('button', { name: '🍽️ めしレポ' }).click();
    await page.getByText('推定カロリー：算出できませんでした').waitFor();
    assert(await page.getByText('保存された先頭の写真1枚が対象です。', { exact: false }).isVisible());
    await page.getByRole('button', { name: '𝕏 投稿下書き' }).first().click();
    assert.equal(await draft.inputValue(), '手直し & 日本語 #昼食');
    assert.equal(assists, 2); // Cached toggles do not generate again or lose edits.
    failNext = true;
    await page.getByRole('button', { name: '𝕏 投稿下書き' }).nth(1).click();
    await page.getByText('再試行してください').waitFor();
    await page.getByRole('button', { name: '𝕏 投稿下書き' }).nth(1).click();
    await page.getByRole('textbox').nth(1).waitFor();
    assert.equal(assists, 4);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: '✕ 閉じる' }).click();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    const file = { name: 'meal.png', mimeType: 'image/png', buffer: png };
    await page.locator('#fileInput').setInputFiles(file);
    await page.waitForFunction(() => !document.getElementById('btnProGenerate').disabled);
    failPreview = true;
    await page.getByRole('button', { name: '確認して預ける', exact: true }).click();
    await page.getByText('生成エラー：生成を再試行してください').waitFor();
    assert.equal(saveCalls, 0);
    assert.equal(quickCalls, 0);
    assert.equal(await page.locator('#photoGrid img').count(), 1);
    await page.getByRole('button', { name: '確認して預ける', exact: true }).click();
    const comment = page.getByRole('textbox', { name: '記録するコメント' });
    await comment.waitFor();
    assert.equal(await comment.inputValue(), 'AIの確認用コメント');
    assert.equal(saveCalls, 0);
    assert.equal(quickCalls, 0);
    assert.equal(await page.getByRole('button', { name: 'そのまま預ける', exact: true }).isDisabled(), true);
    await comment.fill('');
    assert.equal(await page.getByRole('button', { name: 'この内容で預ける' }).isDisabled(), true);
    await comment.fill('自分で編集したコメント');
    await page.getByText('𝕏 投稿文を確認する（任意）', { exact: true }).click();
    const previewX = page.locator('#resultArea').getByRole('link', { name: '𝕏 でポスト' });
    assert.equal(await previewX.getAttribute('href'), null);
    const previewDraft = page.locator('#resultArea').getByRole('textbox', { name: 'X投稿の下書き（編集できます）' });
    await previewDraft.fill('確認したX投稿文');
    await page.locator('#resultArea').getByRole('checkbox', { name: '投稿内容を確認しました' }).check();
    assert.equal(new URL(await previewX.getAttribute('href')).searchParams.get('text'), '確認したX投稿文');
    failSave = true;
    await page.getByRole('button', { name: 'この内容で預ける' }).click();
    await page.getByText('保存エラー：保存失敗テスト').waitFor();
    assert.equal(await comment.inputValue(), '自分で編集したコメント');
    assert.equal(await page.locator('#photoGrid img').count(), 1);
    saveGate = new Promise(resolve => { releaseSave = resolve; });
    await page.getByRole('button', { name: 'この内容で預ける' }).click();
    assert.equal(await page.getByRole('button', { name: '保存中…', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('#fileInput').isDisabled(), true);
    await page.getByRole('button', { name: '保存中…', exact: true }).evaluate(button => button.click());
    releaseSave();
    await page.getByText('確認したコメントで記録しました。', { exact: false }).waitFor();
    assert.equal(reviewedPayload.reviewedAnalysis.post_text, '自分で編集したコメント');
    assert.equal(reviewedPayload.confirmed, true);
    assert.equal(previewCalls, 2); // Saving (including retry) never regenerates.
    assert.equal(saveCalls, 2);
    assert.equal(await page.locator('#photoGrid img').count(), 0);
    assert.equal(await previewDraft.inputValue(), '確認したX投稿文');
    // Changing the memo invalidates the previous review before saving.
    await page.locator('#fileInput').setInputFiles(file);
    await page.waitForFunction(() => !document.getElementById('btnProGenerate').disabled);
    await page.getByRole('button', { name: '確認して預ける', exact: true }).click();
    await comment.waitFor();
    await page.locator('#shortMemoInput').fill('写真とメモを変更');
    assert.equal(await page.locator('#resultArea').isVisible(), false);
    assert.equal(await page.getByRole('button', { name: 'この内容で預ける' }).count(), 0);
    await page.getByRole('button', { name: '確認して預ける', exact: true }).click();
    await comment.waitFor();
    await page.getByRole('button', { name: '戻って写真・メモを変更' }).click();
    assert.equal(saveCalls, 2); // Cancel never saves.
    await page.getByRole('button', { name: 'そのまま預ける', exact: true }).click();
    await page.getByText('預かりました！ 相棒が裏側で解析・記録します。').waitFor();
    assert.equal(quickCalls, 1);
    assert.equal(quickPayload.reviewedAnalysis, undefined);
    assert.equal(await page.getByRole('link', { name: '𝕏 でポスト' }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    perPhoto = true;
    await page.locator('#fileInput').setInputFiles([file, {...file,name:'second.png'}, {...file,name:'third.png'}]);
    await page.waitForFunction(() => !document.getElementById('btnProGenerate').disabled);
    await page.getByRole('button',{name:'確認して預ける',exact:true}).click();
    await page.getByText('写真2・ライフレポ',{exact:true}).waitFor();
    assert.equal(await page.locator('#resultArea section').count(),3);
    const card = page.locator('#resultArea section').nth(1);
    await card.locator('summary').click();
    await card.getByRole('textbox').fill('2枚目を編集');
    assert.equal(await card.getByRole('link').getAttribute('href'),null);
    await card.getByRole('checkbox').check();
    assert.match(await card.getByRole('link').getAttribute('href'), /intent/);
    await page.getByRole('button',{name:'この内容で預ける'}).click();
    await page.getByText('確認したコメントで記録しました。',{exact:false}).waitFor();
    assert.equal(reviewedPayload.photo_reports.length,3);
    assert.equal(reviewedPayload.photo_reports[1].x_post_text,'2枚目を編集');
    assert.equal(reviewedPayload.photoReports,true);
    await page.getByRole('button', {name:'⚙️ 設定'}).click();
    await page.getByRole('button', {name:'ログアウト',exact:true}).click();
    await page.getByText('ログアウトしました。',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('email-mock-user')),null);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    await page.locator('#emailAddress').fill('tester@example.test');
    await page.locator('#emailPassword').fill('wrong');
    await page.getByRole('button',{name:'ログイン',exact:true}).click();
    await page.getByText('メールアドレス・パスワードを確認してください。登録済みの場合はログインか再設定をお試しください。',{exact:true}).waitFor();
    assert.equal(await page.locator('#emailPassword').inputValue(),'');
    await page.locator('#emailPassword').fill('test-password-long');
    await page.getByRole('button',{name:'初めての方：メールで登録',exact:true}).click();
    await page.getByText('確認メールを送りました。メール内のリンクを開いてから、この画面に戻ってください。',{exact:true}).waitFor();
    assert.equal(mailCalls,1);
    assert.equal(await page.evaluate(async()=>{try{await meshiAuth.token('https://api.test');return false}catch{return true}}),true);
    await page.getByRole('button',{name:'メール確認が済んだら押す',exact:true}).click();
    await page.getByText('メール確認が完了し、ログインしました。',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('meshi_user_id')),'email-alice');
    assert.equal(await page.locator('#resultArea').innerText(),'');
    await page.reload();
    await page.getByRole('button',{name:'📖 過去ログ'}).click();
    await page.getByRole('button',{name:'🍽️ めしレポ'}).waitFor();
    assert.equal(mailCalls,1);
    await page.evaluate(async()=>{await meshiAuth.reset('https://api.test','tester@example.test')});
    assert.equal(mailCalls,2);
    const cooldown=await page.evaluate(async()=>{try{await meshiAuth.resend('https://api.test')}catch(e){return e.message}});
    assert.match(cooldown,/1分/);
    assert.equal(mailCalls,2);
    assert.deepEqual(errors, []);
    console.log('PASS quick deposit, preview/edit/save/cancel/retry, stale review invalidation, X confirmation/reset, history, meal report, mobile layout');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
