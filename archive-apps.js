(() => {
    const launcher = document.getElementById('archiveLauncher');
    const appButtons = Array.from(document.querySelectorAll('[data-archive-app]'));
    const panels = Array.from(document.querySelectorAll('[data-archive-app-panel]'));
    const backButtons = Array.from(document.querySelectorAll('[data-archive-app-back]'));
    let activeApp = null;
    let returnFocus = null;

    if (!launcher || !appButtons.length || !panels.length) return;

    function openApp(name, trigger) {
        const panel = panels.find((item) => item.dataset.archiveAppPanel === name);
        if (!panel) return;
        if (panel.hasAttribute('data-archive-private') && document.body.dataset.authMode !== 'owner') return;

        returnFocus = trigger || appButtons.find((button) => button.dataset.archiveApp === name) || null;
        activeApp = name;
        launcher.hidden = true;
        panels.forEach((item) => { item.hidden = item !== panel; });
        panel.querySelector('[data-archive-app-back]')?.focus({ preventScroll: true });
        document.dispatchEvent(new CustomEvent('archiveappopen', { detail: { app: name } }));
    }

    function showLauncher() {
        if (!activeApp) return;
        const closedApp = activeApp;
        panels.forEach((panel) => { panel.hidden = true; });
        launcher.hidden = false;
        activeApp = null;
        returnFocus?.focus({ preventScroll: true });
        document.dispatchEvent(new CustomEvent('archiveappclose', { detail: { app: closedApp } }));
    }

    appButtons.forEach((button) => {
        button.addEventListener('click', () => openApp(button.dataset.archiveApp, button));
    });
    backButtons.forEach((button) => button.addEventListener('click', showLauncher));
    document.addEventListener('auth-mode-changed', (event) => {
        const activePanel = panels.find((panel) => panel.dataset.archiveAppPanel === activeApp);
        if (event.detail?.mode !== 'owner' && activePanel?.hasAttribute('data-archive-private')) showLauncher();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !activeApp) return;
        const openDialog = document.querySelector('dialog[open]');
        if (openDialog) return;
        event.preventDefault();
        showLauncher();
    });
})();
