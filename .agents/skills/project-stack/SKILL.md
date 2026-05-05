---
name: project-stack
description: Use this skill for project-wide architecture, setup, repository structure, stack decisions, and MVP scope of the voice-based AI restaurant menu assistant.
---

This project is a voice-based AI restaurant menu and ordering assistant for visually impaired users.

Core product idea:

- The user interacts mainly by voice.
- The assistant behaves like a virtual waiter.
- The assistant helps read the menu, answer questions, recommend items, build an order, modify it, and confirm it.
- The system must not behave like an uncontrolled generic chatbot.
- Business logic must be enforced by the backend.

Official stack:

- Backend: NestJS with TypeScript
- Frontend: Next.js with TypeScript
- Database: Supabase PostgreSQL
- ORM: Prisma
- Local LLM MVP: Ollama
- STT MVP: whisper.cpp or compatible local transcription service
- TTS MVP: Browser SpeechSynthesis

MVP strategy:

- Backend first.
- Text flow before voice flow.
- Voice after order workflow is stable.
- AI after menu and order services are stable.
- Frontend after backend endpoints are stable.

Development rules:

- Keep changes small.
- Avoid overengineering.
- Do not add dependencies unless needed.
- Do not modify unrelated files.
- Do not expose secrets.
- Do not commit `.env`.