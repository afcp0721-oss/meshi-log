// --------------------------------------------------
// 機能0: 設定定数 & ローカルステート管理
// --------------------------------------------------
const RELAY_SERVER_URL = "https://icy-silence-6539.afcp0721.workers.dev";
let userId = localStorage.getItem("meshi_user_id");
let aiName = localStorage.getItem("meshi_ai_name") || "ログアシスタント";
let userCall = localStorage.getItem("meshi_user_call") || "ニックネーム";
let myPhrase = localStorage.getItem("meshi_my_phrase") || "リピ確定！";
let discordWebhook = localStorage.getItem("meshi_discord_webhook") || "";
let lineId = localStorage.getItem("meshi_line_id") || "";

let currentMode = "basic"; // basic or pro
let imagesData = [];
let selectedTone = "いつもの相棒";

// --------------------------------------------------
// 機能1: 初期化 & ヘッダー反映
// --------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  if (!userId) {
    userId = "usr_" + Math.random().toString(36).substring(2, 10);
    localStorage.setItem("meshi_user_id", userId);
  }
  updateUIHeaders();
  renderGrid();
});

function updateUIHeaders() {
  const headerEl = document.getElementById("headerAiTitle");
  if (headerEl) headerEl.innerText = `アシスタント: ${aiName}`;
  const phraseChip = document.getElementById("dynamicPhraseChip");
  if (phraseChip) {
    phraseChip.innerText = myPhrase || "リピ確定！";
    phraseChip.setAttribute("onclick", `toggleMood(this, '${myPhrase}')`);
  }
}

let selectedMood = "";
function toggleMood(el, mood) {
  const isAlready = el.classList.contains("active");
  document.querySelectorAll("#moodChips .chip").forEach(c => c.classList.remove("active"));
  if (!isAlready) {
    el.classList.add("active");
    selectedMood = mood || el.innerText;
  } else {
    selectedMood = "";
  }
}

// --------------------------------------------------
// 機能2: モード切替（おまかせ / PRO）
// --------------------------------------------------
function switchMode(mode) {
  currentMode = mode;
  document.getElementById("btnModeBasic").classList.toggle("active", mode === "basic");
  document.getElementById("btnModePro").classList.toggle("active", mode === "pro");
  document.getElementById("basicActionArea").style.display = mode === "basic" ? "block" : "none";
  document.getElementById("proActionArea").style.display = mode === "pro" ? "block" : "none";
  document.getElementById("resultArea").style.display = "none";
}

function setTone(el, tone) {
  document.querySelectorAll("#toneChips .chip").forEach(c => c.classList.remove("active"));
  el.classList.add("active");
  selectedTone = tone;
}

// --------------------------------------------------
// 機能3: 写真選択 & 6枚グリッドレンダリング（初期枠復活）
// --------------------------------------------------
function handleFileSelect(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;

  const remaining = 6 - imagesData.length;
  const targetFiles = files.slice(0, remaining);

  let processed = 0;
  targetFiles.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      compressImage(e.target.result, (compressedUrl) => {
        imagesData.push(compressedUrl);
        processed++;
        if (processed === targetFiles.length) {
          renderGrid();
        }
      });
    };
    reader.readAsDataURL(file);
  });
}

