interface CapaExpress {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: CapaExpress[] };
}

type AppConRouter = { router: { stack: unknown[] } };

/** Recorre el router de Express 5 y devuelve cada ruta montada como `METODO /ruta`. */
export function rutasDeExpress(app: AppConRouter): string[] {
  const rutas: string[] = [];
  const recorrer = (stack: CapaExpress[]) => {
    for (const capa of stack) {
      if (capa.route) {
        for (const [metodo, activo] of Object.entries(capa.route.methods)) {
          if (activo) rutas.push(`${metodo.toUpperCase()} ${capa.route.path}`);
        }
      } else if (capa.handle?.stack) {
        recorrer(capa.handle.stack);
      }
    }
  };
  recorrer(app.router.stack as CapaExpress[]);
  return rutas;
}

/** Rutas montadas en Express que no pasaron por `registro.definir`. */
export function rutasSinRegistrar(app: AppConRouter, definiciones: readonly { metodo: string; ruta: string }[]): string[] {
  const registradas = new Set(definiciones.map((d) => `${d.metodo.toUpperCase()} ${d.ruta}`));
  return rutasDeExpress(app).filter((r) => !registradas.has(r));
}
