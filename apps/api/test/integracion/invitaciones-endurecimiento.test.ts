import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase, prismaPrueba } from '../db';
import { crearMembresia, crearOrganizacion, crearUsuario } from '../fabricas';
import { cabecerasDeSesionReal } from '../sesion-real';
import { appAuth } from './auth-utilidades';
import { aceptarCon, agenteRegistrado, invitacionConToken, invitar } from './invitaciones-utilidades';

beforeEach(limpiarBase);

describe('invitaciones: endurecimiento', () => {
  it('aceptar tiene límite por persona: el intento 31 en 15 min → 429', async () => {
    const app = appAuth();
    const { agente, csrf } = await agenteRegistrado(app, 'limite@ejemplo.test');
    const inventado = 'B'.repeat(43);
    for (let i = 0; i < 30; i++) {
      expect((await aceptarCon(agente, csrf, inventado)).status).toBe(400);
    }
    const res = await aceptarCon(agente, csrf, inventado);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('al aceptar se revocan las demás invitaciones pendientes del mismo email en esa empresa', async () => {
    const app = appAuth();
    const org = await crearOrganizacion();
    const primera = await invitacionConToken(org.id, { email: 'doble@ejemplo.test' });
    const segunda = await invitacionConToken(org.id, { email: 'doble@ejemplo.test', rol: 'ADMIN' });
    const { agente, csrf } = await agenteRegistrado(app, 'doble@ejemplo.test');
    expect((await aceptarCon(agente, csrf, primera.token)).status).toBe(200);
    const otra = await prismaPrueba.invitacion.findUniqueOrThrow({ where: { id: segunda.invitacion.id } });
    expect(otra.revocadaEn).not.toBeNull();
    expect(otra.aceptadaEn).toBeNull();
  });

  it('quien invita debe seguir siendo OWNER o ADMIN en la base aunque la sesión en caché diga lo contrario', async () => {
    const app = appAuth();
    const org = await crearOrganizacion();
    const persona = await crearUsuario();
    const membresia = await crearMembresia(persona.id, org.id, 'ADMIN');
    const cabeceras = await cabecerasDeSesionReal({ usuarioId: persona.id, organizacionId: org.id });
    // Calienta la caché del resolver con el rol ADMIN.
    expect((await request(app).get('/api/organizacion/invitaciones').set(cabeceras)).status).toBe(200);
    // Degradación en la base sin subir la versión (la caché sigue diciendo ADMIN).
    await prismaPrueba.membresia.update({ where: { id: membresia.id }, data: { rol: 'RECLUTADOR' } });
    const res = await invitar(app, cabeceras, { email: 'nueva@ejemplo.test', rol: 'RECLUTADOR' });
    expect(res.status).toBe(403);
    expect(await prismaPrueba.invitacion.count()).toBe(0);
  });
});
