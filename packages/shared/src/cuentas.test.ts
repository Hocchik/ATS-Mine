import { describe, expect, it } from 'vitest';
import {
  ROLES,
  SLUGS_RESERVADOS,
  actualizarOrganizacionSchema,
  cambiarRolSchema,
  contrasenaSchema,
  crearInvitacionSchema,
  crearOrganizacionSchema,
  emailSchema,
  loginSchema,
  nombrePersonaSchema,
  registroSchema,
  slugSchema,
} from './cuentas';

describe('emailSchema', () => {
  it('recorta y pasa a minúsculas', () => {
    expect(emailSchema.parse('  Ana@Ejemplo.TEST ')).toBe('ana@ejemplo.test');
  });
  it('rechaza vacío, sin @ y más de 150 caracteres', () => {
    expect(emailSchema.safeParse('').success).toBe(false);
    expect(emailSchema.safeParse('sin-arroba').success).toBe(false);
    expect(emailSchema.safeParse(`${'a'.repeat(146)}@e.co`).success).toBe(false);
  });
});

describe('contrasenaSchema', () => {
  it('rechaza menos de 10 caracteres', () => {
    expect(contrasenaSchema.safeParse('123456789').success).toBe(false);
    expect(contrasenaSchema.safeParse('1234567890').success).toBe(true);
  });
  it('limita a 72 bytes UTF-8', () => {
    expect(contrasenaSchema.safeParse('ñ'.repeat(25)).success).toBe(true);
    expect(contrasenaSchema.safeParse('ñ'.repeat(40)).success).toBe(false);
  });
});

describe('nombrePersonaSchema', () => {
  it('recorta y exige 1 a 100 caracteres', () => {
    expect(nombrePersonaSchema.parse('  Ana ')).toBe('Ana');
    expect(nombrePersonaSchema.safeParse('   ').success).toBe(false);
    expect(nombrePersonaSchema.safeParse('a'.repeat(101)).success).toBe(false);
  });
});

describe('slugSchema', () => {
  it('pasa a minúsculas y valida el formato', () => {
    expect(slugSchema.parse('Mi-Tienda')).toBe('mi-tienda');
    expect(slugSchema.safeParse('a').success).toBe(false);
    expect(slugSchema.safeParse('-ab').success).toBe(false);
    expect(slugSchema.safeParse('ab-').success).toBe(false);
    expect(slugSchema.safeParse('a'.repeat(41)).success).toBe(false);
    expect(slugSchema.safeParse('a_b').success).toBe(false);
  });
  it('rechaza guiones consecutivos', () => {
    expect(slugSchema.safeParse('mi--tienda').success).toBe(false);
  });
  it.each([...SLUGS_RESERVADOS])('rechaza el slug reservado %s', (s) => {
    // los de 2 letras no pasan el formato igualmente; todos deben fallar
    expect(slugSchema.safeParse(s).success).toBe(false);
  });
  it('incluye los reservados esperados', () => {
    for (const s of ['app', 'api', 'public', 'internal', 'login', 'registro', 'seguimiento',
      'privacidad', 'admin', 'superadmin', 'empleos', 'static', 'assets', 'health',
      'invitacion', 'restablecer', 'www', 'docs']) {
      expect(SLUGS_RESERVADOS).toContain(s);
    }
  });
});

describe('registro y login', () => {
  it('registroSchema valida nombre, email y contraseña', () => {
    const r = registroSchema.parse({ nombre: ' Ana ', email: 'A@b.co', contrasena: '1234567890' });
    expect(r).toEqual({ nombre: 'Ana', email: 'a@b.co', contrasena: '1234567890' });
    expect(registroSchema.safeParse({ nombre: 'Ana', email: 'a@b.co', contrasena: 'corta' }).success).toBe(false);
  });
  it('loginSchema solo exige 1 carácter de contraseña', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', contrasena: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'a@b.co', contrasena: '' }).success).toBe(false);
  });
});

describe('crearOrganizacionSchema', () => {
  const base = { nombre: 'Glonis', slug: 'glonis', zonaHoraria: 'America/Lima', locale: 'es-PE', pais: 'pe' };
  it('acepta y normaliza el país', () => {
    expect(crearOrganizacionSchema.parse(base).pais).toBe('PE');
  });
  it('acepta UTC y rechaza zonas inválidas', () => {
    expect(crearOrganizacionSchema.safeParse({ ...base, zonaHoraria: 'UTC' }).success).toBe(true);
    expect(crearOrganizacionSchema.safeParse({ ...base, zonaHoraria: 'Marte/Olimpo' }).success).toBe(false);
  });
  it('valida locale, país y nombre', () => {
    expect(crearOrganizacionSchema.safeParse({ ...base, locale: 'es' }).success).toBe(false);
    expect(crearOrganizacionSchema.safeParse({ ...base, locale: 'ES-pe' }).success).toBe(false);
    expect(crearOrganizacionSchema.safeParse({ ...base, pais: 'PER' }).success).toBe(false);
    expect(crearOrganizacionSchema.safeParse({ ...base, nombre: '' }).success).toBe(false);
    expect(crearOrganizacionSchema.safeParse({ ...base, nombre: 'a'.repeat(121) }).success).toBe(false);
  });
});

