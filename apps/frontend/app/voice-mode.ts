export const voiceMessageEndpoint = "/voice/message";
export const maximumVoiceRecordingDurationMs = 15_000;
export const voiceMessageTimeoutMs = 45_000;

const supportedAudioMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

export type SupportedAudioMimeType = (typeof supportedAudioMimeTypes)[number];

export function getPreferredAudioMimeType(
  isTypeSupported: (mimeType: string) => boolean,
): SupportedAudioMimeType | null {
  return (
    supportedAudioMimeTypes.find((mimeType) => isTypeSupported(mimeType)) ??
    null
  );
}
