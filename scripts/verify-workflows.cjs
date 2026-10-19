const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-workflows-'));
  const env = { ...process.env, ALLSAMPLE_DATA_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ env, ...(process.argv[2] ? { executablePath: path.resolve(process.argv[2]), args: [] } : { args: [path.join(__dirname, '..')] }) });
  let app;
  try {
    app = await launch(); let page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await page.waitForFunction(() => state.ready);
    await page.locator('#workflow').selectOption('video');
    assert.equal(await page.locator('[data-site="soundeffect-lab"]').isChecked(), true);
    assert.equal(await page.locator('[data-site="splice"]').isChecked(), false);
    await page.locator('#kind').selectOption('効果音');
    await page.locator('#no-credit').check();
    await page.locator('[data-site="onjin"]').uncheck();
    await page.locator('#workflow').selectOption('music');
    assert.equal(await page.locator('[data-site="soundeffect-lab"]').isChecked(), false);
    assert.equal(await page.locator('[data-site="splice"]').isChecked(), true);
    assert.equal(await page.locator('#no-credit').isChecked(), false);
    await page.locator('#kind').selectOption('ループ');
    await page.locator('#price').selectOption('free');
    await page.locator('#workflow').selectOption('video');
    assert.equal(await page.locator('#kind').inputValue(), '効果音');
    assert.equal(await page.locator('#no-credit').isChecked(), true);
    assert.equal(await page.locator('[data-site="onjin"]').isChecked(), false);
    console.log('PASS: each workflow restores customized sites and filters');
    await app.close(); app = null;
    app = await launch(); page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await page.waitForFunction(() => state.ready);
    assert.equal(await page.locator('#workflow').inputValue(), 'video');
    assert.equal(await page.locator('#kind').inputValue(), '効果音');
    assert.equal(await page.locator('#no-credit').isChecked(), true);
    assert.equal(await page.locator('[data-site="onjin"]').isChecked(), false);
    await page.locator('#workflow').selectOption('music');
    assert.equal(await page.locator('#kind').inputValue(), 'ループ');
    assert.equal(await page.locator('#price').inputValue(), 'free');
    await page.locator('#clear-filters').click();
    await page.locator('#workflow').selectOption('video');
    await page.locator('#workflow').selectOption('music');
    assert.equal(await page.locator('#kind').inputValue(), '');
    assert.equal(await page.locator('#price').inputValue(), 'all');
    console.log('PASS: settings survive an actual restart and resetting one workflow leaves the other intact');
  } finally {
    if (app) await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
