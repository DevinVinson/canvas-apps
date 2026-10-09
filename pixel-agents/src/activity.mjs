function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((x) => (typeof x === "string" ? x : (x.text ?? "")))
      .filter(Boolean)
      .join("\n");
  return content == null
    ? ""
    : typeof content === "object"
      ? JSON.stringify(content)
      : String(content);
}

export function textOf(event) {
  const content = event?.llm_message?.content ?? event?.content ?? [];
  return contentText(content);
}

export function summarizeEvent(event) {
  if (event.kind === "MessageEvent") return textOf(event);
  if (event.kind === "ActionEvent") {
    const action = event.action ?? {};
    if (event.tool_name === "finish") return action.message ?? "Finished";
    return `${event.tool_name ?? action.kind ?? "Tool"}: ${[action.command, action.path, action.task ?? action.summary].filter(Boolean).join(" ")}`.trim();
  }
  if (event.kind === "ObservationEvent") {
    const o = event.observation ?? {};
    return `${event.tool_name ?? "Tool result"}${o.is_error ? " failed" : ""}: ${contentText(o.content ?? o.output ?? o.error)}`.trim();
  }
  if (event.kind === "ConversationErrorEvent")
    return event.detail ?? event.error ?? event.code ?? "Conversation error";
  return "";
}

export function activityOf(conversation, events = []) {
  const status = conversation.execution_status ?? "unknown";
  const newest = [...events].sort((a, b) =>
    String(b.timestamp).localeCompare(String(a.timestamp)),
  );
  const significant = newest.find((e) =>
    [
      "ActionEvent",
      "ObservationEvent",
      "MessageEvent",
      "ConversationErrorEvent",
    ].includes(e.kind),
  );
  const latestAction = newest.find((e) => e.kind === "ActionEvent");
  const tool = latestAction?.tool_name ?? latestAction?.action?.kind ?? null;
  const running = status === "running";
  const error = ["error", "stuck"].includes(status);
  const waiting = [
    "waiting_for_confirmation",
    "waiting_for_user",
    "paused",
  ].includes(status);
  let label = error
    ? "Needs attention"
    : waiting
      ? "Waiting for you"
      : running
        ? "Thinking"
        : status === "finished"
          ? "Finished"
          : status === "idle"
            ? "Ready"
            : status;
  let animationTool = null;
  if (running && significant?.kind === "ActionEvent") {
    const reading =
      /read|list|search|grep|glob|browser/i.test(tool ?? "") ||
      /^(view|read|list|search)$/.test(latestAction.action?.command ?? "");
    label = reading
      ? "Reading"
      : tool === "finish"
        ? "Finishing"
        : /file|edit|write/i.test(tool ?? "")
          ? "Writing"
          : /terminal|bash|exec/i.test(tool ?? "")
            ? "Running a command"
            : "Using a tool";
    animationTool = label === "Reading" ? "Read" : "Edit";
  }
  const metrics = Object.values(conversation.stats?.usage_to_metrics ?? {});
  const cost = metrics.reduce(
    (sum, m) => sum + Number(m.accumulated_cost ?? 0),
    0,
  );
  return {
    status,
    running,
    error,
    waiting,
    label,
    tool,
    animationTool,
    cost,
    latest: significant,
    summary: significant ? summarizeEvent(significant) : "",
  };
}

export function selectOfficeConversations(conversations, watched, hidden) {
  const available = conversations.filter((c) => !hidden.includes(c.id));
  const ids = new Set(watched ?? available.slice(0, 6).map((c) => c.id));
  for (const c of available)
    if (c.execution_status === "running" || c.tags?.pixeloffice === "true")
      ids.add(c.id);
  return available.filter((c) => ids.has(c.id)).slice(0, 24);
}

export function startPayload(settings, workspace, prompt, title) {
  if (!workspace.trim().startsWith("/"))
    throw new Error(
      "Enter an absolute workspace path on the selected backend.",
    );
  if (!prompt.trim()) throw new Error("Give your agent a task first.");
  const agent = { ...settings.agent_settings };
  delete agent.schema_version;
  agent.tools = agent.tools?.length
    ? agent.tools
    : [
        { name: "terminal", params: {} },
        { name: "file_editor", params: {} },
        { name: "task_tracker", params: {} },
      ];
  const payload = {
    workspace: { kind: "LocalWorkspace", working_dir: workspace.trim() },
    worktree: false,
    agent_settings: agent,
    secrets_encrypted: true,
    max_iterations: 100,
    stuck_detection: true,
    autotitle: false,
    tags: { pixeloffice: "true" },
    initial_message: {
      role: "user",
      content: [{ type: "text", text: prompt.trim() }],
      run: true,
    },
  };
  if (settings.conversation_settings?.confirmation_policy)
    payload.confirmation_policy =
      settings.conversation_settings.confirmation_policy;
  return payload;
}
