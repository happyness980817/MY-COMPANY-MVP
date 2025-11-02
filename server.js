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
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++)
    out += chars[Math.floor(Math.random() * chars.length)];
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
  if (!role || !name) return res.status(400).send("필수값 누락");

  const room = generateRoomCode(20);
  const r = ensureRoom(room);

  try {
    const conv = await openai.conversations.create({});
    r.conversationId = conv.id;
    if (!r.conversationId) {
      return res.status(500).send("대화 생성 실패");
    }
  } catch (e) {
    console.error("Conversation create error:", e);
    return res.status(500).send("대화를 생성할 수 없습니다.");
  }

  req.session.name = name;
  req.session.role = role;
  req.session.room = room;

  return res.render("code", { title: "방 코드 안내", code: room, name, role });
});

// 기존 방 입장: Conversation 절대 생성 금지 (없으면 에러)
app.post("/enter", (req, res) => {
  const { role, name, room } = req.body;
  if (!role || !name || !room) return res.status(400).send("필수값 누락");

  const r = rooms[room];
  if (!r) {
    return res.status(404).send("존재하지 않는 방 코드입니다.");
  }
  if (!r.conversationId) {
    // 복구용 생성도 하지 않음: 명시적으로 실패 처리
    return res.status(500).send("이 방의 대화가 준비되지 않았습니다.");
  }

  req.session.name = name;
  req.session.role = role;
  req.session.room = room;

  return res.redirect("/room");
});

app.get("/room", (req, res) => {
  const { name, role, room } = req.session;
  if (!name || !role || !room || !rooms[room]) return res.redirect("/");
  if (role === "client")
    return res.render("client", { name, room, title: "내담자" });
  return res.render("counselor", { name, room, title: "상담사" });
});

// ===== Socket =====
io.on("connection", (socket) => {
  const sess =
    socket.request && socket.request.session ? socket.request.session : null;
  const name = sess && sess.name ? sess.name : undefined;
  const room = sess && sess.room ? sess.room : undefined;
  const role = sess && sess.role ? sess.role : undefined;

  if (name && room && role) {
    socket.data = { name, room, role };
    socket.join(room);
    const r = ensureRoom(room);
    if (role === "client") r.clientId = socket.id;
    if (role === "counselor") r.counselorId = socket.id;
    io.to(room).emit("system", { text: `${name}님(${role})이 입장했습니다.` });
  }

  socket.on("join", () => {});

  // 내담자 메시지 → 화면 브로드캐스트 + Conversation에 user 아이템 적재
  socket.on("client_message", async (text) => {
    const data = socket.data || {};
    const sName = data.name;
    const sRoom = data.room;
    const sRole = data.role;
    if (sRole !== "client" || !sRoom || !text) return;

    const r = ensureRoom(sRoom);

    io.to(sRoom).emit("message", {
      name: sName,
      role: "client",
      text,
      ts: Date.now(),
    });

    r.lastClientText = text;

    try {
      if (r.conversationId) {
        await openai.conversations.items.create(r.conversationId, {
          role: "user",
          content: [{ type: "input_text", text }],
        });
      }
    } catch (e) {
      console.error("Add user item error:", e);
    }
  });

  // 상담사: “AI 응답 생성” → Conversation 기반 Responses 호출
  socket.on("counselor_generate", async () => {
    const data = socket.data;
    const sRoom = data.room;
    const sRole = data.role;
    if (sRole !== "counselor" || !sRoom) return;

    const r = ensureRoom(sRoom);
    const { conversationId, lastClientText } = r;

    if (!lastClientText) {
      if (r.counselorId)
        io.to(r.counselorId).emit("ai_error", {
          message: "생성할 내담자 발화가 없습니다.",
        });
      return;
    }
    if (!conversationId) {
      if (r.counselorId)
        io.to(r.counselorId).emit("ai_error", {
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

      const draft =
        resp && resp.output_text ? resp.output_text : "(응답 생성 실패)";

      try {
        await openai.conversations.items.create(conversationId, {
          role: "assistant",
          content: [{ type: "output_text", text: draft }],
        });
      } catch (e2) {
        console.error("Add assistant item error:", e2);
      }

      if (r.counselorId)
        io.to(r.counselorId).emit("ai_draft", { text: draft, ts: Date.now() });
    } catch (err) {
      const msg = err && err.message ? err.message : "AI 응답 생성 오류";
      if (r.counselorId)
        io.to(r.counselorId).emit("ai_error", { message: msg });
      console.error(err);
    }
  });

  // 상담사: 수정 지시 → user 아이템 적재 후 같은 Conversation으로 재생성
  socket.on("counselor_refine", async (payload) => {
    const data = socket.data;
    const sName = data.name;
    const sRoom = data.room;
    const sRole = data.role;
    const instruction =
      payload && payload.instruction ? payload.instruction : "";
    if (sRole !== "counselor" || !sRoom || !instruction) return;

    const r = ensureRoom(sRoom);
    const { conversationId, lastClientText } = r;
    if (!conversationId) {
      if (r.counselorId)
        io.to(r.counselorId).emit("ai_error", {
          message: "대화가 준비되지 않았습니다.",
        });
      return;
    }

    try {
      // 지시를 user 아이템으로 쌓기
      await openai.conversations.items.create(conversationId, {
        role: "user",
        content: [
          { type: "input_text", text: `상담사 지시: """${instruction}"""` },
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

      const revised =
        resp && resp.output_text ? resp.output_text : "(수정 실패)";

      // 결과도 assistant 아이템으로 쌓기
      try {
        await openai.conversations.items.create(conversationId, {
          role: "assistant",
          content: [{ type: "output_text", text: revised }],
        });
      } catch (e2) {
        console.error("Add assistant item error:", e2);
      }

      if (r.counselorId) {
        io.to(r.counselorId).emit("ai_draft", {
          text: revised,
          ts: Date.now(),
          revisedBy: sName,
        });
      }
    } catch (err) {
      const msg = err && err.message ? err.message : "AI 수정 오류";
      if (r.counselorId)
        io.to(r.counselorId).emit("ai_error", { message: msg });
      console.error(err);
    }
  });

  // 상담사 → 본 채팅 전송(assistant로 기록도 남김)
  socket.on("counselor_send_final", async (text) => {
    const data = socket.data;
    const sName = data.name;
    const sRoom = data.room;
    const sRole = data.role;
    if (sRole !== "counselor" || !sRoom || !text) return;

    io.to(sRoom).emit("message", {
      name: sName,
      role: "counselor",
      text,
      ts: Date.now(),
    });

    const r = ensureRoom(sRoom);
    if (r.conversationId) {
      try {
        await openai.conversations.items.create(r.conversationId, {
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
      } catch (e) {
        console.error("Add final assistant item error:", e);
      }
    }
  });

  socket.on("disconnect", () => {
    const data = socket.data;
    const sName = data.name;
    const sRoom = data.room;
    const sRole = data.role;
    if (!sRoom) return;
    const r = ensureRoom(sRoom);
    if (sRole === "client" && r.clientId === socket.id) r.clientId = null;
    if (sRole === "counselor" && r.counselorId === socket.id)
      r.counselorId = null;
    io.to(sRoom).emit("system", {
      text: `${sName || "익명"}님(${sRole || "알수없음"})이 퇴장했습니다.`,
    });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
