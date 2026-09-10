const RELAY_SERVER_URL = "https://icy-silence-6539.afcp0721.workers.dev";

let imagesData = [];
let selectedTag = "🔥 最高！";
let selectedStyle = localStorage.getItem('user_post_style') || 'natural';
let currentCategory = "";

window.addEventListener('DOMContentLoaded', () => {
  const target = document.querySelector(`.style-btn[data-style="${selectedStyle}"]`) || document.querySelector('.style-btn');
  if (target) selectStyle(target);
  renderHistory();
  updateLearnStatusUI();
  updateAiVoiceComment();
});

function selectTag(btn) {
  document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedTag = btn.innerText;
}

function selectStyle(btn) {
  document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedStyle = btn.getAttribute('data-style');
  localStorage.setItem('user_post_style', selectedStyle);
}

function updateAiVoiceComment() {
  const history = JSON.parse(localStorage.getItem('my_life_logs') || '[]');
  const voiceEl = document.getElementById('aiVoiceText');
  if (!history.length) {
    voiceEl.innerText = "写真をセットするとAIが好みを学習します！何でも気軽に投稿してみてね。";
    return;
  }

  const recentCategories = history.slice(0, 5).map(h => h.category);
  const foodCount = recentCategories.filter(c => c.includes("食レポ")).length;
  const tripCount = recentCategories.filter(c => c.includes("風景") || c.includes("旅")).length;

  if (foodCount >= 3) {
    voiceEl.innerText = `最近美味しいごはんの投稿が続いてますね（直近5回中${foodCount}回）！食へのこだわり、しっかり学習してますよ😋`;
  } else if (tripCount >= 2) {
    voiceEl.innerText = "最近お出かけやドライブが多いですね！移動お疲れ様です、安全運転で🚗✨";
  } else {
    voiceEl.innerText = `現在${history.length}件の記録を保持しています。使っていくほどあなた専用に育ちますよ！`;
  }
}

function updateLearnStatusUI() {
  const examples = JSON.parse(localStorage.getItem('my_ai_style_examples') || '[]');
  const statusEl = document.getElementById('learnStatus');
  const resetBtn = document.getElementById('resetLearnBtn');

  if (examples.length === 0) {
    statusEl.innerText = "🧠 文体学習: 0件（修正保存であなた専用に成長）";
    statusEl.style.color = "#64748b";
    resetBtn.style.display = "none";
  } else {
    statusEl.innerText = `🧠 文体学習中: ${examples.length}件の好みを反映中`;
    statusEl.style.color = "#0284c7";
    resetBtn.style.display = "inline";
  }
}

function resetLearnedStyle() {
  if (confirm("学習した文体データをリセットしますか？")) {
    localStorage.removeItem('my_ai_style_examples');
    updateLearnStatusUI();
    alert("文体学習をリセットしました。");
  }
}

function recordUserStyleExample(shortText, longText) {
  try {
    let examples = JSON.parse(localStorage.getItem('my_ai_style_examples') || '[]');
    if (!examples.some(ex => ex.short === shortText)) {
      examples.unshift({ short: shortText, long: longText, date: new Date().toISOString() });
      if (examples.length > 5) examples.pop();
      localStorage.setItem('my_ai_style_examples', JSON.stringify(examples));
      updateLearnStatusUI();
    }
  } catch (e) {
    console.warn("文体サンプルの保存に失敗しました", e);
  }
}

