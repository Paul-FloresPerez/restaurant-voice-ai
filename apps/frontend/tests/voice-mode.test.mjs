import assert from "node:assert/strict";
import test from "node:test";
import { splitSpeechText } from "../app/speech-utils.ts";
import {
  createBrowserChatRequest,
  getBackendAudioEndpoint,
  resolveVoiceMode,
  shouldUseBrowserRecognition,
} from "../app/voice-mode.ts";

test("production defaults to backend-audio", () => {
  const mode = resolveVoiceMode(undefined);

  assert.equal(mode, "backend-audio");
  assert.equal(getBackendAudioEndpoint(mode), "/voice/message");
});

test("backend-audio never enables SpeechRecognition", () => {
  assert.equal(shouldUseBrowserRecognition("backend-audio"), false);
  assert.equal(shouldUseBrowserRecognition("browser"), true);
});

test("browser remains an explicit compatibility mode", () => {
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

test("speech is split into sequential chunks of at most 180 characters", () => {
  const chunks = splitSpeechText(
    "Primera oración breve. " + "palabra ".repeat(60) + "Respuesta final.",
  );

  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 180));
  assert.equal(chunks[0], "Primera oración breve.");
});
