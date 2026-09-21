// Run with Node and Playwright installed (Chromium required). No live services used.
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let assists = 0;
    let failNext = false;
    const records = [
      { record_id: 1, category_major: 'food', category_minor: 'meat', ai_comment: '<img src=x onerror=alert(1)>', created_at: '2026-09-21' },
      { record_id: 2, category_major: 'scene', category_minor: 'other', ai_comment: '風景' }
    ];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'app.test') {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1).split('?')[0];
        return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html', body: readFileSync(resolve(__dirname, '..', file)) });
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
    assert.equal(await page.getByRole('button', { name: '預ける', exact: true }).isDisabled(), true);
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
    assert.equal(new URL(await link.getAttribute('href')).searchParams.get('text'), '手直し & 日本語 #昼食');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
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
    assert.deepEqual(errors, []);
    console.log('PASS mobile history, food-only report, uncertainty, X editing/link, cache, retry, text escaping, layout');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
