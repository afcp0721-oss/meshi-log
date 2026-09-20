export default {

  async fetch(request, env, ctx) {

    const url = new URL(request.url);

    const MODEL = env.GEMINI_MODEL || "gemini-flash-latest";



    const corsHeaders = {

      "Access-Control-Allow-Origin": "*",

      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",

      "Access-Control-Allow-Headers": "Content-Type"

    };



    if (request.method === "OPTIONS") {

      return new Response(null, { headers: corsHeaders });

    }



    if (request.method === "GET" && url.pathname === "/api/logs") {

      try {

        const { results } = await env.DB.prepare(

          "SELECT record_id, post_text AS ai_comment, discord_image_url AS photo_thumb, short_memo, category_minor, created_at FROM activity_records ORDER BY created_at DESC LIMIT 30"

        ).all();



        return new Response(JSON.stringify({ results: results || [] }), {

          headers: Object.assign({}, corsHeaders, { "Content-Type": "application/json" })

        });

      } catch (err) {

        return new Response(JSON.stringify({ error: err.message, results: [] }), {

          status: 500,

          headers: Object.assign({}, corsHeaders, { "Content-Type": "application/json" })

        });

      }

    }



    if (request.method === "POST" && url.pathname === "/api/generate") {

      try {

        const body = await request.json();

        const geminiRes = await fetch(

          "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent?key=" + env.GEMINI_API_KEY,

          {

            method: "POST",

            headers: { "Content-Type": "application/json" },

            body: JSON.stringify(body)

          }

        );

        const data = await geminiRes.json();

        return new Response(JSON.stringify(data), {

          headers: Object.assign({}, corsHeaders, { "Content-Type": "application/json" })

        });

      } catch (err) {

        return new Response(JSON.stringify({ error: { message: err.message } }), {

          status: 500,

          headers: Object.assign({}, corsHeaders, { "Content-Type": "application/json" })

        });

      }

    }



    if (request.method === "POST") {

      try {

        const payload = await request.json();

        ctx.waitUntil(handleBackgroundJob(payload, env, MODEL));



        return new Response(JSON.stringify({ status: "accepted", message: "預かりました！裏で処理中..." }), {

          headers: Object.assign({}, corsHeaders, { "Content-Type": "application/json" })

        });

      } catch (e) {

        return new Response(JSON.stringify({ error: e.message }), {

          status: 500,

          headers: Object.assign({}, corsHeaders, { "Content-Type": "application/json" })

        });

      }

    }



    return new Response("Not Found", { status: 404, headers: corsHeaders });

  }

};



async function handleBackgroundJob(payload, env, modelName) {

  const images = payload.images;

  const shortMemo = payload.shortMemo || "";

  const userId = payload.userId || "yamamoto_boss";

  const discordWebhookUrl = payload.discordWebhookUrl;

  const lineToken = payload.lineToken;

  const lineUserId = payload.lineUserId;

  const aiName = payload.aiName || "ララ";

  const callName = payload.callName || "ボス";



  let discordImageUrl = null;

  if (discordWebhookUrl && images && images.length > 0) {

    discordImageUrl = await uploadToDiscord(discordWebhookUrl, images[0]);

  }



  let recentContext = "";

  try {

    const { results } = await env.DB.prepare(

      "SELECT post_text, category_minor, created_at FROM activity_records ORDER BY created_at DESC LIMIT 3"

    ).all();

    if (results && results.length > 0) {

      recentContext = "【直近の記録】: \n" + results.map(function(r) { return "- " + r.category_minor + ": " + r.post_text; }).join("\n");

    }

  } catch (err) {

    console.error("D1 Read Error:", err);

  }



  const prompt = "\nあなたは" + callName + "の気さくで率直な専属AI「" + aiName + "」です。\n白々しいお世辞や定型ポエム、過剰な美化は厳禁。クスッと笑えるウィットあるツッコミや、リアルな共感で返してください。\n\nちょい足しメモ: \"" + (shortMemo || "なし") + "\"\n" + recentContext + "\n\n写真とメモから、以下のJSONフォーマットのみを出力してください：\n{\n  \"post_text\": \"親しみやすくウィットに富んだコメント（1〜3文程度）\",\n  \"category_major\": \"food\" | \"life\" | \"scene\",\n  \"category_minor\": \"ramen\" | \"meat\" | \"cafe\" | \"work_site\" | \"driving\" | \"hobby\" | \"other\",\n  \"location_type\": \"eatery\" | \"work_site\" | \"vehicle\" | \"outdoor\" | \"home\" | \"unknown\",\n  \"companion_type\": \"solo\" | \"pair\" | \"group\" | \"unknown\",\n  \"price_range\": \"under_1k\" | \"1k_to_3k\" | \"over_3k\" | \"none\",\n  \"interest_tag\": \"noodle_craft\" | \"car_maintenance\" | \"heavy_work\" | \"sports_gear\" | \"none\"\n}\n";



  const geminiResult = await callGemini(env.GEMINI_API_KEY, modelName, prompt, images);

  const commentText = geminiResult.post_text || geminiResult.aiComment || (typeof geminiResult === "string" ? geminiResult : "しっかり記録しました！");



  try {

    await env.DB.prepare(

      "INSERT INTO activity_records (user_id, post_text, discord_image_url, short_memo, category_major, category_minor, location_type, companion_type, price_range, interest_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"

    ).bind(

      userId,

      commentText,

      discordImageUrl || "",

      shortMemo || "",

      geminiResult.category_major || "life",

      geminiResult.category_minor || "other",

      geminiResult.location_type || "unknown",

      geminiResult.companion_type || "unknown",

      geminiResult.price_range || "none",

      geminiResult.interest_tag || "none"

    ).run();

  } catch (err) {

    console.error("D1 Insert Error:", err);

  }



  if (lineToken && lineUserId) {

    await sendLinePush(lineToken, lineUserId, commentText, discordImageUrl);

  }



  if (discordWebhookUrl && commentText) {

    await sendDiscordText(discordWebhookUrl, "**[" + aiName + "]**\n" + commentText);

  }

}



