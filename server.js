import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import session from "express-session";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
});
app.use(sessionMiddleware);
io.engine.use((req, res, next) => sessionMiddleware(req, res, next));

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function generateRoomCode(len = 20) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** 방 상태
 * rooms[room] = {
 *   clientId: string|null,
 *   counselorId: string|null,
 *   lastClientText: string,
 *   conversationId: string|null, // conv_...
 * }
 */
const rooms = Object.create(null);
function ensureRoom(room) {
  if (!rooms[room]) {
    rooms[room] = {
      clientId: null,
      counselorId: null,
      lastClientText: "",
      conversationId: null,
    };
  }
  return rooms[room];
}

app.get("/", (_, res) => {
  res.render("home", { title: "상담 플랫폼 – 시작하기" });
});

// 방 생성: 여기서만 Conversation 생성
app.post("/create", async (req, res) => {
  const { role, name } = req.body;
  console.log(req.body);
  if (!role || !name) return res.status(400).send("필수값 누락");

  const code = generateRoomCode(20);
  const room = ensureRoom(code);

  try {
    const conv = await openai.conversations.create({});
    room.conversationId = conv.id;
    if (!room.conversationId) {
      return res.status(500).send("대화 생성 실패");
    }
  } catch (e) {
    console.error("Conversation create error:", e);
    return res.status(500).send("대화를 생성할 수 없습니다.");
  }

  req.session.name = name;
  req.session.role = role;
  req.session.code = code;

  return res.render("code", { title: "방 코드 안내", code, name, role });
});

// 기존 방 입장: Conversation 절대 생성 금지 (없으면 에러)
app.post("/enter", (req, res) => {
  const { role, name, code } = req.body;
  if (!role || !name || !code) return res.status(400).send("필수값 누락");

  const room = rooms[code];
  if (!room) {
    return res.status(404).send("존재하지 않는 방 코드입니다.");
  }
  if (!room.conversationId) {
    // 복구용 생성도 하지 않음: 명시적으로 실패 처리
    return res.status(500).send("이 방의 대화가 준비되지 않았습니다.");
  }

  req.session.name = name;
  req.session.role = role;
  req.session.code = code;

  return res.redirect("/room");
});

app.get("/room", (req, res) => {
  const { name, role, code } = req.session;
  if (!name || !role || !code || !rooms[code]) return res.redirect("/");
  if (role === "client") return res.render("client", { name, room: code, title: "내담자" });
  return res.render("counselor", { name, room: code, title: "상담사" });
});

// ===== Socket =====
io.on("connection", (socket) => {
  const sess = socket.request && socket.request.session ? socket.request.session : null;
  const name = sess && sess.name ? sess.name : undefined;
  const code = sess && sess.code ? sess.code : undefined;
  const role = sess && sess.role ? sess.role : undefined;

  if (name && code && role) {
    socket.data = { name, code, role };
    socket.join(code);
    const room = ensureRoom(code);
    if (role === "client") room.clientId = socket.id;
    if (role === "counselor") room.counselorId = socket.id;
    io.to(code).emit("system", { text: `${name}님(${role})이 입장했습니다.` });
  }

  socket.on("join", () => {});

  // 내담자 메시지 → 화면 브로드캐스트 + Conversation에 user 아이템 적재 + 곧바로 AI 초안 생성
  socket.on("client_message", async (text) => {
    const data = socket.data;
    const sName = data.name;
    const sCode = data.code;
    const sRole = data.role;
    if (sRole !== "client" || !sCode || !text) return;

    const room = ensureRoom(sCode);
    const { conversationId } = room;

    // 1) 본 채팅에 표시
    io.to(sCode).emit("message", {
      name: sName,
      role: "client",
      text,
      ts: Date.now(),
    });

    // 2) 마지막 내담자 발화 저장
    room.lastClientText = text;

    try {
      // 3) 대화 히스토리에 user 아이템 적재
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

      // 4) 바로 AI 응답 생성 (상담사에게만 초안 전달)
      if (conversationId && room.counselorId) {
        const resp = await openai.responses.create({
          model: "gpt-5",
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

        // 5) 초안도 assistant 아이템으로 기록
        await openai.conversations.items.create(conversationId, {
          items: [
            {
              role: "assistant",
              content: [{ type: "output_text", text: draft }],
            },
          ],
        });

        // 6) 상담사 화면의 AI 보조 패널로 전송
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
  });

  // 상담사: "AI 응답 생성" → Conversation 기반 Responses 호출
  socket.on("counselor_generate", async () => {
    const data = socket.data;
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
        model: "gpt-5",
        instructions: process.env.INSTRUCTION_STRING,
        // SDK 버전에 따라 아래 중 하나가 유효합니다.
        conversation: { id: conversationId }, // 보편적
        // conversation_id: conversationId,    // 일부 SDK/버전
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
  });

  // 상담사: 수정 지시 → user 아이템 적재 후 같은 Conversation으로 재생성
  socket.on("counselor_refine", async (payload) => {
    const data = socket.data;
    const sName = data.name;
    const sCode = data.code;
    const sRole = data.role;
    const instruction = payload.instruction;
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
      // 지시를 user 아이템으로 쌓기
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

      // 같은 대화 문맥으로 재생성
      const resp = await openai.responses.create({
        model: "gpt-5",
        instructions: `${process.env.INSTRUCTION_STRING} 상담사의 피드백을 반영해 2~4문장으로 개선하세요.`,
        conversation: { id: conversationId }, // or conversation_id
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

      // 결과도 assistant 아이템으로 쌓기
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
  });

  // 상담사 → 본 채팅 전송(assistant로 기록도 남김)
  socket.on("counselor_send_final", async (text) => {
    const data = socket.data;
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
  });

  socket.on("disconnect", () => {
    const data = socket.data;
    const sName = data.name;
    const sCode = data.code;
    const sRole = data.role;
    if (!sCode) return;
    const room = ensureRoom(sCode);
    if (sRole === "client" && room.clientId === socket.id) room.clientId = null;
    if (sRole === "counselor" && room.counselorId === socket.id) room.counselorId = null;
    io.to(sCode).emit("system", {
      text: `${sName || "익명"}님(${sRole || "알수없음"})이 퇴장했습니다.`,
    });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
