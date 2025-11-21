import { ensureRoom } from "../roomsController.js";

export async function handleCounselorGenerate(socket, io, openai, model) {
  const data = socket.data || {};
  const sCode = data.code;
  const sRole = data.role;
  if (sRole !== "counselor" || !sCode) return;

  const room = ensureRoom(sCode);
  const { conversationId, lastClientText } = room;

  if (!lastClientText) {
    if (room.counselorId)
      io.to(room.counselorId).emit("ai_error", {
        message: "생성할 내담자 발화가 없습니다.",
      });
    return;
  }
  if (!conversationId) {
    if (room.counselorId)
      io.to(room.counselorId).emit("ai_error", {
        message: "대화가 준비되지 않았습니다.",
      });
    return;
  }

  try {
    const resp = await openai.responses.create({
      model,
      instructions: process.env.INSTRUCTION_STRING,
      conversation: { id: conversationId },
      input: [
        {
          role: "user",
          content: `내담자 최신 메시지 참조: """${lastClientText}"""`,
        },
        {
          role: "developer",
          content: process.env.DEV_INSTRUCTION_STRING,
        },
      ],
      store: true,
    });

    const draft = resp && resp.output_text ? resp.output_text : "(응답 생성 실패)";

    try {
      await openai.conversations.items.create(conversationId, {
        items: [
          {
            role: "assistant",
            content: [{ type: "output_text", text: draft }],
          },
        ],
      });
    } catch (e2) {
      console.error("Add assistant item error:", e2);
    }

    if (room.counselorId)
      io.to(room.counselorId).emit("ai_draft", {
        text: draft,
        ts: Date.now(),
      });
  } catch (err) {
    const msg = err.message || "AI 응답 생성 오류";
    if (room.counselorId) io.to(room.counselorId).emit("ai_error", { message: msg });
    console.error(err);
  }
}

export async function handleCounselorRefine(socket, io, openai, model, payload) {
  const data = socket.data || {};
  const sName = data.name;
  const sCode = data.code;
  const sRole = data.role;
  const instruction = payload && payload.instruction;
  if (sRole !== "counselor" || !sCode || !instruction) return;

  const room = ensureRoom(sCode);
  const { conversationId, lastClientText } = room;
  if (!conversationId) {
    if (room.counselorId)
      io.to(room.counselorId).emit("ai_error", {
        message: "대화가 준비되지 않았습니다.",
      });
    return;
  }

  try {
    await openai.conversations.items.create(conversationId, {
      items: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `상담사 지시: """${instruction}"""`,
            },
          ],
        },
      ],
    });

    const resp = await openai.responses.create({
      model,
      instructions: `${process.env.INSTRUCTION_STRING} 상담사의 피드백을 반영해 2~4문장으로 개선하세요.`,
      conversation: { id: conversationId },
      input: [
        {
          role: "user",
          content: `내담자 메시지: """${lastClientText || ""}"""`,
        },
        {
          role: "developer",
          content: process.env.DEV_INSTRUCTION_STRING,
        },
      ],
      store: true,
    });

    const revised = resp && resp.output_text ? resp.output_text : "(수정 실패)";

    try {
      await openai.conversations.items.create(conversationId, {
        items: [
          {
            role: "assistant",
            content: [{ type: "output_text", text: revised }],
          },
        ],
      });
    } catch (e2) {
      console.error("Add assistant item error:", e2);
    }

    if (room.counselorId) {
      io.to(room.counselorId).emit("ai_draft", {
        text: revised,
        ts: Date.now(),
        revisedBy: sName,
      });
    }
  } catch (err) {
    const msg = err.message || "AI 수정 오류";
    if (room.counselorId) io.to(room.counselorId).emit("ai_error", { message: msg });
    console.error(err);
  }
}

export async function handleCounselorSendFinal(socket, io, openai, text) {
  const data = socket.data || {};
  const sName = data.name;
  const sCode = data.code;
  const sRole = data.role;
  if (sRole !== "counselor" || !sCode || !text) return;

  io.to(sCode).emit("message", {
    name: sName,
    role: "counselor",
    text,
    ts: Date.now(),
  });

  const room = ensureRoom(sCode);
  if (room.conversationId) {
    try {
      await openai.conversations.items.create(room.conversationId, {
        items: [
          {
            role: "assistant",
            content: [{ type: "output_text", text }],
          },
        ],
      });
    } catch (e) {
      console.error("Add final assistant item error:", e);
    }
  }
}

