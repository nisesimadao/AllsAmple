// Node-only integration checks. No Electron window, installer or OS restart.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
execFileSync(process.execPath, ['--test', path.join(__dirname, '../tests/module-updates.test.cjs')], { stdio: 'inherit' });
