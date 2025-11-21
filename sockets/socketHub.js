import { handleConnection, handleDisconnect } from "./connectionHandler.js";
import { handleClientMessage } from "./clientHandler.js";
import { handleCounselorGenerate, handleCounselorRefine, handleCounselorSendFinal } from "./counselorHandler.js";

export function setupSockets(io, openai, model = "gpt-5.1") {
  io.on("connection", (socket) => {
    handleConnection(socket, io);

    socket.on("client_message", (text) => handleClientMessage(socket, io, openai, model, text));

    socket.on("counselor_generate", () => handleCounselorGenerate(socket, io, openai, model));

    socket.on("counselor_refine", (payload) => handleCounselorRefine(socket, io, openai, model, payload));

    socket.on("counselor_send_final", (text) => handleCounselorSendFinal(socket, io, openai, text));

    socket.on("disconnect", () => handleDisconnect(socket, io));
  });
}
