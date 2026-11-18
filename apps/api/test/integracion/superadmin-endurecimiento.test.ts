import { beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase, prismaPrueba } from '../db';
import { crearOrganizacion } from '../fabricas';
import { appAuth } from './auth-utilidades';
import { accionOrg, generarEnlace, superadminCon } from './superadmin-utilidades';

beforeEach(limpiarBase);

describe('superadmin: endurecimiento', () => {
  it('verificar una empresa ya verificada no reescribe quién ni cuándo la verificó, ni vuelve a auditar', async () => {
    const app = appAuth();
    const org = await crearOrganizacion();
    const primero = await superadminCon();
    const segundo = await superadminCon();

    expect((await accionOrg(app, primero.cabeceras, org.id, 'verificar')).status).toBe(200);
    const antes = await prismaPrueba.organizacion.findUniqueOrThrow({ where: { id: org.id } });

    const res = await accionOrg(app, segundo.cabeceras, org.id, 'verificar', { dominioCorreoVerificado: true });
    expect(res.status).toBe(200);
    const despues = await prismaPrueba.organizacion.findUniqueOrThrow({ where: { id: org.id } });
    expect(despues.verificadaPorId).toBe(primero.usuario.id);
    expect(despues.verificadaEn?.toISOString()).toBe(antes.verificadaEn?.toISOString());
    // El dato de dominio sí puede completarse después.
    expect(despues.dominioCorreoVerificado).toBe(true);
    const auditorias = await prismaPrueba.eventoAuditoria.count({
      where: { tipo: 'VERIFICACION_ORG', organizacionAfectadaId: org.id },
    });
    expect(auditorias).toBe(1);
  });

  it('no se generan enlaces de restablecer para cuentas superadmin (ni la propia)', async () => {
    const app = appAuth();
    const atacante = await superadminCon();
    const victima = await superadminCon();

    const aOtro = await generarEnlace(app, atacante.cabeceras, victima.usuario.id);
    expect(aOtro.status).toBe(403);
    expect(aOtro.body.error.code).toBe('FORBIDDEN');
    const aSiMismo = await generarEnlace(app, atacante.cabeceras, atacante.usuario.id);
    expect(aSiMismo.status).toBe(403);
    expect(await prismaPrueba.tokenRestablecer.count()).toBe(0);
  });
});
