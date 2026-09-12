const RELAY_SERVER_URL = "https://icy-silence-6539.afcp0721.workers.dev";

let userId = localStorage.getItem('meshi_user_id');
let aiName = localStorage.getItem('meshi_ai_name') || 'ララ';
let userCall = localStorage.getItem('meshi_user_call') || 'ボス';
let imagesData = [];
let currentLog = null;

window.addEventListener('DOMContentLoaded', () => {
  if (!userId) {
    userId = 'usr_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem('meshi_user_id', userId);
  }

  if (!localStorage.getItem('meshi_ai_name')) {
    document.getElementById('onboardingCard').style.display = 'block';
  } else {
    showMainUI();
  }
});

function setCall(call) {
  document.getElementById('userCallInput').value = call;
}

async function saveRelationship() {
  aiName = document.getElementById('aiNameInput').value.trim() || 'ララ';
  userCall = document.getElementById('userCallInput').value.trim() || 'ボス';

  localStorage.setItem('meshi_ai_name', aiName);
  localStorage.setItem('meshi_user_call', userCall);

  await fetch(`${RELAY_SERVER_URL}/api/user`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, aiName, userCall })
  });

  document.getElementById('onboardingCard').style.display = 'none';
  showMainUI(true);
}

function showMainUI(isFirst = false) {
  document.getElementById('mainCard').style.display = 'block';
  const voiceEl = document.getElementById('aiVoiceBubble');

  if (isFirst) {
    voiceEl.innerText = `よろしく、${userCall}！私のことも${aiName}って呼んでくれてありがとう！記念すべき1食目を見せてよ。`;
  } else {
    voiceEl.innerText = `${userCall}、お腹空いた！今日のウマい飯、${aiName}に見せて？`;
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
          dataUrl,
          base64: dataUrl.split(',')[1],
          mimeType: 'image/jpeg'
        });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleImages(event) {
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

  analyzeImages();
}

async function analyzeImages() {
  const voiceEl = document.getElementById('aiVoiceBubble');
  const alertEl = document.getElementById('safetyAlert');
  const resultSec = document.getElementById('resultSection');
  const shareBtn = document.getElementById('xShareBtn');

  voiceEl.innerText = `解析中… ${aiName}がじっくり見てるからちょっと待っててね！`;
  alertEl.style.display = 'none';
  resultSec.style.display = 'none';

  const prompt = `
あなたは${userCall}の専属AI「${aiName}」です。32歳くらいのしっかり者で、ストレートかつユーモアを交えて話します。
渡された写真（最大6枚）を解析し、純粋なJSONのみを出力してください。

【最重要・機密情報セキュリティ判定】
写真内に料理以外の個人情報（レシート・領収書・クレジットカード・機密書類・免許証・他人の顔の明確な写り込みなど）が存在するか厳重にチェックしてください。

【出力JSONフォーマット】
{
  "has_sensitive_data": true または false,
  "safety_warning": "機密情報や顔がある場合の警告文。問題なければ空文字",
  "ai_comment": "${aiName}としてのツッコミ・感想（${userCall}と呼びかけること）",
  "x_post_text": "X用ポスト文（120文字前後、絵文字とハッシュタグ含む。本人が投稿する自然な口調）",
  "best_image_idx": 0
}
`;

  const parts = [{ text: prompt }];
  imagesData.forEach(img => {
    parts.push({
      inline_data: { mime_type: img.mimeType, data: img.base64 }
    });
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

  const payload = {
    embeds: [{
      title: `🍽️ ${userCall}のメシログ（AI: ${aiName}）`,
      color: 15339532,
      description: `**${aiName}のツッコミ:**\n${currentLog.ai_comment}`,
      fields: [
        { name: "📱 Xポスト内容", value: editedPost }
      ],
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
}
