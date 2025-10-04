// commands/tiktok.react.js — TikTok con reacciones (Sky API)
// 👍 video   | ❤️ video (documento)
// 1 → video  | 2 → video (documento)
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const API_BASE = process.env.API_BASE || "https://api-sky.ultraplus.click";
const API_KEY  = process.env.API_KEY  || "Russellxz";

const isUrl    = (u="") => /^https?:\/\/\S+$/i.test(u);
const isTikTok = (u="") => /tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com/i.test(u);

// memoria de vistas previas → acción elegida
const pendingTT = Object.create(null);

async function callSkyTikTok(url){
  const { data: api, status } = await axios.get(
    `${API_BASE}/api/download/tiktok.php`,
    {
      params: { url },
      headers: { Authorization: `Bearer ${API_KEY}` },
      timeout: 25000,
      validateStatus: s => s >= 200 && s < 600
    }
  );
  if (status !== 200 || !api || api.status !== "true" || !api.data?.video) {
    throw new Error(api?.error || `HTTP ${status}`);
  }
  return api.data; // { title, video, audio?, duration?, author?, likes/comments?, thumbnail? }
}

function prefixFor(conn){
  const rawID = conn.user?.id || "";
  const subbotID = rawID.split(":")[0] + "@s.whatsapp.net";
  try {
    const p = JSON.parse(fs.readFileSync(path.resolve("prefixes.json"), "utf8"));
    return p[subbotID] || ".";
  } catch { return "."; }
}

async function sendTikTok(conn, job, mode, quoted){
  const caption =
`⚡ 𝗧𝗶𝗸𝗧𝗼𝗸 — 𝗹𝗶𝘀𝘁𝗼

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${job.title}
✦ 𝗔𝘂𝘁𝗼𝗿: ${job.author}
✦ 𝗗𝘂𝗿𝗮𝗰𝗶𝗼́𝗻: ${job.duration}

✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click
────────────
🤖 𝘼𝙯𝙪𝙧𝙖 𝙐𝙡𝙩𝙧𝙖 2.0`;

  if (mode === "document") {
    await conn.sendMessage(job.chatId, {
      document: { url: job.videoUrl },
      mimetype: "video/mp4",
      fileName: `${job.title}.mp4`,
      caption
    }, { quoted });
  } else {
    await conn.sendMessage(job.chatId, {
      video: { url: job.videoUrl },
      mimetype: "video/mp4",
      caption
    }, { quoted });
  }

  await conn.sendMessage(job.chatId, { react: { text: "✅", key: quoted.key } });
}

const handler = async (msg, { conn, text, args, command }) => {
  const usedPrefix = prefixFor(conn);
  const chatId = msg.key.remoteJid;
  const url = (args?.[0] || text || "").trim();

  if (!url) {
    return conn.sendMessage(chatId, {
      text:
`✳️ 𝙐𝙨𝙖:
${usedPrefix}${command} <enlace>
Ej: ${usedPrefix}${command} https://vm.tiktok.com/xxxxxx/`
    }, { quoted: msg });
  }
  if (!isUrl(url) || !isTikTok(url)) {
    return conn.sendMessage(chatId, { text: "❌ *Enlace de TikTok inválido.*" }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "⏱️", key: msg.key } });

  try {
    // 1) Llama a Sky API
    const d = await callSkyTikTok(url);
    const videoUrl = d.video;
    if (!videoUrl) throw new Error("No se pudo obtener el video.");

    const title   = d.title || "TikTok";
    const author  = (d.author && (d.author.nickname || d.author.name || d.author.username)) || "—";
    const durTxt  = d.duration ? `${d.duration}s` : "—";
    const likes   = d.likes ?? d.like ?? 0;
    const comments = d.comments ?? d.comment ?? 0;

    const banner =
`⚡ 𝗧𝗶𝗸𝗧𝗼𝗸 — 𝗽𝗿𝗲𝗽𝗮𝗿𝗮𝗱𝗼

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}
✦ 𝗔𝘂𝘁𝗼𝗿: ${author}
✦ 𝗗𝘂𝗿𝗮𝗰𝗶𝗼́𝗻: ${durTxt}
✦ 𝗟𝗶𝗸𝗲𝘀: ${likes} • 𝗖𝗼𝗺𝗲𝗻𝘁𝗮𝗿𝗶𝗼𝘀: ${comments}

🎮 *Elige cómo enviarlo:*
• 👍 𝙑𝙞𝙙𝙚𝙤
• ❤️ 𝘿𝙤𝙘𝙪𝙢𝙚𝙣𝙩𝙤 (mp4)
o responde: *1* = video, *2* = documento

✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click
────────────
🤖 𝘼𝙯𝙪𝙧𝙖 𝙐𝙡𝙩𝙧𝙖 2.0`;

    // 2) Enviar preview con thumbnail (si viene) + instrucciones
    const preview = await conn.sendMessage(chatId, {
      image: d.thumbnail ? { url: d.thumbnail } : undefined,
      caption: banner
    }, { quoted: msg });

    // 3) Guardar job
    pendingTT[preview.key.id] = {
      chatId,
      title,
      author,
      duration: durTxt,
      videoUrl,
      previewId: preview.key.id,
      createdAt: Date.now()
    };

    // 4) Listener único: reacciones y respuestas (1/2)
    if (!conn._ttListener) {
      conn._ttListener = true;
      conn.ev.on("messages.upsert", async ev => {
        for (const m of ev.messages) {
          // (a) Reacciones
          if (m.message?.reactionMessage) {
            const { key: reactKey, text: emoji } = m.message.reactionMessage;
            const job = pendingTT[reactKey?.id];
            if (job) {
              const mode = emoji === "❤️" ? "document" : (emoji === "👍" ? "video" : null);
              if (mode) {
                try {
                  await sendTikTok(conn, job, mode, m);
                } catch (e) {
                  await conn.sendMessage(job.chatId, { text: `❌ Error: ${e?.message || e}` }, { quoted: m });
                }
              }
            }
          }

          // (b) Respuesta citando el banner
          try {
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const quotedId = ctx?.stanzaId;
            const job = quotedId ? pendingTT[quotedId] : null;
            if (job) {
              const txt = (
                m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                ""
              ).trim().toLowerCase();

              let mode = null;
              if (txt === "1" || txt.includes("video") && !txt.includes("doc")) mode = "video";
              else if (txt === "2" || txt.includes("doc")) mode = "document";

              if (mode) {
                try {
                  await sendTikTok(conn, job, mode, m);
                } catch (e) {
                  await conn.sendMessage(job.chatId, { text: `❌ Error: ${e?.message || e}` }, { quoted: m });
                }
              } else {
                await conn.sendMessage(job.chatId, {
                  text: "⚠️ *Opciones válidas:* 1=video, 2=documento (o reacciona 👍 / ❤️)"
                }, { quoted: m });
              }
            }
          } catch {}
        }
      });
    }

    // 5) Limpieza (auto-expira a los 5 min)
    setTimeout(() => delete pendingTT[preview.key.id], 5 * 60 * 1000);

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  } catch (error) {
    console.error("❌ TikTok react (Sky):", error?.message || error);
    await conn.sendMessage(chatId, {
      text: "❌ *Ocurrió un error al procesar el enlace de TikTok.*"
    }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

handler.command = ["tiktok","tt"];
module.exports = handler;
