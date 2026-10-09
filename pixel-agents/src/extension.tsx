import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Office } from "./office";
import {
  activityOf,
  selectOfficeConversations,
  startPayload,
  summarizeEvent,
  textOf,
} from "./activity.mjs";
import styles from "./styles.css";
import {
  canRunDirectly,
  sendTask,
  resumeTask,
  createTask,
} from "./controls.mjs";

type Host = {
  backend: { id: string; kind: string };
  agentServer: { request: (r: any) => Promise<any> };
  registerPage: (id: string, mount: (c: any) => any) => () => void;
  navigate: (path: string) => void;
};
const ROOT = "/extensions/pixel-agents/office";
const COLORS = [
  "#bbd98d",
  "#b8b3f5",
  "#f0c491",
  "#8fc9d3",
  "#e7a8be",
  "#a8c1f0",
];
const messageOf = (e: any) => (e instanceof Error ? e.message : String(e));
const readSaved = (key: string) => {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      value &&
      Array.isArray(value.hidden) &&
      (value.watched === null || Array.isArray(value.watched))
    )
      return value;
  } catch {}
  return { watched: null, hidden: [] };
};

type OfficeView = { mode: "office" | "split"; panel: "agents" | "desk" | null };
const readView = (key: string): OfficeView => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    if (v && (v.mode === "office" || v.mode === "split"))
      return {
        mode: v.mode,
        panel: ["agents", "desk"].includes(v.panel) ? v.panel : null,
      };
  } catch {}
  return { mode: "office", panel: null };
};

