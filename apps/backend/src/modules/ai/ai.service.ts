import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type AiInterpretedIntent =
  | 'ADD_ITEM'
  | 'CANCEL_ITEM'
  | 'REMOVE_ITEM'
  | 'READ_MENU'
  | 'CATEGORY_QUERY'
  | 'MENU_CATEGORIES'
  | 'ORDER_SUMMARY'
  | 'CONFIRM_ORDER'
  | 'AFFIRMATION'
  | 'NEGATION'
  | 'UNKNOWN';

export type AiConfirmationType = 'explicit' | 'closure' | 'ambiguous';

export type AiInterpretation = {
  intent: AiInterpretedIntent;
  productName: string | null;
  quantity: number | null;
  categoryName: string | null;
  notes: string | null;
  confirmationType: AiConfirmationType | null;
  confidence: number;
};

export type AiHealthResponse = {
  ok: boolean;
  enabled: boolean;
  baseUrl: string;
  model: string;
  modelAvailable: boolean;
  error: string | null;
};

type OllamaGenerateResponse = {
  response?: unknown;
};

type OllamaTagsResponse = {
  models?: Array<{
    name?: unknown;
    model?: unknown;
  }>;
};

const allowedIntents: ReadonlySet<string> = new Set([
  'ADD_ITEM',
  'CANCEL_ITEM',
  'REMOVE_ITEM',
  'READ_MENU',
  'CATEGORY_QUERY',
  'MENU_CATEGORIES',
  'ORDER_SUMMARY',
  'CONFIRM_ORDER',
  'AFFIRMATION',
  'NEGATION',
  'UNKNOWN',
]);

