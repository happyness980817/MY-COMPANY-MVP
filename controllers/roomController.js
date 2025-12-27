import { createConversationId, ensureRoom, generateRoomCode, rooms } from "../services/room.js";

export function home(_, res) {
  res.render("home", { title: "상담 플랫폼 – 시작하기" });
}

export async function postCreate(req, res) {
  const role = req.body && req.body.role ? req.body.role : "";
  const name = req.body && req.body.name ? req.body.name : "";

  if (!role || !name) return res.status(400).send("필수값 누락");

  const code = generateRoomCode(20);
  const room = ensureRoom(code);

  const openai = req.app && req.app.locals ? req.app.locals.openai : null;
  if (!openai) return res.status(500).send("서버 설정 오류");

  try {
    room.conversationId = await createConversationId(openai);
    if (!room.conversationId) return res.status(500).send("대화 생성 실패");
  } catch (e) {
    console.error("Conversation create error:", e);
    return res.status(500).send("대화를 생성할 수 없습니다.");
  }

  req.session.name = name;
  req.session.role = role;
  req.session.code = code;

  return res.render("code", { title: "방 코드 안내", code, name, role });
}

export function postEnter(req, res) {
  const role = req.body && req.body.role ? req.body.role : "";
  const name = req.body && req.body.name ? req.body.name : "";
  const code = req.body && req.body.code ? req.body.code : "";

  if (!role || !name || !code) return res.status(400).send("필수값 누락");

  const room = rooms[code];
  if (!room) return res.status(404).send("존재하지 않는 방 코드입니다.");
  if (!room.conversationId)
    return res.status(500).send("이 방의 대화가 준비되지 않았습니다.");

  req.session.name = name;
  req.session.role = role;
  req.session.code = code;

  return res.redirect("/room");
}

export function room(req, res) {
  const name = req.session && req.session.name ? req.session.name : "";
  const role = req.session && req.session.role ? req.session.role : "";
  const code = req.session && req.session.code ? req.session.code : "";

  if (!name || !role || !code || !rooms[code]) return res.redirect("/");
  if (role === "client")
    return res.render("client", { name, room: code, title: "내담자" });
  return res.render("counselor", { name, room: code, title: "상담사" });
}
