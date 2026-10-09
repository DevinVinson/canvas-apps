import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { act } from "react";

test("real bundle mounts nested routes, preserves action errors across polls, and releases its resources", async () => {
  const dom = new JSDOM(
    '<main style="height:700px"><div id="mount"></div></main>',
    { url: "http://canvas.test" },
  );
  const originals = new Map();
  const set = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  };
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLCanvasElement",
    "localStorage",
    "sessionStorage",
  ])
    set(key, dom.window[key]);
  set("IS_REACT_ACT_ENVIRONMENT", true);
  const observers = [];
  set(
    "ResizeObserver",
    class {
      constructor(cb) {
        this.cb = cb;
        this.closed = false;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        this.closed = true;
      }
    },
  );
  let frame = 0;
  const frames = new Set();
  set("requestAnimationFrame", () => {
    frames.add(++frame);
    return frame;
  });
  set("cancelAnimationFrame", (id) => frames.delete(id));
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    imageSmoothingEnabled: false,
  });
  const originalTimeout = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout;
  const timers = new Map();
  set("setTimeout", (callback, delay, ...args) => {
    const id = originalTimeout(() => {
      timers.delete(id);
      callback(...args);
    }, delay);
    timers.set(id, { callback, delay });
    return id;
  });
  set("clearTimeout", (id) => {
    timers.delete(id);
    originalClear(id);
  });
  const container = document.querySelector("#mount");
  const routes = [];
  let registration,
    cleaned = false,
    polls = 0;
  const conversation = {
    id: "agent-one",
    title: "Maya",
    execution_status: "running",
    confirmation_policy: { kind: "NeverConfirm" },
    workspace: { working_dir: "/tmp/review" },
  };
  const host = {
    backend: { id: "mount-test", kind: "local" },
    registerPage: (id, mount) => {
      assert.equal(id, "office");
      registration = mount;
      return () => {
        cleaned = true;
      };
    },
    navigate: (path) => routes.push(path),
    agentServer: {
      request: async (r) => {
        if (r.path.includes("conversations/search")) {
          polls++;
          return { items: [conversation] };
        }
        if (r.path.includes("events/search"))
          return {
            items: [
              {
                id: "message",
                kind: "MessageEvent",
                source: "agent",
                timestamp: "2026-10-09",
                llm_message: {
                  content: [{ type: "text", text: "Working on the review" }],
                },
              },
            ],
          };
        if (r.path.endsWith("/pause")) throw new Error("Pause refused");
        return conversation;
      },
    },
  };
  let dispose, deactivate;
  const flush = async () =>
    act(async () => {
      await new Promise((resolve) => originalTimeout(resolve, 0));
    });
  const button = (name) => {
    const value = [...container.querySelectorAll("button")].find(
      (e) => e.textContent.trim() === name,
    );
    assert.ok(value, `button ${name}`);
    return value;
  };
  try {
    const code = fs.readFileSync(
      new URL("../extension.js", import.meta.url),
      "utf8",
    );
    const module = await import(
      "data:text/javascript;base64," + Buffer.from(code).toString("base64")
    );
    await act(async () => {
      deactivate = module.activate(host);
      dispose = registration({
        container,
        path: "agent-one",
        navigate: host.navigate,
      });
    });
    await flush();
    assert.match(container.textContent, /Maya/);
    assert.equal(container.querySelector(".pa-inspector").hidden, true);
    await act(async () => button("Agent desk").click());
    assert.equal(container.querySelector(".pa-inspector").hidden, false);
    await act(async () => button("Pause agent").click());
    await flush();
    assert.match(
      container.querySelector("[role=alert]").textContent,
      /Pause refused/,
    );
    const pollEntry = [...timers.entries()].find(([, t]) => t.delay === 3000);
    assert.ok(pollEntry);
    const [pollId, poll] = pollEntry;
    originalClear(pollId);
    timers.delete(pollId);
    await act(async () => {
      await poll.callback();
    });
    await flush();
    assert.ok(polls >= 2);
    assert.match(
      container.querySelector("[role=alert]").textContent,
      /Pause refused/,
    );
    await act(async () => button("Dismiss").click());
    assert.equal(container.querySelector("[role=alert]"), null);
    await act(async () => button("Split view").click());
    assert.equal(container.querySelector(".pa-roster").hidden, false);
    await act(async () => container.querySelector(".pa-person>button").click());
    assert.equal(routes.at(-1), "/extensions/pixel-agents/office/agent-one");
    await act(async () => dispose());
    dispose = null;
    assert.equal(container.childElementCount, 0);
    assert.equal(frames.size, 0);
    assert.ok(observers.every((o) => o.closed));
    assert.equal(timers.size, 0, "poll timers must be cleared on unmount");
    await act(async () => {
      dispose = registration({ container, path: "", navigate: host.navigate });
    });
    await flush();
    assert.match(container.textContent, /Meet your agents/);
    await act(async () => dispose());
    dispose = null;
    assert.equal(container.childElementCount, 0);
    assert.equal(frames.size, 0);
    assert.equal(timers.size, 0);
    assert.ok(observers.every((o) => o.closed));
    deactivate();
    assert.equal(cleaned, true);
  } finally {
    if (dispose) await act(async () => dispose());
    for (const id of timers.keys()) originalClear(id);
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