const allowedConfirmationTypes: ReadonlySet<string> = new Set([
  'explicit',
  'closure',
  'ambiguous',
]);

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private ollamaUnavailableUntil = 0;

  constructor(private readonly configService: ConfigService) {}

  async checkHealth(): Promise<AiHealthResponse> {
    const baseUrl = this.ollamaBaseUrl();
    const model = this.ollamaModel();

    if (!baseUrl) {
      return {
        ok: false,
        enabled: false,
        baseUrl: '',
        model,
        modelAvailable: false,
        error: 'OLLAMA_NOT_CONFIGURED',
      };
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 2000);

    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        signal: abortController.signal,
      });

      if (!response.ok) {
        return {
          ok: false,
          enabled: true,
          baseUrl,
          model,
          modelAvailable: false,
          error: 'OLLAMA_HEALTH_REQUEST_FAILED',
        };
      }

      const data = (await response.json()) as OllamaTagsResponse;
      const modelNames = this.extractModelNames(data);
      const modelAvailable = modelNames.includes(model);

      return {
        ok: modelAvailable,
        enabled: true,
        baseUrl,
        model,
        modelAvailable,
        error: modelAvailable ? null : 'OLLAMA_MODEL_NOT_FOUND',
      };
    } catch {
      return {
        ok: false,
        enabled: true,
        baseUrl,
        model,
        modelAvailable: false,
        error: 'OLLAMA_UNAVAILABLE',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async interpretMessage(
    message: string,
    context: object,
  ): Promise<AiInterpretation | null> {
    const baseUrl = this.ollamaBaseUrl();
    const model = this.ollamaModel();

    if (!baseUrl) {
      return null;
    }

    if (Date.now() < this.ollamaUnavailableUntil) {
      return null;
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 2000);

    this.logger.log('AI interpretation requested');

    try {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        signal: abortController.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt: this.buildPrompt(message, context),
          stream: false,
          format: 'json',
          options: {
            temperature: 0,
          },
        }),
      });

      if (!response.ok) {
        this.logger.warn('AI interpretation failed, using fallback');
        this.markOllamaUnavailable();
        return null;
      }

      const data = (await response.json()) as OllamaGenerateResponse;

      if (typeof data.response !== 'string') {
        this.logger.warn('AI interpretation failed, using fallback');
        this.markOllamaUnavailable();
        return null;
      }

      const interpretation = this.parseInterpretation(data.response);

      if (!interpretation) {
        this.logger.warn('AI interpretation failed, using fallback');
        this.markOllamaUnavailable();
        return null;
      }

      this.logger.log(
        `AI interpretation success intent=${interpretation.intent} confidence=${interpretation.confidence}`,
      );
      this.ollamaUnavailableUntil = 0;

      return interpretation;
    } catch {
      this.logger.warn('AI interpretation failed, using fallback');
      this.markOllamaUnavailable();
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildPrompt(message: string, context: object): string {
    return [
      'Eres un interprete de intenciones para un sistema controlado de pedidos de restaurante.',
      'No eres el asistente final del usuario.',
      'No inventes productos, precios, ingredientes ni disponibilidad.',
      'No ejecutes acciones. Solo clasifica el mensaje del usuario.',
      'Debes responder solo JSON valido, sin markdown, sin explicaciones y sin texto adicional.',
      'El JSON debe tener exactamente estos campos:',
      '{"intent":"ADD_ITEM|CANCEL_ITEM|READ_MENU|CATEGORY_QUERY|ORDER_SUMMARY|CONFIRM_ORDER|AFFIRMATION|NEGATION|UNKNOWN","productName":string|null,"quantity":number|null,"categoryName":string|null,"confirmationType":"explicit|closure|ambiguous"|null,"confidence":number}',
      'Usa quantity solo si el usuario indica una cantidad clara; si no, usa null.',
      'Usa confirmationType explicit solo para confirmaciones finales claras como "confirmo", "si confirmo" o "confirmar pedido".',
      'Usa confirmationType closure para frases de cierre como "haz el pedido", "eso nomas", "ya esta" o "quiero hacer el pedido".',
      'Usa confirmationType ambiguous para respuestas como "si", "ok" o "dale" cuando no pidan confirmar explicitamente.',
      'Usa confidence entre 0 y 1.',
      'Contexto disponible:',
      JSON.stringify(context),
      'Mensaje del usuario:',
      JSON.stringify(message),
    ].join('\n');
  }

  private parseInterpretation(value: string): AiInterpretation | null {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const intent = parsed.intent;

      if (!this.isAllowedIntent(intent)) {
        return null;
      }

      return {
        intent,
        productName: this.optionalString(parsed.productName),
        quantity: this.optionalPositiveInteger(parsed.quantity),
        categoryName: this.optionalString(parsed.categoryName),
        notes: this.optionalString(parsed.notes),
        confirmationType: this.optionalConfirmationType(
          parsed.confirmationType,
        ),
        confidence: this.confidence(parsed.confidence),
      };
    } catch {
      return null;
    }
  }

  private optionalString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
  }

  private isAllowedIntent(value: unknown): value is AiInterpretedIntent {
    return typeof value === 'string' && allowedIntents.has(value);
  }

  private optionalConfirmationType(value: unknown): AiConfirmationType | null {
    if (typeof value !== 'string' || !allowedConfirmationTypes.has(value)) {
      return null;
    }

    return value as AiConfirmationType;
  }

  private optionalPositiveInteger(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    const integerValue = Math.floor(value);

    return integerValue > 0 ? integerValue : null;
  }

  private confidence(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 0;
    }

    return Math.min(1, Math.max(0, value));
  }

  private extractModelNames(data: OllamaTagsResponse): string[] {
    return (data.models ?? [])
      .flatMap((model) => [model.name, model.model])
      .filter((value): value is string => typeof value === 'string');
  }

  private ollamaBaseUrl(): string | null {
    const value =
      this.configService.get<string>('OLLAMA_BASE_URL') ??
      process.env.OLLAMA_BASE_URL;
    const cleanedValue = value ? this.cleanBaseUrl(value) : '';

    return cleanedValue || null;
  }

  private ollamaModel(): string {
    const configuredModel = this.configService.get<string>('OLLAMA_MODEL');
    const environmentModel = process.env.OLLAMA_MODEL;

    return configuredModel?.trim() || environmentModel?.trim() || 'qwen2.5:3b';
  }

  private cleanBaseUrl(value: string): string {
    return value.trim().replace(/\/+$/, '');
  }

  private markOllamaUnavailable(): void {
    this.ollamaUnavailableUntil = Date.now() + 30_000;
  }
}
