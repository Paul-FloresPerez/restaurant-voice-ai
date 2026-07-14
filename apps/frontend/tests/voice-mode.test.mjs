import assert from "node:assert/strict";
import test from "node:test";
import {
  createBrowserChatRequest,
  getBackendAudioEndpoint,
  resolveVoiceMode,
} from "../app/voice-mode.ts";

test("production defaults to browser and cannot call /voice/message", () => {
  const mode = resolveVoiceMode(undefined);

  assert.equal(mode, "browser");
  assert.equal(getBackendAudioEndpoint(mode), null);
});

test("backend-audio must be explicitly configured", () => {
  const mode = resolveVoiceMode("backend-audio");

  assert.equal(mode, "backend-audio");
  assert.equal(getBackendAudioEndpoint(mode), "/voice/message");
});

test("a browser transcript targets /chat/message with the real text", () => {
  const request = createBrowserChatRequest(
    "session-id",
    "  Quiero una gaseosa, por favor  ",
  );

  assert.deepEqual(request, {
    path: "/chat/message",
    body: {
      sessionId: "session-id",
      message: "Quiero una gaseosa, por favor",
    },
  });
});

test("an empty browser transcript does not create a request", () => {
  assert.equal(createBrowserChatRequest("session-id", "   "), null);
});
