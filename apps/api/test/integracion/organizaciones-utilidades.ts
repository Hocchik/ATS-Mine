import type { Rol } from '@prisma/client';
import { crearMembresia, crearUsuario } from '../fabricas';
import { cabecerasDeSesionReal } from '../sesion-real';

/** Persona nueva con membresía `rol` en la empresa y cabeceras de sesión real (cookie + CSRF + Origin) en ella. */
export async function miembroCon(organizacionId: string, rol: Rol) {
  const usuario = await crearUsuario();
  const membresia = await crearMembresia(usuario.id, organizacionId, rol);
  const cabeceras = await cabecerasDeSesionReal({ usuarioId: usuario.id, organizacionId, rol });
  return { usuario, membresia, cabeceras };
}