function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1200;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
          else { w = Math.round((w * maxDim) / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve({
          dataUrl: dataUrl,
          base64: dataUrl.split(',')[1],
          mimeType: 'image/jpeg'
        });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleMultipleImages(event) {
  const files = Array.from(event.target.files).slice(0, 6);
  if (!files.length) return;

  imagesData = [];
  const grid = document.getElementById('previewGrid');
  grid.innerHTML = '';

  for (const f of files) {
    const comp = await compressImage(f);
    imagesData.push(comp);

    const thumb = document.createElement('img');
    thumb.src = comp.dataUrl;
    thumb.className = 'preview-thumb';
    grid.appendChild(thumb);
  }

  document.getElementById('uploadText').innerText = `📷 ${imagesData.length}枚選択中（タップで変更）`;
  document.getElementById('generateBtn').disabled = false;
}

async function generatePosts() {
  if (!imagesData.length) return;

  const btn = document.getElementById('generateBtn');
  const spinnerWrap = document.getElementById('spinnerWrap');
  const resultSection = document.getElementById('resultSection');

  btn.disabled = true;
  spinnerWrap.style.display = 'block';
  resultSection.style.display = 'none';

  let styleRule = "";
  if (selectedStyle === 'dandy') {
    styleRule = "落ち着いた大人の男目線。「〜だ」「〜だな」といった静かな味わい深さやこだわりを重視。";
  } else if (selectedStyle === 'lady') {
    styleRule = "明るく軽やかな共感トーン。「〜♪」「〜でした！」といった親しみやすく華やかな表現。";
  } else {
    styleRule = "性別を問わないスマートで上質なトーン。感情を押しつけず、情景と良さを素直に伝える表現。";
  }

  const examples = JSON.parse(localStorage.getItem('my_ai_style_examples') || '[]');
  let personalizedPrompt = "";
  if (examples.length > 0) {
    personalizedPrompt = `
【最重要：ユーザー専用の文体学習（お手本）】
以下はユーザー本人が過去に手動修正して確定させた投稿の具体例です。
このユーザー特有の「語尾、句読点、言葉のリズム、絵文字の使い方」を徹底的に真似して作成してください。
${examples.map((ex, i) => `[お手本${i + 1}]\n短文: ${ex.short}\n長文: ${ex.long}`).join('\n\n')}
`;
  }

  const promptText = `
あなたはユーザー本人の代わりにSNS投稿を作成するゴーストライターAIです。
渡された写真（最大6枚）の全体を総合的に把握し、ユーザー本人が投稿する自然な文章を作成してください。
出力は指定のJSONフォーマットのみで行ってください。

【1. 主役判定と複数枚の統合】
- 看板、外観、料理、人物、風景などが混在している場合は全体を1つのストーリーとして統合してください。
- 人物が写っている場合は、料理があっても「楽しそうな食事会・団らんのひとコマ」を優先してください。
- 写真に写っていない味や架空のメニューを勝手に捏造しないでください。

【2. 執筆ルール】
- 気分タグ: "${selectedTag}"
- 基本文体指示: ${styleRule}
- 視点: 必ず投稿者本人のつぶやき目線。「〜ですね」「お疲れ様です」といったAIからの話しかけ口調は厳禁。
${personalizedPrompt}

【3. 出力フォーマット】
以下のキーを持つ純粋なJSONのみを返してください（Markdownブロック不要）。
{
  "category": "食レポ または 風景・旅 または 人物・団らん または 日常",
  "short_text": "X用ポスト。120〜130文字以内。ハッシュタグ付き。",
  "long_text": "詳細アーカイブ文。ブログや記録用の自然な長文。"
}
`;

  const parts = [{ text: promptText }];
  imagesData.forEach(img => {
    parts.push({
      inline_data: {
        mime_type: img.mimeType,
        data: img.base64
      }
    });
  });

  try {
    const response = await fetch(`${RELAY_SERVER_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error ? errorData.error.message : "中継サーバー通信エラー");
    }

    const data = await response.json();
    let rawText = data.candidates[0].content.parts[0].text;
    rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(rawText);

    currentCategory = result.category;
    document.getElementById('detectedMode').innerText = `🏷️ 自動判別: ${result.category}モード`;
    document.getElementById('shortText').value = result.short_text;
    document.getElementById('longText').value = result.long_text;

    saveToLocalHistory({
      date: new Date().toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      category: result.category,
      short_text: result.short_text,
      long_text: result.long_text,
      tag: selectedTag,
      style: selectedStyle,
      imageCount: imagesData.length
    });

    resultSection.style.display = 'block';
  } catch (err) {
    alert("エラー詳細: " + err.message);
    console.error(err);
  } finally {
    btn.disabled = false;
    spinnerWrap.style.display = 'none';
  }
}

function copyBoth() {
  const shortVal = document.getElementById('shortText').value;
  const longVal = document.getElementById('longText').value;

  recordUserStyleExample(shortVal, longVal);

  const combined = `【X用】\n${shortVal}\n\n【詳細ログ】\n${longVal}`;
  navigator.clipboard.writeText(combined);
  alert("コピーしました！（直した文体をAIが学習しました）");
}

function saveToLocalHistory(record) {
  try {
    const history = JSON.parse(localStorage.getItem('my_life_logs') || '[]');
    history.unshift(record);
    if (history.length > 50) history.pop();
    localStorage.setItem('my_life_logs', JSON.stringify(history));
    renderHistory();
    updateAiVoiceComment();
  } catch (e) {
    console.warn("ローカル保存に失敗しました", e);
  }
}

function renderHistory() {
  const listEl = document.getElementById('historyList');
  const badgeEl = document.getElementById('historyCountBadge');
  const history = JSON.parse(localStorage.getItem('my_life_logs') || '[]');
  
  badgeEl.innerText = `${history.length}件`;
  if (!history.length) {
    listEl.innerHTML = '<div style="font-size: 0.75rem; color: #94a3b8; text-align: center; padding: 10px;">まだ保存されたログがありません</div>';
    return;
  }

  listEl.innerHTML = history.slice(0, 10).map((item, idx) => `
    <div class="history-card">
      <div class="history-header">
        <span><span class="history-badge">${item.category}</span> ${item.tag}</span>
        <span>${item.date}</span>
      </div>
      <div class="history-text"><strong>X用:</strong> ${item.short_text}</div>
      <div class="history-btn-row">
        <button class="btn-mini-copy" onclick="copyHistoryItem(${idx}, 'short')">短文コピー</button>
        <button class="btn-mini-copy" onclick="copyHistoryItem(${idx}, 'long')">長文コピー</button>
      </div>
    </div>
  `).join('');
}

function copyHistoryItem(index, type) {
  const history = JSON.parse(localStorage.getItem('my_life_logs') || '[]');
  const item = history[index];
  if (!item) return;
  const text = type === 'short' ? item.short_text : item.long_text;
  navigator.clipboard.writeText(text);
  alert(`${type === 'short' ? '短文' : '長文'}をコピーしました！`);
}

function clearHistory() {
  if (confirm("スマホ内の履歴をすべて削除しますか？")) {
    localStorage.removeItem('my_life_logs');
    renderHistory();
    updateAiVoiceComment();
  }
}

async function sendToDiscord() {
  const shortVal = document.getElementById('shortText').value;
  const longVal = document.getElementById('longText').value;

  recordUserStyleExample(shortVal, longVal);

  const btn = document.getElementById('discordBtn');
  btn.disabled = true;
  btn.innerText = "画像と一緒に送信中...";

  const payload = {
    embeds: [{
      title: `📸 ${currentCategory}ログ（${selectedTag}）`,
      color: 15339532,
      fields: [
        { name: "📱 X用（短文）", value: shortVal || "なし" },
        { name: "📝 詳細アーカイブ（長文）", value: longVal || "なし" }
      ],
      footer: { text: `画像 ${imagesData.length} 枚を解析 | ${new Date().toLocaleString()}` }
    }]
  };

  const formData = new FormData();
  formData.append("payload_json", JSON.stringify(payload));

  for (let i = 0; i < imagesData.length; i++) {
    const byteCharacters = atob(imagesData[i].base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let j = 0; j < byteCharacters.length; j++) {
      byteNumbers[j] = byteCharacters.charCodeAt(j);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: imagesData[i].mimeType });
    formData.append(`files[${i}]`, blob, `photo_${i + 1}.jpg`);
  }

  try {
    const res = await fetch(`${RELAY_SERVER_URL}/api/discord`, {
      method: "POST",
      body: formData
    });
    if (!res.ok) throw new Error("Discord送信エラー");
    alert("写真とテキストをDiscordに保存しました！（直した文体もAIが学習しました）");
  } catch (e) {
    alert("Discord送信に失敗しました。");
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.innerText = "💬 Discordへ保存";
  }
}
