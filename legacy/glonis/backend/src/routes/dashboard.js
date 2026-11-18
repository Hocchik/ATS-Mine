const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');

const router = express.Router();

// Perú es UTC-5 (sin horario de verano) — límites de fecha calculados con offset explícito
const PERU_OFFSET = '-05:00';

function inicioDeMesPeru() {
  const ahoraPeru = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
  const y = ahoraPeru.getFullYear();
  const m = String(ahoraPeru.getMonth() + 1).padStart(2, '0');
  return new Date(`${y}-${m}-01T00:00:00${PERU_OFFSET}`);
}

function hace30Dias() {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

router.get('/resumen', auth, async (req, res, next) => {
  try {
    const [
      totalPostulantes,
      vacantesActivas,
      vacantesCerradas,
      scorePromedio,
    ] = await Promise.all([
      prisma.postulacion.count({ where: { creadoEn: { gte: inicioDeMesPeru() } } }),
      prisma.vacante.count({ where: { estado: 'ACTIVA' } }),
      prisma.vacante.count({ where: { estado: 'CERRADA' } }),
      prisma.postulacion.aggregate({
        _avg: { scoreTotal: true },
        where: { scoreTotal: { gt: 0 }, creadoEn: { gte: hace30Dias() } },
      }),
    ]);

    res.json({
      totalPostulantes,
      vacantesActivas,
      vacantesCerradas,
      scorePromedio: Math.round((scorePromedio._avg.scoreTotal || 0) * 10) / 10,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/pipeline', auth, async (req, res, next) => {
  try {
    const etapas = ['POSTULADO', 'EN_REVISION', 'ENTREVISTA', 'OFERTA', 'DESCARTADO'];

    const counts = await Promise.all(
      etapas.map((etapa) =>
        prisma.postulacion.count({ where: { etapa } }).then((count) => ({ etapa, count }))
      )
    );

    res.json(counts);
  } catch (err) {
    next(err);
  }
});

router.get('/top-candidatos', auth, async (req, res, next) => {
  try {
    const top = await prisma.postulacion.findMany({
      where: { scoreTotal: { gt: 0 }, etapa: { not: 'DESCARTADO' } },
      orderBy: { scoreTotal: 'desc' },
      take: 5,
      include: {
        candidato: { select: { id: true, nombre: true, email: true } },
        vacante: { select: { id: true, titulo: true, puesto: true } },
        score: {
          select: { scoreCV: true, scoreDisponibilidad: true, scoreCuestionario: true, scoreCoherencia: true },
        },
      },
    });

    res.json(top);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
