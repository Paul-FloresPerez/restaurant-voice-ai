import assert from "node:assert/strict";
import test from "node:test";
import {
  canConfirmOrder,
  confirmOrderRequest,
  isNetworkFailure,
} from "../app/order-flow.ts";

const draftOrder = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "DRAFT",
  items: [{ id: "item-1" }],
};

test("a DRAFT order is confirmed through the direct endpoint without a body", async () => {
  let capturedUrl = "";
  let capturedOptions;
  const confirmedOrder = { ...draftOrder, status: "CONFIRMED" };
  const fetcher = async (url, options) => {
    capturedUrl = String(url);
    capturedOptions = options;
    return new Response(JSON.stringify(confirmedOrder), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await confirmOrderRequest(
    "https://api.example.com",
    draftOrder,
    fetcher,
  );

  assert.equal(
    capturedUrl,
    `https://api.example.com/orders/${draftOrder.id}/confirm`,
  );
  assert.equal(capturedOptions.method, "POST");
  assert.equal("body" in capturedOptions, false);
  assert.equal(result.status, "CONFIRMED");
});

test("an empty order is rejected before making a request", async () => {
  let requestCount = 0;
  const fetcher = async () => {
    requestCount += 1;
    return new Response();
  };

  await assert.rejects(
    confirmOrderRequest(
      "https://api.example.com",
      { ...draftOrder, items: [] },
      fetcher,
    ),
    /pedido vacío/,
  );
  assert.equal(requestCount, 0);
});

test("a confirmed order cannot generate a second confirmation", () => {
  assert.equal(canConfirmOrder(draftOrder, false), true);
  assert.equal(
    canConfirmOrder({ ...draftOrder, status: "CONFIRMED" }, false),
    false,
  );
  assert.equal(canConfirmOrder(draftOrder, true), false);
});

test("network errors remain retryable and do not create an internal lock", async () => {
  const failedFetch = async () => {
    throw new TypeError("Failed to fetch");
  };

  await assert.rejects(
    confirmOrderRequest("https://api.example.com", draftOrder, failedFetch),
    /Failed to fetch/,
  );
  assert.equal(isNetworkFailure(new TypeError("Failed to fetch")), true);
  assert.equal(canConfirmOrder(draftOrder, false), true);
});
