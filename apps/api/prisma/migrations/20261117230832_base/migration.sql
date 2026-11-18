-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('OWNER', 'ADMIN', 'RECLUTADOR', 'ENTREVISTADOR');

-- CreateEnum
CREATE TYPE "EstadoVerificacion" AS ENUM ('PENDIENTE', 'VERIFICADA', 'SUSPENDIDA');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "esSuperadmin" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organizacion" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoClave" TEXT,
    "colorAcento" TEXT NOT NULL DEFAULT '#0F766E',
    "zonaHoraria" TEXT NOT NULL DEFAULT 'America/Lima',
    "locale" TEXT NOT NULL DEFAULT 'es-PE',
    "pais" CHAR(2) NOT NULL DEFAULT 'PE',
    "sitioWeb" TEXT,
    "textoPrivacidad" TEXT NOT NULL DEFAULT '',
    "mensajeCierre" TEXT NOT NULL DEFAULT 'Gracias por postular. En esta ocasión el proceso continuó con otros perfiles.',
    "retencionMeses" INTEGER NOT NULL DEFAULT 12,
    "estadoVerificacion" "EstadoVerificacion" NOT NULL DEFAULT 'PENDIENTE',
    "verificadaPorId" UUID,
    "verificadaEn" TIMESTAMP(3),
    "dominioCorreoVerificado" BOOLEAN NOT NULL DEFAULT false,
    "esDemo" BOOLEAN NOT NULL DEFAULT false,
    "googleJobsHabilitado" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membresia" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "rol" "Rol" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membresia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Organizacion_slug_key" ON "Organizacion"("slug");

-- CreateIndex
CREATE INDEX "Membresia_organizacionId_idx" ON "Membresia"("organizacionId");

-- CreateIndex
CREATE UNIQUE INDEX "Membresia_usuarioId_organizacionId_key" ON "Membresia"("usuarioId", "organizacionId");

-- CreateIndex
CREATE UNIQUE INDEX "Membresia_id_organizacionId_key" ON "Membresia"("id", "organizacionId");

-- AddForeignKey
ALTER TABLE "Membresia" ADD CONSTRAINT "Membresia_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membresia" ADD CONSTRAINT "Membresia_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
