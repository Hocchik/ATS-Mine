import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { obtenerEmpresaActivaOpcional, obtenerSesionEmpresa, type SesionEmpresa } from '../../src/http/sesion';
import { ejecutarComoPlataforma, ejecutarEnTenant } from '../../src/tenant/contexto';

const ORG = '00000000-0000-4000-8000-000000000001';
const OTRA = '00000000-0000-4000-8000-000000000002';
const sesion: SesionEmpresa = { usuarioId: 'u', esSuperadmin: false, organizacionId: ORG, membresiaId: 'm', rol: 'OWNER' };
const respuesta = (locals: Record<string, unknown>) => ({ locals }) as unknown as Response;
const codigo = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'sin-error';
};

describe('obtenerSesionEmpresa', () => {
  it('devuelve la sesión dentro del contexto de su propia empresa', async () => {
    const res = respuesta({ sesion });
    expect(await ejecutarEnTenant(ORG, () => obtenerSesionEmpresa(res))).toEqual(sesion);
  });

  it('lanza SIN_EMPRESA fuera de contexto, en modo plataforma o en el contexto de otra empresa', async () => {
    const res = respuesta({ sesion });
    expect(codigo(() => obtenerSesionEmpresa(res))).toBe('SIN_EMPRESA');
    expect(await ejecutarComoPlataforma('prueba', () => codigo(() => obtenerSesionEmpresa(res)))).toBe('SIN_EMPRESA');
    expect(await ejecutarEnTenant(OTRA, () => codigo(() => obtenerSesionEmpresa(res)))).toBe('SIN_EMPRESA');
  });
});

describe('obtenerEmpresaActivaOpcional', () => {
  it('devuelve la empresa activa guardada aparte, o null', () => {
    const empresa = { organizacionId: ORG, membresiaId: 'm', rol: 'ADMIN' };
    expect(obtenerEmpresaActivaOpcional(respuesta({ empresaActiva: empresa }))).toEqual(empresa);
    expect(obtenerEmpresaActivaOpcional(respuesta({}))).toBeNull();
  });
});
