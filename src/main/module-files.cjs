// Keep the payload small: no Electron, node_modules, audio or user data.
module.exports = [
  'src/main/site-module.cjs',
  ...['soundeffect-lab', 'maou', 'onjin', 'dova', 'freesound', 'pixabay', 'browser-catalog'].map(name => `src/main/providers/${name}.cjs`),
  'src/main/priority-queue.cjs', 'src/main/persistence.cjs',
  'src/main/automation/catalog-page.js', 'src/shared/query.js',
  'vendor/sampletap/hook.js', 'vendor/sampletap/LICENSE', 'LICENSE'
];
