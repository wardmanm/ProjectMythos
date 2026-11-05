// ESLint for the whole repository: typescript-eslint's strict type-checked rules, plus
// eslint-plugin-boundaries for the package and module boundaries (CONV-121).
// scripts/lint-rules.test.ts proves each restriction below fires.
import boundaries from 'eslint-plugin-boundaries';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// ARCH-021: the server modules each module may import. Anything not listed is forbidden,
// and the table has no cycles. http may import every other module's public API.
const moduleImports = {
  config: [],
  storage: ['config'],
  events: [],
  auth: ['config'],
  content: ['config', 'storage'],
  providers: ['config', 'storage', 'events'],
  memory: ['storage', 'providers'],
  context: ['content', 'memory', 'storage'],
  journal: ['memory', 'storage'],
  world: ['memory', 'context', 'providers', 'storage', 'events'],
  turn: ['world', 'context', 'memory', 'providers', 'content', 'storage', 'events'],
  media: ['providers', 'storage', 'content', 'events'],
};
moduleImports.http = Object.keys(moduleImports);
const allModules = Object.keys(moduleImports);

// Where each kind of code lives. Patterns match the full path from the repository root.
// A file takes the type of the first descriptor it matches, so the server's modules and
// cli come before the server folder that contains them.
const elements = [
  { type: 'contracts', pattern: 'packages/contracts/src' },
  { type: 'core', pattern: 'packages/core/src' },
  { type: 'server-module', pattern: 'apps/server/src/modules/*', capture: ['module'] },
  { type: 'server-cli', pattern: 'apps/server/src/cli' },
  { type: 'server', pattern: 'apps/server/src' },
  { type: 'client', pattern: 'apps/client' },
  { type: 'scripts', pattern: 'scripts' },
].map((element) => ({ ...element, partialMatch: false }));

// A workspace package is reached by name (ARCH-004) or, wrongly, by a relative path.
// Either way it must be allowed by the package table in ARCH §2.
const contracts = [{ element: { type: 'contracts' } }, { module: { source: '@mythos/contracts' } }];
const core = [{ element: { type: 'core' } }, { module: { source: '@mythos/core' } }];
const anyPackage = { module: { origin: ['external', 'core'] } };
const serverByName = { module: { source: '@mythos/server' } };
const clientByName = { module: { source: '@mythos/client' } };
const coreByName = { module: { source: '@mythos/core' } };

const moduleIndex = (name) => ({
  element: { type: 'server-module', captured: { module: name }, fileInternalPath: 'index.ts' },
});

// Policies are read in order, and the last one that matches a dependency decides it.
const dependencyPolicies = [
  // ARCH §2: contracts depends on zod only, core on contracts only (ARCH-010).
  { from: { element: { type: 'contracts' } }, allow: { to: { module: { source: 'zod' } } } },
  { from: { element: { type: 'core' } }, allow: { to: contracts } },
  // Tests may use any npm package or Node built-in; local boundaries still apply.
  { from: { file: { categories: 'test' } }, allow: { to: anyPackage } },

  // The server uses core, contracts, and any npm package, never the client.
  {
    from: { element: { types: ['server', 'server-module', 'server-cli'] } },
    allow: { to: [...contracts, ...core, anyPackage] },
  },
  // ARCH-020, ARCH-021: a module imports another only through its index.ts, and only as
  // the table allows. A module that may import none needs no policy.
  ...Object.entries(moduleImports)
    .filter(([, allowed]) => allowed.length > 0)
    .map(([name, allowed]) => ({
      from: { element: { type: 'server-module', captured: { module: name } } },
      allow: { to: allowed.map(moduleIndex) },
    })),
  // ARCH-022: app.ts and main.ts may import any module's index.ts; cli files import
  // app.ts and nothing else from the server.
  { from: { element: { type: 'server' } }, allow: { to: allModules.map(moduleIndex) } },
  {
    from: { element: { type: 'server-cli' } },
    allow: { to: { element: { type: 'server', fileInternalPath: 'app.ts' } } },
  },

  // The client depends on contracts and npm packages, never on core or the server.
  { from: { element: { type: 'client' } }, allow: { to: [...contracts, anyPackage] } },
  { from: { element: { type: 'client' } }, disallow: { to: [coreByName, serverByName] } },

  // ARCH-007: scripts import no app code.
  { from: { element: { type: 'scripts' } }, allow: { to: [...contracts, ...core, anyPackage] } },
  { from: { element: { type: 'scripts' } }, disallow: { to: [serverByName, clientByName] } },

  // Nothing imports the server or the client by name.
  { disallow: { to: [serverByName, clientByName] } },
];

