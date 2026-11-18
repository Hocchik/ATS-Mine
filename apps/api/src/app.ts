import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { verificarOrigen } from './http/csrf';
import { exigirEdge } from './http/edge';
import { manejadorErrores, rutaNoEncontrada } from './http/manejador-errores';
import { crearRegistro, type RegistroRutas } from './http/registro';
import type { ResolverSesion } from './http/sesion';
import { serializarPeticion } from './logger';

export type Modulo = (ctx: { registro: RegistroRutas; router: Router }) => void;

export interface Seguridad {
  jwtSecret: string;
  /** Origen web permitido: verificación de `Origin` en métodos que modifican datos. */
  webOrigin: string;
  /** Secreto compartido con el edge; sin él (desarrollo/pruebas) `/api` no exige la cabecera. */
  edgeSecret?: string | undefined;
  cookiesSeguras: boolean;
}

export interface DependenciasApp {
  logger: Logger;
  resolverSesion: ResolverSesion;
  seguridad: Seguridad;
  modulos: readonly Modulo[];
}

export function crearApp({ logger, resolverSesion, seguridad, modulos }: DependenciasApp) {
  const app = express();
  app.disable('x-powered-by');
  // Solo en producción hay un proxy de confianza delante (Vercel/Render); fuera de ahí un X-Forwarded-For sería falsificable.
  app.set('trust proxy', seguridad.cookiesSeguras ? 1 : false);
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

  app.use('/api', exigirEdge(seguridad.edgeSecret));
  // Antes del router y para toda ruta: un Origin ajeno en POST/PUT/PATCH/DELETE se rechaza también en las públicas.
  app.use(verificarOrigen(seguridad.webOrigin));

  const registro = crearRegistro({ resolverSesion, webOrigin: seguridad.webOrigin });
  const router = Router();
  for (const modulo of modulos) modulo({ registro, router });
  app.use(router);

  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);
  return { app, registro };
}
