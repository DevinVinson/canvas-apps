import test from "node:test";
import assert from "node:assert/strict";
import {
  activityOf,
  selectOfficeConversations,
  startPayload,
  textOf,
  summarizeEvent,
} from "../src/activity.mjs";
test("action and observation transitions reflect actual activity, not an old tool call", () => {
  const action = {
    kind: "ActionEvent",
    timestamp: "2026-10-09T00:00:01Z",
    tool_name: "file_editor",
    action: { path: "hello.txt" },
  };
  assert.equal(
    activityOf({ execution_status: "running" }, [action]).label,
    "Writing",
  );
  const observation = {
    kind: "ObservationEvent",
    timestamp: "2026-10-09T00:00:02Z",
  };
  assert.equal(
    activityOf({ execution_status: "running" }, [action, observation]).label,
    "Thinking",
  );
  assert.equal(
    activityOf({ execution_status: "finished" }, [action]).running,
    false,
  );
  assert.equal(
    activityOf({ execution_status: "error" }, []).label,
    "Needs attention",
  );
});
test("running conversations enter office and hidden choices win", () => {
  const cs = Array.from({ length: 8 }, (_, i) => ({
    id: String(i),
    execution_status: i === 7 ? "running" : "finished",
  }));
  assert.equal(selectOfficeConversations(cs, null, []).length, 7);
  assert.equal(
    selectOfficeConversations(cs, ["1"], ["7"])
      .map((c) => c.id)
      .join(","),
    "1",
  );
});
test("encrypted settings round trip without modifying the original settings", () => {
  const settings = {
    agent_settings: {
      schema_version: 1,
      llm: { api_key: "encrypted-test" },
      tools: [],
    },
  };
  const body = startPayload(
    settings,
    "/tmp/pixel-test",
    "Write a greeting",
    "Pip",
  );
  assert.equal(body.secrets_encrypted, true);
  assert.equal(body.agent_settings.llm.api_key, "encrypted-test");
  assert.equal(body.agent_settings.schema_version, undefined);
  assert.equal(settings.agent_settings.schema_version, 1);
  assert.equal(body.agent_settings.tools.length, 3);
  assert.equal(settings.agent_settings.tools.length, 0);
  assert.throws(
    () => startPayload(settings, "relative", "hello", "Pip"),
    /absolute/,
  );
  assert.throws(() => startPayload(settings, "/tmp", " ", "Pip"), /task/);
});
test("message parsing uses the SDK llm_message shape", () =>
  assert.equal(
    textOf({
      llm_message: {
        content: [{ type: "text", text: "Hello" }, { type: "image" }],
      },
    }),
    "Hello",
  ));
test("tool results render typed content and file view actions animate as reading", () => {
  assert.equal(
    summarizeEvent({
      kind: "ObservationEvent",
      tool_name: "terminal",
      observation: { content: [{ type: "text", text: "VALID JSON" }] },
    }),
    "terminal: VALID JSON",
  );
  assert.equal(
    activityOf({ execution_status: "running" }, [
      {
        kind: "ActionEvent",
        timestamp: "2026-10-09",
        tool_name: "file_editor",
        action: { command: "view", path: "x" },
      },
    ]).label,
    "Reading",
  );
});
