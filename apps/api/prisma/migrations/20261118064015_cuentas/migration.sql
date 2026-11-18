-- CreateEnum
CREATE TYPE "TipoEventoAuditoria" AS ENUM ('LOGIN', 'LOGIN_FALLIDO', 'REGISTRO', 'CAMBIO_ROL', 'MIEMBRO_ELIMINADO', 'INVITACION_CREADA', 'INVITACION_ACEPTADA', 'INVITACION_REVOCADA', 'ORGANIZACION_CREADA', 'VERIFICACION_ORG', 'SUSPENSION_ORG', 'REACTIVACION_ORG', 'RESTABLECER_GENERADO', 'RESTABLECER_USADO');

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "versionSesion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "Invitacion" (
    "id" UUID NOT NULL,
    "organizacionId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "aceptadaEn" TIMESTAMP(3),
    "revocadaEn" TIMESTAMP(3),
    "creadaPorId" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenRestablecer" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "usadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenRestablecer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlugAnterior" (
    "slug" TEXT NOT NULL,
    "organizacionIdDestino" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlugAnterior_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "EventoAuditoria" (
    "id" UUID NOT NULL,
    "tipo" "TipoEventoAuditoria" NOT NULL,
    "usuarioId" UUID,
    "organizacionAfectadaId" UUID,
    "ip" TEXT,
    "datos" JSONB NOT NULL DEFAULT '{}',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoAuditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invitacion_tokenHash_key" ON "Invitacion"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitacion_organizacionId_idx" ON "Invitacion"("organizacionId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitacion_id_organizacionId_key" ON "Invitacion"("id", "organizacionId");

-- CreateIndex
CREATE UNIQUE INDEX "TokenRestablecer_tokenHash_key" ON "TokenRestablecer"("tokenHash");

-- CreateIndex
CREATE INDEX "EventoAuditoria_organizacionAfectadaId_creadoEn_idx" ON "EventoAuditoria"("organizacionAfectadaId", "creadoEn");

-- AddForeignKey
ALTER TABLE "Invitacion" ADD CONSTRAINT "Invitacion_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenRestablecer" ADD CONSTRAINT "TokenRestablecer_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlugAnterior" ADD CONSTRAINT "SlugAnterior_organizacionIdDestino_fkey" FOREIGN KEY ("organizacionIdDestino") REFERENCES "Organizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
