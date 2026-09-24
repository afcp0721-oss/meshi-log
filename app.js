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
let isReadingPhotos = false;
let pendingReview = null;
let modalIndex = 0;

window.addEventListener("DOMContentLoaded", () => {
  if (!userId) {
    userId = "usr_" + cryptoRandomId();
    localStorage.setItem("meshi_user_id", userId);
  }
  document.getElementById("shortMemoInput").addEventListener("input", invalidateReview);
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

async function handleFileSelect(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (!files.length || isSubmitting || isReadingPhotos) return;
  const remaining = MAX_PHOTOS - imagesData.length;
  if (remaining <= 0) return showToast("写真は1回につき最大3枚です");
  invalidateReview();
  isReadingPhotos = true;
  renderGrid();
  try {
    const photos = await Promise.all(files.slice(0, remaining).map(file => new Promise(resolve => {
      if (!file.type.startsWith("image/")) return resolve(null);
      const reader = new FileReader();
      reader.onload = e => compressImage(e.target.result, resolve);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    })));
    imagesData.push(...photos.filter(Boolean));
  } finally {
    isReadingPhotos = false;
    renderGrid();
  }
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
  img.onerror = () => { showToast("画像を読み込めませんでした"); callback(null); };
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

  const busy = isSubmitting || isReadingPhotos;
  grid.querySelectorAll("button").forEach(button => { button.disabled = busy; });
  document.getElementById("fileInput").disabled = busy;
  document.getElementById("shortMemoInput").disabled = busy;
  const disabled = imagesData.length === 0 || busy || pendingReview !== null;
  document.getElementById("btnQuickUpload").disabled = disabled;
  document.getElementById("btnProGenerate").disabled = disabled;
}

function removeImage(idx) {
  if (isSubmitting || isReadingPhotos) return;
  invalidateReview();
  imagesData.splice(idx, 1);
  renderGrid();
  document.getElementById("resultArea").style.display = "none";
}

function invalidateReview() {
  pendingReview = null;
  const area = document.getElementById("resultArea");
  area.replaceChildren();
  area.style.display = "none";
  renderGrid();
}

function depositPayload() {
  return {
    images: [...imagesData], photoReports: true,
    discordWebhookUrl: localStorage.getItem("meshi_discord_webhook") || "",
    shortMemo: document.getElementById("shortMemoInput").value.trim(),
    userId, aiName, callName: userCall,
    tone: selectedTone, mood: selectedMood
  };
}

async function uploadQuick() {
  if (!imagesData.length || isSubmitting || isReadingPhotos || pendingReview) return;
  invalidateReview();
  isSubmitting = true;
  renderGrid();
  setBusy(false, true);
  try {
    const payload = { ...depositPayload(), tone: "いつもの相棒", mood: "" };
    const res = await fetch(RELAY_SERVER_URL, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || `送信に失敗しました (${res.status})`);
    showToast("預かりました！ 相棒が裏側で解析・記録します。");
    imagesData = [];
    document.getElementById("shortMemoInput").value = "";
  } catch (err) {
    showToast("送信エラー：" + err.message, true);
  } finally {
    isSubmitting = false;
    setBusy(false, false);
    renderGrid();
  }
}

async function generatePro() {
  if (!imagesData.length || isSubmitting || isReadingPhotos || pendingReview) return;
  invalidateReview();
  const payload = depositPayload();
  isSubmitting = true;
  renderGrid();
  setBusy(true, true);
  try {
    const res = await fetch(`${RELAY_SERVER_URL}/api/preview`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    const data = await safeJson(res);
    if (!res.ok || typeof data.analysis?.post_text !== "string" || !data.analysis.post_text.trim()) {
      throw new Error(data.error || "コメントを生成できませんでした");
    }
    pendingReview = { payload, analysis: data.analysis, photo_reports: data.photo_reports };
    renderDepositReview(data);
  } catch (err) {
    showToast("生成エラー：" + err.message, true);
  } finally {
    isSubmitting = false;
    setBusy(true, false);
    renderGrid();
  }
}

function renderDepositReview(data) {
  const area = document.getElementById("resultArea");
  area.replaceChildren();
  area.style.display = "block";
  const status = document.createElement("p");
  status.textContent = "まだ預けていません。コメントを確認・編集してください。";
  status.className = "desc";
  status.setAttribute("role", "status");
  const label = document.createElement("label");
  label.htmlFor = "reviewComment";
  label.textContent = "記録するコメント";
  const comment = document.createElement("textarea");
  comment.id = "reviewComment";
  comment.value = data.analysis.post_text;
  comment.maxLength = 2000;
  comment.style.cssText = "width:100%;min-height:100px;padding:10px;background:#0f172a;color:#fff;border:1px solid #475569;border-radius:8px;font-size:.9rem";
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "btn-main";
  confirm.textContent = "この内容で預ける";
  const saveFeedback = document.createElement("p");
  saveFeedback.setAttribute("role", "alert");
  saveFeedback.style.cssText = "color:#fca5a5;line-height:1.6;margin:8px 0";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn-sub";
  cancel.textContent = "戻って写真・メモを変更";
  cancel.addEventListener("click", () => { if (!isSubmitting) invalidateReview(); });
  comment.addEventListener("input", () => { confirm.disabled = !comment.value.trim(); });
  confirm.addEventListener("click", async () => {
    if (!pendingReview || isSubmitting || !comment.value.trim()) return;
    isSubmitting = true;
    confirm.disabled = true;
    cancel.disabled = true;
    comment.disabled = true;
    confirm.textContent = "保存中…";
    saveFeedback.textContent = "";
    renderGrid();
    try {
      const res = await fetch(`${RELAY_SERVER_URL}/api/deposit-reviewed`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...pendingReview.payload, confirmed: true, photo_reports: pendingReview.photo_reports,
          reviewedAnalysis: { ...pendingReview.analysis, post_text: comment.value } })
      });
      const result = await safeJson(res);
      if (!res.ok || result.status !== "saved") throw new Error(result.error || "保存の完了を確認できませんでした。過去ログを確認してください。");
      pendingReview = null;
      imagesData = [];
      document.getElementById("shortMemoInput").value = "";
      status.textContent = "確認したコメントで記録しました。X投稿は下の下書きを確認してから行えます。";
      confirm.remove();
      cancel.remove();
      comment.disabled = false;
      comment.readOnly = true;
      showToast("確認した内容で預けました。");
    } catch (err) {
      status.textContent = "保存に失敗しました。ボタン下の案内を確認してください。";
      saveFeedback.textContent = "保存エラー：" + err.message;
      saveFeedback.scrollIntoView({block:"center", behavior:"smooth"});
      confirm.disabled = false;
      cancel.disabled = false;
      comment.disabled = false;
      confirm.textContent = "この内容で預ける";
    } finally {
      isSubmitting = false;
      renderGrid();
    }
  });
  area.append(status, label, comment, confirm, saveFeedback, cancel);
  if (data.photo_reports) {
    data.photo_reports.forEach((report, index) => {
      const card = document.createElement('section');
      card.className = 'card';
      const title = document.createElement('h3');
      title.textContent = `写真${index + 1}・${report.kind === 'meal' ? 'めしレポ' : 'ライフレポ'}`;
      const photo = document.createElement('img');
      photo.src = pendingReview.payload.images[index];
      photo.alt = `写真${index + 1}`;
      photo.style.cssText = 'width:100%;max-height:220px;object-fit:contain';
      const text = document.createElement('p');
      text.textContent = report.comment;
      card.append(title, photo, text);
      if (report.meal_report) renderMealReport(card, report.meal_report, true);
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = '𝕏 投稿文を確認する（任意）';
      details.append(summary);
      renderXDraft(details, report.x_post_text, value => {report.x_post_text = value;});
      card.append(details);
      area.append(card);
    });
    const note = document.createElement('p');
    note.textContent = '預けると写真・レポート・X下書きをDiscordへ保管します。保存後の編集はDiscordに反映されません。カロリーは合算しません。';
    area.append(note);
  }
  if (!data.photo_reports && data.analysis.category_major === "food" && data.meal_report) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "🍽️ めしレポを見る";
    details.appendChild(summary);
    renderMealReport(details, data.meal_report, true);
    area.appendChild(details);
  }
  if (!data.photo_reports && data.x_post_text) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "𝕏 投稿文を確認する（任意）";
    details.appendChild(summary);
    renderXDraft(details, data.x_post_text);
    area.appendChild(details);
  }
  area.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setBusy(pro, busy) {
  const spin = document.getElementById(pro ? "spinPro" : "spinBasic");
  const text = document.getElementById(pro ? "textPro" : "textBasic");
  if (spin) spin.style.display = busy ? "inline-block" : "none";
  if (text) text.textContent = busy ? (pro ? "コメント生成中…" : "預かり中…") : (pro ? "確認して預ける" : "そのまま預ける");
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
  if (isSubmitting || isReadingPhotos) return;
  document.getElementById("userCallInput").value = userCall;
  document.getElementById("aiNameInput").value = aiName;
  document.getElementById("myPhraseInput").value = myPhrase;
  document.getElementById("discordInput").value = localStorage.getItem("meshi_discord_webhook") || "";
  document.getElementById("settingsCard").style.display = "block";
  document.getElementById("mainCard").style.display = "none";
}
const APP_SHARE_URL = "https://afcp0721-oss.github.io/meshi-log/";

