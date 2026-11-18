import type { Express } from 'express';
import request from 'supertest';
import { prismaPrueba } from '../db';
import { crearUsuario } from '../fabricas';
import { cabecerasDeSesionReal, ORIGEN_PRUEBA } from '../sesion-real';

export const RUTA_ORGS = '/api/superadmin/organizaciones';

/** Superadmin nuevo (cliente sin filtro, solo en pruebas) con cabeceras de sesión real sin empresa. */
export async function superadminCon() {
  const base = await crearUsuario();
  const usuario = await prismaPrueba.usuario.update({ where: { id: base.id }, data: { esSuperadmin: true } });
  const cabeceras = await cabecerasDeSesionReal({ usuarioId: usuario.id });
  return { usuario, cabeceras };
}

/** POST de una acción de superadmin sobre una empresa (`verificar`, `suspender`, `reactivar`). */
export const accionOrg = (
  app: Express,
  cabeceras: Record<string, string>,
  organizacionId: string,
  accion: 'verificar' | 'suspender' | 'reactivar',
  cuerpo: unknown = {},
) => request(app).post(`${RUTA_ORGS}/${organizacionId}/${accion}`).set(cabeceras).send(cuerpo as object);

/** El superadmin genera el enlace de restablecer de esa persona. */
export const generarEnlace = (app: Express, cabeceras: Record<string, string>, usuarioId: string) =>
  request(app).post(`/api/superadmin/usuarios/${usuarioId}/enlace-restablecer`).set(cabeceras).send({});

/** POST público de restablecer (con el Origin de la web, como lo enviaría el navegador). */
export const restablecer = (app: Express, cuerpo: unknown) =>
  request(app).post('/public/restablecer').set('Origin', ORIGEN_PRUEBA).send(cuerpo as object);

/** Token en claro del enlace `${webOrigin}/restablecer/${token}`. */
export function tokenDeEnlace(enlace: unknown): string {
  if (typeof enlace !== 'string') throw new Error('La respuesta no trae enlace');
  const partes = enlace.split('/restablecer/');
  if (partes.length !== 2 || !partes[1]) throw new Error('El enlace no tiene la forma /restablecer/<token>');
  return partes[1];
}
