import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function normalizeOrigin(origin?: string): string | undefined {
  const normalizedOrigin = origin?.trim().replace(/\/+$/, '');

  return normalizedOrigin || undefined;
}

function getAllowedOrigins(): string[] {
  const origins = [
    'https://restaurant-voice-ai-fronted.vercel.app',
    'http://localhost:3000',
    normalizeOrigin(process.env.FRONTEND_URL),
    ...(process.env.CORS_ORIGIN?.split(',').map(normalizeOrigin) ?? []),
  ].filter((origin): origin is string => Boolean(origin));

  return Array.from(new Set(origins));
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowedOrigins = getAllowedOrigins();

  console.log('Allowed CORS origins:', allowedOrigins);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = normalizeOrigin(origin);

      if (normalizedOrigin && allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked origin: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