async function copyAppUrl() {
  const status = document.getElementById("appShareStatus");
  try {
    await navigator.clipboard.writeText(APP_SHARE_URL);
    status.textContent = "URLをコピーしました。LINEなどに貼り付けて紹介できます。";
  } catch {
    const field = document.getElementById("appShareUrl");
    field.focus();
    field.select();
    field.setSelectionRange(0, field.value.length);
    status.textContent = "URLを長押ししてコピーしてください。";
  }
}

async function shareApp() {
  const status = document.getElementById("appShareStatus");
  status.textContent = "";
  if (!navigator.share) return copyAppUrl();
  try {
    await navigator.share({ title: "めしログ＆ライフログ", url: APP_SHARE_URL });
  } catch (error) {
    if (error.name !== "AbortError") await copyAppUrl();
  }
}

function closeSettings() {
  document.getElementById("settingsCard").style.display = "none";
  document.getElementById("mainCard").style.display = "block";
}
function setCall(v) { document.getElementById("userCallInput").value = v; }
function setAiName(v) { document.getElementById("aiNameInput").value = v; }
function setPhrase(v) { document.getElementById("myPhraseInput").value = v; }

async function saveSettings() {
  const webhook = document.getElementById("discordInput").value.trim();
  if (webhook && !/^https:\/\/discord\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+$/.test(webhook)) {
    showToast("DiscordのウェブフックURLを確認してください");
    return;
  }
  if (webhook) localStorage.setItem("meshi_discord_webhook", webhook);
  else localStorage.removeItem("meshi_discord_webhook");
  invalidateReview();
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
  if (isSubmitting || isReadingPhotos) return;
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

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px";

  const xBtn = document.createElement("button");
  xBtn.type = "button";
  xBtn.className = "btn-gear";
  xBtn.textContent = "𝕏 投稿下書き";
  xBtn.addEventListener("click", () => loadAssist(item, "x_post", card, xBtn));
  actions.appendChild(xBtn);

  if (item.category_major === "food") {
    const reportBtn = document.createElement("button");
    reportBtn.type = "button";
    reportBtn.className = "btn-gear";
    reportBtn.textContent = "🍽️ めしレポ";
    reportBtn.addEventListener("click", () => loadAssist(item, "meal_report", card, reportBtn));
    actions.appendChild(reportBtn);
  }

  card.appendChild(actions);

  const assistArea = document.createElement("div");
  assistArea.className = "assist-area";
  assistArea.setAttribute("aria-live", "polite");
  assistArea.style.cssText = "display:none;margin-top:10px";
  card.appendChild(assistArea);
  return card;
}

