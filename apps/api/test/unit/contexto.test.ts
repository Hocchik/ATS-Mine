import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { contextoActual, ejecutarComoPlataforma, ejecutarEnTenant } from '../../src/tenant/contexto';

describe('ejecutarEnTenant', () => {
  it('rechaza un organizacionId que no es UUID', async () => {
    await expect(ejecutarEnTenant('org-1', () => 1)).rejects.toThrow(/organizacionId inválido/);
  });

  it('no permite cambiar a otra empresa dentro de un contexto de empresa', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await expect(ejecutarEnTenant(a, () => ejecutarEnTenant(b, () => 1))).rejects.toThrow(/cambiar de empresa/);
  });

  it('permite anidar la misma empresa', async () => {
    const a = randomUUID();
    expect(await ejecutarEnTenant(a, () => ejecutarEnTenant(a, () => 7))).toBe(7);
  });

  it('permite entrar a una empresa desde el modo plataforma', async () => {
    const a = randomUUID();
    const ctx = await ejecutarComoPlataforma('prueba', () => ejecutarEnTenant(a, () => contextoActual()));
    expect(ctx).toEqual({ modo: 'tenant', organizacionId: a });
  });

  it('un error síncrono de fn se convierte en rechazo', async () => {
    await expect(
      ejecutarEnTenant(randomUUID(), () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('normaliza el UUID a minúsculas', async () => {
    const a = randomUUID();
    const ctx = await ejecutarEnTenant(a.toUpperCase(), () => contextoActual());
    expect(ctx).toEqual({ modo: 'tenant', organizacionId: a });
    expect(await ejecutarEnTenant(a, () => ejecutarEnTenant(a.toUpperCase(), () => 1))).toBe(1);
  });
});

describe('ejecutarComoPlataforma', () => {
  it.each(['', '   ', '\t\n'])('exige un motivo no vacío (%j)', async (motivo) => {
    let ejecutada = false;
    await expect(
      ejecutarComoPlataforma(motivo, () => {
        ejecutada = true;
      }),
    ).rejects.toThrow(/motivo/);
    expect(ejecutada).toBe(false);
  });

  it('con motivo, corre en modo plataforma', async () => {
    expect(await ejecutarComoPlataforma('auth.login', () => contextoActual())).toEqual({
      modo: 'plataforma',
      motivo: 'auth.login',
    });
  });
});
