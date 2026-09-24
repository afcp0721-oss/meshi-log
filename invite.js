"use strict";
const INVITE_URL = "https://afcp0721-oss.github.io/meshi-log/invite.html";
const field = document.getElementById("inviteText");
const status = document.getElementById("shareStatus");
function message() { return field.value.trim(); }
async function copyInvite() {
  const text = [message(), INVITE_URL].filter(Boolean).join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "コピーしました。LINEなどに貼り付けて送れます。";
  } catch {
    const fallback = document.getElementById("manualCopy");
    fallback.value = text;
    fallback.hidden = false;
    document.getElementById("manualLabel").hidden = false;
    fallback.focus(); fallback.select(); fallback.setSelectionRange(0, text.length);
    status.textContent = "下の文章を長押し、または選択してコピーしてください。";
  }
}
document.getElementById("copyInvite").addEventListener("click", copyInvite);
document.getElementById("shareInvite").addEventListener("click", async () => {
  status.textContent = "";
  if (!navigator.share) return copyInvite();
  try {
    await navigator.share({title:"めしログ＆ライフログ", text:message(), url:INVITE_URL});
    status.textContent = "共有画面を閉じました。送信状況は共有先で確認してください。";
  } catch (error) {
    if (error.name === "AbortError") { status.textContent = "共有をキャンセルしました。"; return; }
    await copyInvite();
  }
});
