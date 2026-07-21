"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  isNetworkFailure,
  serverConnectionMessage,
} from "../order-flow";

type KitchenStatus = "CONFIRMED" | "PREPARING" | "READY" | "DELIVERED";

type KitchenOrder = {
  id: string;
  orderCode: string;
  sessionId: string;
  status: KitchenStatus;
  confirmedAt: string | null;
  total: string;
  items: Array<{
    id: string;
    itemName: string;
    variantName: string | null;
    quantity: number;
    specialInstructions: string | null;
    modifiers: Array<{
      id: string;
      optionName: string;
      quantity: number;
    }>;
  }>;
};

const apiUrl = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
).replace(/\/$/, "");

const columns: Array<{
  status: Exclude<KitchenStatus, "DELIVERED">;
  title: string;
  action: KitchenStatus;
  actionLabel: string;
}> = [
  {
    status: "CONFIRMED",
    title: "Nuevos",
    action: "PREPARING",
    actionLabel: "Iniciar preparación",
  },
  {
    status: "PREPARING",
    title: "En preparación",
    action: "READY",
    actionLabel: "Marcar como listo",
  },
  {
    status: "READY",
    title: "Listos",
    action: "DELIVERED",
    actionLabel: "Entregado",
  },
];

function formatMoney(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `S/ ${amount.toFixed(2)}` : value;
}

function elapsedTime(confirmedAt: string | null) {
  if (!confirmedAt) {
    return "Hora no disponible";
  }

  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(confirmedAt).getTime()) / 60000),
  );
  return minutes < 1 ? "Hace menos de un minuto" : `Hace ${minutes} min`;
}

export default function KitchenPage() {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  const loadOrders = useCallback(async () => {
    if (!navigator.onLine) {
      setIsOnline(false);
      setError(serverConnectionMessage);
      setIsLoading(false);
      return;
    }

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => abortController.abort(), 20000);
    setIsLoading(true);

    try {
      const response = await fetch(`${apiUrl}/orders/kitchen`, {
        cache: "no-store",
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Error HTTP ${response.status}`);
      }

      const kitchenOrders = (await response.json()) as KitchenOrder[];
      setOrders(kitchenOrders.filter((order) => order.status !== "DELIVERED"));
      setError(null);
    } catch (requestError) {
      setError(
        isNetworkFailure(requestError)
          ? serverConnectionMessage
          : requestError instanceof Error
            ? requestError.message
            : "No se pudo actualizar la cola de cocina.",
      );
    } finally {
      window.clearTimeout(timeoutId);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    const initialLoadId = window.setTimeout(() => void loadOrders(), 0);
    const intervalId = window.setInterval(() => void loadOrders(), 10000);

    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
    };
  }, [loadOrders]);

  const ordersByStatus = useMemo(
    () =>
      Object.fromEntries(
        columns.map((column) => [
          column.status,
          orders.filter((order) => order.status === column.status),
        ]),
      ) as Record<Exclude<KitchenStatus, "DELIVERED">, KitchenOrder[]>,
    [orders],
  );

  async function updateStatus(order: KitchenOrder, status: KitchenStatus) {
    if (updatingOrderId || !navigator.onLine) {
      setIsOnline(navigator.onLine);
      setError(serverConnectionMessage);
      return;
    }

    setUpdatingOrderId(order.id);
    setError(null);
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => abortController.abort(), 20000);

    try {
      const response = await fetch(`${apiUrl}/orders/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message || `Error HTTP ${response.status}`);
      }

      const updatedOrder = (await response.json()) as KitchenOrder;
      setOrders((current) =>
        updatedOrder.status === "DELIVERED"
          ? current.filter((item) => item.id !== order.id)
          : current.map((item) =>
              item.id === updatedOrder.id ? updatedOrder : item,
            ),
      );
    } catch (requestError) {
      setError(
        isNetworkFailure(requestError)
          ? serverConnectionMessage
          : requestError instanceof Error
            ? requestError.message
            : "No se pudo actualizar el pedido.",
      );
    } finally {
      window.clearTimeout(timeoutId);
      setUpdatingOrderId(null);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-4 text-white sm:p-6">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 rounded-md border border-white/15 bg-neutral-900 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-300">
              Restaurante Real
            </p>
            <h1 className="mt-1 text-4xl font-semibold">Cola de cocina</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!isOnline ? (
              <span className="rounded-md bg-amber-950 px-3 py-2 text-amber-100">
                Sin conexión
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void loadOrders()}
              disabled={isLoading}
              className="min-h-12 rounded-md bg-emerald-300 px-5 text-lg font-semibold text-neutral-950 disabled:bg-neutral-600"
            >
              {isLoading ? "Actualizando..." : "Actualizar"}
            </button>
            <Link className="rounded-md border border-white/20 px-4 py-3" href="/">
              Volver al cliente
            </Link>
          </div>
        </header>

        {error ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-300/50 bg-red-950 p-4 text-red-100">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void loadOrders()}
              className="rounded-md border border-red-200 px-4 py-2 font-semibold"
            >
              Reintentar
            </button>
          </div>
        ) : null}

        <section className="mt-5 grid gap-5 xl:grid-cols-3">
          {columns.map((column) => (
            <div
              key={column.status}
              className="rounded-md border border-white/15 bg-neutral-900 p-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold">{column.title}</h2>
                <span className="rounded-full bg-black px-3 py-1 text-lg">
                  {ordersByStatus[column.status].length}
                </span>
              </div>
              <div className="mt-4 space-y-4">
                {ordersByStatus[column.status].length === 0 ? (
                  <p className="rounded-md bg-black p-4 text-neutral-400">
                    No hay pedidos en esta sección.
                  </p>
                ) : (
                  ordersByStatus[column.status].map((order) => (
                    <article
                      key={order.id}
                      className="rounded-md border border-white/15 bg-black p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-2xl font-semibold">
                            #{order.orderCode}
                          </h3>
                          <p className="text-neutral-400">
                            {elapsedTime(order.confirmedAt)}
                          </p>
                        </div>
                        <p className="text-xl font-semibold text-emerald-300">
                          {formatMoney(order.total)}
                        </p>
                      </div>
                      <ul className="mt-4 space-y-3">
                        {order.items.map((item) => (
                          <li key={item.id} className="border-t border-white/10 pt-3">
                            <p className="text-lg font-semibold">
                              {item.quantity} × {item.itemName}
                            </p>
                            {item.variantName && item.variantName !== "Default" ? (
                              <p className="text-neutral-400">{item.variantName}</p>
                            ) : null}
                            {item.modifiers.length > 0 ? (
                              <p className="text-neutral-300">
                                {item.modifiers
                                  .map((modifier) =>
                                    modifier.quantity > 1
                                      ? `${modifier.quantity} × ${modifier.optionName}`
                                      : modifier.optionName,
                                  )
                                  .join(", ")}
                              </p>
                            ) : null}
                            {item.specialInstructions ? (
                              <p className="mt-1 rounded bg-amber-950 p-2 text-amber-100">
                                Nota: {item.specialInstructions}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        disabled={updatingOrderId !== null}
                        onClick={() => void updateStatus(order, column.action)}
                        className="mt-5 min-h-12 w-full rounded-md bg-emerald-300 px-4 text-lg font-semibold text-neutral-950 disabled:bg-neutral-600"
                      >
                        {updatingOrderId === order.id
                          ? "Actualizando..."
                          : column.actionLabel}
                      </button>
                    </article>
                  ))
                )}
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
