async function analyzeImages() {
  if (!imagesData.length) return;

  const voiceEl = document.getElementById('aiVoiceBubble');
  const alertEl = document.getElementById('safetyAlert');
  const resultSec = document.getElementById('resultSection');
  const shareBtn = document.getElementById('xShareBtn');
  const analyzeBtn = document.getElementById('btnAnalyze');

  // 解析開始：ボタンをローディング表示にする
  if (analyzeBtn) {
    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = '⏳ 解析中…（相棒がじっくり確認中）';
    analyzeBtn.style.opacity = '0.6';
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

    // 成功時：ボタンを元に戻す
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      analyzeBtn.innerHTML = '🔍 この写真で解析する';
      analyzeBtn.style.opacity = '1';
    }
  } catch (err) {
    voiceEl.innerText = "うーん、解析でエラーが出ちゃった！もう一度試してみて。";
    console.error(err);

    // エラー時：ボタンを元に戻す
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      analyzeBtn.innerHTML = '🔍 この写真で解析する';
      analyzeBtn.style.opacity = '1';
    }
  }
}
