import { ensureRoom } from "../services/roomService.js";

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
    if (conversationId) {
      await openai.conversations.items.create(conversationId, {
        items: [
          {
            role: "user",
            content: [{ type: "input_text", text }],
          },
        ],
      });
    }

    if (conversationId && room.counselorId) {
      const resp = await openai.responses.create({
        model,
        instructions: process.env.INSTRUCTION_STRING,
        conversation: { id: conversationId },
        input: [
          {
            role: "user",
            content: `내담자 최신 메시지 참조: """${text}"""`,
          },
          {
            role: "developer",
            content: process.env.DEV_INSTRUCTION_STRING,
          },
        ],
        store: true,
      });

      const draft = resp && resp.output_text ? resp.output_text : "(응답 생성 실패)";

      await openai.conversations.items.create(conversationId, {
        items: [
          {
            role: "assistant",
            content: [{ type: "output_text", text: draft }],
          },
        ],
      });

      io.to(room.counselorId).emit("ai_draft", {
        text: draft,
        ts: Date.now(),
      });
    }
  } catch (e) {
    console.error("client_message AI error:", e);
    if (room.counselorId) {
      const msg = e && e.message ? e.message : "AI 응답 생성 오류";
      io.to(room.counselorId).emit("ai_error", { message: msg });
    }
  }
}
