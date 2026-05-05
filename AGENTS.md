# AGENTS.md

## Project context

This project is a voice-based AI restaurant menu and ordering assistant.

The product is designed mainly for visually impaired users who need to interact with a restaurant menu by voice. The system should behave like a virtual waiter: it must listen to the customer, understand natural language, answer menu questions, suggest products when useful, help build an order, allow changes before confirmation, and confirm the final order clearly.

This is not a generic chatbot. It is a controlled restaurant ordering system with AI assistance.

## Main product goals

The MVP must allow a user to:

- Start a voice-based restaurant session.
- Ask what products, categories, dishes, drinks, desserts, or combos are available.
- Ask about prices, ingredients, allergens, vegetarian/vegan/spicy options, and availability.
- Add products to a draft order.
- Remove products from the draft order.
- Change quantities.
- Modify options or extras.
- Add special instructions.
- Ask for the current order summary.
- Confirm the order only after a clear read-back.
- Avoid accidental confirmation.

## Accessibility goals

The system is designed for users with visual disability or low vision.

Important accessibility rules:

- Responses must be clear, short, and easy to understand by voice.
- The assistant must confirm important actions verbally.
- The assistant must not rely only on visual UI.
- The system must support correction flows, for example:
  - "No, quita eso"
  - "Mejor pon dos"
  - "Cambia la gaseosa por agua"
  - "Repíteme mi pedido"
- The assistant must avoid long menus unless the user asks for the full list.
- The assistant should offer categories first when the menu is large.

## Official stack

- Backend: NestJS with TypeScript
- Frontend: Next.js with TypeScript
- Database: Supabase PostgreSQL
- ORM: Prisma
- Local LLM for MVP: Ollama
- Speech to Text for MVP: whisper.cpp or equivalent local STT service
- Text to Speech for MVP: Browser SpeechSynthesis

## Architecture decision

The backend is the source of truth.

Frontend responsibilities:

- Capture audio.
- Send audio/text to backend.
- Display conversation state.
- Play assistant responses with text-to-speech.
- Never calculate prices or order totals.

Backend responsibilities:

- Session management.
- Menu access.
- Draft order logic.
- Price calculation.
- Order confirmation.
- AI orchestration.
- Voice/transcription orchestration.
- Validation and business rules.

Database responsibilities:

- Store menu, variants, modifiers, ingredients, allergens.
- Store sessions.
- Store draft and confirmed orders.
- Store order items and modifier snapshots.
- Store interaction logs.
- Store order events.

## Business rules

- A session can have one active DRAFT order.
- A DRAFT order can be modified.
- A CONFIRMED order cannot be modified by normal customer endpoints.
- The backend must calculate prices and totals.
- The frontend must never send trusted prices or totals.
- Store snapshot values in order items:
  - product name
  - variant name
  - unit price
  - modifier names
  - modifier prices
- Always recalculate totals after order mutations.
- Use database transactions when modifying orders.

## AI rules

The LLM must not invent products, prices, ingredients, allergens, or availability.

The LLM should be used to understand natural language and decide what action is needed, but business data must come from the backend/database.

The assistant must behave like a restaurant waiter, not like a general-purpose chatbot.

For MVP, prefer deterministic backend tools over free-form answers.

## Development rules

- Keep the first version simple and functional.
- Do not overengineer.
- Do not add unnecessary dependencies.
- Prefer small, focused changes.
- Keep controllers thin.
- Keep business logic in services.
- Use DTOs with validation.
- Use Prisma for database access.
- Never commit `.env` files.
- Use `.env.example` for required environment variables.

## Current priority

Current priority is backend foundation:

1. Prisma connection
2. Session module
3. Menu module
4. Order module
5. Interaction log module
6. AI/chat orchestration
7. Voice integration
8. Frontend