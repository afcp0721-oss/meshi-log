const RELAY_SERVER_URL = "https://icy-silence-6539.afcp0721.workers.dev";

let userId = localStorage.getItem('meshi_user_id');
let aiName = localStorage.getItem('meshi_ai_name') || '相棒';
let userCall = localStorage.getItem('meshi_user_call') || 'ボス';
let selectedMood = '最高';
let selectedLength = 'short';
let imagesData = [];
let currentLog = null;

window.addEventListener('DOMContentLoaded', () => {
  if (!userId) {
    userId = 'usr_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem('meshi_user_id', userId);
  }
  updateHeader();
  greet();
});

function updateHeader() {
  const headerEl = document.getElementById('headerAiTitle');
  if (headerEl) headerEl.innerText = `専属AI: ${aiName}`;
}

function greet() {
  const voiceEl = document.getElementById('aiVoiceBubble');
  if (voiceEl) voiceEl.innerText = `${userCall}、今日のウマい飯、${aiName}に見せて？`;
}

function setAiName(name) { document.getElementById('aiNameInput').value = name; }
function setCall(call) { document.getElementById('userCallInput').value = call; }

function openSettings() {
  document.getElementById('aiNameInput').value = aiName;
  document.getElementById('userCallInput').value = userCall;
  document.getElementById('settingsCard').style.display = 'block';
  document.getElementById('mainCard').style.display = 'none';
}

function skipSettings() {
  document.getElementById('settingsCard').style.display = 'none';
  document.getElementById('mainCard').style.display = 'block';
}

async function saveRelationship() {
  aiName = document.getElementById('aiNameInput').value.trim() || '相棒';
  userCall = document.getElementById('userCallInput').value.trim() || 'ボス';

  localStorage.setItem('meshi_ai_name', aiName);
  localStorage.setItem('meshi_user_call', userCall);

  updateHeader();
  skipSettings();
  greet();

  await fetch(`${RELAY_SERVER_URL}/api/user`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, aiName, userCall })
  }).catch(() => {});
}

