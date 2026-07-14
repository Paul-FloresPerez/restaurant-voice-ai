const defaultMaximumChunkLength = 180;

export function splitSpeechText(
  text: string,
  maximumChunkLength = defaultMaximumChunkLength,
): string[] {
  const cleanText = text.trim().replace(/\s+/g, " ");

  if (!cleanText) {
    return [];
  }

  const sentences = cleanText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [cleanText];
  const chunks: string[] = [];

  for (const sentence of sentences.map((value) => value.trim())) {
    if (sentence.length <= maximumChunkLength) {
      chunks.push(sentence);
      continue;
    }

    const words = sentence.split(" ");
    let currentChunk = "";

    for (const word of words) {
      const candidate = currentChunk ? `${currentChunk} ${word}` : word;

      if (candidate.length <= maximumChunkLength) {
        currentChunk = candidate;
        continue;
      }

      if (currentChunk) {
        chunks.push(currentChunk);
      }

      if (word.length <= maximumChunkLength) {
        currentChunk = word;
        continue;
      }

      for (let index = 0; index < word.length; index += maximumChunkLength) {
        chunks.push(word.slice(index, index + maximumChunkLength));
      }
      currentChunk = "";
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }
  }

  return chunks;
}
