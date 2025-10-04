// commands/ytmp4.react.js — YouTube → VIDEO con reacciones (Sky API)
// 👍 video  | ❤️ documento
// 1 → video | 2 → documento
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream");
const { promisify } = require("util");
const streamPipeline = promisify(pipeline);

const API_BASE = process.env.API_BASE || "https://api-sky.ultraplus.click";
const API_KEY  = process.env.API_KEY  || "Russellxz";

const pendingYT4 = Object.create(null);

const isYouTube = (u="") =>
  /^https?:\/\//i.test(u) && /(youtube\.com|youtu\.be|music\.youtube\.com)/i.test(u);

const fmtSec = (s) => {
  const n = Number(s || 0);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return (h ? `${h}:` : "") + `${m.toString().padStart(2,"0")}:${sec.toString().padStart(2,"0")}`;
};

async function callSkyYTVideo(url){
  const r = await axios.get(`${API_BASE}/api/download/yt.php`, {
    params: { url, format: "video" },
    headers: { Authorization: `Bearer ${API_KEY}`, "X-API-Key": API_KEY },
    timeout: 30000,
    validateStatus: s => s >= 200 && s < 600
  });
  if (r.status !== 200 || r.data?.status !== "true" || !r.data?.data) {
    throw new Error(`API ${r.status}: ${r.data?.error || "respuesta inválida"}`);
  }
  const d = r.data.data;
  const mediaUrl = d.video || d.audio;
  if (!mediaUrl) throw new Error("El API no devolvió un enlace de video.");
  return {
    title: d.title || "YouTube Video",
    duration: d.duration || 0,
    thumbnail: d.thumbnail || "",
    url: mediaUrl
  };
}

async function downloadToTmp(fileUrl, nameBase = "ytv"){
  const tmpDir = path.resolve("./tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const filePath = path.join(tmpDir, `${nameBase}-${Date.now()}.mp4`);
  const resp = await axios.get(fileUrl, { responseType: "stream", timeout: 120000 });
  await streamPipeline(resp.data, fs.createWriteStream(filePath));
  return filePath;
}

async function sendVideo(conn, job, mode, quoted){
  const { chatId, videoUrl, title, durationTxt } = job;

  // Descarga local (sin límites)
  const filePath = await downloadToTmp(videoUrl, "ytmp4");

  const payload = {
    [mode === "document" ? "document" : "video"]: fs.readFileSync(filePath),
    mimetype: "video/mp4",
    fileName: `${title}.mp4`,
  };
  if (mode !== "document") {
    payload.caption =
`⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 𝗩𝗶𝗱𝗲𝗼 — 𝗹𝗶𝘀𝘁𝗼

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}
✦ 𝗗𝘂𝗿𝗮𝗰𝗶𝗼́𝗻: ${durationTxt}
✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click

🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`;
  }

  await conn.sendMessage(chatId, payload, { quoted });
  try { fs.unlinkSync(filePath); } catch {}

  await conn.sendMessage(chatId, { react: { text: "✅", key: quoted.key } });
}

const handler = async (msg, { conn, args, usedPrefix, command }) => {
  const chatId = msg.key.remoteJid;
  const url  = (args.join(" ") || "").trim();
  const pref = usedPrefix || (global.prefixes?.[0] || ".");

  if (!url) {
    return conn.sendMessage(chatId, {
      text: `✳️ 𝙐𝙨𝙖:\n${pref}${command} <url>\nEj: ${pref}${command} https://youtu.be/xxxxxx`
    }, { quoted: msg });
  }
  if (!isYouTube(url)) {
    return conn.sendMessage(chatId, { text: "❌ 𝙐𝙍𝙇 𝙙𝙚 𝙔𝙤𝙪𝙏𝙪𝙗𝙚 𝙞𝙣𝙫𝙖́𝙡𝙞𝙙𝙖." }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏱️", key: msg.key } });

    // 1) Llama a tu Sky API
    const info = await callSkyYTVideo(url);

    // 2) Banner + instrucciones
    const preview = await conn.sendMessage(chatId, {
      image: info.thumbnail ? { url: info.thumbnail } : undefined,
      caption:
`⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 — 𝘃𝗶𝗱𝗲𝗼 𝗽𝗿𝗲𝗽𝗮𝗿𝗮𝗱𝗼

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${info.title}
✦ 𝗗𝘂𝗿𝗮𝗰𝗶𝗼́𝗻: ${info.duration ? fmtSec(info.duration) : "—"}

🎮 *Elige cómo enviarlo:*
• 👍 𝗩𝗶𝗱𝗲𝗼
• ❤️ 𝗗𝗼𝗰𝘂𝗺𝗲𝗻𝘁𝗼 (mp4)
o responde: *1* = video, *2* = documento

✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click
────────────
🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`
    }, { quoted: msg });

    // 3) guardar job para las reacciones / respuestas
    pendingYT4[preview.key.id] = {
      chatId,
      videoUrl: info.url,
      title: info.title,
      durationTxt: info.duration ? fmtSec(info.duration) : "—"
    };

    // 4) listener: reacciones + números
    if (!conn._ytmp4ReactListener) {
      conn._ytmp4ReactListener = true;

      conn.ev.on("messages.upsert", async ev => {
        for (const m of ev.messages) {
          // Reacciones
          if (m.message?.reactionMessage) {
            const { key: reactKey, text: emoji } = m.message.reactionMessage;
            const job = pendingYT4[reactKey?.id];
            if (job) {
              const mode = emoji === "❤️" ? "document" : (emoji === "👍" ? "video" : null);
              if (mode) {
                try { await sendVideo(conn, job, mode, m); }
                catch (e) {
                  await conn.sendMessage(job.chatId, { text: `❌ Error: ${e?.message || e}` }, { quoted: m });
                }
              }
            }
          }

          // Respuestas con texto (citadas al banner)
          try {
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const quotedId = ctx?.stanzaId;
            const job = quotedId ? pendingYT4[quotedId] : null;
            if (job) {
              const txt = (
                m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                ""
              ).trim().toLowerCase();

              let mode = null;
              if (txt === "1" || (txt.includes("video") && !txt.includes("doc"))) mode = "video";
              else if (txt === "2" || txt.includes("doc")) mode = "document";

              if (mode) {
                try { await sendVideo(conn, job, mode, m); }
                catch (e) {
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

    // 5) expira en 5 min
    setTimeout(() => { delete pendingYT4[preview.key.id]; }, 5 * 60 * 1000);

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  } catch (err) {
    console.error("ytmp4 react (Sky) error:", err?.message || err);
    await conn.sendMessage(chatId, { text: `❌ ${err?.message || "Error procesando el enlace."}` }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

handler.command = ["ytmp4","ytv"];
module.exports = handler;
