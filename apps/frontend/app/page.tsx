"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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
  role: "user" | "assistant";
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

const apiUrl = "/backend";

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

function getDefaultVariant(item: MenuItem): MenuVariant | undefined {
  return item.variants.find((variant) => variant.isDefault) ?? item.variants[0];
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [message, setMessage] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [orderStatus, setOrderStatus] = useState("Sin pedido consultado.");
  const [error, setError] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isLoadingMenu, setIsLoadingMenu] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  const groupedMenu = useMemo(() => {
    return menuItems.reduce<Record<string, MenuItem[]>>((groups, item) => {
      const category = item.categoryName || "Sin categoria";
      groups[category] = [...(groups[category] ?? []), item];
      return groups;
    }, {});
  }, [menuItems]);

  useEffect(() => {
    void loadMenu();
  }, []);

  async function loadMenu() {
    setIsLoadingMenu(true);
    setError(null);

    try {
      const items = await apiRequest<MenuItem[]>("/menu/items");
      setMenuItems(items);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo cargar el menu.",
      );
    } finally {
      setIsLoadingMenu(false);
    }
  }

  async function createSession() {
    setIsCreatingSession(true);
    setError(null);

    try {
      const createdSession = await apiRequest<Session>("/sessions", {
        method: "POST",
        body: JSON.stringify({ channel: "frontend-test" }),
      });
      setSession(createdSession);
      setConversation([]);
      setOrder(null);
      setOrderStatus("Sesion creada. Aun no hay pedido activo.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo crear la sesion.",
      );
    } finally {
      setIsCreatingSession(false);
    }
  }

  async function loadCurrentOrder(sessionId: string) {
    try {
      const currentOrder = await apiRequest<Order>(
        `/orders/current/${sessionId}`,
      );
      setOrder(currentOrder);
      setOrderStatus("");
    } catch (requestError) {
      setOrder(null);
      setOrderStatus(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo consultar el pedido actual.",
      );
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanMessage = message.trim();

    if (!session || !cleanMessage) {
      return;
    }

    setIsSendingMessage(true);
    setError(null);
    setMessage("");

    const userEntry: ConversationEntry = {
      id: crypto.randomUUID(),
      role: "user",
      text: cleanMessage,
    };

    setConversation((entries) => [...entries, userEntry]);

    try {
      const response = await apiRequest<ChatResponse>("/chat/message", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.id,
          message: cleanMessage,
        }),
      });

      setConversation((entries) => [
        ...entries,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: response.assistantMessage,
        },
      ]);
    } catch (requestError) {
      const errorMessage =
        requestError instanceof Error
          ? requestError.message
          : "No se pudo enviar el mensaje.";
      setError(errorMessage);
      setConversation((entries) => [
        ...entries,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `Error: ${errorMessage}`,
        },
      ]);
    } finally {
      await loadCurrentOrder(session.id);
      setIsSendingMessage(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 text-stone-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-stone-200 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-700">
              Prueba local
            </p>
            <h1 className="mt-1 text-3xl font-semibold">
              Menu por voz del restaurante
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
              Pantalla minima para crear una sesion, hablar con el asistente y
              revisar el pedido actual sin usar curl.
            </p>
          </div>

          <button
            type="button"
            onClick={createSession}
            disabled={isCreatingSession}
            className="inline-flex h-11 items-center justify-center rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-400"
          >
            {isCreatingSession ? "Creando..." : "Crear sesion"}
          </button>
        </header>

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {error}
          </div>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-6">
            <section className="rounded-md border border-stone-200 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Sesion activa</h2>
                  <p className="mt-1 break-all text-sm text-stone-600">
                    {session ? session.id : "No hay sesion creada."}
                  </p>
                </div>
                <span className="w-fit rounded-md bg-stone-100 px-3 py-1 text-xs font-medium text-stone-700">
                  {session ? session.status : "Sin sesion"}
                </span>
              </div>
            </section>

            <section className="rounded-md border border-stone-200 bg-white p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Menu</h2>
                <button
                  type="button"
                  onClick={loadMenu}
                  disabled={isLoadingMenu}
                  className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-400"
                >
                  {isLoadingMenu ? "Cargando..." : "Recargar"}
                </button>
              </div>

              {menuItems.length === 0 ? (
                <p className="text-sm text-stone-600">
                  No hay productos cargados.
                </p>
              ) : (
                <div className="grid gap-5 md:grid-cols-2">
                  {Object.entries(groupedMenu).map(([category, items]) => (
                    <div key={category}>
                      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                        {category}
                      </h3>
                      <ul className="space-y-3">
                        {items.map((item) => {
                          const variant = getDefaultVariant(item);

                          return (
                            <li
                              key={item.id}
                              className="rounded-md border border-stone-200 p-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium">{item.name}</p>
                                  {item.description ? (
                                    <p className="mt-1 text-sm leading-5 text-stone-600">
                                      {item.description}
                                    </p>
                                  ) : null}
                                </div>
                                <p className="shrink-0 text-sm font-semibold text-emerald-700">
                                  {variant ? formatMoney(variant.price) : "--"}
                                </p>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-600">
                                {item.isVegetarian ? (
                                  <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-800">
                                    Vegetariano
                                  </span>
                                ) : null}
                                {item.isVegan ? (
                                  <span className="rounded-md bg-lime-50 px-2 py-1 text-lime-800">
                                    Vegano
                                  </span>
                                ) : null}
                                {item.isSpicy ? (
                                  <span className="rounded-md bg-red-50 px-2 py-1 text-red-800">
                                    Picante
                                  </span>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="flex flex-col gap-6">
            <section className="rounded-md border border-stone-200 bg-white p-4">
              <h2 className="text-lg font-semibold">Asistente</h2>
              <form onSubmit={sendMessage} className="mt-4 flex flex-col gap-3">
                <label
                  htmlFor="message"
                  className="text-sm font-medium text-stone-700"
                >
                  Mensaje
                </label>
                <textarea
                  id="message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  disabled={!session || isSendingMessage}
                  rows={4}
                  maxLength={1000}
                  placeholder={
                    session
                      ? "Ejemplo: quiero una hamburguesa"
                      : "Primero crea una sesion"
                  }
                  className="min-h-28 resize-y rounded-md border border-stone-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100 disabled:bg-stone-100"
                />
                <button
                  type="submit"
                  disabled={!session || !message.trim() || isSendingMessage}
                  className="h-11 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
                >
                  {isSendingMessage ? "Enviando..." : "Enviar"}
                </button>
              </form>
            </section>

            <section className="rounded-md border border-stone-200 bg-white p-4">
              <h2 className="text-lg font-semibold">Conversacion</h2>
              <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
                {conversation.length === 0 ? (
                  <p className="text-sm text-stone-600">
                    No hay mensajes todavia.
                  </p>
                ) : (
                  conversation.map((entry) => (
                    <div
                      key={entry.id}
                      className={
                        entry.role === "user"
                          ? "ml-6 rounded-md bg-emerald-700 px-3 py-2 text-sm text-white"
                          : "mr-6 rounded-md bg-stone-100 px-3 py-2 text-sm text-stone-800"
                      }
                    >
                      <p className="mb-1 text-xs font-semibold uppercase opacity-80">
                        {entry.role === "user" ? "Usuario" : "Asistente"}
                      </p>
                      <p className="leading-5">{entry.text}</p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-md border border-stone-200 bg-white p-4">
              <h2 className="text-lg font-semibold">Pedido actual</h2>
              <div className="mt-4">
                {order ? (
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-stone-600">
                        Estado:{" "}
                        <span className="font-medium text-stone-950">
                          {order.status}
                        </span>
                      </p>
                      <p className="text-base font-semibold text-emerald-700">
                        {formatMoney(order.total)}
                      </p>
                    </div>
                    {order.items.length === 0 ? (
                      <p className="mt-3 text-sm text-stone-600">
                        El pedido esta vacio.
                      </p>
                    ) : (
                      <ul className="mt-3 space-y-3">
                        {order.items.map((item) => (
                          <li
                            key={item.id}
                            className="border-t border-stone-200 pt-3 text-sm"
                          >
                            <div className="flex justify-between gap-3">
                              <p className="font-medium">
                                {item.quantity} x {item.itemName}
                                {item.variantName &&
                                item.variantName !== "Default"
                                  ? ` (${item.variantName})`
                                  : ""}
                              </p>
                              <p className="font-semibold">
                                {formatMoney(item.lineTotal)}
                              </p>
                            </div>
                            {item.specialInstructions ? (
                              <p className="mt-1 text-stone-600">
                                Nota: {item.specialInstructions}
                              </p>
                            ) : null}
                            {item.modifiers.length > 0 ? (
                              <p className="mt-1 text-stone-600">
                                Extras:{" "}
                                {item.modifiers
                                  .map(
                                    (modifier) =>
                                      `${modifier.quantity} x ${modifier.optionName}`,
                                  )
                                  .join(", ")}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-stone-600">{orderStatus}</p>
                )}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
