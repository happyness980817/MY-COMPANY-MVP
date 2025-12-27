import { ensureRoom } from "../services/room.js";
import {
  addAssistantItem,
  addUserItem,
  generateDraft,
  refineDraft,
} from "../services/ai.js";

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
    const draft = await generateDraft(openai, {
      model,
      conversationId,
      instructionString: process.env.INSTRUCTION_STRING,
      devInstructionString: process.env.DEV_INSTRUCTION_STRING,
      clientText: lastClientText,
    });

    try {
      await addAssistantItem(openai, conversationId, draft);
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
    if (room.counselorId)
      io.to(room.counselorId).emit("ai_error", { message: msg });
    console.error(err);
  }
}

export async function handleCounselorRefine(
  socket,
  io,
  openai,
  model,
  payload
) {
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
    await addUserItem(
      openai,
      conversationId,
      `상담사 지시: """${instruction}"""`
    );

    const revised = await refineDraft(openai, {
      model,
      conversationId,
      instructionString: process.env.INSTRUCTION_STRING,
      devInstructionString: process.env.DEV_INSTRUCTION_STRING,
      lastClientText: lastClientText || "",
    });

    try {
      await addAssistantItem(openai, conversationId, revised);
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
    if (room.counselorId)
      io.to(room.counselorId).emit("ai_error", { message: msg });
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
      await addAssistantItem(openai, room.conversationId, text);
    } catch (e) {
      console.error("Add final assistant item error:", e);
    }
  }
}
