const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");

  // ⏳ Reacción inicial
  await conn.sendMessage(chatId, {
    react: { text: "⏳", key: msg.key }
  });

  if (!isGroup) {
    await conn.sendMessage(chatId, {
      react: { text: "❌", key: msg.key }
    });
    return conn.sendMessage(chatId, {
      text: "🚫 Este comando solo se puede usar en grupos."
    }, { quoted: msg });
  }

  const metadata = await conn.groupMetadata(chatId);
  const sender = msg.key.participant || msg.key.remoteJid;
  const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
  const botId = conn.user.id.split(":")[0] + "@s.whatsapp.net";

  if (!admins.includes(sender)) {
    await conn.sendMessage(chatId, {
      react: { text: "❌", key: msg.key }
    });
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los administradores pueden usar este comando."
    }, { quoted: msg });
  }

  if (!admins.includes(botId)) {
    await conn.sendMessage(chatId, {
      react: { text: "❌", key: msg.key }
    });
    return conn.sendMessage(chatId, {
      text: "⚠️ Yo también necesito ser administrador para expulsar gente."
    }, { quoted: msg });
  }

  const nonAdmins = metadata.participants
    .filter(p => !admins.includes(p.id) && p.id !== botId)
    .map(p => p.id);

  if (nonAdmins.length === 0) {
    await conn.sendMessage(chatId, {
      react: { text: "⚠️", key: msg.key }
    });
    return conn.sendMessage(chatId, {
      text: "✅ No hay miembros que se puedan expulsar."
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, {
    text: `🧨 Expulsando ${nonAdmins.length} miembros...`,
    quoted: msg
  });

  for (const user of nonAdmins) {
    try {
      await conn.groupParticipantsUpdate(chatId, [user], "remove");
      await new Promise(r => setTimeout(r, 1000)); // Espera 1 segundo
    } catch (e) {
      console.error(`❌ Error al expulsar a ${user}:`, e.message);
    }
  }

  await conn.sendMessage(chatId, {
    react: { text: "✅", key: msg.key }
  });

  return conn.sendMessage(chatId, {
    text: "🚪 Todos los miembros no administradores fueron expulsados."
  }, { quoted: msg });
};

handler.command = ["kickall"];
module.exports = handler;
