// Frontières de modules. Voir .mercy/plan.md, « Contraintes globales » et contrainte dure 2 du prompt.
const only = (from, allowed, comment) => ({
  name: `${from.replace(/[^a-z]/g, '')}-only-${allowed.replace(/[^a-z|]/g, '').replace(/\|/g, '-')}`,
  comment,
  severity: 'error',
  from: { path: `^src/${from}/` },
  to: { path: '^src/', pathNot: `^src/(${allowed})/` },
})

module.exports = {
  forbidden: [
    only('sim', 'sim', 'src/sim est pur : il ne dépend que de lui-même'),
    {
      name: 'sim-no-npm',
      comment: 'src/sim ne dépend d\'aucun paquet (ni three, ni node:*)',
      severity: 'error',
      from: { path: '^src/sim/' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'core'] },
    },
    only('metrics', 'sim|metrics', 'les métriques ne lisent que la simulation'),
    only('bots', 'sim|metrics|bots', 'les bots passent par la simulation'),
    only('render', 'sim|render', 'le rendu lit l\'état, rien d\'autre'),
    only('audio', 'sim|audio', 'l\'audio lit les évènements, rien d\'autre'),
    only('input', 'sim|input', 'les entrées produisent des commandes'),
    {
      name: 'three-only-in-render',
      comment: 'three est réservé au rendu (et aux entrées, pour le lancer de rayon)',
      severity: 'error',
      from: { pathNot: '^src/(render|input|dev|main\\.ts)' },
      to: { path: ['^node_modules/three/', '^node_modules/\\.pnpm/three@'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true, dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    exclude: { path: '(node_modules|/dist/)' },
  },
}