function compressImage(dataUrl, callback) {
  const img = new Image();
  img.onload = () => {
    const maxDim = 1200;
    let w = img.width, h = img.height;
    if (w > maxDim || h > maxDim) {
      if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
      else { w = Math.round((w * maxDim) / h); h = maxDim; }
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    callback(canvas.toDataURL("image/jpeg", 0.82));
  };
  img.src = dataUrl;
}

function renderGrid() {
  const grid = document.getElementById("photoGrid");
  grid.innerHTML = "";

  imagesData.forEach((dataUrl, idx) => {
    const cell = document.createElement("div");
    cell.className = "photo-cell";
    cell.innerHTML = `
      <img src="${dataUrl}" onclick="openImageModal(${idx})">
      <div class="del-btn" onclick="removeImage(${idx})">✕</div>
    `;
    grid.appendChild(cell);
  });

  if (imagesData.length < 6) {
    const addCell = document.createElement("div");
    addCell.className = "photo-cell add-cell";
    addCell.innerHTML = `
      <span style="font-size: 1.5rem; line-height: 1;">＋</span>
      <span>${imagesData.length}/6</span>
    `;
    addCell.onclick = () => document.getElementById("fileInput").click();
    grid.appendChild(addCell);
  }

  const hasPhotos = imagesData.length > 0;
  document.getElementById("btnQuickUpload").disabled = !hasPhotos;
  document.getElementById("btnProGenerate").disabled = !hasPhotos;
}

function removeImage(idx) {
  imagesData.splice(idx, 1);
  renderGrid();
  document.getElementById("resultArea").style.display = "none";
}

// --------------------------------------------------
// 機能4: 【おまかせモード】1秒保存先行 ＆ 非同期処理
// --------------------------------------------------
async function uploadQuick() {
  if (!imagesData.length) return;
  const btn = document.getElementById("btnQuickUpload");
  const spin = document.getElementById("spinBasic");
  const text = document.getElementById("textBasic");
  btn.disabled = true;
  if (spin) spin.style.display = "inline-block";
  if (text) text.innerText = "預かり中…";

  try {
    const res = await fetch(`${RELAY_SERVER_URL}/api/meals/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        images: imagesData,
        photoThumb: imagesData[0]
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "保存に失敗しました");

    showToast("⚡ ログアシスタントが預かりました！解析は裏側で進めます。");

    // X下書き用ポーリング（裏側の解析が終わるのを待ってXリンクを出す）
    pollMealResult(data.mealId);

  } catch (err) {
    alert("エラー: " + err.message);
  finally {
    btn.disabled = false;
    if (spin) spin.style.display = "none";
    if (text) text.innerText = "⚡ 預ける（1秒で完了）";
  }
}

// 非同期解析完了待ち
async function pollMealResult(mealId) {
  let attempts = 0;
  const interval = setInterval(async () => {
    attempts++;
    if (attempts > 15) { clearInterval(interval); return; }

    const res = await fetch(`${RELAY_SERVER_URL}/api/meals/status?id=${mealId}`);
    const record = await res.json();

    if (record && record.status === "done") {
      clearInterval(interval);
      displayResult(record.ai_comment, record.x_post_text, record.privacy_warning);
    }
  }, 2000);
}

// --------------------------------------------------
// 機能5: 【PROモード】リアルタイムGemini生成
// --------------------------------------------------
async function generatePro() {
  if (!imagesData.length) return;
  const btn = document.getElementById("btnProGenerate");
  btn.disabled = true;
  btn.innerText = "✨ 生成中…";

  const promptText = `
あなたは${userCall}専属の「${aiName}」です。トーン: ${selectedTone}。
画像（${imagesData.length}枚）を解析し、以下のJSON形式で回答してください。
- aiComment: ${userCall}に寄り添う親身なツッコミ（30〜60文字）。
- xPostText: X投稿用短文（口癖「${myPhrase}」を入れ、ハッシュタグ付き）。
- privacyWarning: 個人情報や顔写り込みがある場合は true、なければ false。
`;

  const parts = [{ text: promptText }];
  imagesData.forEach(img => {
    parts.push({
      inline_data: {
        mime_type: "image/jpeg",
        data: img.replace(/^data:image\/\w+;base64,/, "")
      }
    });
  });

 try {
      const res = await fetch(`${RELAY_SERVER_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }] })
      });
      const data = await res.json();

      // エラーの詳細をそのままアラートに表示するガード
      if (!res.ok || data.error) {
        throw new Error(data.error?.message || JSON.stringify(data));
      }
      if (!data.candidates || !data.candidates[0]) {
        throw new Error("Geminiから回答が取得できませんでした: " + JSON.stringify(data));
      }

      let rawText = data.candidates[0].content.parts[0].text;
      rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(rawText);

      displayResult(parsed.aiComment, parsed.xPostText, parsed.privacyWarning);
    } catch (err) {
      alert("生成エラー: " + err.message);
    }
finally {
    btn.disabled = false;
    if (spin) spin.style.display = "none";
    if (text) text.innerText = "✨ じっくり生成してプレビュー";
  }
}

// --------------------------------------------------
// 機能6: 解析結果表示 & Xシェアリンク
// --------------------------------------------------
function displayResult(comment, postText, privacyWarning) {
  const resultArea = document.getElementById("resultArea");
  const commentEl = document.getElementById("aiComment");
  const xTextEl = document.getElementById("xText");
  const xShareBtn = document.getElementById("btnXShare");
  const alertBox = document.getElementById("alertBox");

  if (privacyWarning) {
    alertBox.innerText = "⚠️ 個人情報や顔の写り込みが検知されました。投稿内容を確認してください。";
    alertBox.style.display = "block";
  } else {
    alertBox.style.display = "none";
  }

  commentEl.innerText = comment || "記録完了！";
  xTextEl.value = postText || "";

  updateXShareLink(postText);
  xTextEl.oninput = () => updateXShareLink(xTextEl.value);

  resultArea.style.display = "block";
}

