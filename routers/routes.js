import { ensureRoom, rooms } from "../services/roomService.js";

export function setupRoutes(app, openai) {
  app.get("/", (_, res) => {
    res.render("home", { title: "상담 플랫폼 – 시작하기" });
  });

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

  app.post("/enter", (req, res) => {
    const { role, name, code } = req.body;
    if (!role || !name || !code) return res.status(400).send("필수값 누락");

    const room = rooms[code];
    if (!room) {
      return res.status(404).send("존재하지 않는 방 코드입니다.");
    }
    if (!room.conversationId) {
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
}

function generateRoomCode(len = 20) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