describe('actualizarOrganizacionSchema', () => {
  it('todas las claves son opcionales', () => {
    expect(actualizarOrganizacionSchema.safeParse({}).success).toBe(true);
  });
  it('valida colorAcento', () => {
    expect(actualizarOrganizacionSchema.safeParse({ colorAcento: '#1A2b3C' }).success).toBe(true);
    expect(actualizarOrganizacionSchema.safeParse({ colorAcento: '#12345' }).success).toBe(false);
    expect(actualizarOrganizacionSchema.safeParse({ colorAcento: 'red' }).success).toBe(false);
  });
  it('valida retencionMeses', () => {
    expect(actualizarOrganizacionSchema.safeParse({ retencionMeses: 1 }).success).toBe(true);
    expect(actualizarOrganizacionSchema.safeParse({ retencionMeses: 120 }).success).toBe(true);
    expect(actualizarOrganizacionSchema.safeParse({ retencionMeses: 0 }).success).toBe(false);
    expect(actualizarOrganizacionSchema.safeParse({ retencionMeses: 121 }).success).toBe(false);
    expect(actualizarOrganizacionSchema.safeParse({ retencionMeses: 1.5 }).success).toBe(false);
  });
  it('sitioWeb debe ser https', () => {
    expect(actualizarOrganizacionSchema.safeParse({ sitioWeb: 'https://glonis.pe' }).success).toBe(true);
    expect(actualizarOrganizacionSchema.safeParse({ sitioWeb: 'http://glonis.pe' }).success).toBe(false);
    expect(actualizarOrganizacionSchema.safeParse({ sitioWeb: 'javascript:alert(1)' }).success).toBe(false);
  });
  it('limita textos', () => {
    expect(actualizarOrganizacionSchema.safeParse({ textoPrivacidad: 'a'.repeat(20000) }).success).toBe(true);
    expect(actualizarOrganizacionSchema.safeParse({ textoPrivacidad: 'a'.repeat(20001) }).success).toBe(false);
    expect(actualizarOrganizacionSchema.safeParse({ mensajeCierre: 'a'.repeat(1000) }).success).toBe(true);
    expect(actualizarOrganizacionSchema.safeParse({ mensajeCierre: 'a'.repeat(1001) }).success).toBe(false);
  });
  it('rechaza claves desconocidas', () => {
    expect(actualizarOrganizacionSchema.safeParse({ esDemo: true }).success).toBe(false);
  });
  it('logoClave ya no es editable por el cliente', () => {
    expect(actualizarOrganizacionSchema.safeParse({ logoClave: 'x/y.png' }).success).toBe(false);
  });
  it('los textos largos rechazan caracteres de control pero admiten saltos de línea y tabuladores', () => {
    const nul = String.fromCharCode(0);
    const campana = String.fromCharCode(7);
    const del = String.fromCharCode(127);
    for (const campo of ['textoPrivacidad', 'mensajeCierre'] as const) {
      expect(actualizarOrganizacionSchema.safeParse({ [campo]: `a${nul}b` }).success).toBe(false);
      expect(actualizarOrganizacionSchema.safeParse({ [campo]: `a${campana}b` }).success).toBe(false);
      expect(actualizarOrganizacionSchema.safeParse({ [campo]: `a${del}b` }).success).toBe(false);
      expect(actualizarOrganizacionSchema.safeParse({ [campo]: 'a\nb\r\n\tc' }).success).toBe(true);
    }
  });
});

describe('invitaciones y roles', () => {
  it('acepta los roles válidos', () => {
    expect(ROLES).toEqual(['ADMIN', 'RECLUTADOR', 'ENTREVISTADOR', 'OWNER']);
    expect(crearInvitacionSchema.parse({ email: 'A@b.co', rol: 'ADMIN' })).toEqual({ email: 'a@b.co', rol: 'ADMIN' });
    expect(crearInvitacionSchema.safeParse({ email: 'a@b.co', rol: 'ROOT' }).success).toBe(false);
    expect(cambiarRolSchema.safeParse({ rol: 'OWNER' }).success).toBe(true);
    expect(cambiarRolSchema.safeParse({ rol: 'x' }).success).toBe(false);
  });
});

describe('nombres sin caracteres de control', () => {
  const malos = ['Ana\u0000', 'Ana\nPérez', 'Ana\tPérez', 'Ana\u007F'];
  it.each(malos)('rechaza %j en nombre de persona y de empresa', (nombre) => {
    expect(nombrePersonaSchema.safeParse(nombre).success).toBe(false);
    const base = { slug: 'acme-demo', zonaHoraria: 'UTC', locale: 'es-PE', pais: 'PE' };
    expect(crearOrganizacionSchema.safeParse({ ...base, nombre }).success).toBe(false);
    expect(actualizarOrganizacionSchema.safeParse({ nombre }).success).toBe(false);
  });

  it('acepta letras con tildes y eñes', () => {
    expect(nombrePersonaSchema.safeParse('José Ñandú Pérez').success).toBe(true);
    expect(actualizarOrganizacionSchema.safeParse({ nombre: 'Compañía Ñ' }).success).toBe(true);
  });
});
