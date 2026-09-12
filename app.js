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
  document.getElementById('headerAiTitle').innerText = `専属AI: ${aiName}（呼び名: ${userCall}）`;
}

function greet() {
  const voiceEl = document.getElementById('aiVoiceBubble');
  voiceEl.innerText = `${userCall}、お腹空いた！今日のウマい飯、${aiName}に見せて？（最大6枚まで選べるよ）`;
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
  analyzeBtn.style.display = imagesData.length > 0 ? 'block' : 'none';
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

  voiceEl.innerText = `解析中… ${aiName}が写真${imagesData.length}枚をじっくり見てるから待っててね！`;
  alertEl.style.display = 'none';
  resultSec.style.display = 'none';

  const lenInstruction = selectedLength === 'short' 
    ? 'X用ポスト文は80〜100文字程度で簡潔に。'
    : 'X用ポスト文は180〜220文字程度で料理のディテールや味の情景をしっかり描写して。';

  const prompt = `
あなたは${userCall}の専属AI「${aiName}」です。32歳くらいのしっかり者で、ストレートかつユーモアを交えて話します。
今日の${userCall}の気分は「${selectedMood}」です。
渡された食事写真（${imagesData.length}枚）を解析し、純粋なJSONのみを出力してください。

【文字量指定】
${lenInstruction}

【最重要・機密情報セキュリティ判定】
写真内に料理以外の個人情報（レシート・領収書・クレジットカード・機密書類・免許証・他人の顔の明確な写り込みなど）が存在するか厳重にチェックしてください。

【出力JSONフォーマット】
{
  "has_sensitive_data": true または false,
  "safety_warning": "機密情報や顔がある場合の警告文。問題なければ空文字",
  "ai_comment": "${aiName}としてのツッコミ・感想（${userCall}と呼びかけること）",
  "x_post_text": "X用ポスト文（ハッシュタグと絵文字含む。本人が投稿する自然な口調）",
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
    document.getElementById('xPostText').value = result.x_post_text;

    if (result.has_sensitive_data) {
      alertEl.innerText = `⚠️ 警告: ${result.safety_warning}\n個人情報保護のため、X共有ボタンを無効化しています。`;
      alertEl.style.display = 'block';
      shareBtn.style.pointerEvents = 'none';
      shareBtn.style.opacity = '0.3';
    } else {
      shareBtn.style.pointerEvents = 'auto';
      shareBtn.style.opacity = '1';
      updateXLink(result.x_post_text);
    }

    resultSec.style.display = 'block';
  } catch (err) {
    voiceEl.innerText = "うーん、解析でエラーが出ちゃった！もう一度試してみて。";
    console.error(err);
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

  const editedPost = document.getElementById('xPostText').value;
  const mealId = 'meal_' + Date.now();

  // 1. D1 保存
  await fetch(`${RELAY_SERVER_URL}/api/save-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      mealId,
      aiComment: currentLog.ai_comment,
      xPostText: editedPost,
      bestIdx: currentLog.best_image_idx || 0
    })
  });

  // 2. Discord 送信
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

  // 3. 完了通知 ＆ 完全リセット
  alert("D1データベースとDiscordに保存完了しました！");
  resetAll();
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
