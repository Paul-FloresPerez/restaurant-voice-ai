export const orderConfirmationTimeoutMs = 20_000;
export const offlineDraftMessage =
  "No tienes conexión a internet. Tu pedido permanece guardado como borrador.";
export const serverConnectionMessage =
  "No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.";

export type ConfirmableOrder = {
  id: string;
  status: string;
  items: unknown[];
};

export function canConfirmOrder(
  order: ConfirmableOrder | null,
  isConfirming: boolean,
): boolean {
  return Boolean(
    order?.id &&
      order.status === "DRAFT" &&
      order.items.length > 0 &&
      !isConfirming,
  );
}

export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch|ERR_INTERNET_DISCONNECTED|network|conexi[oó]n/i.test(
    message,
  );
}

export async function confirmOrderRequest<TOrder extends ConfirmableOrder>(
  apiBaseUrl: string,
  order: TOrder,
  fetcher: typeof fetch = fetch,
  timeoutMs = orderConfirmationTimeoutMs,
): Promise<TOrder> {
  if (!order.id) {
    throw new Error("No existe un pedido válido para confirmar.");
  }

  if (order.items.length === 0) {
    throw new Error("No se puede confirmar un pedido vacío.");
  }

  if (order.status !== "DRAFT") {
    throw new Error("Este pedido ya no está disponible para confirmación.");
  }

  const abortController = new AbortController();
  let didTimeOut = false;
  const timeoutId = setTimeout(() => {
    didTimeOut = true;
    abortController.abort();
  }, timeoutMs);

  try {
    const response = await fetcher(
      `${apiBaseUrl}/orders/${order.id}/confirm`,
      {
        method: "POST",
        signal: abortController.signal,
      },
    );

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        message?: string | string[];
      } | null;
      const message = Array.isArray(errorBody?.message)
        ? errorBody.message.join(", ")
        : errorBody?.message;
      throw new Error(message || `Error HTTP ${response.status}`);
    }

    return (await response.json()) as TOrder;
  } catch (error) {
    if (didTimeOut) {
      throw new Error("La confirmación tardó más de 20 segundos.");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
