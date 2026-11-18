// Resetea la contraseña de un usuario directamente en la base de datos.
// Uso (PowerShell):
//   $env:DATABASE_URL = "postgresql://...neon...?sslmode=require"
//   $env:RESET_EMAIL = "admin@glonis.pe"
//   $env:RESET_PASSWORD = "la-nueva-contraseña"
//   node scripts/reset-password.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const email = process.env.RESET_EMAIL || 'admin@glonis.pe';
  const password = process.env.RESET_PASSWORD;
  if (!password) {
    throw new Error('RESET_PASSWORD no está configurada');
  }
  if (password.length < 8) {
    throw new Error('La contraseña debe tener al menos 8 caracteres');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.usuario.update({ where: { email }, data: { passwordHash } });
  console.log(`Contraseña actualizada para ${email}`);
}

main()
  .catch((e) => { console.error(e.code === 'P2025' ? 'Usuario no encontrado' : e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
