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
          "SELECT record_id, post_text AS ai_comment, discord_image_url AS photo_thumb, short_memo, category_major, category_minor, created_at FROM activity_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 30"
        ).bind(userId).all();
        return json({ results: results || [] }, 200, headers);
      } catch (err) {
        console.error("D1 Read Error:", err);
        return json({ error: "ログを取得できませんでした", results: [] }, 500, headers);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/image") {
      try {
        const raw = (url.searchParams.get("url") || "").trim();
        const target = new URL(raw);
        if (target.protocol !== "https:" || !isAllowedDiscordCdnHost(target.hostname)) {
          return json({ error: "Invalid image URL" }, 400, headers);
        }

        const upstream = await fetch(target.toString(), {
          headers: { "User-Agent": "MeshiLog/1.0" }
        });
        if (!upstream.ok) {
          return json({ error: "画像を取得できませんでした" }, 502, headers);
        }

        const contentType = upstream.headers.get("Content-Type") || "application/octet-stream";
        if (!contentType.toLowerCase().startsWith("image/")) {
          return json({ error: "画像ではありません" }, 502, headers);
        }

        return new Response(upstream.body, {
          status: 200,
          headers: {
            ...cors,
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=3600"
          }
        });
      } catch (err) {
        console.error("Image proxy error:", err);
        return json({ error: "画像URLが不正です" }, 400, headers);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/assist") {
      try {
        const body = await request.json();
        const userId = String(body.userId || "").slice(0, 100);
        const recordId = Number(body.recordId);
        const action = String(body.action || "");
        if (!userId || !Number.isFinite(recordId) || !["x_post", "meal_report"].includes(action)) {
          return json({ error: "Invalid assist request" }, 400, headers);
        }

        const record = await env.DB.prepare(
          "SELECT record_id, post_text, discord_image_url, short_memo, category_major, category_minor, created_at FROM activity_records WHERE user_id = ? AND record_id = ? LIMIT 1"
        ).bind(userId, recordId).first();
        if (!record) return json({ error: "記録が見つかりません" }, 404, headers);

        const model = env.GEMINI_MODEL || "gemini-flash-latest";
        let images = [];
        if (record.discord_image_url) {
          const dataUrl = await discordImageToDataUrl(record.discord_image_url);
          if (dataUrl) images = [dataUrl];
        }

        if (action === "x_post") {
          const prompt = `
あなたはSNS投稿の編集アシスタントです。
以下の写真日記記録から、Xに投稿できる自然な日本語の下書きを1つ作ってください。
誇張、架空の店名・商品名・人物名・場所名は禁止です。確認できない固有名詞は書かないでください。
ハッシュタグは0〜2個。短く読みやすくしてください。
記録コメント: ${record.post_text || ""}
メモ: ${record.short_memo || ""}
カテゴリ: ${record.category_minor || "other"}
次のJSONだけを返してください:
{"x_post_text":"投稿下書き"}
`;
          const result = await callGemini(env.GEMINI_API_KEY, model, prompt, images);
          return json({ x_post_text: String(result.x_post_text || record.post_text || "").slice(0, 1000) }, 200, headers);
        }

        if (record.category_major !== "food") {
          return json({ error: "めしレポは食事記録のみ対象です" }, 400, headers);
        }
        if (!images.length) {
          return json({ error: "写真を取得できないため、めしレポを作成できません" }, 422, headers);
        }

        const prompt = `
あなたは食事写真の簡易レポートAIです。
写真とメモから見える範囲だけで推定してください。医療診断や精密な栄養計算ではありません。
量や調理法が不明な場合は幅を持たせ、断定しないでください。
店名・商品名・人物名・場所名を推測・創作してはいけません。
メモ: ${record.short_memo || "なし"}
次のJSONだけを返してください:
{
  "meal_name":"料理の簡潔な説明",
  "estimated_calories_min":0,
  "estimated_calories_max":0,
  "ingredients":["見える主な食材"],
  "nutrition_balance":"ざっくりした栄養バランス",
  "comment":"短い一言"
}
`;
        const result = await callGemini(env.GEMINI_API_KEY, model, prompt, images);
        const min = clampCalories(result.estimated_calories_min);
        const max = Math.max(min, clampCalories(result.estimated_calories_max));
        return json({
          meal_report: {
            meal_name: String(result.meal_name || "食事").slice(0, 120),
            estimated_calories_min: min,
            estimated_calories_max: max,
            ingredients: Array.isArray(result.ingredients) ? result.ingredients.slice(0, 8).map(x => String(x).slice(0, 60)) : [],
            nutrition_balance: String(result.nutrition_balance || "").slice(0, 300),
            comment: String(result.comment || "").slice(0, 200),
            disclaimer: "写真からの概算です。実際の量・材料・調理法で変わります。"
          }
        }, 200, headers);
      } catch (err) {
        console.error("Assist error:", err);
        return json({ error: "AI補助を生成できませんでした" }, 500, headers);
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

async function discordImageToDataUrl(rawUrl) {
  try {
    const target = new URL(rawUrl);
    if (target.protocol !== "https:" || !isAllowedDiscordCdnHost(target.hostname)) return "";
    const res = await fetch(target.toString(), { headers: { "User-Agent": "MeshiLog/1.0" } });
    if (!res.ok) return "";
    const contentType = (res.headers.get("Content-Type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) return "";
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:${contentType.split(";")[0]};base64,${btoa(binary)}`;
  } catch {
    return "";
  }
}

function clampCalories(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(10000, Math.round(n));
}

function isAllowedDiscordCdnHost(hostname) {
  const host = hostname.toLowerCase();
  return host === "cdn.discordapp.com" || host === "media.discordapp.net";
}