async function uploadToDiscord(webhookUrl, base64Data) {

  try {

    const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);

    const base64Content = base64Data.split(",")[1] || base64Data;

    const binary = Uint8Array.from(atob(base64Content), function(c) { return c.charCodeAt(0); });



    let body = "--" + boundary + "\r\n";

    body += "Content-Disposition: form-data; name=\"file\"; filename=\"upload.jpg\"\r\n";

    body += "Content-Type: image/jpeg\r\n\r\n";



    const pre = new TextEncoder().encode(body);

    const post = new TextEncoder().encode("\r\n--" + boundary + "--\r\n");

    const merged = new Uint8Array(pre.length + binary.length + post.length);

    merged.set(pre, 0);

    merged.set(binary, pre.length);

    merged.set(post, pre.length + binary.length);



    const res = await fetch(webhookUrl, {

      method: "POST",

      headers: { "Content-Type": "multipart/form-data; boundary=" + boundary },

      body: merged

    });



    if (res.ok) {

      const data = await res.json();

      if (data.attachments && data.attachments[0]) {

        return data.attachments[0].url;

      }

    }

  } catch (e) {

    console.error("Discord Upload Error:", e);

  }

  return null;

}



async function sendLinePush(token, to, text, imageUrl) {

  try {

    const messages = [];

    if (imageUrl) {

      messages.push({

        type: "image",

        originalContentUrl: imageUrl,

        previewImageUrl: imageUrl

      });

    }

    messages.push({

      type: "text",

      text: text

    });



    await fetch("https://api.line.me/v2/bot/message/push", {

      method: "POST",

      headers: {

        "Content-Type": "application/json",

        Authorization: "Bearer " + token

      },

      body: JSON.stringify({ to: to, messages: messages })

    });

  } catch (e) {

    console.error("LINE Push Error:", e);

  }

}



async function sendDiscordText(webhookUrl, content) {

  try {

    await fetch(webhookUrl, {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ content: content })

    });

  } catch (e) {

    console.error("Discord Text Error:", e);

  }

}



async function callGemini(apiKey, modelName, prompt, images) {

  try {

    const parts = [{ text: prompt }];



    if (images && images.length > 0) {

      const b64 = images[0].split(",")[1] || images[0];

      parts.push({

        inlineData: {

          mimeType: "image/jpeg",

          data: b64

        }

      });

    }



    const payload = {

      contents: [{ role: "user", parts: parts }],

      generationConfig: { responseMimeType: "application/json" }

    };



    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent?key=" + apiKey, {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify(payload)

    });



    const data = await res.json();

    let text = "{}";

    if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {

      text = data.candidates[0].content.parts[0].text || "{}";

    }

    text = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    try {

      return JSON.parse(text);

    } catch (e) {

      return { post_text: text };

    }

  } catch (err) {

    console.error("callGemini Error:", err);

    return { post_text: "記録完了！" };

  }

}