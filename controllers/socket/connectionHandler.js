import { ensureRoom } from "../roomsController.js";

export function handleConnection(socket, io) {
  const sess = socket.request && socket.request.session ? socket.request.session : null;
  const name = sess && sess.name ? sess.name : undefined;
  const code = sess && sess.code ? sess.code : undefined;
  const role = sess && sess.role ? sess.role : undefined;

  if (!name || !code || !role) {
    return;
  }

  socket.data = { name, code, role };
  socket.join(code);

  const room = ensureRoom(code);
  if (role === "client") room.clientId = socket.id;
  if (role === "counselor") room.counselorId = socket.id;

  io.to(code).emit("system", { text: `${name}님(${role})이 입장했습니다.` });
}

export function handleDisconnect(socket, io) {
  const data = socket.data || {};
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
}

