// commands/play.js — Sky API (sin límites) + reacciones/respuestas
const axios = require("axios");
const yts = require("yt-search");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { promisify } = require("util");
const { pipeline } = require("stream");
const streamPipe = promisify(pipeline);

// Sky API
const API_BASE = process.env.API_BASE || "https://api-sky.ultraplus.click";
const API_KEY  = process.env.API_KEY  || "Russellxz";

// Almacena tareas pendientes por previewMessageId
const pending = {};

// --- helper Sky API ---
async function skyYT(url, format) {
  const { data, status } = await axios.get(`${API_BASE}/api/download/yt.php`, {
    params: { url, format }, // 'audio' | 'video'
    headers: { Authorization: `Bearer ${API_KEY}` },
    timeout: 60000,
    validateStatus: s => s >= 200 && s < 600
  });
  if (status !== 200 || !data || data.status !== "true" || !data.data) {
    throw new Error(data?.error || `HTTP ${status}`);
  }
  return data.data; // { title, thumbnail, duration, audio?, video? }
}

// Utilidad: descarga a disco y devuelve ruta
async function downloadToFile(url, filePath) {
  const res = await axios.get(url, { responseType: "stream" });
  await streamPipe(res.data, fs.createWriteStream(filePath));
  return filePath;
}

module.exports = async (msg, { conn, text }) => {
  const subID = (conn.user.id || "").split(":")[0] + "@s.whatsapp.net";
  const pref = (() => {
    try {
      const p = JSON.parse(fs.readFileSync("prefixes.json", "utf8"));
      return p[subID] || ".";
    } catch {
      return ".";
    }
  })();

  if (!text) {
    return conn.sendMessage(
      msg.key.remoteJid,
      { text: `✳️ Usa:\n${pref}play <término>\nEj: *${pref}play* bad bunny diles` },
      { quoted: msg }
    );
  }

  // reacción de carga
  await conn.sendMessage(msg.key.remoteJid, {
    react: { text: "⏳", key: msg.key }
  });

  // búsqueda
  const res = await yts(text);
  const video = res.videos?.[0];
  if (!video) {
    return conn.sendMessage(
      msg.key.remoteJid,
      { text: "❌ Sin resultados." },
      { quoted: msg }
    );
  }

  const { url: videoUrl, title, timestamp: duration, views, author, thumbnail } = video;
  const viewsFmt = (views || 0).toLocaleString();

  const caption = `
╔═══════════════╗
║✦ 𝘼𝙕𝙐𝙍𝘼 SUBBOTS✦
╚═══════════════╝
📀 Info del video:
╭───────────────╮
├ 🎼 Título: ${title}
├ ⏱️ Duración: ${duration}
├ 👁️ Vistas: ${viewsFmt}
├ 👤 Autor: ${author?.name || author || "Desconocido"}
└ 🔗 Link: ${videoUrl}
╰───────────────╯
📥 Opciones de Descarga (reacciona o responde):
┣ 👍 Audio MP3     (1 / audio)
┣ ❤️ Video MP4     (2 / video)
┣ 📄 Audio Doc     (4 / audiodoc)
┗ 📁 Video Doc     (3 / videodoc)

✦ Source: api-sky.ultraplus.click
═════════════════════
   𖥔 Azura SUBBOTS 𖥔
═════════════════════`.trim();

  // envía preview
  const preview = await conn.sendMessage(
    msg.key.remoteJid,
    { image: { url: thumbnail }, caption },
    { quoted: msg }
  );

  // guarda trabajo
  pending[preview.key.id] = {
    chatId: msg.key.remoteJid,
    videoUrl,
    title,
    commandMsg: msg,
    done: { audio: false, video: false, audioDoc: false, videoDoc: false }
  };

  // confirmación
  await conn.sendMessage(msg.key.remoteJid, {
    react: { text: "✅", key: msg.key }
  });

  // listener único
  if (!conn._playproListener) {
    conn._playproListener = true;
    conn.ev.on("messages.upsert", async ev => {
      for (const m of ev.messages) {
        // 1) REACCIONES
        if (m.message?.reactionMessage) {
          const { key: reactKey, text: emoji } = m.message.reactionMessage;
          const job = pending[reactKey.id];
          if (job) {
            await handleDownload(conn, job, emoji, job.commandMsg);
          }
        }

        // 2) RESPUESTAS CITADAS (1/2/3/4)
        try {
          const context = m.message?.extendedTextMessage?.contextInfo;
          const citado = context?.stanzaId;
          const texto = (
            m.message?.conversation?.toLowerCase() ||
            m.message?.extendedTextMessage?.text?.toLowerCase() ||
            ""
          ).trim();
          const job = pending[citado];
          const chatId = m.key.remoteJid;
          if (citado && job) {
            // AUDIO
            if (["1", "audio", "4", "audiodoc"].includes(texto)) {
              const docMode = ["4", "audiodoc"].includes(texto);
              await conn.sendMessage(chatId, { react: { text: docMode ? "📄" : "🎵", key: m.key } });
              await conn.sendMessage(chatId, { text: `🎶 Descargando audio...` }, { quoted: m });
              await downloadAudio(conn, job, docMode, m);
            }
            // VIDEO
            else if (["2", "video", "3", "videodoc"].includes(texto)) {
              const docMode = ["3", "videodoc"].includes(texto);
              await conn.sendMessage(chatId, { react: { text: docMode ? "📁" : "🎬", key: m.key } });
              await conn.sendMessage(chatId, { text: `🎥 Descargando video...` }, { quoted: m });
              await downloadVideo(conn, job, docMode, m);
            }
            // AYUDA
            else {
              await conn.sendMessage(chatId, {
                text: `⚠️ Opciones válidas:\n1/audio, 4/audiodoc → audio\n2/video, 3/videodoc → video`
              }, { quoted: m });
            }

            // elimina de pending después de 5 minutos
            if (!job._timer) {
              job._timer = setTimeout(() => delete pending[citado], 5 * 60 * 1000);
            }
          }
        } catch (e) {
          console.error("Error en detector citado:", e);
        }
      }
    });
  }
};

