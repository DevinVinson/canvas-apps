// /run implicitly approves pending actions. Only run directly when the backend
// explicitly reports that this conversation does not use confirmations.
export function canRunDirectly(conversation) {
  return (
    conversation?.confirmation_policy?.kind === "NeverConfirm" &&
    conversation.execution_status !== "waiting_for_confirmation"
  );
}

export async function sendTask(request, id, text) {
  const conversation = await request({
    path: `/api/conversations/${encodeURIComponent(id)}`,
  });
  const run = canRunDirectly(conversation);
  try {
    await request({
      path: `/api/conversations/${encodeURIComponent(id)}/events`,
      method: "POST",
      body: { role: "user", content: [{ type: "text", text }], run },
    });
    return { run, capacity: false };
  } catch (error) {
    // This endpoint saves the message before attempting to acquire run capacity.
    // Do not invite the user to resend an already persisted message.
    if (
      error?.status === 429 ||
      error?.response?.status === 429 ||
      /message saved.*capacity|run capacity is full/i.test(
        String(error?.message ?? error),
      )
    )
      return { run: false, capacity: true };
    throw error;
  }
}

export async function resumeTask(request, id) {
  const conversation = await request({
    path: `/api/conversations/${encodeURIComponent(id)}`,
  });
  if (!canRunDirectly(conversation))
    throw new Error(
      "Open the conversation to review approvals and continue this agent.",
    );
  return request({
    path: `/api/conversations/${encodeURIComponent(id)}/run`,
    method: "POST",
  });
}

export async function createTask(request, payload, title) {
  const conversation = await request({
    path: "/api/conversations",
    method: "POST",
    body: payload,
  });
  let warning = "";
  if (title.trim()) {
    try {
      await request({
        path: `/api/conversations/${encodeURIComponent(conversation.id)}`,
        method: "PATCH",
        body: { title: title.trim() },
      });
      conversation.title = title.trim();
    } catch {
      warning =
        "Your agent started, but its name could not be saved. Rename it in the full conversation.";
    }
  }
  return { conversation, warning };
}
