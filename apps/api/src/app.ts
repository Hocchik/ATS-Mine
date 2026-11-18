import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { manejadorErrores, rutaNoEncontrada } from './http/manejador-errores';
import { crearRegistro, type RegistroRutas } from './http/registro';
import type { ResolverSesion } from './http/sesion';
import { serializarPeticion } from './logger';

export type Modulo = (ctx: { registro: RegistroRutas; router: Router }) => void;

export interface DependenciasApp {
  logger: Logger;
  resolverSesion: ResolverSesion;
  /** Origen web permitido: verificación de `Origin` en métodos que modifican datos. */
  webOrigin: string;
  modulos: readonly Modulo[];
}

export function crearApp({ logger, resolverSesion, webOrigin, modulos }: DependenciasApp) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      serializers: { req: serializarPeticion },
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  // El resolver de sesión lee la cookie de req.cookies: tiene que estar montado antes del router.
  app.use(cookieParser());

  const registro = crearRegistro({ resolverSesion, webOrigin });
  const router = Router();
  for (const modulo of modulos) modulo({ registro, router });
  app.use(router);

  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);
  return { app, registro };
}
