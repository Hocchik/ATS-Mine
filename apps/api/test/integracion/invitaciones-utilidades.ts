import { randomUUID } from 'node:crypto';
import type { Rol } from '@prisma/client';
import type { Express } from 'express';
import request from 'supertest';
import { generarToken } from '../../src/auth/tokens-aleatorios';
import { prismaPrueba } from '../db';
import { ORIGEN_PRUEBA } from '../sesion-real';
import { csrfDe } from './auth-utilidades';

const SIETE_DIAS_MS = 7 * 24 * 3600 * 1000;

/** POST de invitación con las cabeceras de sesión de quien invita. */
export const invitar = (app: Express, cabeceras: Record<string, string>, datos: { email: string; rol: Rol | string }) =>
  request(app).post('/api/organizacion/invitaciones').set(cabeceras).send(datos);

/** Token en claro a partir del enlace de la respuesta de creación. */
export function tokenDelEnlace(enlace: unknown): string {
  if (typeof enlace !== 'string') throw new Error('La respuesta no trae enlace');
  const token = enlace.split('/').pop();
  if (!token) throw new Error('El enlace no termina en un token');
  return token;
}

/** Invitación pendiente creada directo en la base, con su token en claro (lo que tendría el enlace). */
export async function invitacionConToken(organizacionId: string, datos: { email: string; rol?: Rol }) {
  const { token, hash } = generarToken();
  const invitacion = await prismaPrueba.invitacion.create({
    data: {
      organizacionId,
      email: datos.email,
      rol: datos.rol ?? 'RECLUTADOR',
      tokenHash: hash,
      expiraEn: new Date(Date.now() + SIETE_DIAS_MS),
      creadaPorId: randomUUID(),
    },
  });
  return { invitacion, token };
}

/** Agente que se registra con ese email (sesión real sin empresa) y su CSRF vigente. */
export async function agenteRegistrado(app: Express, email: string) {
  const agente = request.agent(app);
  const res = await agente
    .post('/api/auth/registro')
    .set('Origin', ORIGEN_PRUEBA)
    .send({ nombre: 'Persona Invitada', email, contrasena: 'una-contrasena-larga' });
  if (res.status !== 201) throw new Error(`El registro respondió ${res.status}`);
  return { agente, csrf: csrfDe(res) };
}

/** POST de aceptación desde un agente con sesión (CSRF + Origin). */
export const aceptarCon = (agente: ReturnType<typeof request.agent>, csrf: string, token: string) =>
  agente.post(`/api/invitaciones/${token}/aceptar`).set('Origin', ORIGEN_PRUEBA).set('X-CSRF-Token', csrf);
