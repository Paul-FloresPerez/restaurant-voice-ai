# Backend AGENTS.md

## Scope

This folder contains the NestJS backend for the voice-based AI restaurant menu and ordering assistant.

When Codex is launched from this folder, focus only on backend work unless explicitly asked otherwise.

## Backend stack

- NestJS
- TypeScript strict mode
- Prisma Client
- Supabase PostgreSQL
- class-validator
- class-transformer

## Backend responsibility

The backend must orchestrate:

- Sessions
- Menu queries
- Draft order workflow
- Order item changes
- Price calculation
- Order confirmation
- Interaction logs
- AI/chat service
- Voice transcription service integration

## Folder convention

Use this backend structure:

src/
  prisma/
  modules/
    session/
    menu/
    order/
    chat/
    voice/
  common/
  config/

Do not create unnecessary folders.

## NestJS rules

- Controllers must be thin.
- Services must contain business logic.
- DTOs must validate input.
- Do not put Prisma queries directly inside controllers.
- Use dependency injection correctly.
- Keep methods readable and focused.
- Do not add dependencies without explaining why.

## Prisma rules

- Use PrismaService for database access.
- Do not create a second database client.
- Use transactions for order mutations.
- Recalculate totals in backend.
- Never trust frontend prices.
- Never trust frontend totals.
- Do not expose database credentials.
- Do not commit `.env`.

## Order workflow

An order starts as DRAFT.

While DRAFT, the user can:

- Add items
- Remove items
- Update quantity
- Update modifiers
- Add special instructions
- Clear the order
- Ask for a summary
- Confirm the order

After CONFIRMED:

- Normal customer endpoints must not modify the order.
- Any correction must be handled by a separate future admin/staff flow.

## Voice/AI behavior

The AI must help interpret user intent, but backend services enforce the real action.

Examples:

- "Quiero una hamburguesa" means add the matching item if there is a clear match.
- "Quita la gaseosa" means remove or ask clarification if multiple beverages exist.
- "Cuánto cuesta el lomo" means query menu item price.
- "Tiene maní?" means query allergens.
- "Repíteme mi pedido" means return current order summary.

The assistant must ask clarification when intent is ambiguous.