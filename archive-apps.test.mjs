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
    assert.match(html, /data-archive-app="ehviewer"[^>]+data-archive-private[^>]+aria-controls="archiveEhviewerPanel"/);
    assert.match(html, /data-archive-app="ledger"[^>]+data-archive-private[^>]+aria-controls="archiveLedgerPanel"/);
    assert.match(html, /id="publicAppsHeading">公开应用</);
    assert.match(html, /id="privateAppsHeading">私有应用</);
    assert.match(html, /archive-app-group-private[^>]+data-owner-only hidden/);
    assert.match(html, /id="archiveSteamPanel"[^>]+data-archive-app-panel="steam" hidden/);
    assert.match(html, /id="archiveAiPanel"[^>]+data-archive-app-panel="ai" hidden/);
    assert.match(html, /id="archiveEhviewerPanel"[^>]+data-archive-app-panel="ehviewer" hidden/);
    assert.match(html, /id="archiveLedgerPanel"[^>]+data-archive-app-panel="ledger"[^>]+data-archive-private hidden/);
    assert.equal((html.match(/data-archive-app-back/g) || []).length, 4);
});

test('archive apps load their remote data only after the matching app opens', async () => {
    const [steam, ehviewer, launcher] = await Promise.all([
        readFile(join(projectRoot, 'steam-ui.js'), 'utf8'),
        readFile(join(projectRoot, 'ehviewer-ui.js'), 'utf8'),
        readFile(join(projectRoot, 'archive-apps.js'), 'utf8')
    ]);

    assert.match(steam, /event\.detail\?\.app === 'steam'/);
    assert.match(ehviewer, /event\.detail\?\.app === 'ehviewer'/);
    assert.match(launcher, /new CustomEvent\('archiveappopen'/);
    assert.match(launcher, /document\.body\.dataset\.authMode !== 'owner'/);
    assert.match(launcher, /event\.key !== 'Escape'/);
});