function selectMood(el, mood) {
  document.querySelectorAll('#moodChips .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  selectedMood = mood;
}

function selectLength(el, len) {
  document.querySelectorAll('#lengthChips .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  selectedLength = len;
  
  if (currentLog) {
    document.getElementById('xPostText').value = len === 'short' ? currentLog.x_post_short : currentLog.x_post_long;
    updateXLink(document.getElementById('xPostText').value);
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
        resolve({ dataUrl, base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function createTinyThumb(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 240;
      let w = img.width, h = img.height;
      if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
      else { w = Math.round((w * maxDim) / h); h = maxDim; }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.6));
    };
    img.src = dataUrl;
  });
}
async function handleImages(event) {
  const files = Array.from(event.target.files).slice(0, 6);
  if (!files.length) return;

  for (const f of files) {
    if (imagesData.length >= 6) break;
    const comp = await compressImage(f);
    imagesData.push(comp);
  }
  renderPreviews();
}

function renderPreviews() {
  const grid = document.getElementById('previewGrid');
  grid.innerHTML = '';

  imagesData.forEach((img, idx) => {
    const box = document.createElement('div');
    box.className = 'thumb-box';

    const thumb = document.createElement('img');
    thumb.src = img.dataUrl;
    thumb.className = 'preview-thumb';

    const delBtn = document.createElement('div');
    delBtn.className = 'del-badge';
    delBtn.innerText = '✕';
    delBtn.onclick = () => removeImage(idx);

    box.appendChild(thumb);
    box.appendChild(delBtn);
    grid.appendChild(box);
  });

  const analyzeBtn = document.getElementById('btnAnalyze');
  if (analyzeBtn) {
    analyzeBtn.style.display = imagesData.length > 0 ? 'block' : 'none';
  }
}

function removeImage(index) {
  imagesData.splice(index, 1);
  renderPreviews();
  if (imagesData.length === 0) {
    document.getElementById('resultSection').style.display = 'none';
  }
}

async function analyzeImages() {
  if (!imagesData.length) return;

  const voiceEl = document.getElementById('aiVoiceBubble');
  const alertEl = document.getElementById('safetyAlert');
  const resultSec = document.getElementById('resultSection');
  const shareBtn = document.getElementById('xShareBtn');
  const analyzeBtn = document.getElementById('btnAnalyze');

  // スピナー付きローディング表示 ＆ 連打防止
  if (analyzeBtn) {
    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = '<span class="spinner"></span>解析中…（相棒が確認中）';
    analyzeBtn.style.opacity = '0.7';
    analyzeBtn.style.cursor = 'not-allowed';
  }

  voiceEl.innerText = `解析中… ${aiName}が写真${imagesData.length}枚をチェック中！`;
  alertEl.style.display = 'none';
  resultSec.style.display = 'none';

  const prompt = `
あなたは${userCall}の専属AI「${aiName}」です。32歳くらいのしっかり者で、ストレートかつユーモアを交えて話します。
今日の${userCall}の気分は「${selectedMood}」です。
渡された食事写真（${imagesData.length}枚）を解析し、純粋なJSONのみを出力してください。

【最重要・セキュリティ判定】
写真内に料理以外の個人情報（レシート・クレジットカード・書類・免許証・顔の明確な写り込みなど）があるか判定してください。

【出力JSONフォーマット】
{
  "has_sensitive_data": true または false,
  "safety_warning": "機密情報や顔がある場合の警告文。問題なければ空文字",
  "ai_comment": "${aiName}としてのツッコミ・感想（${userCall}と呼びかけること）",
  "x_post_short": "X用ポスト文（80〜100字程度、ハッシュタグと絵文字含む）",
  "x_post_long": "X用ポスト文（180〜220字程度で詳細、ハッシュタグと絵文字含む）",
  "best_image_idx": 0
}
`;

  const parts = [{ text: prompt }];
  imagesData.forEach(img => {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
  });

  try {
    const res = await fetch(`${RELAY_SERVER_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] })
    });

    const data = await res.json();
    let rawText = data.candidates[0].content.parts[0].text;
    rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(rawText);

    currentLog = result;
    voiceEl.innerText = result.ai_comment;

    const postContent = selectedLength === 'short' ? result.x_post_short : result.x_post_long;
    document.getElementById('xPostText').value = postContent;

    if (result.has_sensitive_data) {
      alertEl.innerText = `⚠️ 警告: ${result.safety_warning}\n個人情報保護のため、X共有ボタンを無効化しています。`;
      alertEl.style.display = 'block';
      shareBtn.style.pointerEvents = 'none';
      shareBtn.style.opacity = '0.3';
    } else {
      shareBtn.style.pointerEvents = 'auto';
      shareBtn.style.opacity = '1';
      updateXLink(postContent);
    }

    resultSec.style.display = 'block';

    // 完了時：ボタンを復元
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      analyzeBtn.innerHTML = '🔍 この写真で解析する';
      analyzeBtn.style.opacity = '1';
      analyzeBtn.style.cursor = 'pointer';
    }
  } catch (err) {
    voiceEl.innerText = "うーん、解析でエラーが出ちゃった！もう一度試してみて。";
    console.error(err);

    // エラー時：ボタンを復元
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      analyzeBtn.innerHTML = '🔍 この写真で解析する';
      analyzeBtn.style.opacity = '1';
      analyzeBtn.style.cursor = 'pointer';
    }
  }
}

function updateXLink(text) {
  const shareBtn = document.getElementById('xShareBtn');
  shareBtn.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

document.getElementById('xPostText').addEventListener('input', (e) => {
  updateXLink(e.target.value);
});

async function saveToCloudAndDiscord() {
  if (!currentLog) return;

  const saveBtn = document.getElementById('btnSaveCloud');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner"></span>保存中…';
    saveBtn.style.opacity = '0.7';
    saveBtn.style.cursor = 'not-allowed';
  }

  try {
    const editedPost = document.getElementById('xPostText').value;
    const mealId = 'meal_' + Date.now();
    const bestIdx = currentLog.best_image_idx || 0;
    const targetImg = imagesData[bestIdx] || imagesData[0];
    const photoThumb = targetImg ? await createTinyThumb(targetImg.dataUrl) : null;
    const allPhotos = imagesData.map(img => img.dataUrl);

    await fetch(`${RELAY_SERVER_URL}/api/save-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        mealId,
        aiComment: currentLog.ai_comment,
        xPostText: editedPost,
        bestIdx: bestIdx,
        photoThumb: photoThumb,
        allPhotos: allPhotos
      })
    });

    const payload = {
      embeds: [{
        title: `🍽️ ${userCall}のメシログ（AI: ${aiName}）`,
        color: 15339532,
        description: `**気分:** ${selectedMood}\n**${aiName}のツッコミ:**\n${currentLog.ai_comment}`,
        fields: [{ name: "📱 Xポスト内容", value: editedPost }],
        footer: { text: `User ID: ${userId} | ${new Date().toLocaleString()}` }
      }]
    };

    const formData = new FormData();
    formData.append("payload_json", JSON.stringify(payload));

    imagesData.forEach((img, i) => {
      const byteChars = atob(img.base64);
      const byteNums = new Array(byteChars.length);
      for (let j = 0; j < byteChars.length; j++) byteNums[j] = byteChars.charCodeAt(j);
      const blob = new Blob([new Uint8Array(byteNums)], { type: img.mimeType });
      formData.append(`files[${i}]`, blob, `meal_${i + 1}.jpg`);
    });

    await fetch(`${RELAY_SERVER_URL}/api/discord`, { method: "POST", body: formData });

    alert("D1データベースとDiscordに保存完了しました！");
    resetAll();
  } catch (err) {
    alert("保存中にエラーが発生しました。もう一度試してください。");
    console.error(err);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '💾 クラウド＆Discordに記録してリセット';
      saveBtn.style.opacity = '1';
      saveBtn.style.cursor = 'pointer';
    }
  }
}