async function loadAssist(item, action, card, button) {
  const area = card.querySelector(".assist-area");
  if (!area || card.dataset.assistBusy === "true") return;
  const cacheKey = action === "x_post" ? "xDraft" : "mealReport";
  if (card.assistCache?.[cacheKey] !== undefined) {
    area.replaceChildren();
    area.style.display = "block";
    if (action === "x_post") renderXDraft(area, card.assistCache.xDraft, value => { card.assistCache.xDraft = value; });
    else renderMealReport(area, card.assistCache.mealReport);
    return;
  }
  card.dataset.assistBusy = "true";
  const buttons = card.querySelectorAll("button");
  buttons.forEach(btn => { btn.disabled = true; });
  const oldText = button.textContent;
  button.textContent = "生成中…";
  area.style.display = "block";
  area.textContent = "AIが確認中…";

  try {
    const res = await fetch(`${RELAY_SERVER_URL}/api/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, recordId: item.record_id, action })
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || "生成できませんでした");
    area.replaceChildren();

    card.assistCache ||= {};
    if (action === "x_post") {
      card.assistCache.xDraft = data.x_post_text || "";
      renderXDraft(area, card.assistCache.xDraft, value => { card.assistCache.xDraft = value; });
    } else {
      card.assistCache.mealReport = data.meal_report || {};
      renderMealReport(area, card.assistCache.mealReport);
    }
  } catch (err) {
    area.textContent = err.message;
    area.style.color = "#f87171";
  } finally {
    card.dataset.assistBusy = "false";
    buttons.forEach(btn => { btn.disabled = false; });
    button.textContent = oldText;
  }
}

function renderXDraft(area, text, onEdit = () => {}) {
  area.style.color = "";
  const title = document.createElement("div");
  title.textContent = "𝕏 投稿下書き";
  title.style.cssText = "font-size:.8rem;font-weight:bold;color:#cbd5e1;margin-bottom:6px";

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("aria-label", "X投稿の下書き（編集できます）");
  textarea.style.cssText = "width:100%;min-height:90px;box-sizing:border-box;background:#0f172a;color:#fff;border:1px solid #475569;border-radius:8px;padding:8px;font-size:.88rem";

  const share = document.createElement("a");
  share.className = "btn-x";
  share.target = "_blank";
  share.rel = "noopener noreferrer";
  share.textContent = "𝕏 でポスト";
  const counter = document.createElement("div");
  counter.className = "x-draft-count";
  counter.style.cssText = "font-size:.75rem;color:#94a3b8;margin-top:6px";
  const consent = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  consent.append(checkbox, document.createTextNode(" 投稿内容を確認しました"));
  const refreshLink = () => {
    const ready = checkbox.checked && !!textarea.value.trim();
    if (ready) share.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(textarea.value)}`;
    else share.removeAttribute("href");
    share.setAttribute("aria-disabled", String(!ready));
    share.style.opacity = ready ? "1" : ".45";
    const length = [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(textarea.value)].length;
    counter.textContent = `${length}文字（目安130文字）`;
    onEdit(textarea.value);
  };
  checkbox.addEventListener("change", refreshLink);
  textarea.addEventListener("input", () => { checkbox.checked = false; refreshLink(); });
  share.addEventListener("click", event => {
    if (!checkbox.checked || !textarea.value.trim()) event.preventDefault();
  });
  share.setAttribute("role", "link");
  refreshLink();
  const note = document.createElement("p");
  note.textContent = "130文字程度の下書きです。Xの投稿画面で確認してポストできます。写真はX側で追加してください。";
  note.style.cssText = "font-size:.75rem;color:#94a3b8;margin-top:6px";
  area.append(title, textarea, counter, note, consent, share);
}

function renderMealReport(area, report, preview = false) {
  area.style.color = "";
  const box = document.createElement("div");
  box.style.cssText = "background:#111827;border:1px solid #374151;border-radius:8px;padding:10px;font-size:.84rem;line-height:1.55;color:#e5e7eb";

  const title = document.createElement("div");
  title.textContent = "🍽️ めしレポ";
  title.style.cssText = "font-weight:bold;color:#fb923c;margin-bottom:6px";
  box.appendChild(title);

  const name = document.createElement("div");
  name.textContent = report.meal_name || "食事";
  box.appendChild(name);

  const kcal = document.createElement("div");
  const min = report.estimated_calories_min;
  const max = report.estimated_calories_max;
  const hasRange = Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min;
  kcal.textContent = hasRange ? `推定カロリー：約${min}〜${max} kcal` : "推定カロリー：算出できませんでした";
  kcal.style.cssText = "font-weight:bold;margin-top:4px";
  box.appendChild(kcal);

  if (Array.isArray(report.ingredients) && report.ingredients.length) {
    const ingredients = document.createElement("div");
    ingredients.textContent = "見える食材：" + report.ingredients.join("、");
    box.appendChild(ingredients);
  }
  if (report.nutrition_balance) {
    const nutrition = document.createElement("div");
    nutrition.textContent = "バランス：" + report.nutrition_balance;
    box.appendChild(nutrition);
  }
  if (report.comment) {
    const comment = document.createElement("div");
    comment.textContent = report.comment;
    comment.style.cssText = "margin-top:4px";
    box.appendChild(comment);
  }
  const note = document.createElement("div");
  note.textContent = `${report.image_scope === "this_photo" ? "この写真が対象です。" : (preview ? "選択した" : "保存された") + "先頭の写真1枚が対象です。"}写真からの概算で、実際の量・材料・調理法により変わります。`;
  note.style.cssText = "font-size:.72rem;color:#94a3b8;margin-top:6px";
  box.appendChild(note);
  area.appendChild(box);
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
