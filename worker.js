const JSON_HEADERS = { "Content-Type": "application/json" };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    const headers = { ...cors, ...JSON_HEADERS };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    if (request.method === "GET" && url.pathname === "/api/logs") {
      try {
        const userId = (url.searchParams.get("userId") || "").trim();
        if (!userId) return json({ error: "userId is required", results: [] }, 400, headers);

        const { results } = await env.DB.prepare(
          "SELECT record_id, post_text AS ai_comment, discord_image_url AS photo_thumb, short_memo, category_minor, created_at FROM activity_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 30"
        ).bind(userId).all();
        return json({ results: results || [] }, 200, headers);
      } catch (err) {
        console.error("D1 Read Error:", err);
        return json({ error: "ログを取得できませんでした", results: [] }, 500, headers);
      }
    }

    if (request.method === "POST" && url.pathname === "/") {
      try {
        const payload = await request.json();
        const images = Array.isArray(payload.images) ? payload.images : [];
        if (images.length < 1 || images.length > 3) {
          return json({ error: "写真は1〜3枚で預けてください" }, 400, headers);
        }
        if (images.some(x => typeof x !== "string" || !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(x))) {
          return json({ error: "対応していない画像形式です" }, 400, headers);
        }
        const clean = {
          ...payload,
          userId: String(payload.userId || "").slice(0, 100),
          shortMemo: String(payload.shortMemo || "").slice(0, 500),
          aiName: String(payload.aiName || "ララ").slice(0, 50),
          callName: String(payload.callName || "あなた").slice(0, 50),
          tone: String(payload.tone || "いつもの相棒").slice(0, 50),
          mood: String(payload.mood || "").slice(0, 100),
          images
        };
        if (!clean.userId) return json({ error: "userId is required" }, 400, headers);

        ctx.waitUntil(handleBackgroundJob(clean, env));
        return json({ status: "accepted", message: "預かりました" }, 202, headers);
      } catch (err) {
        return json({ error: err.message || "Invalid request" }, 400, headers);
      }
    }

    return new Response("Not Found", { status: 404, headers: cors });
  }
};

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

async function handleBackgroundJob(payload, env) {
  const model = env.GEMINI_MODEL || "gemini-flash-latest";
  const webhook = env.DISCORD_WEBHOOK_URL || "";
  let imageUrls = [];

  if (webhook) {
    for (const image of payload.images) {
      const url = await uploadToDiscord(webhook, image);
      if (url) imageUrls.push(url);
    }
  }

  let recentContext = "";
  try {
    const { results } = await env.DB.prepare(
      "SELECT post_text, category_minor, created_at FROM activity_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 5"
    ).bind(payload.userId).all();
    if (results?.length) {
      recentContext = "【このユーザーの直近の記録】\n" +
        results.map(r => `- ${r.category_minor || "other"}: ${r.post_text || ""}`).join("\n");
    }
  } catch (err) {
    console.error("D1 recent context error:", err);
  }

  const prompt = `
あなたは${payload.callName}の気さくで率直な専属AI「${payload.aiName}」です。
白々しいお世辞、定型ポエム、過剰な美化は避け、写真日記として自然な1〜3文で返してください。
複数写真は同じ1回の出来事としてまとめて理解してください。
画像やメモから確認できない店名・商品名・人物名・場所などの固有名詞を推測・創作してはいけません。不明なら不明のまま扱ってください。
トーン: ${payload.tone}
気分: ${payload.mood || "指定なし"}
ちょい足しメモ: ${payload.shortMemo || "なし"}
${recentContext}

次のJSONだけを返してください:
{
  "post_text": "写真日記コメント",
  "category_major": "food | life | scene",
  "category_minor": "ramen | meat | cafe | work_site | driving | hobby | other",
  "location_type": "eatery | work_site | vehicle | outdoor | home | unknown",
  "companion_type": "solo | pair | group | unknown",
  "price_range": "under_1k | 1k_to_3k | over_3k | none",
  "interest_tag": "noodle_craft | car_maintenance | heavy_work | sports_gear | none"
}`;

  const result = await callGemini(env.GEMINI_API_KEY, model, prompt, payload.images);
  const comment = result.post_text || "記録しました。";

  try {
    await env.DB.prepare(
      "INSERT INTO activity_records (user_id, post_text, discord_image_url, short_memo, category_major, category_minor, location_type, companion_type, price_range, interest_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      payload.userId,
      comment,
      imageUrls[0] || "",
      payload.shortMemo,
      allowed(result.category_major, ["food","life","scene"], "life"),
      allowed(result.category_minor, ["ramen","meat","cafe","work_site","driving","hobby","other"], "other"),
      allowed(result.location_type, ["eatery","work_site","vehicle","outdoor","home","unknown"], "unknown"),
      allowed(result.companion_type, ["solo","pair","group","unknown"], "unknown"),
      allowed(result.price_range, ["under_1k","1k_to_3k","over_3k","none"], "none"),
      allowed(result.interest_tag, ["noodle_craft","car_maintenance","heavy_work","sports_gear","none"], "none")
    ).run();
  } catch (err) {
    console.error("D1 Insert Error:", err);
    throw err;
  }

  if (webhook) {
    await sendDiscordText(webhook, `**[${payload.aiName}]**\n${comment}`);
  }
}

function allowed(value, values, fallback) {
  return values.includes(value) ? value : fallback;
}

async function uploadToDiscord(webhookUrl, dataUrl) {
  try {
    const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i);
    if (!match) return null;
    const mime = match[1].toLowerCase().replace("jpg", "jpeg");
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const binary = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));

    const form = new FormData();
    form.append("file", new Blob([binary], { type: mime }), `upload.${ext}`);
    const separator = webhookUrl.includes("?") ? "&" : "?";
    const res = await fetch(webhookUrl + separator + "wait=true", { method: "POST", body: form });
    if (!res.ok) throw new Error(`Discord upload failed: ${res.status}`);
    const data = await res.json();
    return data.attachments?.[0]?.url || null;
  } catch (err) {
    console.error("Discord Upload Error:", err);
    return null;
  }
}

async function sendDiscordText(webhookUrl, content) {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ content })
    });
    if (!res.ok) console.error("Discord text failed:", res.status);
  } catch (err) {
    console.error("Discord Text Error:", err);
  }
}

async function callGemini(apiKey, modelName, prompt, images) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
  const parts = [{ text: prompt }];

  for (const image of images) {
    const match = image.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i);
    if (!match) continue;
    parts.push({
      inlineData: {
        mimeType: match[1].toLowerCase().replace("jpg", "jpeg"),
        data: match[2]
      }
    });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json" }
      })
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Gemini error: ${res.status}`);
  let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(text); }
  catch { return { post_text: text || "記録しました。" }; }
}
