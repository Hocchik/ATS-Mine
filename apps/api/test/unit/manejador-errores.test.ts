import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { manejadorErrores } from '../../src/http/manejador-errores';

const crearFakes = (headersSent: boolean) => {
  const res = { headersSent, status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  const req = { id: 'r1', log: { error: vi.fn() } };
  const next = vi.fn();
  return { req, res, next };
};

describe('manejadorErrores', () => {
  it('delega en next(err) sin responder cuando los headers ya se enviaron', () => {
    const { req, res, next } = crearFakes(true);
    const err = new Error('tarde');

    manejadorErrores(err, req as unknown as Request, res as unknown as Response, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('responde 500 INTERNAL con requestId cuando aún se puede responder', () => {
    const { req, res, next } = crearFakes(false);

    manejadorErrores(new Error('boom'), req as unknown as Request, res as unknown as Response, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.objectContaining({ code: 'INTERNAL', requestId: 'r1' }),
    });
  });
});
