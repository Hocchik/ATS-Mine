import { describe, expect, it } from 'vitest';
import { normalizarRuta } from '../../src/http/registro';

describe('normalizarRuta', () => {
  it.each([
    ['/api/x/:a', '/api/x/:b'],
    ['/api/x/foo-:a', '/api/x/foo-:b'],
    ['/api/x/*s', '/api/x/*t'],
    ['/api/x/{:a}', '/api/x/{:b}'],
    ['/api/x/:a', '/api/x/*s'],
    ['/api/x//y', '/api/x/y'],
    ['/API/X/', '/api/x'],
  ])('%s y %s colisionan', (a, b) => {
    expect(normalizarRuta(a)).toBe(normalizarRuta(b));
  });

  it('una ruta literal no colisiona con un parámetro', () => {
    expect(normalizarRuta('/api/x/nuevo')).not.toBe(normalizarRuta('/api/x/:id'));
  });
});
