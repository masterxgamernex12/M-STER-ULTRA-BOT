const handler = async (msg, { conn }) => {
  const ownerNumber = "55272588492827@s.whatsapp.net"; // Número del creador
  const ownerName = "wilker s 🤖"; // Nombre visible del creador

  const messageText = `📞 *Contacto del Creador del Subbot:*

Si tienes dudas, preguntas o sugerencias sobre el funcionamiento de *Azura Ultra 2.0 Subbot*, puedes contactar a su creador.

📌 *Nombre:* wilker
📌 *Número:* +5492644138998
💬 *Toca el contacto para enviarle un mensaje directo.`;

  // Enviar contacto vCard
  await conn.sendMessage(msg.key.remoteJid, {
    contacts: {
      displayName: ownerName,
      contacts: [
        {
          vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${ownerName}\nTEL;waid=${ownerNumber.split('@')[0]}:+${ownerNumber.split('@')[0]}\nEND:VCARD`
        }
      ]
    }
  });

  // Enviar texto informativo
  await conn.sendMessage(msg.key.remoteJid, {
    text: messageText
  }, { quoted: msg });
};

handler.command = ['creador'];
module.exports = handler;
