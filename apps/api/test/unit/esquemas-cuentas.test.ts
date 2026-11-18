import { actualizarOrganizacionSchema } from '@criterio/shared';
import { describe, expect, it } from 'vitest';
import { CAMPOS_EDITABLES_ORGANIZACION } from '../../src/tenant/globales';

describe('actualizarOrganizacionSchema vs CAMPOS_EDITABLES_ORGANIZACION', () => {
  it('declaran exactamente las mismas claves', () => {
    const claves = new Set(Object.keys(actualizarOrganizacionSchema.shape));
    expect(claves).toEqual(new Set(CAMPOS_EDITABLES_ORGANIZACION));
  });
});