function App({ host, context }: { host: Host; context: any }) {
  const storageKey = `pixel-agents:${host.backend.id}`;
  const viewKey = `pixel-agents-view:${host.backend.id}`;
  const [view, setView] = useState<OfficeView>(() => readView(viewKey));
  const viewRef = useRef(view);
  viewRef.current = view;
  const updateView = (next: OfficeView) => {
    viewRef.current = next;
    try {
      localStorage.setItem(viewKey, JSON.stringify(next));
    } catch {}
    setView(next);
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && viewRef.current.panel)
        updateView({ ...viewRef.current, panel: null });
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [viewKey]);
  const [preferences, setPreferences] = useState(() => readSaved(storageKey));
  const [conversations, setConversations] = useState<any[]>([]);
  const [events, setEvents] = useState<Record<string, any[]>>({});
  const [selected, setSelected] = useState<string | null>(
    () => context.path?.split("/").filter(Boolean)[0] ?? null,
  );
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("office");
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [eventErrors, setEventErrors] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState(false);
  const [lastSync, setLastSync] = useState("");
  const [zoom, setZoom] = useState(1);
  const [paused, setPaused] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const noticeKey = `pixel-agents-notice:${host.backend.id}`;
  const [notice, setNotice] = useState(() => {
    try {
      const value = sessionStorage.getItem(noticeKey) ?? "";
      sessionStorage.removeItem(noticeKey);
      return value;
    } catch {
      return "";
    }
  });
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const [newAgent, setNewAgent] = useState(false);
  const [workspace, setWorkspace] = useState("");
  const [name, setName] = useState("");
  const [task, setTask] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const followFeed = useRef(true);
  const live = useRef({ preferences, selected });
  live.current = { preferences, selected };
  useEffect(() => {
    followFeed.current = true;
  }, [selected]);
  useEffect(() => {
    const feed = feedRef.current;
    if (feed && followFeed.current) feed.scrollTop = feed.scrollHeight;
  }, [events, selected, view.panel]);
  const refresh = () => setRefreshTick((n) => n + 1);
  const savePreferences = (next: any) => {
    // Persist before route navigation can unmount the page.
    live.current.preferences = next;
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setNotice(
        "Browser storage is unavailable; office choices will last for this visit.",
      );
    }
    setPreferences(next);
  };
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await host.agentServer.request({
          path: "/api/conversations/search?limit=100&sort_order=UPDATED_AT_DESC",
        });
        if (disposed) return;
        const all = data.items ?? data.conversations ?? [];
        setConversations(all);
        setConnected(true);
        setConnectionError("");
        setLastSync(new Date().toLocaleTimeString());
        const office = selectOfficeConversations(
          all,
          live.current.preferences.watched,
          live.current.preferences.hidden,
        );
        const eventIds = new Set<string>(
          office
            .filter((c: any) => c.execution_status === "running")
            .map((c: any) => c.id),
        );
        if (live.current.selected) eventIds.add(live.current.selected);
        // Selected and running conversations refresh every cycle. Quiet agents need no event polling.
        const results = await Promise.allSettled(
          [...eventIds].map(async (id) => ({
            id,
            data: await host.agentServer.request({
              path: `/api/conversations/${encodeURIComponent(id)}/events/search?limit=30&sort_order=TIMESTAMP_DESC`,
            }),
          })),
        );
        if (disposed) return;
        const next: Record<string, any[]> = {};
        const errs: Record<string, string> = {};
        results.forEach((r, i) => {
          const id = [...eventIds][i];
          if (r.status === "fulfilled")
            next[id] = r.value.data.items ?? r.value.data.events ?? [];
          else errs[id] = messageOf(r.reason);
        });
        setEvents((old) => ({ ...old, ...next }));
        setEventErrors(errs);
      } catch (e) {
        if (!disposed) {
          setConnected(false);
          setConnectionError(messageOf(e));
        }
      }
      if (!disposed) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [host, refreshTick, selected]);
  const office = selectOfficeConversations(
    conversations,
    preferences.watched,
    preferences.hidden,
  );
  const person = conversations.find((c) => c.id === selected);
  const a = person ? activityOf(person, events[person.id] ?? []) : null;
  const choose = useCallback(
    (id: string) => {
      if (viewRef.current.mode === "office")
        updateView({ ...viewRef.current, panel: "desk" });
      setSelected(id);
      setDraft("");
      setNotice("");
      context.navigate(`${ROOT}/${id}`);
    },
    [context, viewKey],
  );
  const watch = (id: string) => {
    const p = live.current.preferences;
    savePreferences({
      hidden: p.hidden.filter((x: string) => x !== id),
      watched: [
        ...new Set([...(p.watched ?? office.map((c: any) => c.id)), id]),
      ],
    });
  };
  const hide = (id: string) => {
    const p = live.current.preferences;
    savePreferences({ ...p, hidden: [...new Set([...p.hidden, id])] });
  };
  const mutate = async (path: string, body?: any) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await host.agentServer.request({
        path,
        method: "POST",
        ...(body ? { body } : {}),
      });
      if (mounted.current) refresh();
      return true;
    } catch (e) {
      if (mounted.current) setError(messageOf(e));
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !draft.trim() || busy) return;
    const id = selected,
      text = draft.trim();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await sendTask(
        (r: any) => host.agentServer.request(r),
        id,
        text,
      );
      if (mounted.current && live.current.selected === id) {
        setDraft("");
        setNotice(
          result.capacity
            ? "Message saved, but the server is at capacity. Resume the agent later; do not resend."
            : result.run
              ? "Task sent. Your agent will pick it up here."
              : "Message saved. Open the conversation to review approvals and continue.",
        );
        refresh();
      }
    } catch (e) {
      if (mounted.current && live.current.selected === id)
        setError(messageOf(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const resume = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await resumeTask((r: any) => host.agentServer.request(r), selected);
      if (mounted.current) refresh();
    } catch (e) {
      if (mounted.current) setError(messageOf(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const settings = await host.agentServer.request({
        path: "/api/settings",
        headers: { "X-Expose-Secrets": "encrypted" },
      });
      const payload = startPayload(settings, workspace, task, name);
      const { conversation: c, warning } = await createTask(
        (r: any) => host.agentServer.request(r),
        payload,
        name,
      );
      if (!mounted.current) return;
      watch(c.id);
      setConversations((old) => [c, ...old.filter((x) => x.id !== c.id)]);
      setNewAgent(false);
      setTask("");
      setName("");
      if (warning)
        try {
          sessionStorage.setItem(noticeKey, warning);
        } catch {}
      choose(c.id);
      setNotice(warning);
      refresh();
    } catch (e) {
      if (mounted.current) setError(messageOf(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const listed = (scope === "office" ? office : conversations).filter((c) =>
    `${c.title ?? ""} ${c.workspace?.working_dir ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const visibleEvents = (events[selected ?? ""] ?? [])
    .filter((e) =>
      [
        "MessageEvent",
        "ActionEvent",
        "ObservationEvent",
        "ConversationErrorEvent",
      ].includes(e.kind),
    )
    .slice(0, 12)
    .reverse();
  return (
    <div className="pa">
      <header className="pa-header">
        <div className="pa-brand">
          <div className="pa-logo" aria-hidden="true">
            ▦
          </div>
          <div>
            <div className="pa-eyebrow">OPENHANDS · AGENT CANVAS</div>
            <h1>
              Pixel Office <span>LIVE WORK, LITTLE PEOPLE.</span>
            </h1>
          </div>
        </div>
        <div className="pa-header-actions">
          <span className={`pa-connection ${connected ? "online" : ""}`}>
            <i />
            {connected ? "Connected" : "Connecting"}
            <small>{connected ? lastSync : ""}</small>
          </span>
          <button
            className="pa-primary"
            onClick={() => {
              setWorkspace(
                person?.workspace?.working_dir ??
                  conversations[0]?.workspace?.working_dir ??
                  "",
              );
              setNewAgent(true);
            }}
          >
            + New agent
          </button>
        </div>
      </header>
      <nav className="pa-view-controls" aria-label="Office view controls">
        <div className="pa-view-modes">
          <button
            aria-pressed={view.mode === "office"}
            onClick={() => updateView({ mode: "office", panel: null })}
          >
            Office view
          </button>
          <button
            aria-pressed={view.mode === "split"}
            onClick={() => updateView({ mode: "split", panel: null })}
          >
            Split view
          </button>
        </div>
        {view.mode === "office" && (
          <div className="pa-panel-controls">
            <button
              aria-pressed={view.panel === "agents"}
              onClick={() =>
                updateView({
                  ...view,
                  panel: view.panel === "agents" ? null : "agents",
                })
              }
            >
              Agents <span>{office.length}</span>
            </button>
            <button
              disabled={!person}
              aria-pressed={view.panel === "desk"}
              onClick={() =>
                updateView({
                  ...view,
                  panel: view.panel === "desk" ? null : "desk",
                })
              }
            >
              Agent desk
            </button>
          </div>
        )}
      </nav>
      {connectionError && (
        <div className="pa-error" role="alert">
          {connectionError}
          <button onClick={refresh}>Retry connection</button>
        </div>
      )}
      {error && (
        <div className="pa-error" role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      <div
        className={`pa-layout ${view.mode === "office" ? "pa-office-view" : ""}`}
      >
        <aside
          className="pa-roster"
          aria-label="Agent roster"
          hidden={view.mode === "office" && view.panel !== "agents"}
        >
          {view.mode === "office" && (
            <button
              className="pa-panel-close"
              aria-label="Close agent roster"
              onClick={() => updateView({ ...view, panel: null })}
            >
              ×
            </button>
          )}
          <div className="pa-section-title">
            YOUR PEOPLE <span>{office.length}</span>
          </div>
          <input
            aria-label="Find an agent"
            placeholder="Find an agent…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="pa-tabs">
            <button
              aria-pressed={scope === "office"}
              onClick={() => setScope("office")}
            >
              In the office
            </button>
            <button
              aria-pressed={scope === "all"}
              onClick={() => setScope("all")}
            >
              All conversations
            </button>
          </div>
          <div className="pa-people">
            {listed.map((c, i) => {
              const act = activityOf(c, events[c.id] ?? []);
              const included = office.some((o) => o.id === c.id);
              return (
                <div
                  className={`pa-person ${selected === c.id ? "selected" : ""}`}
                  key={c.id}
                >
                  <button onClick={() => choose(c.id)}>
                    <div
                      className="pa-avatar"
                      style={{ "--avatar": COLORS[i % COLORS.length] } as any}
                    >
                      <span>▪ ▪</span>
                      <b>▰</b>
                    </div>
                    <div>
                      <strong>{c.title ?? `Agent ${c.id.slice(0, 6)}`}</strong>
                      <span className={act.running ? "pa-active" : ""}>
                        <i />
                        {act.label}
                      </span>
                      <small>
                        {(c.workspace?.working_dir ?? "").split("/").pop()}
                      </small>
                    </div>
                  </button>
                  {!included && (
                    <button
                      className="pa-watch"
                      aria-label={`Watch ${c.title ?? c.id}`}
                      onClick={() => watch(c.id)}
                    >
                      +
                    </button>
                  )}
                </div>
              );
            })}
            {!listed.length && (
              <p className="pa-empty">
                {connected
                  ? "No agents here yet. Start one or add an existing conversation."
                  : "Connecting to your selected Canvas backend…"}
              </p>
            )}
          </div>
          <footer>
            <span>● Working &nbsp; ◇ Waiting &nbsp; ○ Ready</span>
            <p>Each person is a real conversation.</p>
            <a
              href="https://github.com/pixel-agents-hq/pixel-agents"
              target="_blank"
              rel="noreferrer"
            >
              Artwork & engine: Pixel Agents ↗
            </a>
          </footer>
        </aside>
        <main className="pa-world">
          <div className="pa-world-top">
            <div>
              <span className="pa-eyebrow">THE WORKSPACE</span>
              <h2>A little office. Real work.</h2>
            </div>
            <div className="pa-world-stats">
              <span>
                <b>
                  {
                    office.filter((c) => c.execution_status === "running")
                      .length
                  }
                </b>{" "}
                working
              </span>
              <span>
                <b>{office.length}</b> in office
              </span>
            </div>
          </div>
          <div className="pa-canvas">
            <Office
              expanded={view.mode === "office"}
              conversations={office}
              events={events}
              selected={selected}
              onSelect={choose}
              zoom={zoom}
              paused={paused}
            />
            {office.length === 0 && connected && (
              <div className="pa-empty-world">
                <h3>Your office is ready.</h3>
                <p>Create an agent, or add a conversation from the roster.</p>
              </div>
            )}
            <div className="pa-world-label">
              OPENHANDS HQ <span>EST. 2026</span>
            </div>
          </div>
          <div className="pa-world-bottom">
            <span>Click a person to see what they’re doing.</span>
            <div>
              <button
                aria-label="Zoom out"
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}
              >
                −
              </button>
              <button onClick={() => setZoom(1)}>Fit</button>
              <button
                aria-label="Zoom in"
                onClick={() => setZoom((z) => Math.min(2.2, z + 0.15))}
              >
                +
              </button>
              <button
                aria-pressed={paused}
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? "Resume animation" : "Pause animation"}
              </button>
            </div>
          </div>
          <div className="pa-loop">
            <span>
              01 <b>GIVE A TASK</b>
            </span>
            <i>→</i>
            <span>
              02 <b>WATCH IT WORK</b>
            </span>
            <i>→</i>
            <span>
              03 <b>WORK TOGETHER</b>
            </span>
          </div>
        </main>
        <aside
          className="pa-inspector"
          aria-label="Agent desk"
          hidden={view.mode === "office" && view.panel !== "desk"}
        >
          {view.mode === "office" && (
            <button
              className="pa-panel-close"
              aria-label="Close agent desk"
              onClick={() => updateView({ ...view, panel: null })}
            >
              ×
            </button>
          )}
          {person && a ? (
            <>
              <div className="pa-section-title">
                AGENT DESK{" "}
                <span className={a.running ? "pa-active" : ""}>{a.label}</span>
              </div>
              <h2>{person.title ?? "Untitled agent"}</h2>
              <p className="pa-workspace">{person.workspace?.working_dir}</p>
              <div className="pa-agent-meta">
                <span>
                  Model{" "}
                  <b>
                    {person.current_model_id ??
                      person.agent?.llm?.model ??
                      "Configured model"}
                  </b>
                </span>
                <span>
                  Spend <b>${a.cost.toFixed(4)}</b>
                </span>
              </div>
              <div className="pa-actions">
                <button
                  onClick={() => host.navigate(`/conversations/${person.id}`)}
                >
                  Open conversation ↗
                </button>
                {a.running ? (
                  <button
                    disabled={busy}
                    onClick={() =>
                      mutate(`/api/conversations/${person.id}/pause`)
                    }
                  >
                    Pause agent
                  </button>
                ) : (
                  <>
                    {canRunDirectly(person) ? (
                      <button disabled={busy} onClick={resume}>
                        Resume agent
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          host.navigate(`/conversations/${person.id}`)
                        }
                      >
                        Review & continue ↗
                      </button>
                    )}
                  </>
                )}
                <button onClick={() => hide(person.id)}>
                  Remove from office
                </button>
              </div>
              {!canRunDirectly(person) && (
                <p className="pa-approval-note">
                  Approvals stay in the full conversation. Messages sent here
                  are saved without starting or approving actions.
                </p>
              )}
              <div className="pa-section-title pa-activity-title">
                RECENT ACTIVITY {a.tool && <span>{a.tool}</span>}
              </div>
              {eventErrors[person.id] && (
                <p className="pa-error">
                  Couldn’t load activity: {eventErrors[person.id]}
                </p>
              )}
              <div
                className="pa-feed"
                ref={feedRef}
                onScroll={() => {
                  const f = feedRef.current;
                  if (f)
                    followFeed.current =
                      f.scrollHeight - f.scrollTop - f.clientHeight < 40;
                }}
              >
                {visibleEvents.map((e) => (
                  <article
                    key={e.id}
                    className={e.source === "user" ? "user" : ""}
                  >
                    <div>
                      <strong>
                        {e.kind === "MessageEvent"
                          ? e.source === "user"
                            ? "YOU"
                            : "AGENT"
                          : e.kind === "ActionEvent"
                            ? "TOOL CALL"
                            : e.kind === "ObservationEvent"
                              ? "RESULT"
                              : "ERROR"}
                      </strong>
                      <time>
                        {new Date(e.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <p>{String(summarizeEvent(e)).slice(0, 1600) || e.kind}</p>
                  </article>
                ))}
                {!visibleEvents.length && (
                  <p className="pa-empty">
                    Activity will appear here as your agent works.
                  </p>
                )}
              </div>
              <form className="pa-composer" onSubmit={send}>
                <label htmlFor="pa-task">Give this agent a task</label>
                <textarea
                  id="pa-task"
                  placeholder="What should we work on next?"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                />
                <button className="pa-primary" disabled={busy || !draft.trim()}>
                  {busy
                    ? "Sending…"
                    : canRunDirectly(person)
                      ? "Send task →"
                      : "Save message →"}
                </button>
                {notice && <p role="status">{notice}</p>}
              </form>
            </>
          ) : (
            <div className="pa-no-selection">
              <div>▦</div>
              <h2>Meet your agents.</h2>
              <p>
                Select a person in the office or roster to see their activity
                and give them a task.
              </p>
              <span>YOUR NEXT IDEA STARTS HERE.</span>
            </div>
          )}
        </aside>
      </div>
      {newAgent && (
        <div className="pa-modal-backdrop">
          <section
            className="pa-modal"
            role="dialog"
            aria-modal="true"
            aria-label="New agent"
          >
            <button
              className="pa-modal-close"
              aria-label="Close new agent"
              onClick={() => setNewAgent(false)}
            >
              ×
            </button>
            <div className="pa-eyebrow">A NEW PERSON, A NEW POSSIBILITY</div>
            <h2>Welcome someone to the office.</h2>
            <p>
              Your agent uses the selected backend’s current model and works in
              the folder you choose.
            </p>
            <form onSubmit={create}>
              <label>
                Name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Maya · Frontend"
                  required
                />
              </label>
              <label>
                Workspace on this backend
                <input
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  placeholder="/absolute/path/to/project"
                  required
                />
              </label>
              <label>
                First task
                <textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder="What should this agent build or investigate?"
                  rows={4}
                  required
                />
              </label>
              {error && (
                <p className="pa-error" role="alert">
                  {error}
                </p>
              )}
              <button className="pa-primary" disabled={busy}>
                {busy ? "Starting…" : "Start agent →"}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export function activate(host: Host) {
  return host.registerPage("office", (context: any) => {
    const style = document.createElement("style");
    style.textContent = styles;
    context.container.append(style);
    const node = document.createElement("div");
    context.container.append(node);
    // Canvas's mount wrapper has a min-height, so a percentage height cannot fill it.
    const viewport = context.container.closest("main") ?? context.container;
    const resize = () => {
      node.style.height = `${viewport.clientHeight}px`;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    resize();
    const root = createRoot(node);
    root.render(<App host={host} context={context} />);
    return () => {
      observer.disconnect();
      root.unmount();
      node.remove();
      style.remove();
    };
  });
}
