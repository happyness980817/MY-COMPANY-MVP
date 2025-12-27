function getOutputText(resp, fallback) {
  if (resp && resp.output_text) return resp.output_text;
  return fallback;
}

export async function addUserItem(openai, conversationId, text) {
  if (!conversationId) return;
  await openai.conversations.items.create(conversationId, {
    items: [
      {
        role: "user",
        content: [{ type: "input_text", text }],
      },
    ],
  });
}

export async function addAssistantItem(openai, conversationId, text) {
  if (!conversationId) return;
  await openai.conversations.items.create(conversationId, {
    items: [
      {
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
  });
}

export async function generateDraft(openai, opts) {
  opts = opts || {};
  const {
    model = "gpt-5.1",
    conversationId = null,
    instructionString = "",
    devInstructionString = "",
    clientText = "",
  } = opts;

  const resp = await openai.responses.create({
    model,
    instructions: instructionString,
    conversation: { id: conversationId },
    input: [
      {
        role: "user",
        content: `내담자 최신 메시지 참조: """${clientText}"""`,
      },
      {
        role: "developer",
        content: devInstructionString,
      },
    ],
    store: true,
  });

  return getOutputText(resp, "(응답 생성 실패)");
}

export async function refineDraft(openai, opts) {
  opts = opts || {};
  const {
    model = "gpt-5.1",
    conversationId = null,
    instructionString = "",
    devInstructionString = "",
    lastClientText = "",
  } = opts;

  const resp = await openai.responses.create({
    model,
    instructions: `${instructionString} 상담사의 피드백을 반영해 2~4문장으로 개선하세요.`,
    conversation: { id: conversationId },
    input: [
      {
        role: "user",
        content: `내담자 메시지: """${lastClientText}"""`,
      },
      {
        role: "developer",
        content: devInstructionString,
      },
    ],
    store: true,
  });

  return getOutputText(resp, "(수정 실패)");
}
