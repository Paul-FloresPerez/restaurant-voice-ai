"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { splitSpeechText } from "./speech-utils";
import {
  getPreferredAudioMimeType,
  maximumVoiceRecordingDurationMs,
  voiceMessageEndpoint,
  voiceMessageTimeoutMs,
} from "./voice-mode";

type Session = {
  id: string;
  channel: string;
  tableLabel: string | null;
  status: string;
};

type MenuVariant = {
  id: string;
  name: string;
  price: string;
  isDefault: boolean;
};

type MenuItem = {
  id: string;
  categoryName: string;
  name: string;
  description: string | null;
  isVegetarian: boolean;
  isVegan: boolean;
  isSpicy: boolean;
  variants: MenuVariant[];
};

type ChatResponse = {
  sessionId: string;
  orderId: string;
  intent: string;
  assistantMessage: string;
};

type ConversationEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
};

type OrderItem = {
  id: string;
  itemName: string;
  variantName: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  specialInstructions: string | null;
  modifiers: Array<{
    id: string;
    optionName: string;
    quantity: number;
    priceDelta: string;
  }>;
};

type Order = {
  id: string;
  status: string;
  total: string;
  subtotal: string;
  items: OrderItem[];
};

type VoiceMessageResponse = {
  sessionId: string;
  transcription: string;
  assistantMessage: string;
  intent: string;
  order?: Order | null;
};

type VoiceState =
  | "idle"
  | "listening"
  | "processing"
  | "speaking"
  | "error";
type BackendStatus = "preparing" | "ready" | "unavailable";
type SpeakOptions = {
  markAsSpeaking?: boolean;
  onEnd?: () => void;
};

const apiUrl = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
).replace(/\/$/, "");

const luffyIntro =
  "Hola, soy Luffy, tu mesero virtual. Puedo leerte la carta, agregar o quitar productos y ayudarte a confirmar tu pedido. ¿Qué deseas ordenar?";

const noPermissionMessage =
  "No tengo permiso para usar el microfono. Activa el permiso del navegador o usa el modo prueba.";
const noAudioCaptureMessage =
  "No encuentro un microfono disponible. Revisa el dispositivo de audio o usa el modo prueba.";
const unsupportedMediaRecorderMessage =
  "Este navegador no permite grabar audio WebM. Usa el modo texto o los botones rapidos.";
const audioSendErrorMessage =
  "No pude enviar el audio al servidor. Usa los botones rapidos o el modo prueba.";
const noSessionForAudioMessage =
  "No existe una sesion activa para enviar audio. Intenta iniciar nuevamente.";

const quickActions = [
  { label: "Leer carta", message: "leer carta" },
  { label: "Hamburguesas", message: "que hamburguesas hay" },
  { label: "Bebidas", message: "que bebidas hay" },
  { label: "Postres", message: "que postres hay" },
  { label: "Repetir pedido", message: "repiteme mi pedido" },
  { label: "Confirmar pedido", message: "confirmo mi pedido" },
];
const voiceStatus: Record<VoiceState, { title: string; helper: string }> = {
  idle: {
    title: "Toca para hablar",
    helper: "Luffy iniciara la sesion y te guiara paso a paso.",
  },
  listening: {
    title: "Te escucho",
    helper: "Te escucho. Toca nuevamente para enviar.",
  },
  processing: {
    title: "Procesando tu pedido...",
    helper: "Procesando tu pedido...",
  },
  speaking: {
    title: "Luffy está respondiendo...",
    helper: "Escucha la respuesta. Luego toca otra vez para hablar.",
  },
  error: {
    title: "Problema de voz",
    helper: "El flujo esta listo para intentar nuevamente.",
  },
};

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(errorBody, response.status));
  }

  return response.json() as Promise<T>;
}

function getApiErrorMessage(errorBody: unknown, status: number): string {
  if (typeof errorBody !== "object" || errorBody === null) {
    return `Error HTTP ${status}`;
  }

  const message = "message" in errorBody ? errorBody.message : undefined;

  if (Array.isArray(message)) {
    return message.join(", ");
  }

  if (typeof message === "string") {
    return message;
  }

  return `Error HTTP ${status}`;
}

function formatMoney(value: string): string {
  const numberValue = Number(value);

  if (Number.isNaN(numberValue)) {
    return value;
  }

  return `S/ ${numberValue.toFixed(2)}`;
}

function newEntry(role: ConversationEntry["role"], text: string) {
  return {
    id: crypto.randomUUID(),
    role,
    text,
  };
}

