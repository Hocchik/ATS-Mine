export class CacheTTL<K, V> {
  private readonly entradas = new Map<K, { valor: V; vence: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly reloj: () => number = Date.now,
  ) {}

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
    this.entradas.set(clave, { valor, vence: this.reloj() + this.ttlMs });
  }

  borrar(clave: K): void {
    this.entradas.delete(clave);
  }

  limpiar(): void {
    this.entradas.clear();
  }
}
