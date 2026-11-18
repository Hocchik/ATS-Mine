import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { generarToken } from '../../src/auth/tokens-aleatorios';
import { limpiarBase, prismaPrueba } from '../db';
import { cabecerasDeSesionReal, ORIGEN_PRUEBA } from '../sesion-real';
import { appAuth, CONTRASENA, personaConContrasena } from './auth-utilidades';
import { generarEnlace, restablecer, superadminCon, tokenDeEnlace } from './superadmin-utilidades';

beforeEach(limpiarBase);

const NUEVA = 'otra-contrasena-nueva-y-larga';
const UNA_HORA_MS = 3600_000;

const login = (app: ReturnType<typeof appAuth>, email: string, contrasena: string) =>
  request(app).post('/api/auth/login').set('Origin', ORIGEN_PRUEBA).send({ email, contrasena });

const esTokenInvalido = (res: request.Response) => {
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('TOKEN_INVALIDO');
  return res.body.error.message as string;
};

/** Token pendiente creado directo en la base (cliente sin filtro), con su valor en claro. */
async function tokenEnBase(usuarioId: string, expiraEn = new Date(Date.now() + UNA_HORA_MS)) {
  const { token, hash } = generarToken();
  const fila = await prismaPrueba.tokenRestablecer.create({ data: { usuarioId, tokenHash: hash, expiraEn } });
  return { token, fila };
}

describe('POST /api/superadmin/usuarios/:id/enlace-restablecer', () => {
  it('crea un token de 1 h (solo su hash en la base), responde el enlace y audita', async () => {
    const app = appAuth();
    const persona = await personaConContrasena();
    const sa = await superadminCon();
    const antes = Date.now();

    const res = await generarEnlace(app, sa.cabeceras, persona.id);

    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['enlace', 'expiraEn']);
    const token = tokenDeEnlace(res.body.enlace);
    expect(res.body.enlace).toBe(`${ORIGEN_PRUEBA}/restablecer/${token}`);
    expect(res.text).not.toMatch(/passwordHash|tokenHash/);
    const expira = new Date(res.body.expiraEn).getTime();
    expect(expira).toBeGreaterThanOrEqual(antes + UNA_HORA_MS - 1000);
    expect(expira).toBeLessThanOrEqual(Date.now() + UNA_HORA_MS + 1000);
    const filas = await prismaPrueba.tokenRestablecer.findMany({ where: { usuarioId: persona.id }, omit: { tokenHash: false } });
    expect(filas).toHaveLength(1);
    expect(filas[0]?.tokenHash).not.toBe(token);
    const evento = await prismaPrueba.eventoAuditoria.findFirstOrThrow({ where: { tipo: 'RESTABLECER_GENERADO' } });
    expect(evento.usuarioId).toBe(sa.usuario.id);
    expect(JSON.stringify(evento.datos)).toContain(persona.id);
  });

  it('usuario inexistente o id mal formado → 404', async () => {
    const app = appAuth();
    const { cabeceras } = await superadminCon();
    expect((await generarEnlace(app, cabeceras, randomUUID())).status).toBe(404);
    expect((await generarEnlace(app, cabeceras, 'no-es-uuid')).status).toBe(404);
  });

  it('un enlace nuevo deja sin efecto los anteriores pendientes de esa persona', async () => {
    const app = appAuth();
    const persona = await personaConContrasena();
    const { cabeceras } = await superadminCon();
    const primero = tokenDeEnlace((await generarEnlace(app, cabeceras, persona.id)).body.enlace);
    const segundo = tokenDeEnlace((await generarEnlace(app, cabeceras, persona.id)).body.enlace);

    esTokenInvalido(await restablecer(app, { token: primero, contrasena: NUEVA }));
    expect((await restablecer(app, { token: segundo, contrasena: NUEVA })).status).toBe(204);
  });
});

