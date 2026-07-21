(() => {
  const installButton = document.querySelector('#installHomeBtn');
  const requestButton = document.querySelector('#requestHomeBtn');
  let deferredPrompt = null;

  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isMobile = () => Boolean(navigator.userAgentData?.mobile) || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia('(max-width: 760px)').matches;

  const refreshLabels = () => {
    installButton.textContent = isMobile() ? 'Instalar Númina en este teléfono' : 'Instalar Númina en esta PC';
    if (isStandalone()) {
      installButton.classList.add('hidden');
      requestButton.classList.remove('hidden');
    }
  };

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    refreshLabels();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installButton.classList.add('hidden');
    requestButton.classList.remove('hidden');
  });

  installButton.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch { /* no-op */ }
      deferredPrompt = null;
    }
    requestButton.classList.remove('hidden');
  });

  refreshLabels();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
  }
})();
