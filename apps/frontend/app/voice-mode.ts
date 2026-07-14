export type VoiceMode = "browser" | "backend-audio";

export type BrowserChatRequest = {
  path: "/chat/message";
  body: {
    sessionId: string;
    message: string;
  };
};

export function resolveVoiceMode(configuredMode?: string): VoiceMode {
  return configuredMode?.trim().toLowerCase() === "backend-audio"
    ? "backend-audio"
    : "browser";
}

export function createBrowserChatRequest(
  sessionId: string,
  transcript: string,
): BrowserChatRequest | null {
  const message = transcript.trim();

  if (!sessionId || !message) {
    return null;
  }

  return {
    path: "/chat/message",
    body: {
      sessionId,
      message,
    },
  };
}

export function getBackendAudioEndpoint(
  mode: VoiceMode,
): "/voice/message" | null {
  return mode === "backend-audio" ? "/voice/message" : null;
}