// no-restricted-syntax takes one list per file: a later config object replaces an
// earlier one's list rather than adding to it. So each file group below lists every
// selector that applies to it.
const noEnum = [
  { selector: 'TSEnumDeclaration', message: 'CONV-004: use a string literal union, not an enum.' },
];
const noDefaultExport = [
  { selector: 'ExportDefaultDeclaration', message: 'CONV-005: use a named export.' },
  {
    selector: 'ExportNamedDeclaration > ExportSpecifier[exported.name="default"]',
    message: 'CONV-005: use a named export.',
  },
];
const noLocaleOrdering = [
  {
    selector: 'CallExpression[callee.property.name="localeCompare"]',
    message: 'CONV-087: order strings with cmp from core, not localeCompare.',
  },
  {
    selector: 'MemberExpression[object.name="Intl"][property.name="Collator"]',
    message: 'CONV-087: order strings with cmp from core, not Intl.Collator.',
  },
];
const noClockOrRandomness = [
  {
    selector: 'MemberExpression[object.name="Date"][property.name="now"]',
    message: 'CONV-060: core takes time as a parameter.',
  },
  {
    selector: 'NewExpression[callee.name="Date"]',
    message: 'CONV-060: core takes time as a parameter.',
  },
  {
    selector: 'MemberExpression[object.name="Math"][property.name="random"]',
    message: 'CONV-060: core takes randomness as an Rng parameter.',
  },
];

// CONV-060: Node types are visible in core (its tests read fixtures), so lint keeps Node's
// IO and timer globals out of core source.
const nodeGlobals = [
  'process',
  'Buffer',
  'fetch',
  'global',
  'require',
  'setTimeout',
  'setInterval',
  'setImmediate',
].map((name) => ({
  name,
  message: 'CONV-060: core does no IO; take what it needs as a parameter.',
}));

// ARCH-122 and ARCH-120: in the client, only src/api calls fetch and only src/events opens
// an EventSource, so components reach the server through hooks and the query cache.
const clientFetch = {
  name: 'fetch',
  message: 'ARCH-122: components never call fetch; use a hook from src/api.',
};
const clientEventSource = {
  name: 'EventSource',
  message:
    'ARCH-120: only src/events opens an EventSource; events reach components through the query cache.',
};

const tests = ['**/*.test.ts', '**/*.test.tsx'];
// Files whose tool requires a default export (CONV-005).
const toolConfigs = ['eslint.config.js', 'vitest.config.ts', 'apps/client/vite.config.ts'];

export default defineConfig(
  // .claude/worktrees/ holds full copies of the repository, one per parallel agent
  // (02-conventions Decisions); each is linted from its own checkout.
  {
    ignores: [
      'spec/',
      'content-library/',
      'content-packs/',
      '**/dist/',
      '**/coverage/',
      '.claude/worktrees/**',
    ],
  },

  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },

  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': elements,
      'boundaries/files': [{ pattern: tests, category: 'test' }],
      'import/resolver': { node: { extensions: ['.ts', '.tsx', '.js'] } },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        { default: 'disallow', checkAllOrigins: true, policies: dependencyPolicies },
      ],
    },
  },

  // CONV-070: log through the injected logger, except where a person reads the output.
  { rules: { 'no-console': 'error' } },
  { files: ['scripts/**', 'apps/server/src/cli/**'], rules: { 'no-console': 'off' } },

  // CONV-003: non-null assertions are allowed in tests only.
  { files: tests, rules: { '@typescript-eslint/no-non-null-assertion': 'off' } },

  {
    rules: {
      'no-restricted-syntax': ['error', ...noEnum, ...noDefaultExport, ...noLocaleOrdering],
    },
  },
  // Locale-aware sorting is allowed for display-only lists in the client (CONV-087).
  {
    files: ['apps/client/**'],
    rules: { 'no-restricted-syntax': ['error', ...noEnum, ...noDefaultExport] },
  },
  {
    files: ['packages/core/src/**'],
    ignores: tests,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...noEnum,
        ...noDefaultExport,
        ...noLocaleOrdering,
        ...noClockOrRandomness,
      ],
      'no-restricted-globals': ['error', ...nodeGlobals],
    },
  },
  // no-restricted-globals takes one list per file too, so each client folder lists its own.
  {
    files: ['apps/client/src/**'],
    ignores: [...tests, 'apps/client/src/api/**', 'apps/client/src/events/**'],
    rules: { 'no-restricted-globals': ['error', clientFetch, clientEventSource] },
  },
  {
    files: ['apps/client/src/api/**'],
    ignores: tests,
    rules: { 'no-restricted-globals': ['error', clientEventSource] },
  },
  {
    files: ['apps/client/src/events/**'],
    ignores: tests,
    rules: { 'no-restricted-globals': ['error', clientFetch] },
  },
  {
    files: toolConfigs,
    rules: { 'no-restricted-syntax': ['error', ...noEnum, ...noLocaleOrdering] },
  },
  {
    files: ['apps/client/vite.config.ts'],
    rules: { 'no-restricted-syntax': ['error', ...noEnum] },
  },
);
