// commands/facebook.js — Sky API + elección (👍/❤️ o 1/2) sin límites
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Sky API
const API_BASE = process.env.API_BASE || "https://api-sky.ultraplus.click";
const SKY_API_KEY = process.env.SKY_API_KEY || "Russellxz";

// Pendientes por mensaje preview
const pending = {};

// --- helpers ---
async function callSkyFacebook(url) {
  const headers = { Authorization: `Bearer ${SKY_API_KEY}` };

  // 1) endpoint .js
  try {
    const r = await axios.get(`${API_BASE}/api/download/facebook`, {
      params: { url },
      headers,
      timeout: 30000,
      validateStatus: s => s >= 200 && s < 600
    });
    if ((r.data?.status === "true" || r.data?.status === true) && r.data?.data) return r.data.data;
  } catch (_) {}

  // 2) fallback .php
  const r2 = await axios.get(`${API_BASE}/api/download/facebook.php`, {
    params: { url },
    headers,
    timeout: 30000,
    validateStatus: s => s >= 200 && s < 600
  });
  if ((r2.data?.status === "true" || r2.data?.status === true) && r2.data?.data) return r2.data.data;

  const err = r2.data?.error || `HTTP ${r2.status || "?"}`;
  throw new Error(`Sky API fallo: ${err}`);
}

async function downloadToTmp(fileUrl, nameHint = "fb") {
  const tmpDir = path.resolve("./tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `${nameHint}-${Date.now()}.mp4`);

  const res = await axios.get(fileUrl, { responseType: "stream", timeout: 120000 });
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(filePath);
    res.data.pipe(w);
    w.on("finish", resolve);
    w.on("error", reject);
  });
  return filePath;
}

function fmtDur(s) {
  const n = Number(s || 0);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return (h ? `${h}:` : "") + `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

// --- handler ---
const handler = async (msg, { conn, args, command, usedPrefix }) => {
  const chatId = msg.key.remoteJid;
  const text = (args.join(" ") || "").trim();
  const pref = global.prefixes?.[0] || usedPrefix || ".";

  if (!text) {
    return conn.sendMessage(chatId, {
      text: `✳️ Ejemplo de uso:\n${pref}${command} https://fb.watch/ncowLHMp-x/`
    }, { quoted: msg });
  }

  if (!/(facebook\.com|fb\.watch)/i.test(text)) {
    return conn.sendMessage(chatId, {
      text: `❌ Enlace de Facebook inválido.\n\n📌 Ejemplo:\n${pref}${command} https://fb.watch/ncowLHMp-x/`
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  try {
    // 1) Llama a Sky API y arma datos
    const d = await callSkyFacebook(text);
    const videoUrl = d.video_hd || d.video_sd;
    if (!videoUrl) {
      return conn.sendMessage(chatId, { text: "🚫 No se pudo obtener el video." }, { quoted: msg });
    }

    const resos = [
      d.video_hd ? "HD" : null,
      d.video_sd ? (d.video_hd ? "SD (alt)" : "SD") : null,
    ].filter(Boolean).join(" · ") || "Auto";

    // 2) Banner + instrucciones
    const caption =
`⚡ 𝗙𝗮𝗰𝗲𝗯𝗼𝗼𝗸 — 𝗩𝗶𝗱𝗲𝗼 𝗽𝗿𝗲𝗽𝗮𝗿𝗮𝗱𝗼

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${d.title || "Facebook Video"}
✦ 𝗗𝘂𝗿𝗮𝗰𝗶𝗼́𝗻: ${d.duration ? fmtDur(d.duration) : "—"}
✦ 𝗥𝗲𝘀𝗼𝗹𝘂𝗰𝗶𝗼́𝗻: ${resos}

Elige modo de envío:
• 👍  Video normal      • ❤️  Video como documento
• Responde: 1 (video)  • 2 (video-doc)

✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click
────────────
🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`;

    const preview = await conn.sendMessage(
      chatId,
      { image: d.thumbnail ? { url: d.thumbnail } : undefined, caption },
      { quoted: msg }
    );

    // 3) Guardar job pendiente
    pending[preview.key.id] = {
      chatId,
      videoUrl,
      title: d.title || "Facebook Video",
      commandMsg: msg
    };

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    // 4) Listener para reacciones / respuestas
    if (!conn._fbSkyListener) {
      conn._fbSkyListener = true;

      conn.ev.on("messages.upsert", async ev => {
        for (const m of ev.messages) {
          // Reacciones
          if (m.message?.reactionMessage) {
            const { key: reactKey, text: emoji } = m.message.reactionMessage;
            const job = pending[reactKey.id];
            if (job) {
              if (emoji === "👍") await sendVideo(conn, job, false);
              if (emoji === "❤️") await sendVideo(conn, job, true);
            }
          }

          // Respuestas citadas
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
            console.error("fb listener error:", e?.message || e);
          }
        }
      });
    }

  } catch (err) {
    console.error("FB Sky error:", err?.message || err);
    await conn.sendMessage(chatId, {
      text: "❌ Ocurrió un error al procesar el enlace de Facebook."
    }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
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

    const file = await downloadToTmp(job.videoUrl, "fb");
    await conn.sendMessage(job.chatId, {
      [asDocument ? "document" : "video"]: fs.readFileSync(file),
      mimetype: "video/mp4",
      fileName: `${job.title}.mp4`,
      caption: asDocument ? undefined :
`🎬 𝗙𝗕 𝗩𝗶𝗱𝗲𝗼 — 𝗟𝗶𝘀𝘁𝗼
✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click
© Azura SUBBOTS`
    }, { quoted: job.commandMsg });

    try { fs.unlinkSync(file); } catch {}
  } catch (e) {
    console.error("sendVideo error:", e?.message || e);
    await conn.sendMessage(job.chatId, { text: "❌ Error enviando el video." }, { quoted: job.commandMsg });
  }
}

handler.command = ["facebook", "fb"];
module.exports = handler;
