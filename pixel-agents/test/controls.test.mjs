import test from "node:test";
import assert from "node:assert/strict";
import {
  canRunDirectly,
  sendTask,
  resumeTask,
  createTask,
} from "../src/controls.mjs";

test("approval-enabled and unknown conversations never get an implicit run", async () => {
  for (const conversation of [
    {
      execution_status: "waiting_for_confirmation",
      confirmation_policy: { kind: "NeverConfirm" },
    },
    {
      execution_status: "paused",
      confirmation_policy: { kind: "AlwaysConfirm" },
    },
    { execution_status: "idle" },
  ]) {
    assert.equal(canRunDirectly(conversation), false);
    const calls = [];
    const request = async (r) => {
      calls.push(r);
      return r.method ? {} : conversation;
    };
    assert.deepEqual(await sendTask(request, "agent", "Please review this"), {
      run: false,
      capacity: false,
    });
    assert.equal(calls[1].body.run, false);
    calls.length = 0;
    await assert.rejects(
      () => resumeTask(request, "agent"),
      /review approvals/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, undefined);
  }
});
test("fresh backend status controls send and resume instead of a stale UI snapshot", async () => {
  const calls = [];
  const request = async (r) => {
    calls.push(r);
    return r.method
      ? {}
      : {
          execution_status: "finished",
          confirmation_policy: { kind: "NeverConfirm" },
        };
  };
  assert.equal((await sendTask(request, "agent", "Run the tests")).run, true);
  assert.equal(calls[1].body.content[0].text, "Run the tests");
  calls.length = 0;
  await resumeTask(request, "agent");
  assert.equal(calls[1].path, "/api/conversations/agent/run");
});
test("a 429 acknowledges the saved message without inviting a duplicate send", async () => {
  let posts = 0;
  const request = async (r) => {
    if (!r.method)
      return {
        execution_status: "finished",
        confirmation_policy: { kind: "NeverConfirm" },
      };
    posts++;
    throw Object.assign(new Error("at capacity"), { status: 429 });
  };
  assert.deepEqual(await sendTask(request, "agent", "hello"), {
    run: false,
    capacity: true,
  });
  assert.equal(posts, 1);
});
test("ordinary request failures are not mislabeled as persisted messages", async () => {
  const request = async (r) => {
    if (!r.method) return {};
    throw new Error("Disconnected");
  };
  await assert.rejects(
    () => sendTask(request, "agent", "hello"),
    /Disconnected/,
  );
});
test("rename failure returns the created conversation, not a retryable creation failure", async () => {
  const calls = [];
  const request = async (r) => {
    calls.push(r);
    if (r.method === "PATCH") throw new Error("rename failed");
    return { id: "created" };
  };
  const result = await createTask(request, { initial_message: {} }, "Maya");
  assert.equal(result.conversation.id, "created");
  assert.match(result.warning, /agent started/);
  assert.equal(
    calls.filter((r) => r.path === "/api/conversations" && r.method === "POST")
      .length,
    1,
  );
});