function updateXShareLink(text) {
  const btn = document.getElementById("btnXShare");
  btn.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text || "")}`;
}

function showToast(msg) {
  const box = document.getElementById("toastBox");
  box.innerText = msg;
  box.style.display = "block";
  setTimeout(() => { box.style.display = "none"; }, 4000);
}

// --------------------------------------------------
// 機能7: 設定モーダル制御 & D1保存
// --------------------------------------------------
function openSettings() {
  document.getElementById("userCallInput").value = userCall;
  document.getElementById("aiNameInput").value = aiName;
  document.getElementById("myPhraseInput").value = myPhrase;
  document.getElementById("discordInput").value = discordWebhook;
  document.getElementById("lineInput").value = lineId;
  document.getElementById("settingsCard").style.display = "block";
  document.getElementById("mainCard").style.display = "none";
}

function closeSettings() {
  document.getElementById("settingsCard").style.display = "none";
  document.getElementById("mainCard").style.display = "block";
}

function setCall(val) { document.getElementById("userCallInput").value = val; }
function setAiName(val) { document.getElementById("aiNameInput").value = val; }
function setPhrase(val) { document.getElementById("myPhraseInput").value = val; }

async function saveSettings() {
  userCall = document.getElementById("userCallInput").value.trim() || "ニックネーム";
  aiName = document.getElementById("aiNameInput").value.trim() || "ログアシスタント";
  myPhrase = document.getElementById("myPhraseInput").value.trim() || "リピ確定！";
  discordWebhook = document.getElementById("discordInput").value.trim();
  lineId = document.getElementById("lineInput").value.trim();

  localStorage.setItem("meshi_user_call", userCall);
  localStorage.setItem("meshi_ai_name", aiName);
  localStorage.setItem("meshi_my_phrase", myPhrase);
  localStorage.setItem("meshi_discord_webhook", discordWebhook);
  localStorage.setItem("meshi_line_id", lineId);

  updateUIHeaders();

  await fetch(`${RELAY_SERVER_URL}/api/user`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, aiName, userCall, myPhrase, discordWebhook, lineId })
  }).catch(() => {});

  alert("設定を保存しました！");
  closeSettings();
}

// --------------------------------------------------
// 機能8: 過去ログ表示
// --------------------------------------------------
async function loadMealHistory() {
  const modal = document.getElementById("historyModal");
  const list = document.getElementById("historyList");
  modal.style.display = "block";
  document.getElementById("mainCard").style.display = "none";
  list.innerHTML = '<div style="color: #94a3b8; font-size: 0.85rem; text-align: center;">読み込み中…</div>';

  try {
    const res = await fetch(`${RELAY_SERVER_URL}/api/logs?userId=${userId}`);
    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      list.innerHTML = '<div style="color: #94a3b8; font-size: 0.85rem; text-align: center;">まだ記録がありません。</div>';
      return;
    }
    list.innerHTML = "";
    data.results.forEach(item => {
      const card = document.createElement("div");
      card.style.cssText = "background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px;";
      let imgTag = item.photo_thumb ? `<img src="${item.photo_thumb}" style="width: 100%; max-height: 180px; object-fit: cover; border-radius: 6px; margin-bottom: 8px;">` : "";
      card.innerHTML = `
        ${imgTag}
        <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 6px;">${item.created_at}</div>
        <div style="font-size: 0.85rem; color: #6ee7b7; margin-bottom: 8px; font-weight: bold;">💬 ${item.ai_comment || "記録完了"}</div>
        <div style="font-size: 0.82rem; color: #e2e8f0; white-space: pre-wrap; background: #1e293b; padding: 8px; border-radius: 6px;">${item.x_post_text || ""}</div>
      `;
      list.appendChild(card);
    });
  } catch (err) {
    list.innerHTML = '<div style="color: #f87171; font-size: 0.85rem; text-align: center;">ログ取得に失敗しました。</div>';
  }
}

function closeHistory() {
  document.getElementById("historyModal").style.display = "none";
  document.getElementById("mainCard").style.display = "block";
}

// --------------------------------------------------
// 機能9: 画像スワイプ拡大モーダル
// --------------------------------------------------
let modalIndex = 0;
function openImageModal(idx) {
  modalIndex = idx;
  document.getElementById("modalImg").src = imagesData[modalIndex];
  document.getElementById("imageModal").style.display = "flex";
}
function closeImageModal() {
  document.getElementById("imageModal").style.display = "none";
}
function prevImage(e) {
  e.stopPropagation();
  if (modalIndex > 0) { modalIndex--; openImageModal(modalIndex); }
}
function nextImage(e) {
  e.stopPropagation();
  if (modalIndex < imagesData.length - 1) { modalIndex++; openImageModal(modalIndex); }
}
