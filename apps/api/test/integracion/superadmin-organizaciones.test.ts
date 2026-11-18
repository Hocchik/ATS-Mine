import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase, prismaPrueba } from '../db';
import { crearOrganizacion, crearUsuario } from '../fabricas';
import { cabecerasDeSesionReal, ORIGEN_PRUEBA } from '../sesion-real';
import { appAuth } from './auth-utilidades';
import { miembroCon } from './organizaciones-utilidades';
import { accionOrg, generarEnlace, RUTA_ORGS, superadminCon } from './superadmin-utilidades';

beforeEach(limpiarBase);

const app = appAuth();

const eventos = (tipo: 'VERIFICACION_ORG' | 'SUSPENSION_ORG' | 'REACTIVACION_ORG', organizacionAfectadaId: string) =>
  prismaPrueba.eventoAuditoria.findMany({ where: { tipo, organizacionAfectadaId } });

describe('rutas de superadmin: solo superadmin', () => {
  it('una persona no superadmin (OWNER o sin empresa) → 403 en todas; sin sesión → 401', async () => {
    const org = await crearOrganizacion();
    const owner = await miembroCon(org.id, 'OWNER');
    const sinEmpresa = await cabecerasDeSesionReal({ usuarioId: (await crearUsuario()).id });
    const peticiones = [
      (c: Record<string, string>) => request(app).get(RUTA_ORGS).set(c),
      (c: Record<string, string>) => accionOrg(app, c, org.id, 'verificar'),
      (c: Record<string, string>) => accionOrg(app, c, org.id, 'suspender'),
      (c: Record<string, string>) => accionOrg(app, c, org.id, 'reactivar'),
      (c: Record<string, string>) => generarEnlace(app, c, owner.usuario.id),
    ];
    for (const peticion of peticiones) {
      for (const cabeceras of [owner.cabeceras, sinEmpresa]) {
        const res = await peticion(cabeceras);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      expect((await peticion({ Origin: ORIGEN_PRUEBA })).status).toBe(401);
    }
    const intacta = await prismaPrueba.organizacion.findUniqueOrThrow({ where: { id: org.id } });
    expect(intacta.estadoVerificacion).toBe('PENDIENTE');
    expect(await prismaPrueba.tokenRestablecer.count()).toBe(0);
  });
});

describe('GET /api/superadmin/organizaciones', () => {
  it('lista todas las empresas con su número de miembros y filtra por estado; nunca devuelve hashes', async () => {
    const a = await crearOrganizacion({ nombre: 'Alfa Ficticia' });
    const b = await crearOrganizacion({ nombre: 'Beta Ficticia' });
    await prismaPrueba.organizacion.update({ where: { id: b.id }, data: { estadoVerificacion: 'VERIFICADA' } });
    await miembroCon(a.id, 'OWNER');
    await miembroCon(a.id, 'RECLUTADOR');
    const { cabeceras } = await superadminCon();

    const todas = await request(app).get(RUTA_ORGS).set(cabeceras);
    expect(todas.status).toBe(200);
    const alfa = todas.body.find((o: { id: string }) => o.id === a.id);
    expect(alfa).toEqual({
      id: a.id,
      nombre: 'Alfa Ficticia',
      slug: a.slug,
      estadoVerificacion: 'PENDIENTE',
      creadoEn: a.creadoEn.toISOString(),
      miembros: 2,
    });
    expect(todas.body).toHaveLength(2);
    expect(todas.text).not.toMatch(/passwordHash|tokenHash/);

    const verificadas = await request(app).get(`${RUTA_ORGS}?estado=VERIFICADA`).set(cabeceras);
    expect(verificadas.body.map((o: { id: string }) => o.id)).toEqual([b.id]);

    const invalido = await request(app).get(`${RUTA_ORGS}?estado=OTRO`).set(cabeceras);
    expect(invalido.status).toBe(400);
    expect(invalido.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('verificar, suspender y reactivar', () => {
  it('verificar → VERIFICADA con verificadaPorId, verificadaEn y dominioCorreoVerificado; audita', async () => {
    const org = await crearOrganizacion();
    const sa = await superadminCon();

    const res = await accionOrg(app, sa.cabeceras, org.id, 'verificar', { dominioCorreoVerificado: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: org.id, estadoVerificacion: 'VERIFICADA', verificadaPorId: sa.usuario.id });
    expect(res.text).not.toMatch(/passwordHash|tokenHash/);
    const guardada = await prismaPrueba.organizacion.findUniqueOrThrow({ where: { id: org.id } });
    expect(guardada.estadoVerificacion).toBe('VERIFICADA');
    expect(guardada.verificadaPorId).toBe(sa.usuario.id);
    expect(guardada.verificadaEn).not.toBeNull();
    expect(guardada.dominioCorreoVerificado).toBe(true);
    expect(await eventos('VERIFICACION_ORG', org.id)).toHaveLength(1);
  });

  it('id inexistente o mal formado → 404; cuerpo inválido → 400; verificar una suspendida → 409', async () => {
    const org = await crearOrganizacion();
    const { cabeceras } = await superadminCon();
    expect((await accionOrg(app, cabeceras, randomUUID(), 'verificar')).status).toBe(404);
    expect((await accionOrg(app, cabeceras, 'no-es-uuid', 'suspender')).status).toBe(404);
    const malo = await accionOrg(app, cabeceras, org.id, 'verificar', { dominioCorreoVerificado: 'si' });
    expect(malo.status).toBe(400);
    expect((await accionOrg(app, cabeceras, org.id, 'verificar', { otro: 1 })).status).toBe(400);

    await accionOrg(app, cabeceras, org.id, 'suspender');
    const suspendida = await accionOrg(app, cabeceras, org.id, 'verificar');
    expect(suspendida.status).toBe(409);
    expect(suspendida.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('suspender → la sesión de un miembro pierde la empresa de inmediato (sin esperar la caché) y se audita', async () => {
    const org = await crearOrganizacion();
    const miembro = await miembroCon(org.id, 'ADMIN');
    const { cabeceras } = await superadminCon();
    // Primera petición: la membresía queda en la caché del resolver como vigente.
    expect((await request(app).get('/api/organizacion').set(miembro.cabeceras)).status).toBe(200);

    const res = await accionOrg(app, cabeceras, org.id, 'suspender');

    expect(res.status).toBe(200);
    expect(res.body.estadoVerificacion).toBe('SUSPENDIDA');
    const despues = await request(app).get('/api/organizacion').set(miembro.cabeceras);
    expect(despues.status).toBe(403);
    expect(despues.body.error.code).toBe('SIN_EMPRESA');
    expect(await eventos('SUSPENSION_ORG', org.id)).toHaveLength(1);
  });

  it('reactivar: vuelve a VERIFICADA si alguna vez lo estuvo y a PENDIENTE si no; el miembro recupera la empresa', async () => {
    const nunca = await crearOrganizacion();
    const verificada = await crearOrganizacion();
    const miembro = await miembroCon(verificada.id, 'RECLUTADOR');
    const { cabeceras } = await superadminCon();
    await accionOrg(app, cabeceras, verificada.id, 'verificar');
    for (const org of [nunca, verificada]) await accionOrg(app, cabeceras, org.id, 'suspender');
    expect((await request(app).get('/api/organizacion').set(miembro.cabeceras)).status).toBe(403);

    const r1 = await accionOrg(app, cabeceras, nunca.id, 'reactivar');
    const r2 = await accionOrg(app, cabeceras, verificada.id, 'reactivar');

    expect(r1.status).toBe(200);
    expect(r1.body.estadoVerificacion).toBe('PENDIENTE');
    expect(r2.body.estadoVerificacion).toBe('VERIFICADA');
    expect((await request(app).get('/api/organizacion').set(miembro.cabeceras)).status).toBe(200);
    expect(await eventos('REACTIVACION_ORG', verificada.id)).toHaveLength(1);
    // Reactivar una empresa que no está suspendida no cambia nada ni audita.
    const otra = await accionOrg(app, cabeceras, verificada.id, 'reactivar');
    expect(otra.body.estadoVerificacion).toBe('VERIFICADA');
    expect(await eventos('REACTIVACION_ORG', verificada.id)).toHaveLength(1);
  });
});
