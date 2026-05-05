---
name: order-workflow
description: Use this skill when implementing restaurant order logic: draft orders, adding items, removing items, updating quantities, modifiers, notes, summaries, totals, and confirmation.
---

Order domain rules:

- Each active session can have one DRAFT order.
- A DRAFT order can be modified.
- A CONFIRMED order cannot be modified by normal customer endpoints.
- Always calculate prices in the backend.
- Never trust frontend totals.
- Never trust frontend item prices.
- Always store snapshot values in order items:
  - item name
  - variant name
  - unit price
  - modifier names
  - modifier prices
- Use database transactions for:
  - add item
  - update item
  - remove item
  - update modifiers
  - clear order
  - confirm order
- Recalculate subtotal and total after every mutation.
- Log meaningful order events when something changes.

Voice-related interpretation examples:

- "Agrega una hamburguesa" -> add item if exact match exists.
- "Quítame la hamburguesa" -> remove item or ask clarification.
- "Ponle queso extra" -> add modifier if valid for that item.
- "Mejor dos" -> update quantity only if the referenced item is clear.
- "Repíteme mi pedido" -> return order summary.
- "Confirmo" -> confirm only after the assistant has read back the order.