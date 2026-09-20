const RELAY_SERVER_URL = "https://icy-silence-6539.afcp0721.workers.dev";
const MAX_PHOTOS = 3;

let userId = localStorage.getItem("meshi_user_id");
let aiName = localStorage.getItem("meshi_ai_name") || "ログアシスタント";
let userCall = localStorage.getItem("meshi_user_call") || "ニックネーム";
let myPhrase = localStorage.getItem("meshi_my_phrase") || "リピ確定！";
let imagesData = [];
let selectedTone = "いつもの相棒";
let selectedMood = "";
let isSubmitting = false;
let modalIndex = 0;

window.addEventListener("DOMContentLoaded", () => {
  if (!userId) {
    userId = "usr_" + cryptoRandomId();
    localStorage.setItem("meshi_user_id", userId);
  }
  updateUIHeaders();
  renderGrid();
});

function cryptoRandomId() {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).slice(2, 12);
}

function updateUIHeaders() {
  const header = document.getElementById("headerAiTitle");
  if (header) header.textContent = `ログAI: ${aiName}`;
  const chip = document.getElementById("dynamicPhraseChip");
  if (chip) chip.textContent = myPhrase || "リピ確定！";
}

function setTone(el, tone) {
  document.querySelectorAll("#toneChips .chip").forEach(c => c.classList.remove("active"));
  el.classList.add("active");
  selectedTone = tone;
}

function toggleMood(el, mood) {
  const active = el.classList.contains("active");
  document.querySelectorAll("#moodChips .chip").forEach(c => c.classList.remove("active"));
  selectedMood = "";
  if (!active) {
    el.classList.add("active");
    selectedMood = mood || el.textContent.trim();
  }
}

function handleFileSelect(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (!files.length) return;

  const remaining = MAX_PHOTOS - imagesData.length;
  if (remaining <= 0) return showToast("写真は1回につき最大3枚です");

  const targets = files.slice(0, remaining);
  let completed = 0;
  targets.forEach(file => {
    if (!file.type.startsWith("image/")) {
      completed++;
      if (completed === targets.length) renderGrid();
      return;
    }
    const reader = new FileReader();
    reader.onload = e => compressImage(e.target.result, compressed => {
      imagesData.push(compressed);
      completed++;
      if (completed === targets.length) renderGrid();
    });
    reader.onerror = () => {
      completed++;
      if (completed === targets.length) renderGrid();
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
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    callback(canvas.toDataURL("image/jpeg", 0.82));
  };
  img.onerror = () => showToast("画像を読み込めませんでした");
  img.src = dataUrl;
}

function renderGrid() {
  const grid = document.getElementById("photoGrid");
  grid.replaceChildren();

  imagesData.forEach((dataUrl, idx) => {
    const cell = document.createElement("div");
    cell.className = "photo-cell";

    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = `選択写真 ${idx + 1}`;
    img.addEventListener("click", () => openImageModal(idx));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "del-btn";
    del.textContent = "✕";
    del.setAttribute("aria-label", `写真${idx + 1}を削除`);
    del.addEventListener("click", () => removeImage(idx));

    cell.append(img, del);
    grid.appendChild(cell);
  });

  if (imagesData.length < MAX_PHOTOS) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "photo-cell add-cell";
    add.innerHTML = `<span style="font-size:1.5rem;line-height:1">＋</span><span>${imagesData.length}/${MAX_PHOTOS}</span>`;
    add.addEventListener("click", () => document.getElementById("fileInput").click());
    grid.appendChild(add);
  }

  const disabled = imagesData.length === 0 || isSubmitting;
  document.getElementById("btnQuickUpload").disabled = disabled;
  document.getElementById("btnProGenerate").disabled = disabled;
}

function removeImage(idx) {
  if (isSubmitting) return;
  imagesData.splice(idx, 1);
  renderGrid();
  document.getElementById("resultArea").style.display = "none";
}

async function uploadQuick() {
  if (!imagesData.length || isSubmitting) return;
  await submitDeposit({ tone: "いつもの相棒", mood: "" }, false);
}

async function generatePro() {
  if (!imagesData.length || isSubmitting) return;
  await submitDeposit({ tone: selectedTone, mood: selectedMood }, true);
}

async function submitDeposit(options, showResult) {
  isSubmitting = true;
  renderGrid();
  setBusy(showResult, true);

  const memo = document.getElementById("shortMemoInput")?.value.trim() || "";
  const payload = {
    images: [...imagesData],
    shortMemo: memo,
    userId,
    aiName,
    callName: userCall,
    tone: options.tone,
    mood: options.mood
  };

  try {
    const res = await fetch(RELAY_SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || `送信に失敗しました (${res.status})`);

    showToast(showResult
      ? "預かりました。解析後のコメントは過去ログに反映されます。"
      : "預かりました！ 相棒が裏側で解析・記録します。");

    imagesData = [];
    const memoInput = document.getElementById("shortMemoInput");
    if (memoInput) memoInput.value = "";
    document.getElementById("resultArea").style.display = "none";
  } catch (err) {
    showToast("送信エラー：" + err.message, true);
  } finally {
    isSubmitting = false;
    setBusy(showResult, false);
    renderGrid();
  }
}

function setBusy(pro, busy) {
  const spin = document.getElementById(pro ? "spinPro" : "spinBasic");
  const text = document.getElementById(pro ? "textPro" : "textBasic");
  if (spin) spin.style.display = busy ? "inline-block" : "none";
  if (text) text.textContent = busy ? "預かり中…" : (pro ? "✨ じっくり預ける" : "預ける");
}

async function safeJson(res) {
  try { return await res.json(); } catch { return {}; }
}

function showToast(msg, isError = false) {
  const box = document.getElementById("toastBox");
  box.textContent = msg;
  box.style.display = "block";
  box.style.background = isError ? "#b91c1c" : "#ea580c";
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { box.style.display = "none"; }, 4500);
}

