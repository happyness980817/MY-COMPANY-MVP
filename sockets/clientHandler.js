import { ensureRoom } from "../services/room.js";
import {
  addUserItem,
} from "../services/ai.js";

export async function handleClientMessage(socket, io, openai, model, text) {
  const data = socket.data || {};
  const sName = data.name;
  const sCode = data.code;
  const sRole = data.role;
  if (sRole !== "client" || !sCode || !text) return;

  const room = ensureRoom(sCode);
  const { conversationId } = room;

  io.to(sCode).emit("message", {
    name: sName,
    role: "client",
    text,
    ts: Date.now(),
  });

  room.lastClientText = text;

  try {
    if (!conversationId) return;

    await addUserItem(openai, conversationId, text);
  } catch (e) {
    console.error("client_message addUserItem error:", e);
    if (room.counselorId) {
      const msg = e && e.message ? e.message : "AI 응답 생성 오류";
      io.to(room.counselorId).emit("ai_error", { message: msg });
    }
  }
}
