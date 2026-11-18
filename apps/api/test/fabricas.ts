import { randomUUID } from 'node:crypto';
import type { Rol } from '@prisma/client';
import { prismaPrueba } from './db';

const sufijo = () => randomUUID().slice(0, 8);

export function crearOrganizacion(datos: { nombre?: string } = {}) {
  const s = sufijo();
  return prismaPrueba.organizacion.create({
    data: { nombre: datos.nombre ?? `Empresa ${s}`, slug: `empresa-${s}` },
  });
}

export function crearUsuario() {
  const s = sufijo();
  return prismaPrueba.usuario.create({
    data: { email: `u-${s}@ejemplo.test`, nombre: `Persona ${s}`, passwordHash: 'no-usar' },
  });
}

export function crearMembresia(usuarioId: string, organizacionId: string, rol: Rol = 'OWNER') {
  return prismaPrueba.membresia.create({ data: { usuarioId, organizacionId, rol } });
}
