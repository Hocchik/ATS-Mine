-- Los CVs pasan a guardarse en la base de datos: el filesystem de Render free
-- es efímero y los PDFs en disco se pierden en cada deploy/reinicio.
ALTER TABLE "Candidato" ADD COLUMN "cvData" BYTEA;
