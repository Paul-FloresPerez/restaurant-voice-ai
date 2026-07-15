export type VoiceMode = "browser";

export type OnDeviceSpeechOptions = {
  langs: string[];
  processLocally: true;
  quality: "command";
};

export type BrowserChatRequest = {
  path: "/chat/message";
  body: {
    sessionId: string;
    message: string;
  };
};

export function resolveVoiceMode(configuredMode?: string): VoiceMode {
  void configuredMode;
  return "browser";
}

export function shouldUseBrowserRecognition(mode: VoiceMode): boolean {
  return mode === "browser";
}

export function createOnDeviceSpeechOptions(): OnDeviceSpeechOptions {
  return {
    langs: ["es-ES"],
    processLocally: true,
    quality: "command",
  };
}

export function supportsOnDeviceSpeechRecognition(
  constructor: { available?: unknown; install?: unknown },
  recognition: object,
): boolean {
  return (
    typeof constructor.available === "function" &&
    typeof constructor.install === "function" &&
    "processLocally" in recognition
  );
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
