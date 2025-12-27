/* global io, window */
const socket = io();
const { name, room, role } = window.APP;

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("message");
const sendBtn = document.getElementById("send");

sendBtn.addEventListener("click", () => {
  send();
});
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    send();
  }
});

socket.on("message", (d) => {
  const roleLabel = d.role ? ` (${d.role})` : "";
  append(`${d.name}${roleLabel}: ${d.text}`);
});
socket.on("system", (d) => {
  append(`[시스템] ${d.text}`);
});

function send() {
  const v = inputEl.value.trim();
  if (!v) return;
  socket.emit("client_message", v);
  inputEl.value = "";
}

function append(line) {
  const wrapper = document.createElement("div");
  wrapper.className = "text";

  const textSpan = document.createElement("span");
  textSpan.textContent = line;

  const timeSpan = document.createElement("span");
  timeSpan.className = "muted";
  timeSpan.textContent = ` ${new Date().toLocaleString()}`;

  wrapper.append(textSpan, timeSpan);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
