import assert from "node:assert/strict";
import test from "node:test";
import { splitSpeechText } from "../app/speech-utils.ts";
import {
  createBrowserChatRequest,
  createOnDeviceSpeechOptions,
  resolveVoiceMode,
  shouldUseBrowserRecognition,
  supportsOnDeviceSpeechRecognition,
} from "../app/voice-mode.ts";

test("production always uses browser recognition", () => {
  assert.equal(resolveVoiceMode(undefined), "browser");
  assert.equal(resolveVoiceMode("backend-audio"), "browser");
  assert.equal(shouldUseBrowserRecognition("browser"), true);
});

test("on-device recognition uses es-ES and command quality", () => {
  assert.deepEqual(createOnDeviceSpeechOptions(), {
    langs: ["es-ES"],
    processLocally: true,
    quality: "command",
  });
});

test("local recognition requires available, install, and processLocally", () => {
  const constructor = {
    available() {},
    install() {},
  };

  assert.equal(
    supportsOnDeviceSpeechRecognition(constructor, { processLocally: false }),
    true,
  );
  assert.equal(supportsOnDeviceSpeechRecognition({}, {}), false);
});

test("a real browser transcript targets /chat/message unchanged", () => {
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

test("an empty transcript creates no chat request", () => {
  assert.equal(createBrowserChatRequest("session-id", "   "), null);
});

test("speech remains split into chunks of at most 180 characters", () => {
  const chunks = splitSpeechText("palabra ".repeat(60));

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 180));
});