async function handleDownload(conn, job, choice, quotedMsg) {
  const mapping = {
    "👍": "audio",
    "❤️": "video",
    "📄": "audioDoc",
    "📁": "videoDoc"
  };
  const key = mapping[choice];
  if (key) {
    const isDoc = key.endsWith("Doc");
    await conn.sendMessage(job.chatId, { text: `⏳ Descargando ${isDoc ? "documento" : key}…` }, { quoted: job.commandMsg });
    if (key.startsWith("audio")) await downloadAudio(conn, job, isDoc, job.commandMsg);
    else await downloadVideo(conn, job, isDoc, job.commandMsg);
  }
}

async function downloadAudio(conn, job, asDocument, quoted) {
  const { chatId, videoUrl, title } = job;

  // Sky API (audio)
  const d = await skyYT(videoUrl, "audio");
  const mediaUrl = d.audio || d.video; // fallback si upstream solo da video
  if (!mediaUrl) throw new Error("No se pudo obtener audio");

  // Descarga + (si no es mp3) convertir a MP3
  const tmp = path.join(__dirname, "../tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

  const urlPath = new URL(mediaUrl).pathname || "";
  const ext = (urlPath.split(".").pop() || "bin").toLowerCase();
  const isMp3 = ext === "mp3";

  const inFile  = path.join(tmp, `${Date.now()}_in.${ext}`);
  await downloadToFile(mediaUrl, inFile);

  let outFile = inFile;
  if (!isMp3) {
    const tryOut = path.join(tmp, `${Date.now()}_out.mp3`);
    try {
      await new Promise((resolve, reject) =>
        ffmpeg(inFile)
          .audioCodec("libmp3lame")
          .audioBitrate("128k")
          .format("mp3")
          .save(tryOut)
          .on("end", resolve)
          .on("error", reject)
      );
      outFile = tryOut;
      try { fs.unlinkSync(inFile); } catch {}
    } catch {
      outFile = inFile; // si falla la conversión, enviamos el original
    }
  }

  const buffer = fs.readFileSync(outFile);
  await conn.sendMessage(chatId, {
    [asDocument ? "document" : "audio"]: buffer,
    mimetype: "audio/mpeg",
    fileName: `${title}.mp3`
  }, { quoted });

  try { fs.unlinkSync(outFile); } catch {}
}

async function downloadVideo(conn, job, asDocument, quoted) {
  const { chatId, videoUrl, title } = job;

  // Sky API (video)
  const d = await skyYT(videoUrl, "video");
  const mediaUrl = d.video || d.audio; // fallback
  if (!mediaUrl) throw new Error("No se pudo obtener video");

  // Descarga
  const tmp = path.join(__dirname, "../tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  const file = path.join(tmp, `${Date.now()}_vid.mp4`);
  await downloadToFile(mediaUrl, file);

  // Enviar (SIN límite propio)
  await conn.sendMessage(chatId, {
    [asDocument ? "document" : "video"]: fs.readFileSync(file),
    mimetype: "video/mp4",
    fileName: `${title}.mp4`,
    caption: asDocument ? undefined : `🎬 Aquí tiene su video.\n✦ Source: api-sky.ultraplus.click\n© Azura SUBBOTS`
  }, { quoted });

  try { fs.unlinkSync(file); } catch {}
}

module.exports.command = ["play"];
