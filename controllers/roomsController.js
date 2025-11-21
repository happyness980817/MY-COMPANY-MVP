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

export { rooms, ensureRoom };

