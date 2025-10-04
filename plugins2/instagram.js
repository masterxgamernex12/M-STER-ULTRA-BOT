// commands/instagram.js — Sky API + (👍/❤️ o 1/2) + sin límites (solo primer video)
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const API_BASE = process.env.API_BASE || "https://api-sky.ultraplus.click";
const SKY_API_KEY = process.env.SKY_API_KEY || "Russellxz";

// pendings por mensaje preview
const pending = {};

function isIG(u = "") { return /(instagram\.com|instagr\.am)/i.test(u); }

async function callSkyInstagram(url) {
  const headers = { Authorization: `Bearer ${SKY_API_KEY}` };

  // 1) endpoint .js
  try {
    const r = await axios.get(`${API_BASE}/api/download/instagram`, {
      params: { url },
      headers,
      timeout: 30000,
      validateStatus: s => s >= 200 && s < 600
    });
    if ((r.data?.status === "true" || r.data?.status === true) && r.data?.data?.media?.length) {
      return r.data.data; // { author, caption, media:[{type,url,...}], ... }
    }
  } catch (_) {}

  // 2) fallback .php
  const r2 = await axios.get(`${API_BASE}/api/download/instagram.php`, {
    params: { url },
    headers,
    timeout: 30000,
    validateStatus: s => s >= 200 && s < 600
  });
  if ((r2.data?.status === "true" || r2.data?.status === true) && r2.data?.data?.media?.length) {
    return r2.data.data;
  }
  const err = r2.data?.error || `HTTP ${r2.status || "?"}`;
  throw new Error(`Sky API error: ${err}`);
}

async function downloadToTmp(fileUrl, hint = "ig") {
  const tmp = path.resolve("./tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  const file = path.join(tmp, `${hint}-${Date.now()}-${Math.floor(Math.random()*1e5)}.mp4`);

  const res = await axios.get(fileUrl, {
    responseType: "stream",
    timeout: 120000,
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://www.instagram.com/",
      Accept: "*/*"
    },
    maxRedirects: 5
  });

  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(file);
    res.data.pipe(w);
    w.on("finish", resolve);
    w.on("error", reject);
  });

  return file;
}

