// commands/ytmp3.react.js — YT → MP3 con reacciones (Sky API)
// 👍 audio  | ❤️ documento (mp3)
// 1 → audio | 2 → documento
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
const { promisify } = require("util");
const { pipeline } = require("stream");
const streamPipeline = promisify(pipeline);

const API_BASE = process.env.API_BASE || "https://api-sky.ultraplus.click";
const API_KEY  = process.env.API_KEY  || "Russellxz";

const pendingYT = Object.create(null);
const isYouTube = (u="") => /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(u);

function prefixFor(conn, fallback="."){
  try {
    const rawID = conn.user?.id || "";
    const subbotID = rawID.split(":")[0] + "@s.whatsapp.net";
    const p = JSON.parse(fs.readFileSync(path.resolve("prefixes.json"), "utf8"));
    return p[subbotID] || fallback;
  } catch { return fallback; }
}

function fmtSec(s){
  const n = Number(s||0);
  const h = Math.floor(n/3600), m = Math.floor((n%3600)/60), sec = n%60;
  return (h?`${h}:`:"")+`${m.toString().padStart(2,"0")}:${sec.toString().padStart(2,"0")}`;
}

async function callSkyYT(url){
  const { data: api, status } = await axios.get(
    `${API_BASE}/api/download/yt.php`,
    {
      params: { url, format: "audio" },
      headers: { Authorization: `Bearer ${API_KEY}` },
      timeout: 30000,
      validateStatus: s => s >= 200 && s < 600
    }
  );
  if (status !== 200 || !api || api.status !== "true" || !api.data?.audio) {
    throw new Error(api?.error || `HTTP ${status}`);
  }
  return api.data; // { title, audio, thumbnail, duration, ... }
}