function pickSpanishVoice(voices: SpeechSynthesisVoice[]) {
  const languagePriority = ["es-pe", "es-mx", "es-us", "es-es"];
  const spanishVoices = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith("es"),
  );
  const bestAvailableVoice = (candidates: SpeechSynthesisVoice[]) =>
    candidates.find((voice) => voice.localService) ?? candidates[0];

  for (const language of languagePriority) {
    const voice = bestAvailableVoice(
      spanishVoices.filter(
        (candidate) => candidate.lang.toLowerCase() === language,
      ),
    );

    if (voice) {
      return voice;
    }
  }

  return bestAvailableVoice(spanishVoices) ?? voices[0];
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [message, setMessage] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [orderStatus, setOrderStatus] = useState("Sin pedido activo.");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [heardText, setHeardText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isLoadingMenu, setIsLoadingMenu] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isTestModeOpen, setIsTestModeOpen] = useState(false);
  const [backendStatus, setBackendStatus] =
    useState<BackendStatus>("preparing");
  const [mediaRecorderSupported, setMediaRecorderSupported] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [selectedVoiceLabel, setSelectedVoiceLabel] =
    useState("Voz no seleccionada");
  const hasPlayedInitialMenuRef = useRef(false);
  const isCreatingSessionRef = useRef(false);
  const isSendingMessageRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const speechOutputUnlockedRef = useRef(false);
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const activeSpeechTextRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const maxRecordingTimeoutRef = useRef<number | null>(null);
  const isStartingAudioRef = useRef(false);
  const isStoppingAudioRef = useRef(false);
  const activeVoiceRequestRef = useRef<string | null>(null);
  const voiceRequestAbortControllerRef = useRef<AbortController | null>(null);
  const speechRunIdRef = useRef(0);
  const speechTimeoutRef = useRef<number | null>(null);

  const groupedMenu = useMemo(() => {
    return menuItems.reduce<Record<string, MenuItem[]>>((groups, item) => {
      const category = item.categoryName || "Sin categoria";
      groups[category] = [...(groups[category] ?? []), item];
      return groups;
    }, {});
  }, [menuItems]);

  const sessionLabel = session ? "Activa" : "No iniciada";
  const isMicDisabled =
    backendStatus !== "ready" ||
    isCreatingSession ||
    isSendingMessage ||
    voiceState === "processing" ||
    voiceState === "speaking";
  const isChatDisabled =
    backendStatus !== "ready" ||
    isCreatingSession ||
    isSendingMessage ||
    isRecordingAudio;
  const currentVoiceStatus =
    backendStatus === "preparing"
      ? {
          title: "Preparando a Luffy...",
          helper:
            "El servidor se está activando. El micrófono estará disponible en un momento.",
        }
      : backendStatus === "unavailable"
        ? {
            title: "Luffy no está disponible",
            helper: "Recarga la página para intentar conectar nuevamente.",
          }
        : voiceStatus[voiceState];

  async function loadVoices() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return null;
    }

    const voices = await getAvailableVoices();

    if (voices.length > 0 && !selectedVoiceRef.current) {
      const voice = pickSpanishVoice(voices) ?? null;
      selectedVoiceRef.current = voice;
      setSelectedVoiceLabel(
        voice ? `${voice.name} (${voice.lang})` : "Voz no disponible",
      );
      console.log("Voz de Luffy seleccionada:", voice?.name, voice?.lang);
    }

    return selectedVoiceRef.current;
  }

  function unlockSpeechOutput() {
    if (
      speechOutputUnlockedRef.current ||
      typeof window === "undefined" ||
      !("speechSynthesis" in window)
    ) {
      return;
    }

    window.speechSynthesis.resume();
    speechOutputUnlockedRef.current = true;
  }

  function canUseMediaRecorder() {
    return (
      typeof window !== "undefined" &&
      "MediaRecorder" in window &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      getPreferredAudioMimeType(MediaRecorder.isTypeSupported.bind(MediaRecorder)) !==
        null
    );
  }

  function getAvailableVoices(): Promise<SpeechSynthesisVoice[]> {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return Promise.resolve([]);
    }

    const loadedVoices = window.speechSynthesis.getVoices();

    if (loadedVoices.length > 0) {
      return Promise.resolve(loadedVoices);
    }

    return new Promise((resolve) => {
      const previousHandler = window.speechSynthesis.onvoiceschanged;
      const fallbackTimer = window.setTimeout(() => {
        window.speechSynthesis.onvoiceschanged = previousHandler;
        resolve(window.speechSynthesis.getVoices());
      }, 800);

      window.speechSynthesis.onvoiceschanged = (event) => {
        window.clearTimeout(fallbackTimer);
        window.speechSynthesis.onvoiceschanged = previousHandler;
        previousHandler?.call(window.speechSynthesis, event);
        resolve(window.speechSynthesis.getVoices());
      };
    });
  }

  function cancelSpeechOutput() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    speechRunIdRef.current += 1;

    if (speechTimeoutRef.current !== null) {
      window.clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }

    isSpeakingRef.current = false;
    activeSpeechTextRef.current = null;
    window.speechSynthesis.cancel();
  }

  async function speak(text: string, options: SpeakOptions = {}) {
    const cleanText = text.trim();

    if (
      !cleanText ||
      typeof window === "undefined" ||
      !("speechSynthesis" in window)
    ) {
      options.onEnd?.();
      return;
    }

    if (mediaRecorderRef.current?.state === "recording") {
      options.onEnd?.();
      return;
    }

    if (isSpeakingRef.current && activeSpeechTextRef.current === cleanText) {
      return;
    }

    unlockSpeechOutput();
    cancelSpeechOutput();

    const runId = speechRunIdRef.current + 1;
    const shouldMarkAsSpeaking = options.markAsSpeaking ?? true;
    const chunks = splitSpeechText(cleanText);
    speechRunIdRef.current = runId;
    isSpeakingRef.current = true;
    activeSpeechTextRef.current = cleanText;

    if (shouldMarkAsSpeaking) {
      setVoiceState("speaking");
    }

    const stableVoice = selectedVoiceRef.current ?? (await loadVoices());

    if (speechRunIdRef.current !== runId) {
      return;
    }

    let hasFinished = false;
    const finish = () => {
      if (hasFinished || speechRunIdRef.current !== runId) {
        return;
      }

      hasFinished = true;

      if (speechTimeoutRef.current !== null) {
        window.clearTimeout(speechTimeoutRef.current);
        speechTimeoutRef.current = null;
      }

      isSpeakingRef.current = false;
      activeSpeechTextRef.current = null;
      options.onEnd?.();
    };

    const speakChunk = (index: number) => {
      if (speechRunIdRef.current !== runId) {
        return;
      }

      if (index >= chunks.length) {
        finish();
        return;
      }

      const chunk = chunks[index];
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.lang = "es-PE";
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;

      if (stableVoice) {
        utterance.voice = stableVoice;
      }

      utterance.onstart = () => {
        if (shouldMarkAsSpeaking && speechRunIdRef.current === runId) {
          setVoiceState("speaking");
        }
      };
      utterance.onend = () => {
        if (speechTimeoutRef.current !== null) {
          window.clearTimeout(speechTimeoutRef.current);
          speechTimeoutRef.current = null;
        }

        speakChunk(index + 1);
      };
      utterance.onerror = finish;
      speechTimeoutRef.current = window.setTimeout(() => {
        if (speechRunIdRef.current === runId) {
          window.speechSynthesis.cancel();
          finish();
        }
      }, Math.min(16000, Math.max(5000, chunk.length * 80)));
      window.speechSynthesis.speak(utterance);
    };

    speakChunk(0);
  }

  async function loadMenu(): Promise<MenuItem[]> {
    setIsLoadingMenu(true);
    setError(null);

    try {
      const items = await apiRequest<MenuItem[]>("/menu/items");
      setMenuItems(items);
      return items;
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo cargar el menu.",
      );
      return [];
    } finally {
      setIsLoadingMenu(false);
    }
  }

  async function ensureMenuLoaded(): Promise<MenuItem[]> {
    if (menuItems.length > 0) {
      return menuItems;
    }

    return loadMenu();
  }

  async function playWelcome() {
    if (hasPlayedInitialMenuRef.current) {
      return;
    }

    hasPlayedInitialMenuRef.current = true;
    setConversation((entries) => [
      ...entries,
      newEntry("assistant", luffyIntro),
    ]);
    await speak(luffyIntro, {
      onEnd: () => setVoiceState("idle"),
    });
  }

  async function prepareBackend(): Promise<boolean> {
    setBackendStatus("preparing");

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const abortController = new AbortController();
      const timeout = window.setTimeout(() => abortController.abort(), 25000);

      try {
        const response = await fetch(`${apiUrl}/`, {
          method: "GET",
          cache: "no-store",
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Backend unavailable: ${response.status}`);
        }

        setBackendStatus("ready");
        setError(null);
        return true;
      } catch {
        if (attempt < 3) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    setBackendStatus("unavailable");
    setError(
      "No pude preparar a Luffy. Recarga la página para intentar nuevamente.",
    );
    return false;
  }

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setMediaRecorderSupported(canUseMediaRecorder());
      void loadVoices();
      void prepareBackend().then((isReady) => {
        if (isReady) {
          void loadMenu();
        }
      });
    });

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        void loadVoices();
      };
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      cleanupAudioCapture(false);
      cancelSpeechOutput();
      voiceRequestAbortControllerRef.current?.abort();
      voiceRequestAbortControllerRef.current = null;
      activeVoiceRequestRef.current = null;
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
    // Mount-only browser initialization. The called functions are event-style
    // helpers and should not retrigger this setup on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createSession({
    shouldPlayWelcome = true,
  }: { shouldPlayWelcome?: boolean } = {}) {
    if (isCreatingSessionRef.current) {
      return null;
    }

    cancelSpeechOutput();
    isCreatingSessionRef.current = true;
    setIsCreatingSession(true);
    setVoiceState("processing");
    setError(null);

    try {
      const [createdSession] = await Promise.all([
        apiRequest<Session>("/sessions", {
          method: "POST",
          body: JSON.stringify({ channel: "frontend-luffy-accessible-voice" }),
        }),
        ensureMenuLoaded(),
      ]);

      setSession(createdSession);
      setOrder(null);
      setOrderStatus("Sesion creada. Aun no hay pedido activo.");

      if (shouldPlayWelcome) {
        hasPlayedInitialMenuRef.current = false;
        await playWelcome();
      } else {
        setVoiceState("idle");
      }

      return createdSession;
    } catch (requestError) {
      setVoiceState("error");
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo crear la sesion.",
      );
      return null;
    } finally {
      isCreatingSessionRef.current = false;
      setIsCreatingSession(false);
    }
  }

  async function loadCurrentOrder(sessionId: string): Promise<Order | null> {
    try {
      const currentOrder = await apiRequest<Order>(
        `/orders/current/${sessionId}`,
      );
      setOrder(currentOrder);
      setOrderStatus("");
      return currentOrder;
    } catch (requestError) {
      setOrder(null);
      setOrderStatus(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo consultar el pedido actual.",
      );
      return null;
    }
  }

  async function sendChatMessage(
    text: string,
    targetSession = session,
    path: "/chat/message" = "/chat/message",
  ) {
    const cleanMessage = text.trim();

    if (!cleanMessage) {
      return;
    }

    let activeSession = targetSession;

    if (!activeSession) {
      activeSession = await createSession({ shouldPlayWelcome: false });
    }

    if (!activeSession) {
      return;
    }

    isSendingMessageRef.current = true;
    setIsSendingMessage(true);
    setVoiceState("processing");
    setError(null);
    setConversation((entries) => [...entries, newEntry("user", cleanMessage)]);

    const abortController = new AbortController();
    let didTimeOut = false;
    const timeoutId = window.setTimeout(() => {
      didTimeOut = true;
      abortController.abort();
    }, 20000);

    try {
      const response = await apiRequest<ChatResponse>(path, {
        method: "POST",
        signal: abortController.signal,
        body: JSON.stringify({
          sessionId: activeSession.id,
          message: cleanMessage,
        }),
      });
      void loadCurrentOrder(activeSession.id);

      setConversation((entries) => [
        ...entries,
        newEntry("assistant", response.assistantMessage),
      ]);
      void speak(response.assistantMessage, {
        onEnd: () => setVoiceState("idle"),
      });
    } catch (requestError) {
      const errorMessage = didTimeOut
        ? "La solicitud tardó más de 20 segundos. Intenta nuevamente."
        : requestError instanceof Error
          ? requestError.message
          : "No se pudo enviar el mensaje.";
      const spokenError = `Luffy tuvo un problema enviando tu mensaje. ${errorMessage}. Toca nuevamente para intentarlo.`;
      setError(errorMessage);
      setVoiceState("error");
      setConversation((entries) => [
        ...entries,
        newEntry("assistant", spokenError),
      ]);
      void loadCurrentOrder(activeSession.id);
      void speak(spokenError, { onEnd: () => setVoiceState("idle") });
    } finally {
      window.clearTimeout(timeoutId);
      isSendingMessageRef.current = false;
      setIsSendingMessage(false);
    }
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanMessage = message.trim();

    if (!cleanMessage) {
      return;
    }

    setMessage("");
    unlockSpeechOutput();
    await sendChatMessage(cleanMessage);
  }

  async function runQuickAction(text: string) {
    unlockSpeechOutput();
    let activeSession = session;

    if (!activeSession) {
      activeSession = await createSession({ shouldPlayWelcome: false });
    }

    if (!activeSession) {
      return;
    }

    await sendChatMessage(text, activeSession);
  }

  function cleanupAudioCapture(shouldUpdateState = true) {
    if (maxRecordingTimeoutRef.current !== null) {
      window.clearTimeout(maxRecordingTimeoutRef.current);
      maxRecordingTimeoutRef.current = null;
    }

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onerror = null;
      mediaRecorderRef.current.onstop = null;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    isStartingAudioRef.current = false;
    isStoppingAudioRef.current = false;
    if (shouldUpdateState) {
      setIsRecordingAudio(false);
    }
  }

  function getAudioMimeType() {
    return typeof MediaRecorder === "undefined"
      ? null
      : getPreferredAudioMimeType(MediaRecorder.isTypeSupported.bind(MediaRecorder));
  }

  function reportVoiceError(message: string) {
    cleanupAudioCapture();
    setVoiceState("idle");
    setError(message);
    setConversation((entries) => [
      ...entries,
      newEntry("assistant", message),
    ]);
    void speak(message, { onEnd: () => setVoiceState("idle") });
  }

  async function startAudioRecording(activeSession: Session) {
    if (
      isStartingAudioRef.current ||
      mediaRecorderRef.current?.state === "recording" ||
      activeVoiceRequestRef.current
    ) {
      return;
    }

    if (!activeSession.id) {
      reportVoiceError(noSessionForAudioMessage);
      return;
    }

    if (!canUseMediaRecorder()) {
      reportVoiceError(unsupportedMediaRecorderMessage);
      return;
    }

    if (isSpeakingRef.current || isSpeechOutputActive()) {
      setVoiceState("speaking");
      return;
    }

    isStartingAudioRef.current = true;
    setVoiceState("processing");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = getAudioMimeType();

      if (!mimeType) {
        throw new DOMException(
          "No hay un formato WebM compatible.",
          "NotSupportedError",
        );
      }

      const recorder = new MediaRecorder(stream, { mimeType });

      audioChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      isStoppingAudioRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        const message =
          "Ocurrio un problema grabando el audio. Usa los botones rapidos o el modo prueba.";
        reportVoiceError(message);
      };

      let hasHandledStop = false;
      recorder.onstop = () => {
        if (hasHandledStop) {
          return;
        }

        hasHandledStop = true;
        void finishAudioRecording(activeSession.id, recorder.mimeType || mimeType);
      };

      recorder.start();
      maxRecordingTimeoutRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          stopAudioRecording();
        }
      }, maximumVoiceRecordingDurationMs);
      setIsRecordingAudio(true);
      setHeardText("");
      setError(null);
      setVoiceState("listening");
    } catch (recordingError) {
      cleanupAudioCapture();
      const permissionDenied =
        recordingError instanceof DOMException &&
        (recordingError.name === "NotAllowedError" ||
          recordingError.name === "SecurityError");
      const microphoneNotFound =
        recordingError instanceof DOMException &&
        (recordingError.name === "NotFoundError" ||
          recordingError.name === "DevicesNotFoundError");
      const unsupportedFormat =
        recordingError instanceof DOMException &&
        recordingError.name === "NotSupportedError";
      const message = permissionDenied
        ? noPermissionMessage
        : microphoneNotFound
          ? noAudioCaptureMessage
          : unsupportedFormat
            ? unsupportedMediaRecorderMessage
            : "No pude iniciar la grabacion de audio. Usa los botones rapidos o el modo prueba.";

      reportVoiceError(message);
    } finally {
      isStartingAudioRef.current = false;
    }
  }

  function stopAudioRecording() {
    const recorder = mediaRecorderRef.current;

    if (isStoppingAudioRef.current) {
      return;
    }

    if (!recorder || recorder.state === "inactive") {
      cleanupAudioCapture();
      setVoiceState("idle");
      return;
    }

    isStoppingAudioRef.current = true;
    if (maxRecordingTimeoutRef.current !== null) {
      window.clearTimeout(maxRecordingTimeoutRef.current);
      maxRecordingTimeoutRef.current = null;
    }
    setIsRecordingAudio(false);
    setVoiceState("processing");
    setHeardText("");
    try {
      recorder.stop();
    } catch {
      reportVoiceError(
        "No pude detener la grabacion. Toca nuevamente para intentarlo.",
      );
    }
  }

  async function finishAudioRecording(sessionId: string, mimeType: string) {
    const chunks = [...audioChunksRef.current];
    const audioMimeType = mimeType || "audio/webm";
    cleanupAudioCapture();
    const audioBlob = new Blob(chunks, { type: audioMimeType });

    if (activeVoiceRequestRef.current) {
      setVoiceState("idle");
      return;
    }

    if (!sessionId) {
      reportVoiceError(noSessionForAudioMessage);
      return;
    }

    if (audioBlob.size === 0) {
      const message =
        "No se capturo audio. Toca nuevamente el microfono para intentarlo.";
      reportVoiceError(message);
      return;
    }

    const requestId = crypto.randomUUID();
    const abortController = new AbortController();
    let didTimeOut = false;
    activeVoiceRequestRef.current = requestId;
    voiceRequestAbortControllerRef.current = abortController;
    isSendingMessageRef.current = true;
    setIsSendingMessage(true);
    setVoiceState("processing");

    const formData = new FormData();
    formData.append("sessionId", sessionId);
    formData.append("audio", audioBlob, "pedido-voz.webm");
    const timeoutId = window.setTimeout(() => {
      didTimeOut = true;
      abortController.abort();
    }, voiceMessageTimeoutMs);

    try {
      const response = await fetch(`${apiUrl}${voiceMessageEndpoint}`, {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(getApiErrorMessage(errorBody, response.status));
      }

      const voiceResponse = (await response.json()) as VoiceMessageResponse;
      const transcription = voiceResponse.transcription?.trim() ?? "";
      const assistantMessage =
        voiceResponse.assistantMessage?.trim() ||
        "No recibi una respuesta del asistente.";

      if (!transcription) {
        throw new Error("No pude entender el audio. Intenta nuevamente.");
      }

      if ("order" in voiceResponse) {
        setOrder(voiceResponse.order ?? null);
        setOrderStatus(voiceResponse.order ? "" : "Sin pedido activo.");
      } else {
        await loadCurrentOrder(voiceResponse.sessionId || sessionId);
      }

      setError(null);
      setHeardText(transcription);
      setConversation((entries) => [
        ...entries,
        newEntry("user", transcription),
        newEntry("assistant", assistantMessage),
      ]);
      void speak(assistantMessage, {
        onEnd: () => setVoiceState("idle"),
      });
    } catch (sendError) {
      const detail = didTimeOut
        ? "La solicitud tardó más de 45 segundos. Intenta nuevamente."
        : sendError instanceof TypeError
          ? "No se pudo conectar con el servidor. Revisa tu conexión e intenta nuevamente."
          : sendError instanceof Error
            ? sendError.message
            : "Ocurrió un error de red.";
      reportVoiceError(`${audioSendErrorMessage} ${detail}`);
    } finally {
      window.clearTimeout(timeoutId);
      if (activeVoiceRequestRef.current === requestId) {
        activeVoiceRequestRef.current = null;
      }
      if (voiceRequestAbortControllerRef.current === abortController) {
        voiceRequestAbortControllerRef.current = null;
      }
      isSendingMessageRef.current = false;
      setIsSendingMessage(false);
    }
  }

  function isSpeechOutputActive() {
    return (
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      (window.speechSynthesis.speaking || window.speechSynthesis.pending)
    );
  }

  async function handleMainTouch() {
    unlockSpeechOutput();
    void loadVoices();

    if (mediaRecorderRef.current?.state === "recording") {
      stopAudioRecording();
      return;
    }

    if (isSpeakingRef.current || isSpeechOutputActive()) {
      console.log("Microfono bloqueado: Luffy esta hablando.");
      setVoiceState("speaking");
      return;
    }

    if (isMicDisabled) {
      return;
    }

    let activeSession = session;

    if (!activeSession) {
      activeSession = await createSession({ shouldPlayWelcome: false });
    }

    if (!activeSession) {
      setVoiceState("error");
      setError(noSessionForAudioMessage);
      return;
    }

    await startAudioRecording(activeSession);
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6">
        <header className="flex flex-col gap-3 rounded-md border border-white/15 bg-neutral-900 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Menu por Voz
            </h1>
            <p className="mt-1 text-xl text-neutral-200">
              Luffy, tu mesero virtual
            </p>
            <p className="mt-1 text-base text-neutral-400">
              Restaurante Real
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-md border border-white/15 bg-black px-4 py-2">
              <p className="text-xs uppercase text-neutral-400">
                Estado de sesion
              </p>
              <p className="text-xl font-semibold">{sessionLabel}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                unlockSpeechOutput();
                void loadVoices();
                void createSession();
              }}
              disabled={backendStatus !== "ready" || isCreatingSession}
              className="min-h-12 rounded-md bg-emerald-300 px-4 text-lg font-semibold text-neutral-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-300"
            >
              {session ? "Nueva sesion" : "Iniciar"}
            </button>
          </div>
        </header>

        <div
          role="status"
          aria-live="polite"
          className={`rounded-md border px-5 py-3 text-lg ${
            backendStatus === "ready"
              ? "border-emerald-300/50 bg-emerald-950 text-emerald-100"
              : backendStatus === "preparing"
                ? "border-amber-300/50 bg-amber-950 text-amber-100"
                : "border-red-300/50 bg-red-950 text-red-100"
          }`}
        >
          {backendStatus === "ready"
            ? "Luffy está listo"
            : backendStatus === "preparing"
              ? "Preparando a Luffy..."
              : "Luffy no está disponible"}
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-950 px-5 py-4 text-xl text-red-100"
          >
            {error}
          </div>
        ) : null}

        <section className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="flex min-h-[42rem] flex-col rounded-md border border-white/15 bg-neutral-900 p-4">
            <button
              type="button"
              onClick={() => void handleMainTouch()}
              disabled={isMicDisabled}
              aria-label={
                voiceState === "listening"
                  ? "Detener grabacion y enviar el pedido a Luffy"
                  : "Toca para hablar con Luffy"
              }
              className="relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-md border border-emerald-300/40 bg-black px-5 py-8 text-center outline-none transition hover:border-emerald-200 focus-visible:ring-4 focus-visible:ring-emerald-300 disabled:cursor-wait disabled:border-white/15"
            >
              {voiceState === "listening" ? (
                <>
                  <span className="absolute h-[20rem] w-[20rem] rounded-full border border-emerald-300/50 animate-ping" />
                  <span className="absolute h-[34rem] w-[34rem] rounded-full border border-emerald-300/20 animate-pulse" />
                </>
              ) : null}

              {voiceState === "processing" ? (
                <span className="absolute h-[28rem] w-[28rem] rounded-full border border-sky-300/30 animate-pulse" />
              ) : null}

              <span
                className={`relative flex h-64 w-64 items-center justify-center rounded-full border text-white shadow-2xl sm:h-80 sm:w-80 ${
                  voiceState === "listening"
                    ? "border-emerald-200 bg-emerald-400/25 shadow-emerald-400/30"
                    : voiceState === "processing"
                      ? "border-sky-200 bg-sky-400/20 shadow-sky-400/20"
                      : "border-white/25 bg-neutral-900"
                }`}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-32 w-32 sm:h-40 sm:w-40"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.7"
                >
                  <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
                  <path d="M5 11a7 7 0 0 0 14 0" />
                  <path d="M12 18v3" />
                  <path d="M8 21h8" />
                </svg>
              </span>

              <p className="relative mt-8 text-4xl font-semibold sm:text-6xl">
                {currentVoiceStatus.title}
              </p>
              <p className="relative mt-5 max-w-3xl text-2xl leading-10 text-neutral-200">
                {currentVoiceStatus.helper}
              </p>

              {heardText ? (
                <p className="relative mt-6 max-w-3xl rounded-md border border-emerald-300/40 bg-neutral-950/90 px-5 py-4 text-2xl text-emerald-100">
                  Entendí: {heardText}
                </p>
              ) : null}

              <div className="relative mt-8 grid gap-3 text-left text-xl text-neutral-300 sm:grid-cols-2">
                {quickActions.slice(0, 4).map((action) => (
                  <p
                    key={action.message}
                    className="rounded-md border border-white/10 bg-neutral-950/80 px-4 py-3"
                  >
                    Puedes decir: {action.message}.
                  </p>
                ))}
              </div>
            </button>
          </section>

          <aside className="grid gap-4">
            <SecondaryActions
              disabled={isChatDisabled}
              onAction={(text) => void runQuickAction(text)}
            />
            <OrderPanel order={order} orderStatus={orderStatus} />
            <MenuSummary groupedMenu={groupedMenu} isLoadingMenu={isLoadingMenu} />
          </aside>
        </section>

        <section className="rounded-md border border-white/15 bg-neutral-900 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Historial y modo prueba</h2>
              <p className="mt-1 text-base text-neutral-400">
                El texto queda oculto para usuarios; se usa solo para pruebas.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsTestModeOpen((isOpen) => !isOpen)}
              className="min-h-11 rounded-md border border-white/20 px-4 text-base font-semibold transition hover:bg-white hover:text-neutral-950"
            >
              {isTestModeOpen ? "Ocultar modo prueba" : "Modo prueba"}
            </button>
          </div>

          <ConversationPreview conversation={conversation} />

          {isTestModeOpen ? (
            <div className="mt-4 border-t border-white/10 pt-4">
              <div className="grid gap-3 md:grid-cols-4">
                <p className="rounded-md border border-white/10 bg-black px-4 py-3 text-base text-neutral-300">
                  Voz seleccionada: {selectedVoiceLabel}
                </p>
                <p className="rounded-md border border-white/10 bg-black px-4 py-3 text-base text-neutral-300">
                  Endpoint de voz: {voiceMessageEndpoint}
                </p>
                <p className="rounded-md border border-white/10 bg-black px-4 py-3 text-base text-neutral-300">
                  Grabacion real:{" "}
                  {mediaRecorderSupported ? "disponible" : "no disponible"}
                </p>
                <p className="rounded-md border border-white/10 bg-black px-4 py-3 text-base text-neutral-300">
                  Limite de grabacion: 15 segundos
                </p>
              </div>
              <form
                onSubmit={submitMessage}
                className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]"
              >
                <label htmlFor="message" className="sr-only">
                  Mensaje de prueba
                </label>
                <textarea
                  id="message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  disabled={isChatDisabled}
                  rows={3}
                  maxLength={1000}
                  placeholder="Modo prueba: escribe una frase para POST /chat/message"
                  className="min-h-24 resize-y rounded-md border border-white/20 bg-black px-4 py-3 text-lg text-white outline-none placeholder:text-neutral-500 focus:border-emerald-300 focus:ring-4 focus:ring-emerald-300/25 disabled:cursor-not-allowed disabled:bg-neutral-800"
                />
                <button
                  type="submit"
                  disabled={isChatDisabled || !message.trim()}
                  className="min-h-14 rounded-md bg-emerald-300 px-5 text-xl font-semibold text-neutral-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-300"
                >
                  {isSendingMessage ? "Enviando..." : "Enviar"}
                </button>
              </form>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function SecondaryActions({
  disabled,
  onAction,
}: {
  disabled: boolean;
  onAction: (message: string) => void;
}) {
  return (
    <section className="rounded-md border border-white/15 bg-neutral-900 p-4">
      <h2 className="text-2xl font-semibold">Guia rapida</h2>
      <p className="mt-1 text-base text-neutral-400">
        Botones grandes que envian frases como si fueran dichas por voz.
      </p>
      <div className="mt-4 grid gap-3">
        {quickActions.map((action) => (
          <button
            key={action.message}
            type="button"
            onClick={() => onAction(action.message)}
            disabled={disabled}
            className="min-h-14 rounded-md border border-white/20 px-4 text-xl font-semibold transition hover:bg-white hover:text-neutral-950 disabled:cursor-not-allowed disabled:text-neutral-500"
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function ConversationPreview({
  conversation,
}: {
  conversation: ConversationEntry[];
}) {
  const visibleEntries = conversation.slice(-4);

  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      {visibleEntries.length === 0 ? (
        <p className="rounded-md border border-white/10 bg-black p-4 text-lg text-neutral-300">
          Al iniciar la sesion, Luffy dara la bienvenida por voz.
        </p>
      ) : (
        visibleEntries.map((entry) => (
          <div
            key={entry.id}
            className={
              entry.role === "user"
                ? "rounded-md bg-emerald-300 p-4 text-neutral-950"
                : "rounded-md border border-white/10 bg-black p-4 text-white"
            }
          >
            <p className="text-sm font-semibold uppercase tracking-wide opacity-75">
              {entry.role === "user" ? "Cliente" : "Luffy"}
            </p>
            <p className="mt-2 text-lg leading-7">{entry.text}</p>
          </div>
        ))
      )}
    </div>
  );
}

function OrderPanel({
  order,
  orderStatus,
}: {
  order: Order | null;
  orderStatus: string;
}) {
  return (
    <section className="rounded-md border border-white/15 bg-neutral-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Pedido actual</h2>
          <p className="mt-1 text-base text-neutral-400">
            Visible, pero secundario a la voz.
          </p>
        </div>
        <span className="rounded-md bg-black px-3 py-2 text-sm text-neutral-300">
          {order?.status ?? "Sin pedido"}
        </span>
      </div>

      <div className="mt-4 rounded-md bg-black p-4">
        <p className="text-base text-neutral-400">Total</p>
        <p className="mt-1 text-4xl font-semibold text-emerald-300">
          {order ? formatMoney(order.total) : "S/ 0.00"}
        </p>
      </div>

      <div className="mt-4 max-h-64 overflow-y-auto">
        {order ? (
          order.items.length === 0 ? (
            <p className="text-lg leading-8 text-neutral-300">
              El pedido esta vacio.
            </p>
          ) : (
            <ul className="space-y-3">
              {order.items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-md border border-white/10 bg-black p-3"
                >
                  <div className="flex justify-between gap-3">
                    <p className="text-lg font-semibold">
                      {item.quantity} x {item.itemName}
                    </p>
                    <p className="text-lg font-semibold text-emerald-300">
                      {formatMoney(item.lineTotal)}
                    </p>
                  </div>
                  {item.variantName && item.variantName !== "Default" ? (
                    <p className="mt-1 text-base text-neutral-400">
                      {item.variantName}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="text-lg leading-8 text-neutral-300">{orderStatus}</p>
        )}
      </div>
    </section>
  );
}

function MenuSummary({
  groupedMenu,
  isLoadingMenu,
}: {
  groupedMenu: Record<string, MenuItem[]>;
  isLoadingMenu: boolean;
}) {
  const entries = Object.entries(groupedMenu);

  return (
    <section className="rounded-md border border-white/15 bg-neutral-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Carta</h2>
        <span className="text-sm text-neutral-400">
          {isLoadingMenu ? "Cargando..." : `${entries.length} categorias`}
        </span>
      </div>
      <div className="mt-4 max-h-80 overflow-y-auto pr-1">
        {entries.length === 0 ? (
          <p className="text-lg text-neutral-300">No hay productos cargados.</p>
        ) : (
          <div className="space-y-4">
            {entries.map(([category, items]) => (
              <div key={category}>
                <h3 className="text-base font-semibold uppercase tracking-wide text-emerald-300">
                  {category}
                </h3>
                <ul className="mt-2 space-y-2">
                  {items.slice(0, 3).map((item) => (
                    <li
                      key={item.id}
                      className="rounded-md border border-white/10 bg-black p-3"
                    >
                      <p className="text-lg font-semibold">{item.name}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.variants.slice(0, 2).map((variant) => (
                          <span
                            key={variant.id}
                            className="rounded-md bg-neutral-800 px-2 py-1 text-sm text-neutral-200"
                          >
                            {variant.name}: {formatMoney(variant.price)}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