const handler = async (msg, { conn, text, command }) => {
  // prefijo por subbot (igual que tu base)
  const rawID = conn.user?.id || "";
  const subbotID = rawID.split(":")[0] + "@s.whatsapp.net";

  const prefixPath = path.resolve("prefixes.json");
  let prefixes = {};
  if (fs.existsSync(prefixPath)) {
    try { prefixes = JSON.parse(fs.readFileSync(prefixPath, "utf-8")); } catch {}
  }
  const usedPrefix = prefixes[subbotID] || ".";

  if (!text) {
    return await conn.sendMessage(msg.key.remoteJid, {
      text: `✳️ Ejemplo de uso:\n${usedPrefix + command} https://www.instagram.com/reel/DPO9MwWjjY_/`
    }, { quoted: msg });
  }

  if (!isIG(text)) {
    return await conn.sendMessage(msg.key.remoteJid, {
      text: `❌ Enlace de Instagram inválido.\n\n📌 Ejemplo:\n${usedPrefix + command} https://www.instagram.com/p/CCoI4DQBGVQ/`
    }, { quoted: msg });
  }

  // ⏳ reacción mientras se procesa
  await conn.sendMessage(msg.key.remoteJid, { react: { text: "⏳", key: msg.key } });

  try {
    // 1) pedir a tu Sky API
    const data = await callSkyInstagram(text);
    const media = Array.isArray(data.media) ? data.media : [];

    // 2) solo primer VIDEO
    const firstVideo = media.find(it => String(it.type || "").toLowerCase() === "video") || media.find(it => /\.mp4(\?|$)/i.test(String(it.url || "")));
    if (!firstVideo) {
      return conn.sendMessage(msg.key.remoteJid, { text: "🚫 No se encontró video descargable en ese enlace." }, { quoted: msg });
    }

    const banner =
`⚡ 𝗜𝗻𝘀𝘁𝗮𝗴𝗿𝗮𝗺 — 𝗩𝗶𝗱𝗲𝗼 𝗽𝗿𝗲𝗽𝗮𝗿𝗮𝗱𝗼

✦ 𝗔𝘂𝘁𝗼𝗿: ${data.author ? "@"+data.author : "desconocido"}
✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click

Elige modo de envío:
• 👍  Video normal      • ❤️  Video como documento
• Responde: 1 (video)  • 2 (video-doc)

🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`;

    // 3) preview + guardar job
    const preview = await conn.sendMessage(
      msg.key.remoteJid,
      { image: data.media?.[0]?.thumb ? { url: data.media[0].thumb } : undefined, caption: banner },
      { quoted: msg }
    );

    pending[preview.key.id] = {
      chatId: msg.key.remoteJid,
      videoUrl: firstVideo.url,
      title: data.caption || `IG_${data.shortcode || "video"}`,
      commandMsg: msg
    };

    await conn.sendMessage(msg.key.remoteJid, { react: { text: "✅", key: msg.key } });

    // 4) listener para reacciones / respuestas (una sola vez)
    if (!conn._igSkyListener) {
      conn._igSkyListener = true;

      conn.ev.on("messages.upsert", async ev => {
        for (const m of ev.messages) {
          // reacciones
          if (m.message?.reactionMessage) {
            const { key: reactKey, text: emoji } = m.message.reactionMessage;
            const job = pending[reactKey.id];
            if (job) {
              if (emoji === "👍") await sendVideo(conn, job, false);
              if (emoji === "❤️") await sendVideo(conn, job, true);
            }
          }

          // respuestas citadas (1/2)
          try {
            const context = m.message?.extendedTextMessage?.contextInfo;
            const citado = context?.stanzaId;
            const texto = (
              m.message?.conversation?.toLowerCase() ||
              m.message?.extendedTextMessage?.text?.toLowerCase() ||
              ""
            ).trim();

            const job = pending[citado];
            if (citado && job) {
              if (["1", "video"].includes(texto)) {
                await sendVideo(conn, job, false);
              } else if (["2", "videodoc", "doc", "documento"].includes(texto)) {
                await sendVideo(conn, job, true);
              } else {
                await conn.sendMessage(job.chatId, {
                  text: "⚠️ Responde 1 (video) o 2 (video-doc), o reacciona con 👍 / ❤️."
                }, { quoted: job.commandMsg });
              }
            }
          } catch (e) {
            console.error("ig listener error:", e?.message || e);
          }
        }
      });
    }

  } catch (error) {
    console.error("❌ Error en instagram (Sky):", error?.message || error);
    await conn.sendMessage(msg.key.remoteJid, {
      text: "❌ Ocurrió un error al procesar el enlace de Instagram."
    }, { quoted: msg });
    await conn.sendMessage(msg.key.remoteJid, { react: { text: "❌", key: msg.key } });
  }
};

async function sendVideo(conn, job, asDocument) {
  try {
    await conn.sendMessage(job.chatId, {
      react: { text: asDocument ? "📁" : "🎬", key: job.commandMsg.key }
    });
    await conn.sendMessage(job.chatId, {
      text: `⏳ Descargando ${asDocument ? "video (documento)" : "video"}…`
    }, { quoted: job.commandMsg });

    const file = await downloadToTmp(job.videoUrl, "ig");
    await conn.sendMessage(job.chatId, {
      [asDocument ? "document" : "video"]: fs.readFileSync(file),
      mimetype: "video/mp4",
      fileName: `${job.title}.mp4`,
      caption: asDocument ? undefined :
`🎬 𝗜𝗚 𝗩𝗶𝗱𝗲𝗼 — 𝗟𝗶𝘀𝘁𝗼
✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click
© Azura SUBBOTS`
    }, { quoted: job.commandMsg });

    try { fs.unlinkSync(file); } catch {}
  } catch (e) {
    console.error("sendVideo IG error:", e?.message || e);
    await conn.sendMessage(job.chatId, { text: "❌ Error enviando el video." }, { quoted: job.commandMsg });
  }
}

handler.command = ["instagram", "ig"];
module.exports = handler;
