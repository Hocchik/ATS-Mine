import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase, prismaPrueba } from '../db';
import { crearOrganizacion } from '../fabricas';
import { appAuth } from './auth-utilidades';
import { miembroCon } from './organizaciones-utilidades';

beforeEach(limpiarBase);

const app = appAuth();
const ver = (cabeceras: Record<string, string>) => request(app).get('/api/organizacion').set(cabeceras);
const editar = (cabeceras: Record<string, string>, cuerpo: object) =>
  request(app).put('/api/organizacion').set(cabeceras).send(cuerpo);

describe('GET /api/organizacion', () => {
  it('devuelve la empresa propia', async () => {
    const org = await crearOrganizacion({ nombre: 'Propia' });
    await crearOrganizacion({ nombre: 'Ajena' });
    const { cabeceras } = await miembroCon(org.id, 'ENTREVISTADOR');

    const res = await ver(cabeceras);

    expect(res.status).toBe(200);
    expect(res.body.organizacion).toMatchObject({ id: org.id, nombre: 'Propia', slug: org.slug, estadoVerificacion: 'PENDIENTE' });
    expect(res.text).not.toContain('Ajena');
  });
});

describe('PUT /api/organizacion', () => {
  it('un OWNER edita los campos permitidos', async () => {
    const org = await crearOrganizacion();
    const { cabeceras } = await miembroCon(org.id, 'OWNER');
    const res = await editar(cabeceras, { nombre: 'Nuevo nombre', colorAcento: '#112233', retencionMeses: 24 });
    expect(res.status).toBe(200);
    expect(res.body.organizacion).toMatchObject({ nombre: 'Nuevo nombre', colorAcento: '#112233', retencionMeses: 24 });
    const fila = await prismaPrueba.organizacion.findUniqueOrThrow({ where: { id: org.id } });
    expect(fila.nombre).toBe('Nuevo nombre');
  });

  it('un RECLUTADOR → 403 FORBIDDEN', async () => {
    const org = await crearOrganizacion({ nombre: 'Intacta' });
    const { cabeceras } = await miembroCon(org.id, 'RECLUTADOR');
    const res = await editar(cabeceras, { nombre: 'X' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect((await prismaPrueba.organizacion.findUniqueOrThrow({ where: { id: org.id } })).nombre).toBe('Intacta');
  });

  it('esDemo: true → 400 (esquema estricto) y la empresa no cambia', async () => {
    const org = await crearOrganizacion();
    const { cabeceras } = await miembroCon(org.id, 'OWNER');
    const res = await editar(cabeceras, { esDemo: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect((await prismaPrueba.organizacion.findUniqueOrThrow({ where: { id: org.id } })).esDemo).toBe(false);
  });

  it('cambiar el slug guarda el anterior en SlugAnterior y otra empresa ya no puede tomarlo', async () => {
    const org = await crearOrganizacion();
    const slugViejo = org.slug;
    const { cabeceras } = await miembroCon(org.id, 'ADMIN');

    const res = await editar(cabeceras, { slug: 'slug-nuevo' });
    expect(res.status).toBe(200);
    expect(res.body.organizacion.slug).toBe('slug-nuevo');
    const anterior = await prismaPrueba.slugAnterior.findUnique({ where: { slug: slugViejo } });
    expect(anterior?.organizacionIdDestino).toBe(org.id);

    const otra = await crearOrganizacion();
    const { cabeceras: deOtra } = await miembroCon(otra.id, 'OWNER');
    const tomar = await editar(deOtra, { slug: slugViejo });
    expect(tomar.status).toBe(409);
    expect(tomar.body.error.code).toBe('DUPLICATE');
    const enUso = await editar(deOtra, { slug: 'slug-nuevo' });
    expect(enUso.status).toBe(409);
    expect((await prismaPrueba.organizacion.findUniqueOrThrow({ where: { id: otra.id } })).slug).toBe(otra.slug);
  });

  it('la empresa puede recuperar su propio slug anterior', async () => {
    const org = await crearOrganizacion();
    const slugOriginal = org.slug;
    const { cabeceras } = await miembroCon(org.id, 'OWNER');
    expect((await editar(cabeceras, { slug: 'temporal-1' })).status).toBe(200);

    const res = await editar(cabeceras, { slug: slugOriginal });

    expect(res.status).toBe(200);
    expect(res.body.organizacion.slug).toBe(slugOriginal);
    const anteriores = await prismaPrueba.slugAnterior.findMany({ orderBy: { slug: 'asc' } });
    expect(anteriores.map((a) => a.slug)).toEqual(['temporal-1']);
  });

  it('el mismo slug que ya tiene no se registra como anterior', async () => {
    const org = await crearOrganizacion();
    const { cabeceras } = await miembroCon(org.id, 'OWNER');
    const res = await editar(cabeceras, { slug: org.slug, nombre: 'Otro' });
    expect(res.status).toBe(200);
    expect(await prismaPrueba.slugAnterior.count()).toBe(0);
  });

  it('logoClave ya no se puede escribir desde el cliente → 400 y la empresa no cambia', async () => {
    const org = await crearOrganizacion();
    const { cabeceras } = await miembroCon(org.id, 'OWNER');
    const res = await editar(cabeceras, { logoClave: 'otra/clave.png' });
    expect(res.status).toBe(400);
    expect((await prismaPrueba.organizacion.findUniqueOrThrow({ where: { id: org.id } })).logoClave).toBeNull();
  });

  it('un NUL en textoPrivacidad → 400 (no 500)', async () => {
    const org = await crearOrganizacion();
    const { cabeceras } = await miembroCon(org.id, 'OWNER');
    const res = await editar(cabeceras, { textoPrivacidad: `hola${String.fromCharCode(0)}mundo` });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('PUT /api/organizacion: límite de cambios de slug', () => {
  it('3 cambios en 30 días pasan; el 4º → 429 y el slug no cambia; otros campos siguen editables', async () => {
    const org = await crearOrganizacion();
    const { cabeceras } = await miembroCon(org.id, 'OWNER');
    for (const slug of ['cambio-uno', 'cambio-dos', 'cambio-tres']) {
      expect((await editar(cabeceras, { slug })).status).toBe(200);
    }
    const res = await editar(cabeceras, { slug: 'cambio-cuatro' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect((await prismaPrueba.organizacion.findUniqueOrThrow({ where: { id: org.id } })).slug).toBe('cambio-tres');
    expect(await prismaPrueba.slugAnterior.count()).toBe(3);
    expect((await editar(cabeceras, { nombre: 'Sigue editable' })).status).toBe(200);
    // Recuperar su propio slug anterior también cuenta como cambio.
    expect((await editar(cabeceras, { slug: org.slug })).status).toBe(429);
  });

  it('los cambios de hace más de 30 días no cuentan', async () => {
    const org = await crearOrganizacion();
    const { cabeceras } = await miembroCon(org.id, 'OWNER');
    for (const slug of ['cambio-uno', 'cambio-dos', 'cambio-tres']) await editar(cabeceras, { slug });
    const hace31Dias = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await prismaPrueba.slugAnterior.updateMany({ data: { creadoEn: hace31Dias } });
    expect((await editar(cabeceras, { slug: 'cambio-cuatro' })).status).toBe(200);
  });

  it('el límite es por empresa', async () => {
    const org = await crearOrganizacion();
    const otra = await crearOrganizacion();
    const { cabeceras } = await miembroCon(org.id, 'OWNER');
    const deOtra = (await miembroCon(otra.id, 'OWNER')).cabeceras;
    for (const slug of ['cambio-uno', 'cambio-dos', 'cambio-tres']) await editar(cabeceras, { slug });
    expect((await editar(deOtra, { slug: 'otra-nuevo' })).status).toBe(200);
  });
});
