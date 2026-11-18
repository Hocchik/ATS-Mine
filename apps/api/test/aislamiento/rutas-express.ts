import { claveDeRuta } from '../../src/http/registro';

interface CapaExpress {
  name?: string;
  route?: { path: string | string[]; methods: Record<string, boolean> };
  handle?: { stack?: CapaExpress[] };
}

type AppConRouter = { router: { stack: unknown[] } };

interface Recorrido {
  /** `METODO /ruta` de cada ruta montada, con repeticiones. */
  rutas: string[];
  /** Middleware montado con `router.use(...)` dentro de un router de módulo (no es una ruta ni un router). */
  middleware: string[];
}

/**
 * Recorre el router de Express 5. Del nivel de la app solo toma las rutas y los routers de los módulos: su propio
 * middleware (helmet, pino, json, cookieParser, edge, 404, errores) no se reporta. Dentro de los routers de los
 * módulos, todo lo que no sea una ruta ni otro router es un `router.use(...)` que escapa del registro.
 */
export function recorrerExpress(app: AppConRouter): Recorrido {
  const resultado: Recorrido = { rutas: [], middleware: [] };
  const recorrer = (stack: CapaExpress[], enModulo: boolean) => {
    for (const capa of stack) {
      if (capa.route) {
        const rutas = Array.isArray(capa.route.path) ? capa.route.path : [capa.route.path];
        for (const [metodo, activo] of Object.entries(capa.route.methods)) {
          if (activo) for (const ruta of rutas) resultado.rutas.push(`${metodo.toUpperCase()} ${ruta}`);
        }
      } else if (capa.handle?.stack) {
        recorrer(capa.handle.stack, true);
      } else if (enModulo) {
        resultado.middleware.push(`USE ${capa.name ?? '<anonymous>'}`);
      }
    }
  };
  recorrer(app.router.stack as CapaExpress[], false);
  return resultado;
}

/**
 * Problemas entre lo montado en Express y el registro: rutas que no pasaron por `registro.definir`, rutas montadas
 * más veces de las registradas (se cuentan sin distinguir mayúsculas, barra final ni nombre de `:param`, igual que
 * Express: la copia que va primero sombrea a la otra) y middleware `router.use(...)` dentro de los routers.
 */
export function rutasSinRegistrar(app: AppConRouter, definiciones: readonly { metodo: string; ruta: string }[]): string[] {
  const registradas = new Map<string, number>();
  for (const d of definiciones) {
    const clave = claveDeRuta(d.metodo, d.ruta);
    registradas.set(clave, (registradas.get(clave) ?? 0) + 1);
  }
  const { rutas, middleware } = recorrerExpress(app);
  const montadas = new Map<string, { ejemplo: string; veces: number }>();
  for (const r of rutas) {
    const [metodo = '', ruta = ''] = r.split(' ');
    const clave = claveDeRuta(metodo, ruta);
    const previa = montadas.get(clave);
    montadas.set(clave, { ejemplo: previa?.ejemplo ?? r, veces: (previa?.veces ?? 0) + 1 });
  }
  const problemas: string[] = [];
  for (const [clave, { ejemplo, veces }] of montadas) {
    const enRegistro = registradas.get(clave) ?? 0;
    if (enRegistro === 0 && veces === 1) problemas.push(ejemplo);
    else if (enRegistro === 0) problemas.push(`${ejemplo} (montada ${veces} veces, registrada 0)`);
    else if (veces > 1) problemas.push(`${ejemplo} (montada ${veces} veces, registrada ${enRegistro})`);
  }
  return [...problemas, ...middleware];
}