describe('POST /public/restablecer', () => {
  it('ciclo: enlace → nueva contraseña; la sesión anterior → 401, la contraseña nueva entra y la vieja no', async () => {
    const app = appAuth();
    const persona = await personaConContrasena();
    const sesionVieja = await cabecerasDeSesionReal({ usuarioId: persona.id });
    // La sesión queda en la caché del resolver: el restablecer tiene que invalidarla.
    expect((await request(app).get('/api/auth/yo').set(sesionVieja)).status).toBe(200);
    const { cabeceras } = await superadminCon();
    const token = tokenDeEnlace((await generarEnlace(app, cabeceras, persona.id)).body.enlace);

    const res = await restablecer(app, { token, contrasena: NUEVA });

    expect(res.status).toBe(204);
    const yo = await request(app).get('/api/auth/yo').set(sesionVieja);
    expect(yo.status).toBe(401);
    const guardada = await prismaPrueba.usuario.findUniqueOrThrow({ where: { id: persona.id } });
    expect(guardada.versionSesion).toBe(persona.versionSesion + 1);
    expect((await login(app, persona.email, NUEVA)).status).toBe(200);
    expect((await login(app, persona.email, CONTRASENA)).status).toBe(401);
    const fila = await prismaPrueba.tokenRestablecer.findFirstOrThrow({ where: { usuarioId: persona.id } });
    expect(fila.usadoEn).not.toBeNull();
    expect(await prismaPrueba.eventoAuditoria.count({ where: { tipo: 'RESTABLECER_USADO', usuarioId: persona.id } })).toBe(1);
  });

  it('usar dos veces el mismo token → 400 y la segunda contraseña no se aplica', async () => {
    const app = appAuth();
    const persona = await personaConContrasena();
    const { token } = await tokenEnBase(persona.id);

    expect((await restablecer(app, { token, contrasena: NUEVA })).status).toBe(204);
    esTokenInvalido(await restablecer(app, { token, contrasena: 'una-tercera-contrasena' }));
    expect((await login(app, persona.email, NUEVA)).status).toBe(200);
  });

  it('vencido, inventado o mal formado → 400 con el mismo mensaje y sin cambios', async () => {
    const app = appAuth();
    const persona = await personaConContrasena();
    const vencido = await tokenEnBase(persona.id, new Date(Date.now() - 1000));

    const mensajes = [];
    for (const token of [vencido.token, generarToken().token, 'corto', 'A'.repeat(43), 42]) {
      mensajes.push(esTokenInvalido(await restablecer(app, { token, contrasena: NUEVA })));
    }
    expect(new Set(mensajes).size).toBe(1);
    const intacta = await prismaPrueba.usuario.findUniqueOrThrow({ where: { id: persona.id } });
    expect(intacta.versionSesion).toBe(persona.versionSesion);
    expect((await login(app, persona.email, CONTRASENA)).status).toBe(200);
  });

  it('contraseña que no cumple el esquema → 400 VALIDATION_FAILED y el token sigue sin usar', async () => {
    const app = appAuth();
    const persona = await personaConContrasena();
    const { token, fila } = await tokenEnBase(persona.id);

    const res = await restablecer(app, { token, contrasena: 'corta' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    const sinUsar = await prismaPrueba.tokenRestablecer.findUniqueOrThrow({ where: { id: fila.id } });
    expect(sinUsar.usadoEn).toBeNull();
  });

  it('un Origin ajeno se rechaza y el limitador corta tras 10 intentos por IP', async () => {
    const app = appAuth();
    const ajeno = await request(app)
      .post('/public/restablecer')
      .set('Origin', 'https://otro-sitio.test')
      .send({ token: 'A'.repeat(43), contrasena: NUEVA });
    expect(ajeno.status).toBe(403);

    for (let i = 0; i < 10; i++) await restablecer(app, { token: 'corto', contrasena: NUEVA });
    const limitada = await restablecer(app, { token: 'corto', contrasena: NUEVA });
    expect(limitada.status).toBe(429);
  });
});