function openSettings() {
  document.getElementById("userCallInput").value = userCall;
  document.getElementById("aiNameInput").value = aiName;
  document.getElementById("myPhraseInput").value = myPhrase;
  document.getElementById("settingsCard").style.display = "block";
  document.getElementById("mainCard").style.display = "none";
}
function closeSettings() {
  document.getElementById("settingsCard").style.display = "none";
  document.getElementById("mainCard").style.display = "block";
}
function setCall(v) { document.getElementById("userCallInput").value = v; }
function setAiName(v) { document.getElementById("aiNameInput").value = v; }
function setPhrase(v) { document.getElementById("myPhraseInput").value = v; }

async function saveSettings() {
  userCall = document.getElementById("userCallInput").value.trim() || "ニックネーム";
  aiName = document.getElementById("aiNameInput").value.trim() || "ログアシスタント";
  myPhrase = document.getElementById("myPhraseInput").value.trim() || "リピ確定！";

  localStorage.setItem("meshi_user_call", userCall);
  localStorage.setItem("meshi_ai_name", aiName);
  localStorage.setItem("meshi_my_phrase", myPhrase);
  updateUIHeaders();
  showToast("設定を保存しました");
  closeSettings();
}

async function loadMealHistory() {
  const modal = document.getElementById("historyModal");
  const list = document.getElementById("historyList");
  modal.style.display = "block";
  document.getElementById("mainCard").style.display = "none";
  list.textContent = "読み込み中…";

  try {
    const res = await fetch(`${RELAY_SERVER_URL}/api/logs?userId=${encodeURIComponent(userId)}&t=${Date.now()}`);
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || "ログ取得に失敗しました");
    list.replaceChildren();

    if (!data.results?.length) {
      const empty = document.createElement("div");
      empty.textContent = "まだ記録がありません。";
      empty.style.cssText = "color:#94a3b8;font-size:.85rem;text-align:center";
      list.appendChild(empty);
      return;
    }

    data.results.forEach(item => list.appendChild(buildHistoryCard(item)));
  } catch (err) {
    list.replaceChildren();
    const error = document.createElement("div");
    error.textContent = "ログ取得エラー：" + err.message;
    error.style.cssText = "color:#f87171;font-size:.85rem;text-align:center";
    list.appendChild(error);
  }
}

function buildHistoryCard(item) {
  const card = document.createElement("div");
  card.style.cssText = "background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;margin-bottom:12px";

  if (item.photo_thumb) {
    const img = document.createElement("img");
    img.src = `${RELAY_SERVER_URL}/api/image?url=${encodeURIComponent(item.photo_thumb)}`;
    img.alt = "保存写真";
    img.loading = "lazy";
    img.style.cssText = "width:100%;max-height:220px;object-fit:cover;border-radius:6px;margin-bottom:10px";
    card.appendChild(img);
  }

  const meta = document.createElement("div");
  meta.style.cssText = "display:flex;justify-content:space-between;font-size:.75rem;color:#64748b;margin-bottom:6px";
  const date = document.createElement("span");
  date.textContent = item.created_at || "";
  const cat = document.createElement("span");
  cat.textContent = "#" + (item.category_minor || "life");
  cat.style.cssText = "color:#f97316;font-weight:bold";
  meta.append(date, cat);
  card.appendChild(meta);

  if (item.short_memo) {
    const memo = document.createElement("div");
    memo.textContent = "✍️ メモ: " + item.short_memo;
    memo.style.cssText = "font-size:.8rem;color:#94a3b8;margin-bottom:6px";
    card.appendChild(memo);
  }

  const comment = document.createElement("div");
  comment.textContent = item.ai_comment || "記録完了";
  comment.style.cssText = "font-size:.9rem;color:#f8fafc;line-height:1.5;background:#1e293b;padding:10px;border-radius:6px;border-left:3px solid #f97316";
  card.appendChild(comment);
  return card;
}

function closeHistory() {
  document.getElementById("historyModal").style.display = "none";
  document.getElementById("mainCard").style.display = "block";
}

function openImageModal(idx) {
  modalIndex = idx;
  document.getElementById("modalImg").src = imagesData[modalIndex];
  document.getElementById("imageModal").style.display = "flex";
}
function closeImageModal() { document.getElementById("imageModal").style.display = "none"; }
function prevImage(e) {
  e.stopPropagation();
  if (modalIndex > 0) openImageModal(modalIndex - 1);
}
function nextImage(e) {
  e.stopPropagation();
  if (modalIndex < imagesData.length - 1) openImageModal(modalIndex + 1);
}
