"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createBrowserChatRequest,
  getBackendAudioEndpoint,
  resolveVoiceMode,
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
  | "recording"
  | "listening"
  | "processing"
  | "speaking"
  | "error";
type RecognitionLanguage = "es-ES" | "es-MX" | "es-PE";

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
};

type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionErrorEventLike = Event & {
  error: string;
};

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeakOptions = {
  markAsSpeaking?: boolean;
  onEnd?: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    webkitAudioContext?: typeof AudioContext;
  }
}

const apiUrl = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
).replace(/\/$/, "");
const voiceMode = resolveVoiceMode(process.env.NEXT_PUBLIC_VOICE_MODE);

const luffyIntro =
  "Bienvenido al Restaurante Real. Soy Luffy, tu mesero virtual. Puedo leerte la carta, ayudarte a elegir productos y registrar tu pedido. Puedes decir: leer carta, hamburguesas, bebidas, postres, repetir pedido o confirmar pedido.";

const micOffMessage = "Microfono apagado. Toca para hablar nuevamente.";
const noVoiceMessage =
  "No detecte tu voz. Toca nuevamente el centro de la pantalla para intentarlo.";
const noPermissionMessage =
  "No tengo permiso para usar el microfono. Activa el permiso del navegador o usa el modo prueba.";
const noAudioCaptureMessage =
  "No encuentro un microfono disponible. Revisa el dispositivo de audio o usa el modo prueba.";
const recognitionNetworkMessage =
  "El reconocimiento de voz se interrumpio. Puedes usar los botones rapidos o intentar el microfono nuevamente en unos segundos.";
const temporaryVoiceUnavailableMessage =
  "Reconocimiento de voz no disponible temporalmente";
const notUnderstoodMessage =
  "No pude entenderte. Puedes decir: leer carta, bebidas, comida o repetir mi pedido.";
const unsupportedRecognitionMessage =
  "Este navegador no permite reconocimiento de voz aqui. Usa Chrome o Edge, activa permisos, o usa el modo prueba.";
const unsupportedMediaRecorderMessage =
  "Este navegador no permite grabar audio para el modo backend-audio. Usa modo browser o el modo prueba.";
const audioSendErrorMessage =
  "No pude enviar el audio al servidor. Usa los botones rapidos o el modo prueba.";
const noSessionForAudioMessage =
  "No existe una sesion activa para enviar audio. Intenta iniciar nuevamente.";
const silenceDetectionDelayMs = 1700;
const recordingWarmupMs = 700;
const maxRecordingDurationMs = 8000;
const silenceVolumeThreshold = 0.018;

const quickActions = [
  { label: "Leer carta", message: "leer carta" },
  { label: "Hamburguesas", message: "que hamburguesas hay" },
  { label: "Bebidas", message: "que bebidas hay" },
  { label: "Postres", message: "que postres hay" },
  { label: "Repetir pedido", message: "repiteme mi pedido" },
  { label: "Confirmar pedido", message: "confirmo mi pedido" },
];
const recognitionLanguageOptions: RecognitionLanguage[] = [
  "es-ES",
  "es-MX",
  "es-PE",
];

