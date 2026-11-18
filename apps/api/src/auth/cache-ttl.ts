/** Cada cuántas escrituras se barren las entradas vencidas que nadie volvió a leer. */
const ESCRITURAS_ENTRE_BARRIDOS = 100;

export class CacheTTL<K, V> {
  private readonly entradas = new Map<K, { valor: V; vence: number }>();
  private escrituras = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly reloj: () => number = Date.now,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error(`CacheTTL: ttlMs inválido (${ttlMs})`);
  }

  obtener(clave: K): V | undefined {
    const e = this.entradas.get(clave);
    if (!e) return undefined;
    if (this.reloj() >= e.vence) {
      this.entradas.delete(clave);
      return undefined;
    }
    return e.valor;
  }

  guardar(clave: K, valor: V): void {
    const ahora = this.reloj();
    this.entradas.set(clave, { valor, vence: ahora + this.ttlMs });
    if (++this.escrituras % ESCRITURAS_ENTRE_BARRIDOS === 0) this.barrer(ahora);
  }

  private barrer(ahora: number): void {
    for (const [clave, e] of this.entradas) if (ahora >= e.vence) this.entradas.delete(clave);
  }

  borrar(clave: K): void {
    this.entradas.delete(clave);
  }

  limpiar(): void {
    this.entradas.clear();
  }
}