async function toMp3File(fromUrl, title="audio"){
  const tmp = path.join(__dirname, "../tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

  // nombre base
  const inExtGuess = /\.mp3($|\?)/i.test(fromUrl) ? "mp3" :
                     /\.m4a($|\?)/i.test(fromUrl) ? "m4a" :
                     /\.webm($|\?)/i.test(fromUrl) ? "webm" : "bin";
  const inFile  = path.join(tmp, `${Date.now()}_in.${inExtGuess}`);
  const outFile = path.join(tmp, `${Date.now()}_out.mp3`);

  // descarga fuente
  const res = await axios.get(fromUrl, { responseType: "stream", timeout: 120000 });
  await streamPipeline(res.data, fs.createWriteStream(inFile));

  // si ya es mp3, no recodificamos
  if (inExtGuess === "mp3") {
    return { filePath: inFile, fileName: `${title}.mp3`, cleanup: [inFile] };
  }

  // convierte a mp3 (128k)
  await new Promise((resolve, reject) => {
    ffmpeg(inFile)
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .format("mp3")
      .save(outFile)
      .on("end", resolve)
      .on("error", reject);
  });

  // limpia el original y devuelve el resultado
  try { fs.unlinkSync(inFile); } catch {}
  return { filePath: outFile, fileName: `${title}.mp3`, cleanup: [outFile] };
}

async function sendAudio(conn, job, mode, quoted){
  const { audioUrl, title, durationTxt, chatId } = job;

  // 1) convertir/normalizar a mp3 (sin límites)
  const { filePath, fileName, cleanup } = await toMp3File(audioUrl, title);

  // 2) enviar como audio o documento
  if (mode === "document") {
    await conn.sendMessage(chatId, {
      document: fs.readFileSync(filePath),
      mimetype: "audio/mpeg",
      fileName,
      caption:
`🎵 𝗬𝗧 𝗠𝗣𝟯 — 𝗹𝗶𝘀𝘁𝗼

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}
✦ 𝗗𝘂𝗿𝗮𝗰𝗶𝗼́𝗻: ${durationTxt}
✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click

🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`
    }, { quoted });
  } else {
    await conn.sendMessage(chatId, {
      audio: fs.readFileSync(filePath),
      mimetype: "audio/mpeg",
      fileName
    }, { quoted });
    // banner aparte (audio no admite caption en todos los clientes)
    await conn.sendMessage(chatId, {
      text:
`🎵 𝗬𝗧 𝗠𝗣𝟯 — 𝗹𝗶𝘀𝘁𝗼

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}
✦ 𝗗𝘂𝗿𝗮𝗰𝗶𝗼́𝗻: ${durationTxt}
✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click

🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`
    }, { quoted });
  }

  // 3) cleanup + reacción OK
  try { cleanup.forEach(f => fs.existsSync(f) && fs.unlinkSync(f)); } catch {}
  await conn.sendMessage(chatId, { react: { text: "✅", key: quoted.key } });
}

const handler = async (msg, { conn, text, usedPrefix, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = prefixFor(conn, usedPrefix || ".");

  if (!text || !isYouTube(text)) {
    return conn.sendMessage(chatId, {
      text:
`✳️ 𝙐𝙨𝙤 𝙘𝙤𝙧𝙧𝙚𝙘𝙩𝙤:
${pref}${command} <enlace de YouTube>

📌 𝙀𝙟𝙚𝙢𝙥𝙡𝙤:
${pref}${command} https://youtu.be/dQw4w9WgXcQ`
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  try {
    // 1) Sky API
    const d = await callSkyYT(text);
    const title = d.title || "YouTube";
    const durationTxt = d.duration ? fmtSec(d.duration) : "—";
    const thumb = d.thumbnail || "";
    const audioUrl = d.audio;

    // 2) banner + instrucciones de reacción/número
    const preview = await conn.sendMessage(chatId, {
      image: thumb ? { url: thumb } : undefined,
      caption:
`⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 — 𝗮𝘂𝗱𝗶𝗼 𝗽𝗿𝗲𝗽𝗮𝗿𝗮𝗱𝗼

✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}
✦ 𝗗𝘂𝗿𝗮𝗰𝗶𝗼́𝗻: ${durationTxt}

🎮 *Elige cómo enviarlo:*
• 👍 𝘼𝙪𝙙𝙞𝙤 (mp3)
• ❤️ 𝘿𝙤𝙘𝙪𝙢𝙚𝙣𝙩𝙤 (mp3)
o responde: *1* = audio, *2* = documento

✦ 𝗦𝗼𝘂𝗿𝗰𝗲: api-sky.ultraplus.click
────────────
🤖 𝙎𝙪𝙠𝙞 𝘽𝙤𝙩`
    }, { quoted: msg });

    // 3) guardar job
    pendingYT[preview.key.id] = {
      chatId,
      title,
      durationTxt,
      audioUrl
    };

    // 4) listener único: reacciones y números
    if (!conn._ytmp3ReactListener) {
      conn._ytmp3ReactListener = true;

      conn.ev.on("messages.upsert", async ev => {
        for (const m of ev.messages) {
          // a) Reacciones
          if (m.message?.reactionMessage) {
            const { key: reactKey, text: emoji } = m.message.reactionMessage;
            const job = pendingYT[reactKey?.id];
            if (job) {
              const mode = emoji === "❤️" ? "document" : (emoji === "👍" ? "audio" : null);
              if (mode) {
                try { await sendAudio(conn, job, mode, m); }
                catch (e) {
                  await conn.sendMessage(job.chatId, { text: `❌ Error: ${e?.message || e}` }, { quoted: m });
                }
              }
            }
          }

          // b) Respuesta citando el banner
          try {
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const quotedId = ctx?.stanzaId;
            const job = quotedId ? pendingYT[quotedId] : null;
            if (job) {
              const txt = (
                m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                ""
              ).trim().toLowerCase();

              let mode = null;
              if (txt === "1" || txt.includes("audio") && !txt.includes("doc")) mode = "audio";
              else if (txt === "2" || txt.includes("doc")) mode = "document";

              if (mode) {
                try { await sendAudio(conn, job, mode, m); }
                catch (e) {
                  await conn.sendMessage(job.chatId, { text: `❌ Error: ${e?.message || e}` }, { quoted: m });
                }
              } else {
                await conn.sendMessage(job.chatId, {
                  text: "⚠️ *Opciones válidas:* 1=audio, 2=documento (o reacciona 👍 / ❤️)"
                }, { quoted: m });
              }
            }
          } catch {}
        }
      });
    }

    // 5) auto-expira en 5 min
    setTimeout(() => { delete pendingYT[preview.key.id]; }, 5 * 60 * 1000);

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  } catch (err) {
    console.error("❌ ytmp3 react (Sky):", err?.message || err);
    await conn.sendMessage(chatId, {
      text: `❌ *Error:* ${err?.message || "Fallo al procesar el audio."}`
    }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

handler.command = ["ytmp3","yta"];
module.exports = handler;
