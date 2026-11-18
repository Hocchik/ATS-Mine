import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exigirBaseDePrueba } from '../cargar-env';

const BASE = 'postgresql://usuario:clave@localhost:5432';

describe('exigirBaseDePrueba', () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.DATABASE_URL;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it.each([`${BASE}/criterio_test`, `${BASE}/criterio_test?schema=public`])('acepta %s', (url) => {
    process.env.DATABASE_URL = url;
    expect(() => exigirBaseDePrueba()).not.toThrow();
  });

  it.each([
    `${BASE}/criterio_dev?application_name=x_test`,
    `${BASE}/criterio_dev`,
    `${BASE}/criterio_test_respaldo`,
    'no-es-url',
    '',
  ])('rechaza %j', (url) => {
    process.env.DATABASE_URL = url;
    expect(() => exigirBaseDePrueba()).toThrow(/_test/);
  });

  it('rechaza si DATABASE_URL no está definida', () => {
    delete process.env.DATABASE_URL;
    expect(() => exigirBaseDePrueba()).toThrow(/_test/);
  });
});