function resetAll() {
  imagesData = [];
  currentLog = null;
  document.getElementById('previewGrid').innerHTML = '';
  document.getElementById('btnAnalyze').style.display = 'none';
  document.getElementById('resultSection').style.display = 'none';
  document.getElementById('safetyAlert').style.display = 'none';
  document.getElementById('fileInput').value = '';
  greet();
}
// D1から過去ログを取得して表示
async function loadMealHistory() {
  const modal = document.getElementById('historyModal');
  const list = document.getElementById('historyList');
  modal.style.display = 'block';
  document.getElementById('mainCard').style.display = 'none';

  list.innerHTML = '<div style="color: #94a3b8; font-size: 0.85rem; text-align: center;">読み込み中…</div>';

  try {
    const res = await fetch(`${RELAY_SERVER_URL}/api/logs?userId=${userId}`);
    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      list.innerHTML = '<div style="color: #94a3b8; font-size: 0.85rem; text-align: center;">まだ記録がありません。</div>';
      return;
    }

    list.innerHTML = '';
   data.results.forEach(item => {
      const card = document.createElement('div');
      card.style.cssText = "background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px;";
      
      let photosHtml = '';
      let photos = [];
      try {
        if (item.all_photos) photos = JSON.parse(item.all_photos);
      } catch (e) {}

      if (photos.length > 0) {
        photosHtml = `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 10px;">` +
          photos.map(p => `<img src="${p}" style="width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px;">`).join('') +
          `</div>`;
      } else if (item.photo_thumb) {
        photosHtml = `<img src="${item.photo_thumb}" style="width: 100%; max-height: 180px; object-fit: cover; border-radius: 6px; margin-bottom: 8px;">`;
      }

      card.innerHTML = `
        ${photosHtml}
        <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 6px;">${item.created_at}</div>
        <div style="font-size: 0.85rem; color: #6ee7b7; margin-bottom: 8px; font-weight: bold;">💬 ${item.ai_comment}</div>
        <div style="font-size: 0.82rem; color: #e2e8f0; white-space: pre-wrap; background: #1e293b; padding: 8px; border-radius: 6px;">${item.x_post_text}</div>
      `;
      list.appendChild(card);
    });
  } catch (err) {
    list.innerHTML = '<div style="color: #f87171; font-size: 0.85rem; text-align: center;">ログの取得に失敗しました。</div>';
  }
}

function closeHistory() {
  document.getElementById('historyModal').style.display = 'none';
  document.getElementById('mainCard').style.display = 'block';
}