const voiceStatus: Record<VoiceState, { title: string; helper: string }> = {
  idle: {
    title: "Toca para hablar",
    helper: "Luffy iniciara la sesion y te guiara paso a paso.",
  },
  recording: {
    title: "Grabando audio...",
    helper: "Toca nuevamente el centro para detener y enviar el audio.",
  },
  listening: {
    title: "Escuchando",
    helper:
      "Habla ahora. Puedes decir: leer carta, hamburguesas, bebidas o repetir pedido.",
  },
  processing: {
    title: "Procesando",
    helper: "Luffy esta preparando o enviando tu solicitud.",
  },
  speaking: {
    title: "Luffy esta hablando",
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

function getRecognitionConstructor() {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

function pickSpanishVoice(voices: SpeechSynthesisVoice[]) {
  const spanishVoices = voices.filter((voice) => {
    const haystack = `${voice.lang} ${voice.name}`.toLowerCase();
    return (
      voice.lang.toLowerCase().startsWith("es") ||
      haystack.includes("spanish") ||
      haystack.includes("espanol")
    );
  });

  const masculineTerms = [
    "pablo",
    "jorge",
    "diego",
    "carlos",
    "raul",
    "alvaro",
    "male",
    "hombre",
  ];
  const languageTerms = ["es-pe", "es-es", "es-mx"];
  const normalizedVoice = (voice: SpeechSynthesisVoice) =>
    `${voice.lang} ${voice.name}`.toLowerCase();

  for (const language of languageTerms) {
    const voice = spanishVoices.find((candidate) => {
      const haystack = normalizedVoice(candidate);
      return (
        haystack.includes(language) &&
        masculineTerms.some((term) => haystack.includes(term))
      );
    });

    if (voice) {
      return voice;
    }
  }

  const masculineVoice = spanishVoices.find((voice) =>
    masculineTerms.some((term) => normalizedVoice(voice).includes(term)),
  );

  if (masculineVoice) {
    return masculineVoice;
  }

  return (
    languageTerms
      .map((term) =>
        spanishVoices.find((voice) => normalizedVoice(voice).includes(term)),
      )
      .find(Boolean) ??
    spanishVoices[0] ??
    voices[0]
  );
}

function buildCategoryMessage(items: MenuItem[]) {
  const categories = Array.from(
    new Set(items.map((item) => item.categoryName).filter(Boolean)),
  );

  if (categories.length === 0) {
    return "Aun no tengo categorias disponibles. Puedes decir: leer carta, hamburguesas, bebidas o postres.";
  }

  return `Tambien puedo leer opciones de la carta. Categorias disponibles: ${categories.join(
    ", ",
  )}. Puedes decir: leer carta, hamburguesas, bebidas, postres, repetir pedido o confirmar pedido.`;
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
  const [clientReady, setClientReady] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [mediaRecorderSupported, setMediaRecorderSupported] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [selectedVoiceLabel, setSelectedVoiceLabel] =
    useState("Voz no seleccionada");
  const [recognitionLang, setRecognitionLang] =
    useState<RecognitionLanguage>("es-PE");
  const [lastRecognitionError, setLastRecognitionError] =
    useState("Sin errores");
  const [isMicTemporarilyUnavailable, setIsMicTemporarilyUnavailable] =
    useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const ignoreNextEndRef = useRef(false);
  const lastMicErrorRef = useRef<string | null>(null);
  const hasPlayedInitialMenuRef = useRef(false);
  const isCreatingSessionRef = useRef(false);
  const isSendingMessageRef = useRef(false);
  const isListeningRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const speechOutputUnlockedRef = useRef(false);
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const activeSpeechTextRef = useRef<string | null>(null);
  const pendingSpeechRef = useRef<{
    text: string;
    options: SpeakOptions;
  } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioAnalysisFrameRef = useRef<number | null>(null);
  const maxRecordingTimeoutRef = useRef<number | null>(null);
  const silenceStartedAtRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef(0);
  const isStoppingAudioRef = useRef(false);
  const speechRunIdRef = useRef(0);
  const speechTimeoutRef = useRef<number | null>(null);
  const networkErrorCountRef = useRef(0);
  const micReenableTimeoutRef = useRef<number | null>(null);

  const groupedMenu = useMemo(() => {
    return menuItems.reduce<Record<string, MenuItem[]>>((groups, item) => {
      const category = item.categoryName || "Sin categoria";
      groups[category] = [...(groups[category] ?? []), item];
      return groups;
    }, {});
  }, [menuItems]);

  const sessionLabel = session ? "Activa" : "No iniciada";
  const isMicDisabled =
    !isRecordingAudio &&
    (!clientReady ||
      isCreatingSession ||
      isSendingMessage ||
      isMicTemporarilyUnavailable ||
      voiceState === "listening" ||
      voiceState === "processing" ||
      voiceState === "speaking");
  const isChatDisabled = isCreatingSession || isSendingMessage || isRecordingAudio;
  const currentVoiceStatus = isMicTemporarilyUnavailable
    ? {
        title: temporaryVoiceUnavailableMessage,
        helper: "Usa los botones rapidos o el modo prueba. Se reactivara en unos segundos.",
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
      Boolean(navigator.mediaDevices?.getUserMedia)
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

  async function speak(text: string, options: SpeakOptions = {}) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      options.onEnd?.();
      return;
    }

    if (isListeningRef.current || mediaRecorderRef.current?.state === "recording") {
      console.log("Voz de Luffy bloqueada: el microfono esta activo.");
      options.onEnd?.();
      return;
    }

    if (recognitionRef.current) {
      stopRecognition("Luffy is about to speak");
    }

    unlockSpeechOutput();

    if (isSpeakingRef.current && activeSpeechTextRef.current === text) {
      console.log("Voz de Luffy: locucion duplicada ignorada.");
      return;
    }

    if (
      isSpeakingRef.current ||
      window.speechSynthesis.speaking ||
      window.speechSynthesis.pending
    ) {
      console.log("Voz de Luffy: locucion en cola hasta terminar la actual.");
      pendingSpeechRef.current = { text, options };
      return;
    }

    if (speechTimeoutRef.current !== null) {
      window.clearTimeout(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }

    const runId = speechRunIdRef.current + 1;
    const shouldMarkAsSpeaking = options.markAsSpeaking ?? true;
    speechRunIdRef.current = runId;
    isSpeakingRef.current = true;
    activeSpeechTextRef.current = text;

    if (shouldMarkAsSpeaking) {
      setVoiceState("speaking");
    }

    const stableVoice = selectedVoiceRef.current ?? (await loadVoices());
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-PE";
    utterance.rate = 0.95;
    utterance.pitch = 0.85;
    utterance.volume = 1;

    if (stableVoice) {
      utterance.voice = stableVoice;
    }

    let hasFinished = false;
    const finish = () => {
      if (hasFinished) {
        return;
      }

      hasFinished = true;

      if (speechRunIdRef.current !== runId) {
        return;
      }

      if (speechTimeoutRef.current !== null) {
        window.clearTimeout(speechTimeoutRef.current);
        speechTimeoutRef.current = null;
      }

      isSpeakingRef.current = false;
      activeSpeechTextRef.current = null;
      options.onEnd?.();

      const pendingSpeech = pendingSpeechRef.current;
      pendingSpeechRef.current = null;

      if (pendingSpeech) {
        void speak(pendingSpeech.text, pendingSpeech.options);
      }
    };

    utterance.onstart = () => {
      if (speechRunIdRef.current !== runId) {
        return;
      }

      isSpeakingRef.current = true;

      if (shouldMarkAsSpeaking) {
        setVoiceState("speaking");
      }
    };
    utterance.onend = finish;
    utterance.onerror = (event) => {
      console.log("speechSynthesis error:", event.error);
      finish();
    };
    speechTimeoutRef.current = window.setTimeout(
      () => {
        if (speechRunIdRef.current !== runId) {
          return;
        }

        console.log("speechSynthesis timeout de seguridad.");
        finish();
      },
      Math.min(30000, Math.max(7000, text.length * 95)),
    );
    window.speechSynthesis.speak(utterance);
  }

  function stopRecognition(reason: string) {
    if (!recognitionRef.current) {
      return;
    }

    console.log("SpeechRecognition detenido:", reason);
    ignoreNextEndRef.current = true;
    isListeningRef.current = false;
    try {
      recognitionRef.current.abort();
    } catch {
      console.log("SpeechRecognition abort no disponible.");
    }
    recognitionRef.current = null;
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

  async function playWelcome(items: MenuItem[]) {
    if (hasPlayedInitialMenuRef.current) {
      return;
    }

    hasPlayedInitialMenuRef.current = true;
    const categoryMessage = buildCategoryMessage(items);

    setConversation((entries) => [
      ...entries,
      newEntry("assistant", luffyIntro),
      newEntry("assistant", categoryMessage),
    ]);
    await speak(`${luffyIntro} ${categoryMessage}`, {
      onEnd: () => setVoiceState("idle"),
    });
  }

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setClientReady(true);
      setSpeechSupported(Boolean(getRecognitionConstructor()));
      setMediaRecorderSupported(canUseMediaRecorder());
      void loadVoices();
      void loadMenu();
    });

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        void loadVoices();
      };
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      stopRecognition("component cleanup");
      cleanupAudioCapture(false);
      if (speechTimeoutRef.current !== null) {
        window.clearTimeout(speechTimeoutRef.current);
        speechTimeoutRef.current = null;
      }
      if (micReenableTimeoutRef.current !== null) {
        window.clearTimeout(micReenableTimeoutRef.current);
        micReenableTimeoutRef.current = null;
      }
      isSpeakingRef.current = false;
      activeSpeechTextRef.current = null;
      pendingSpeechRef.current = null;
      window.speechSynthesis?.cancel();
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

    isCreatingSessionRef.current = true;
    setIsCreatingSession(true);
    setVoiceState("processing");
    setError(null);

    try {
      const [createdSession, loadedItems] = await Promise.all([
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
        await playWelcome(loadedItems);
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

    try {
      const response = await apiRequest<ChatResponse>(path, {
        method: "POST",
        body: JSON.stringify({
          sessionId: activeSession.id,
          message: cleanMessage,
        }),
      });
      await loadCurrentOrder(activeSession.id);

      setConversation((entries) => [
        ...entries,
        newEntry("assistant", response.assistantMessage),
      ]);
      networkErrorCountRef.current = 0;
      void speak(response.assistantMessage, {
        onEnd: () => setVoiceState("idle"),
      });
    } catch (requestError) {
      const errorMessage =
        requestError instanceof Error
          ? requestError.message
          : "No se pudo enviar el mensaje.";
      const spokenError = `Luffy tuvo un problema enviando tu mensaje. ${errorMessage}. Toca nuevamente para intentarlo.`;
      setError(errorMessage);
      setVoiceState("error");
      setConversation((entries) => [
        ...entries,
        newEntry("assistant", spokenError),
      ]);
      await loadCurrentOrder(activeSession.id);
      void speak(spokenError, { onEnd: () => setVoiceState("idle") });
    } finally {
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
    stopRecognition("developer text mode");
    await sendChatMessage(cleanMessage);
  }

  async function runQuickAction(text: string) {
    unlockSpeechOutput();
    stopRecognition("quick action");
    let activeSession = session;

    if (!activeSession) {
      activeSession = await createSession({ shouldPlayWelcome: false });
    }

    if (!activeSession) {
      return;
    }

    await sendChatMessage(text, activeSession);
  }

  function stopAudioAnalysis() {
    if (typeof window !== "undefined") {
      if (audioAnalysisFrameRef.current !== null) {
        window.cancelAnimationFrame(audioAnalysisFrameRef.current);
        audioAnalysisFrameRef.current = null;
      }

      if (maxRecordingTimeoutRef.current !== null) {
        window.clearTimeout(maxRecordingTimeoutRef.current);
        maxRecordingTimeoutRef.current = null;
      }
    }

    try {
      audioSourceRef.current?.disconnect();
      audioAnalyserRef.current?.disconnect();
    } catch {
      console.log("Nodos de audio ya estaban desconectados.");
    }
    audioSourceRef.current = null;
    audioAnalyserRef.current = null;
    silenceStartedAtRef.current = null;
    recordingStartedAtRef.current = 0;

    const audioContext = audioContextRef.current;
    audioContextRef.current = null;

    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => {
        console.log("No se pudo cerrar AudioContext.");
      });
    }
  }

  function scheduleMaxRecordingStop() {
    if (typeof window === "undefined") {
      return;
    }

    if (maxRecordingTimeoutRef.current !== null) {
      window.clearTimeout(maxRecordingTimeoutRef.current);
    }

    maxRecordingTimeoutRef.current = window.setTimeout(() => {
      if (mediaRecorderRef.current?.state === "recording") {
        console.log("Grabacion detenida por limite maximo.");
        stopAudioRecording();
      }
    }, maxRecordingDurationMs);
  }

  function startAudioLevelMonitoring(stream: MediaStream) {
    if (typeof window === "undefined") {
      return;
    }

    stopAudioAnalysis();
    recordingStartedAtRef.current = performance.now();
    scheduleMaxRecordingStop();

    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;

    if (!AudioContextClass) {
      console.log("Web Audio API no disponible para detectar silencio.");
      return;
    }

    try {
      const audioContext = new AudioContextClass();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      const source = audioContext.createMediaStreamSource(stream);
      const samples = new Uint8Array(analyser.fftSize);

      source.connect(analyser);

      audioContextRef.current = audioContext;
      audioSourceRef.current = source;
      audioAnalyserRef.current = analyser;

      if (audioContext.state === "suspended") {
        void audioContext.resume().catch(() => {
          console.log("No se pudo activar AudioContext.");
        });
      }

      const analyzeVolume = () => {
        if (mediaRecorderRef.current?.state !== "recording") {
          return;
        }

        analyser.getByteTimeDomainData(samples);

        let sum = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const centeredSample = (samples[index] - 128) / 128;
          sum += centeredSample * centeredSample;
        }

        const rms = Math.sqrt(sum / samples.length);
        const now = performance.now();
        const warmupFinished =
          now - recordingStartedAtRef.current >= recordingWarmupMs;

        if (warmupFinished && rms < silenceVolumeThreshold) {
          if (silenceStartedAtRef.current === null) {
            silenceStartedAtRef.current = now;
          }

          if (
            now - silenceStartedAtRef.current >=
            silenceDetectionDelayMs
          ) {
            console.log("Silencio detectado. Deteniendo grabacion.");
            stopAudioRecording();
            return;
          }
        } else {
          silenceStartedAtRef.current = null;
        }

        audioAnalysisFrameRef.current =
          window.requestAnimationFrame(analyzeVolume);
      };

      audioAnalysisFrameRef.current =
        window.requestAnimationFrame(analyzeVolume);
    } catch {
      console.log("No se pudo iniciar deteccion de silencio.");
    }
  }

  function cleanupAudioCapture(shouldUpdateState = true) {
    stopAudioAnalysis();

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onerror = null;
      mediaRecorderRef.current.onstop = null;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    isStoppingAudioRef.current = false;
    if (shouldUpdateState) {
      setIsRecordingAudio(false);
    }
  }

  function getAudioMimeType() {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ) {
      return "audio/webm;codecs=opus";
    }

    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported("audio/webm")
    ) {
      return "audio/webm";
    }

    return "";
  }

  async function startAudioRecording(activeSession: Session) {
    if (!activeSession.id) {
      setVoiceState("error");
      setError(noSessionForAudioMessage);
      setConversation((entries) => [
        ...entries,
        newEntry("assistant", noSessionForAudioMessage),
      ]);
      void speak(noSessionForAudioMessage, {
        onEnd: () => setVoiceState("idle"),
      });
      return;
    }

    if (!canUseMediaRecorder()) {
      setVoiceState("error");
      setError(unsupportedMediaRecorderMessage);
      setConversation((entries) => [
        ...entries,
        newEntry("assistant", unsupportedMediaRecorderMessage),
      ]);
      void speak(unsupportedMediaRecorderMessage, {
        onEnd: () => setVoiceState("idle"),
      });
      return;
    }

    if (isSpeakingRef.current || isSpeechOutputActive()) {
      setVoiceState("speaking");
      return;
    }

    stopRecognition("starting MediaRecorder");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getAudioMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      mediaStreamRef.current = stream;
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
        cleanupAudioCapture();
        setVoiceState("error");
        setError(message);
        setConversation((entries) => [
          ...entries,
          newEntry("assistant", message),
        ]);
        void speak(message, { onEnd: () => setVoiceState("idle") });
      };

      recorder.onstop = () => {
        void finishAudioRecording(activeSession.id, recorder.mimeType || mimeType);
      };

      recorder.start();
      startAudioLevelMonitoring(stream);
      setIsRecordingAudio(true);
      setHeardText("");
      setError(null);
      setVoiceState("recording");
    } catch (recordingError) {
      cleanupAudioCapture();
      const permissionDenied =
        recordingError instanceof DOMException &&
        (recordingError.name === "NotAllowedError" ||
          recordingError.name === "SecurityError");
      const message = permissionDenied
        ? noPermissionMessage
        : "No pude iniciar la grabacion de audio. Usa los botones rapidos o el modo prueba.";

      setVoiceState("error");
      setError(message);
      setConversation((entries) => [
        ...entries,
        newEntry("assistant", message),
      ]);
      void speak(message, { onEnd: () => setVoiceState("idle") });
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
    stopAudioAnalysis();
    setIsRecordingAudio(false);
    setVoiceState("processing");
    setHeardText("");
    try {
      recorder.stop();
    } catch {
      cleanupAudioCapture();
      setVoiceState("idle");
      setError("No pude detener la grabacion. Toca nuevamente para intentarlo.");
    }
  }

  async function finishAudioRecording(sessionId: string, mimeType: string) {
    const audioBlob = new Blob(audioChunksRef.current, {
      type: mimeType || "audio/webm",
    });

    cleanupAudioCapture();

    if (!sessionId) {
      setVoiceState("error");
      setError(noSessionForAudioMessage);
      void speak(noSessionForAudioMessage, {
        onEnd: () => setVoiceState("idle"),
      });
      return;
    }

    if (audioBlob.size === 0) {
      const message =
        "No se capturo audio. Toca nuevamente el microfono para intentarlo.";
      setVoiceState("error");
      setError(message);
      setConversation((entries) => [
        ...entries,
        newEntry("assistant", message),
      ]);
      void speak(message, { onEnd: () => setVoiceState("idle") });
      return;
    }

    const voiceEndpoint = getBackendAudioEndpoint(voiceMode);

    if (!voiceEndpoint) {
      setVoiceState("error");
      setError(
        "El envio de audio al backend esta deshabilitado en modo browser.",
      );
      return;
    }

    const formData = new FormData();
    formData.append("sessionId", sessionId);
    formData.append("audio", audioBlob, "audio.webm");

    try {
      const response = await fetch(`${apiUrl}${voiceEndpoint}`, {
        method: "POST",
        body: formData,
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
        ...(transcription ? [newEntry("user", transcription)] : []),
        newEntry("assistant", assistantMessage),
      ]);
      void speak(assistantMessage, {
        onEnd: () => setVoiceState("idle"),
      });
    } catch (sendError) {
      const message =
        sendError instanceof Error
          ? `${audioSendErrorMessage} ${sendError.message}`
          : audioSendErrorMessage;
      setVoiceState("error");
      setError(message);
      setConversation((entries) => [
        ...entries,
        newEntry("assistant", message),
      ]);
      void speak(message, { onEnd: () => setVoiceState("idle") });
    }
  }

  function handleMicError(errorCode: string) {
    lastMicErrorRef.current = errorCode;
    setLastRecognitionError(errorCode);
    setVoiceState("error");

    if (errorCode === "aborted") {
      console.log("SpeechRecognition abortado.");
      setVoiceState("idle");
      return;
    }

    if (errorCode === "network") {
      networkErrorCountRef.current += 1;
    } else {
      networkErrorCountRef.current = 0;
    }

    const message =
      errorCode === "network"
        ? recognitionNetworkMessage
        : errorCode === "not-allowed" || errorCode === "service-not-allowed"
        ? noPermissionMessage
        : errorCode === "audio-capture"
          ? noAudioCaptureMessage
        : errorCode === "no-speech"
          ? noVoiceMessage
        : notUnderstoodMessage;

    if (errorCode === "network") {
      setIsMicTemporarilyUnavailable(true);
      setError(
        `${temporaryVoiceUnavailableMessage}. ${recognitionNetworkMessage} Usa los botones rapidos o el modo prueba.`,
      );

      if (typeof window !== "undefined") {
        if (micReenableTimeoutRef.current !== null) {
          window.clearTimeout(micReenableTimeoutRef.current);
        }

        micReenableTimeoutRef.current = window.setTimeout(() => {
          networkErrorCountRef.current = 0;
          setIsMicTemporarilyUnavailable(false);
          setError(null);
        }, 30000);
      }
    } else {
      setError(null);
    }

    setConversation((entries) => [...entries, newEntry("assistant", message)]);
    void speak(message, { onEnd: () => setVoiceState("idle") });
  }

  function isSpeechOutputActive() {
    return (
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      (window.speechSynthesis.speaking || window.speechSynthesis.pending)
    );
  }

  function startRecognition(activeSession: Session) {
    const Recognition = getRecognitionConstructor();

    if (isListeningRef.current || recognitionRef.current) {
      console.log("SpeechRecognition ya esta escuchando.");
      return;
    }

    if (isSpeakingRef.current || isSpeechOutputActive()) {
      console.log("No se inicia SpeechRecognition: Luffy esta hablando.");
      setVoiceState("speaking");
      return;
    }

    if (!Recognition) {
      setVoiceState("error");
      setLastRecognitionError("unsupported");
      setConversation((entries) => [
        ...entries,
        newEntry("assistant", unsupportedRecognitionMessage),
      ]);
      void speak(unsupportedRecognitionMessage, {
        onEnd: () => setVoiceState("idle"),
      });
      return;
    }

    finalTranscriptRef.current = "";
    lastMicErrorRef.current = null;
    ignoreNextEndRef.current = false;
    setHeardText("");

    const recognition = new Recognition();
    recognition.lang = recognitionLang;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      isListeningRef.current = true;
      setVoiceState("listening");
    };

    recognition.onresult = (event) => {
      let interimText = "";
      let finalText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";

        if (result.isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }

      const visibleText = `${finalText} ${interimText}`.trim();

      if (visibleText) {
        setHeardText(visibleText);
      }

      if (finalText.trim()) {
        const browserRequest = createBrowserChatRequest(
          activeSession.id,
          finalText,
        );

        if (!browserRequest) {
          return;
        }

        const recognizedText = browserRequest.body.message;
        console.log(recognizedText);
        networkErrorCountRef.current = 0;
        finalTranscriptRef.current = recognizedText;
        setHeardText(recognizedText);
        ignoreNextEndRef.current = true;
        isListeningRef.current = false;
        recognition.stop();
        void sendChatMessage(
          recognizedText,
          activeSession,
          browserRequest.path,
        );
      }
    };

    recognition.onerror = (event) => {
      console.log("SpeechRecognition error:", event.error);
      ignoreNextEndRef.current = true;
      isListeningRef.current = false;
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognitionRef.current = null;
      try {
        recognition.abort();
      } catch {
        console.log("SpeechRecognition abort no disponible tras error.");
      }
      handleMicError(event.error);
    };

    recognition.onend = () => {
      console.log("SpeechRecognition finalizado.");
      recognitionRef.current = null;
      isListeningRef.current = false;

      if (ignoreNextEndRef.current || lastMicErrorRef.current) {
        ignoreNextEndRef.current = false;
        return;
      }

      if (!finalTranscriptRef.current.trim()) {
        if (isSendingMessageRef.current) {
          return;
        }

        setVoiceState("idle");
        setConversation((entries) => [
          ...entries,
          newEntry("assistant", noVoiceMessage),
        ]);
        void speak(`${noVoiceMessage} ${micOffMessage}`, {
          onEnd: () => setVoiceState("idle"),
        });
        return;
      }

      setVoiceState("idle");
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      handleMicError("start-failed");
    }
  }

  async function handleMainTouch() {
    unlockSpeechOutput();
    void loadVoices();

    if (isRecordingAudio) {
      stopAudioRecording();
      return;
    }

    if (isMicTemporarilyUnavailable) {
      setVoiceState("error");
      setError(
        `${temporaryVoiceUnavailableMessage}. Usa los botones rapidos o el modo prueba.`,
      );
      return;
    }

    if (isSpeakingRef.current || isSpeechOutputActive()) {
      console.log("Microfono bloqueado: Luffy esta hablando.");
      setVoiceState("speaking");
      return;
    }

    if (isMicDisabled || isListeningRef.current) {
      console.log("Microfono bloqueado: escuchando o procesando.");
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

    if (voiceMode === "backend-audio") {
      await startAudioRecording(activeSession);
      return;
    }

    startRecognition(activeSession);
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
              disabled={isCreatingSession}
              className="min-h-12 rounded-md bg-emerald-300 px-4 text-lg font-semibold text-neutral-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-300"
            >
              {session ? "Nueva sesion" : "Iniciar"}
            </button>
          </div>
        </header>

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
              aria-label="Toca para hablar con Luffy"
              className="relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-md border border-emerald-300/40 bg-black px-5 py-8 text-center outline-none transition hover:border-emerald-200 focus-visible:ring-4 focus-visible:ring-emerald-300 disabled:cursor-wait disabled:border-white/15"
            >
              {voiceState === "listening" ? (
                <>
                  <span className="absolute h-[20rem] w-[20rem] rounded-full border border-emerald-300/50 animate-ping" />
                  <span className="absolute h-[34rem] w-[34rem] rounded-full border border-emerald-300/20 animate-pulse" />
                </>
              ) : null}

              {voiceState === "recording" ? (
                <>
                  <span className="absolute h-[22rem] w-[22rem] rounded-full border border-red-300/60 animate-ping" />
                  <span className="absolute h-[36rem] w-[36rem] rounded-full border border-red-300/25 animate-pulse" />
                </>
              ) : null}

              {voiceState === "processing" ? (
                <span className="absolute h-[28rem] w-[28rem] rounded-full border border-sky-300/30 animate-pulse" />
              ) : null}

              <span
                className={`relative flex h-64 w-64 items-center justify-center rounded-full border text-white shadow-2xl sm:h-80 sm:w-80 ${
                  voiceState === "listening"
                    ? "border-emerald-200 bg-emerald-400/25 shadow-emerald-400/30"
                    : voiceState === "recording"
                      ? "border-red-200 bg-red-500/25 shadow-red-400/30"
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
              disabled={isCreatingSession || isSendingMessage || isRecordingAudio}
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
                <label className="rounded-md border border-white/10 bg-black px-4 py-3 text-base text-neutral-300">
                  <span className="block text-sm uppercase text-neutral-500">
                    Idioma de reconocimiento
                  </span>
                  <select
                    value={recognitionLang}
                    onChange={(event) =>
                      setRecognitionLang(event.target.value as RecognitionLanguage)
                    }
                    disabled={voiceState === "listening" || isRecordingAudio}
                    className="mt-2 w-full rounded-md border border-white/20 bg-neutral-950 px-3 py-2 text-lg text-white outline-none focus:border-emerald-300 disabled:cursor-not-allowed disabled:text-neutral-500"
                  >
                    {recognitionLanguageOptions.map((language) => (
                      <option key={language} value={language}>
                        {language}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="rounded-md border border-white/10 bg-black px-4 py-3 text-base text-neutral-300">
                  Ultimo error SpeechRecognition: {lastRecognitionError}
                </p>
                <p className="rounded-md border border-white/10 bg-black px-4 py-3 text-base text-neutral-300">
                  Modo de voz: {voiceMode}
                </p>
                <p className="rounded-md border border-white/10 bg-black px-4 py-3 text-base text-neutral-300">
                  Grabacion real:{" "}
                  {mediaRecorderSupported ? "disponible" : "no disponible"}
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

          {clientReady && voiceMode === "browser" && !speechSupported ? (
            <p className="mt-4 rounded-md border border-yellow-300/50 bg-yellow-950 px-4 py-3 text-lg text-yellow-100">
              SpeechRecognition no esta disponible en este navegador. Usa
              Chrome o Edge, o abre Modo prueba.
            </p>
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
