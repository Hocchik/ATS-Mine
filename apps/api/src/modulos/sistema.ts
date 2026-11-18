import type { Modulo } from '../app';

export function moduloSistema(): Modulo {
  return ({ registro, router }) => {
    registro.definir(router, { metodo: 'get', ruta: '/health', acceso: 'PUBLICA' }, (_req, res) => {
      res.json({ ok: true });
    });
  };
}
