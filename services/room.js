const rooms = Object.create(null);

function ensureRoom(code) {
  if (!rooms[code]) {
    rooms[code] = {
      clientId: null,
      counselorId: null,
      lastClientText: "",
      conversationId: null,
    };
  }
  return rooms[code];
}

function generateRoomCode(len) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function createConversationId(openai) {
  const conv = await openai.conversations.create({});
  if (!conv || !conv.id) return null;
  return conv.id;
}

export { rooms, ensureRoom, generateRoomCode, createConversationId };

