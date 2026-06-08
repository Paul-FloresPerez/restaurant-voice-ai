export class VoiceFileInfoResponseDto {
  originalName: string;
  mimeType: string;
  size: number;
}

export class VoiceMessageResponseDto {
  message: string;
  sessionId: string;
  fileInfo: VoiceFileInfoResponseDto;
}
