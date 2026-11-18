import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SQL_CRUDO = ['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe', '$queryRawTyped'].map(
  (property) => ({ property, message: 'SQL crudo solo en src/db/sql-revisado.ts: salta el filtro multiempresa.' }),
);
// Un $extends posterior corre después del filtro multiempresa y puede reescribir args ya revisados.
const EXTENDER_CLIENTE = [
  { property: '$extends', message: 'Solo src/tenant/extension.ts extiende el cliente: otra extensión puede saltarse el aislamiento.' },
];
const SQL_REVISADO = 'apps/api/src/db/sql-revisado.ts';
const EXTENSION_TENANT = 'apps/api/src/tenant/extension.ts';

// En flat config, la última regla que aplica a un archivo reemplaza a las anteriores (no se combinan las opciones):
// por eso cada bloque de abajo arma su lista completa a partir de estas piezas.
const RUTA_SIN_REGISTRO = {
  selector:
    "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(get|post|put|patch|delete|all)$/][callee.object.name=/^(app|router)$/]",
  message: 'Registra rutas con registro.definir() para que queden clasificadas.',
};
const MENSAJE_CLIENTE_CRUDO =
  'El cliente sin filtro multiempresa solo se crea en src/db y src/server.ts; usa el PrismaTenant que recibe el módulo.';
const NUEVO_PRISMA_CLIENT = [
  { selector: "NewExpression[callee.name='PrismaClient']", message: MENSAJE_CLIENTE_CRUDO },
  { selector: "NewExpression[callee.property.name='PrismaClient']", message: MENSAJE_CLIENTE_CRUDO },
];
const IMPORTAR_PRUEBAS = { group: ['**/test/**'], message: 'El código de producción no importa utilidades de prueba.' };
const IMPORTAR_CLIENTE_CRUDO = {
  group: ['**/db/prisma', '**/db/prisma.js', '**/db/prisma.ts'],
  importNames: ['crearPrismaBase'],
  message: MENSAJE_CLIENTE_CRUDO,
};
const IMPORTAR_PRISMA_CLIENT = { name: '@prisma/client', importNames: ['PrismaClient'], message: MENSAJE_CLIENTE_CRUDO };
const reglasApi = ({ rutas, clienteCrudo }) => ({
  'no-restricted-syntax': ['error', ...(rutas ? [RUTA_SIN_REGISTRO] : []), ...(clienteCrudo ? NUEVO_PRISMA_CLIENT : [])],
  'no-restricted-imports': [
    'error',
    {
      paths: clienteCrudo ? [IMPORTAR_PRISMA_CLIENT] : [],
      patterns: [IMPORTAR_PRUEBAS, ...(clienteCrudo ? [IMPORTAR_CLIENTE_CRUDO] : [])],
    },
  ],
});
const CREAN_CLIENTE_CRUDO = ['apps/api/src/db/**', 'apps/api/src/server.ts'];
const REGISTRO = 'apps/api/src/http/registro.ts';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'legacy/**', 'services/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: [SQL_REVISADO, EXTENSION_TENANT],
    rules: { 'no-restricted-properties': ['error', ...SQL_CRUDO, ...EXTENDER_CLIENTE] },
  },
  { files: [SQL_REVISADO], rules: { 'no-restricted-properties': ['error', ...EXTENDER_CLIENTE] } },
  { files: [EXTENSION_TENANT], rules: { 'no-restricted-properties': ['error', ...SQL_CRUDO] } },
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: [REGISTRO, ...CREAN_CLIENTE_CRUDO],
    rules: reglasApi({ rutas: true, clienteCrudo: true }),
  },
  { files: [REGISTRO], rules: reglasApi({ rutas: false, clienteCrudo: true }) },
  { files: CREAN_CLIENTE_CRUDO, rules: reglasApi({ rutas: true, clienteCrudo: false }) },
);
