import assert from "node:assert/strict";
import test from "node:test";
import { splitSpeechText } from "../app/speech-utils.ts";
import {
  getPreferredAudioMimeType,
  maximumVoiceRecordingDurationMs,
  voiceMessageEndpoint,
  voiceMessageTimeoutMs,
} from "../app/voice-mode.ts";

test("voice audio uses the backend endpoint and required time limits", () => {
  assert.equal(voiceMessageEndpoint, "/voice/message");
  assert.equal(maximumVoiceRecordingDurationMs, 15_000);
  assert.equal(voiceMessageTimeoutMs, 45_000);
});

test("Opus WebM is preferred when both audio formats are supported", () => {
  assert.equal(
    getPreferredAudioMimeType(() => true),
    "audio/webm;codecs=opus",
  );
});

test("plain WebM is used when Opus WebM is unavailable", () => {
  assert.equal(
    getPreferredAudioMimeType((mimeType) => mimeType === "audio/webm"),
    "audio/webm",
  );
});

test("audio capture reports no format when WebM is unavailable", () => {
  assert.equal(getPreferredAudioMimeType(() => false), null);
});

test("speech is split into sequential chunks of at most 180 characters", () => {
  const chunks = splitSpeechText(
    "Primera oración breve. " + "palabra ".repeat(60) + "Respuesta final.",
  );

  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 180));
  assert.equal(chunks[0], "Primera oración breve.");
});
