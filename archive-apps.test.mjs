import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('home archive area separates public and owner-only apps with accessible panels', async () => {
    const html = await readFile(join(projectRoot, 'index.html'), 'utf8');

    assert.match(html, /id="archiveLauncher"/);
    assert.match(html, /data-archive-app="steam"[^>]+aria-controls="archiveSteamPanel"/);
    assert.match(html, /data-archive-app="ai"[^>]+aria-controls="archiveAiPanel"/);
    assert.match(html, /data-archive-app="guestbook"[^>]+aria-controls="archiveGuestbookPanel"/);
    assert.match(html, /data-archive-app="gps"[^>]+aria-controls="archiveGpsPanel"/);
    assert.match(html, /data-archive-app="ehviewer"[^>]+data-archive-private[^>]+aria-controls="archiveEhviewerPanel"/);
    assert.match(html, /data-archive-app="ledger"[^>]+data-archive-private[^>]+aria-controls="archiveLedgerPanel"/);
    assert.match(html, /id="publicAppsHeading">公开应用</);
    assert.match(html, /id="privateAppsHeading">私有应用</);
    assert.match(html, /archive-app-group-private[^>]+data-owner-only hidden/);
    assert.match(html, /id="archiveSteamPanel"[^>]+data-archive-app-panel="steam" hidden/);
    assert.match(html, /id="archiveAiPanel"[^>]+data-archive-app-panel="ai" hidden/);
    assert.match(html, /id="archiveGuestbookPanel"[^>]+data-archive-app-panel="guestbook" hidden/);
    assert.match(html, /id="archiveGpsPanel"[^>]+data-archive-app-panel="gps" hidden/);
    assert.match(html, /id="archiveEhviewerPanel"[^>]+data-archive-app-panel="ehviewer" hidden/);
    assert.match(html, /id="archiveLedgerPanel"[^>]+data-archive-app-panel="ledger"[^>]+data-archive-private hidden/);
    assert.equal((html.match(/data-archive-app-back/g) || []).length, 6);
});

test('GPS public app samples device location once per second and caps history at ten records', async () => {
    const [html, script] = await Promise.all([
        readFile(join(projectRoot, 'index.html'), 'utf8'),
        readFile(join(projectRoot, 'gps-ui.js'), 'utf8')
    ]);

    for (const id of ['gpsLatitude', 'gpsLongitude', 'gpsSpeed', 'gpsAccuracy', 'gpsAltitude', 'gpsHeading', 'gpsHistoryBody']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(script, /navigator\.geolocation\.watchPosition/);
    assert.match(script, /setInterval\(captureRecord, 1000\)/);
    assert.match(script, /records\.slice\(0, 10\)/);
    assert.match(script, /event\.detail\?\.app === 'gps'/);
    assert.match(script, /event\.detail\?\.app !== 'gps'/);
});

test('desktop app launcher uses four columns while the mobile override stays responsive', async () => {
    const [desktopCss, mobileCss] = await Promise.all([
        readFile(join(projectRoot, 'archive-apps.css'), 'utf8'),
        readFile(join(projectRoot, 'mobile-ui.css'), 'utf8')
    ]);

    assert.match(desktopCss, /\.archive-app-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(96px, 128px\)\)/s);
    assert.match(mobileCss, /\.archive-app-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(76px, 1fr\)\)/s);
});

test('archive apps load their remote data only after the matching app opens', async () => {
    const [steam, ehviewer, ledger, launcher] = await Promise.all([
        readFile(join(projectRoot, 'steam-ui.js'), 'utf8'),
        readFile(join(projectRoot, 'ehviewer-ui.js'), 'utf8'),
        readFile(join(projectRoot, 'ledger-ui.js'), 'utf8'),
        readFile(join(projectRoot, 'archive-apps.js'), 'utf8')
    ]);

    assert.match(steam, /event\.detail\?\.app === 'steam'/);
    assert.match(ehviewer, /event\.detail\?\.app === 'ehviewer'/);
    assert.match(ledger, /event\.detail\?\.app !== 'ledger'/);
    assert.match(ledger, /\/api\/ledger\?account=/);
    assert.match(launcher, /new CustomEvent\('archiveappopen'/);
    assert.match(launcher, /document\.body\.dataset\.authMode !== 'owner'/);
    assert.match(launcher, /event\.key !== 'Escape'/);
});

test('ledger app exposes account, month, editable balance and transaction fields', async () => {
    const html = await readFile(join(projectRoot, 'index.html'), 'utf8');
    const migration = await readFile(join(projectRoot, 'migrations', '0005_ledger_import.sql'), 'utf8');

    for (const account of ['微信', '支付宝', '银行卡']) {
        assert.match(html, new RegExp(`data-ledger-account="${account}"`));
    }
    for (const id of ['ledgerMonth', 'ledgerEditBalance', 'ledgerEditNote', 'ledgerEditAccount', 'ledgerEditCategory', 'ledgerEditAmount', 'ledgerEditTime', 'ledgerPie']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.equal((migration.match(/^\('(?:alipay|wechat|bank)-/gm) || []).length, 1306);
});
