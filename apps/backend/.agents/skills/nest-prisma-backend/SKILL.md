---
name: nest-prisma-backend
description: Use this skill when creating or modifying NestJS backend modules, controllers, services, DTOs, Prisma access, validation, and backend structure.
---

Backend implementation rules:

- Use NestJS best practices.
- Use TypeScript strict mode.
- Keep controllers thin.
- Put business logic in services.
- Use DTOs with class-validator.
- Use PrismaService for all database operations.
- Do not query Prisma directly from controllers.
- Do not create another database client.
- Do not add dependencies without explaining why.
- Validate all request body fields.
- Keep responses predictable and explicit.
- Prefer clear naming over clever abstractions.

Recommended module structure:

src/modules/<module-name>/
  dto/
  <module-name>.controller.ts
  <module-name>.service.ts
  <module-name>.module.ts

When implementing endpoints:

- Define DTOs first.
- Validate inputs.
- Call service methods from controllers.
- Keep controller methods short.
- Return clear JSON responses.