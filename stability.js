(() => {
  'use strict';

  const STABILITY_VERSION = '3.5.0';
  const BOOT_TIMEOUT_MS = 18000;
  const SYNC_TIMEOUT_MS = 45000;
  const TAB_TTL_MS = 7000;
  const TAB_PING_MS = 2200;
  const NUMINA_CACHE_PREFIX = 'numina-serie-';
  const tabId = (() => {
    try {
      const key = 'numina_stability_tab_id';
      let value = sessionStorage.getItem(key);
      if (!value) {
        value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        sessionStorage.setItem(key, value);
      }
      return value;
    } catch {
      return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  })();

  let bootTimer = 0;
  let syncTimer = 0;
  let pendingWrites = false;
  let secondaryTab = false;
  let lastHiddenAt = 0;
  let reloadingForController = false;
  let tabChannel = null;
  const peers = new Map([[tabId, Date.now()]]);

  function query(selector) {
    return document.querySelector(selector);
  }

  function appToast(message) {
    const toast = query('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(appToast.timer);
    appToast.timer = setTimeout(() => toast.classList.remove('show'), 4000);
  }

  function bootIsVisible() {
    const boot = query('#bootView');
    return Boolean(boot && !boot.classList.contains('hidden'));
  }

  async function clearNuminaRuntime() {
    try {
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name.startsWith(NUMINA_CACHE_PREFIX)).map(name => caches.delete(name)));
      }
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const expectedScript = new URL('./sw.js', location.href).href;
        await Promise.all(registrations.filter(registration => {
          const worker = registration.active || registration.waiting || registration.installing;
          return worker?.scriptURL === expectedScript;
        }).map(registration => registration.unregister()));
      }
    } catch (error) {
      console.warn('Númina: no se pudo limpiar completamente el runtime.', error);
    }
  }

  function showBootRecovery(reason = '') {
    if (!bootIsVisible()) return;
    const card = query('#bootView .access-card');
    if (!card || card.querySelector('[data-stability-recovery]')) return;
    card.querySelector('.spinner')?.remove();
    const panel = document.createElement('div');
    panel.dataset.stabilityRecovery = '1';
    panel.className = 'stability-recovery stack';
    panel.innerHTML = `
      <p class="status-banner offline"><strong>Númina tardó más de lo esperado en iniciar.</strong><br><span data-stability-reason></span></p>
      <div class="form-actions stability-recovery-actions">
        <button class="primary" type="button" data-stability-retry>Reintentar</button>
        <button class="ghost" type="button" data-stability-clean>Reparar caché</button>
      </div>
      <small class="muted">“Reparar caché” no elimina los datos guardados en Firebase. Puede cerrar la sesión local y volver a descargar la aplicación.</small>`;
    panel.querySelector('[data-stability-reason]').textContent = reason || 'Puede ser una conexión lenta, una caché antigua o un bloqueo temporal del navegador.';
    card.append(panel);
    panel.querySelector('[data-stability-retry]')?.addEventListener('click', () => location.reload());
    panel.querySelector('[data-stability-clean]')?.addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = 'Reparando…';
      await clearNuminaRuntime();
      const recoveryUrl = new URL(location.href);
      recoveryUrl.searchParams.set('recovery', String(Date.now()));
      location.replace(recoveryUrl.href);
    });
  }

  function watchBoot() {
    bootTimer = window.setTimeout(() => showBootRecovery(), BOOT_TIMEOUT_MS);
    const boot = query('#bootView');
    if (!boot) return;
    const observer = new MutationObserver(() => {
      if (!bootIsVisible()) {
        clearTimeout(bootTimer);
        observer.disconnect();
      }
    });
    observer.observe(boot, { attributes: true, attributeFilter: ['class'] });
  }

  function ensureStabilityBanner() {
    let banner = query('#stabilityBanner');
    if (banner) return banner;
    banner = document.createElement('aside');
    banner.id = 'stabilityBanner';
    banner.className = 'stability-banner hidden';
    banner.setAttribute('role', 'status');
    banner.innerHTML = '<span data-stability-message></span><div class="stability-banner-actions"><button type="button" data-stability-reload>Reintentar</button><button type="button" data-stability-dismiss>Ocultar</button></div>';
    document.body.append(banner);
    banner.querySelector('[data-stability-reload]')?.addEventListener('click', () => location.reload());
    banner.querySelector('[data-stability-dismiss]')?.addEventListener('click', () => banner.classList.add('hidden'));
    return banner;
  }

  function showStabilityBanner(message, tone = 'warning') {
    const banner = ensureStabilityBanner();
    banner.dataset.tone = tone;
    banner.querySelector('[data-stability-message]').textContent = message;
    banner.classList.remove('hidden');
  }

  function hideStabilityBanner() {
    if (!secondaryTab) query('#stabilityBanner')?.classList.add('hidden');
  }

  function evaluateSyncBadge() {
    const badge = query('#storageBadge');
    if (!badge) return;
    const text = String(badge.textContent || '').trim().toLowerCase();
    pendingWrites = text.includes('pendiente') || text.includes('sincronizando');
    clearTimeout(syncTimer);

    if (text.includes('error de sincronización')) {
      showStabilityBanner('La sincronización encontró un error. Reintenta cuando tengas una conexión estable.', 'error');
      return;
    }
    if (navigator.onLine && (text.includes('cargando datos') || text.includes('sincronizando'))) {
      syncTimer = window.setTimeout(() => {
        const current = String(query('#storageBadge')?.textContent || '').toLowerCase();
        if (current.includes('cargando datos') || current.includes('sincronizando')) {
          showStabilityBanner('La sincronización está tardando demasiado. Puedes reintentar sin perder los datos ya guardados localmente.', 'warning');
        }
      }, SYNC_TIMEOUT_MS);
      return;
    }
    if (!secondaryTab && (text.includes('todo sincronizado') || text === 'sin conexión')) hideStabilityBanner();
  }

  function watchSyncState() {
    const badge = query('#storageBadge');
    if (!badge) return;
    const observer = new MutationObserver(evaluateSyncBadge);
    observer.observe(badge, { childList: true, subtree: true, characterData: true, attributes: true });
    evaluateSyncBadge();
  }

  function handleBeforeUnload(event) {
    if (!pendingWrites) return;
    event.preventDefault();
    event.returnValue = '';
  }

  function prunePeers() {
    const threshold = Date.now() - TAB_TTL_MS;
    for (const [id, seenAt] of peers.entries()) {
      if (seenAt < threshold) peers.delete(id);
    }
    peers.set(tabId, Date.now());
  }

  function setSecondaryTab(value) {
    if (secondaryTab === value) return;
    secondaryTab = value;
    document.body.classList.toggle('numina-secondary-tab', secondaryTab);
    if (secondaryTab) {
      showStabilityBanner('Númina está abierta en otra pestaña. Usa una sola para guardar cambios y evitar acciones duplicadas.', 'warning');
    } else {
      hideStabilityBanner();
      appToast('Esta pestaña volvió a quedar activa para trabajar.');
    }
  }

  function electPrimaryTab() {
    prunePeers();
    const leader = [...peers.keys()].sort()[0] || tabId;
    setSecondaryTab(leader !== tabId);
  }

  function setupTabCoordination() {
    if (!('BroadcastChannel' in window)) return;
    const channelName = `numina-tabs:${location.pathname}`;
    tabChannel = new BroadcastChannel(channelName);
    tabChannel.addEventListener('message', event => {
      if (event.data?.type !== 'NUMINA_TAB_PING' || !event.data.id) return;
      peers.set(String(event.data.id), Number(event.data.at || Date.now()));
      electPrimaryTab();
    });
    const ping = () => {
      peers.set(tabId, Date.now());
      tabChannel.postMessage({ type: 'NUMINA_TAB_PING', id: tabId, at: Date.now() });
      electPrimaryTab();
    };
    ping();
    setInterval(ping, TAB_PING_MS);
    window.addEventListener('pagehide', () => {
      try { tabChannel.postMessage({ type: 'NUMINA_TAB_BYE', id: tabId, at: 0 }); } catch { /* no-op */ }
      tabChannel.close();
    }, { once: true });
  }

  function blockSecondaryActions(event) {
    if (!secondaryTab) return;
    const target = event.target instanceof Element ? event.target : null;
    const form = target?.closest('form');
    const action = target?.closest('[data-save-manual-result], [data-delivery-key], button[type="submit"]');
    if (!form && !action) return;
    const insideApp = Boolean((form || action)?.closest('#appView'));
    if (!insideApp) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    appToast('Usa la otra pestaña de Númina para guardar cambios.');
  }

  async function requestPersistentStorage() {
    try {
      if (!navigator.storage?.persist || !navigator.storage?.persisted) return;
      const alreadyPersistent = await navigator.storage.persisted();
      if (!alreadyPersistent) await navigator.storage.persist();
      const estimate = await navigator.storage.estimate?.();
      const usage = Number(estimate?.usage || 0);
      const quota = Number(estimate?.quota || 0);
      if (quota > 0 && usage / quota > 0.85) {
        showStabilityBanner('El almacenamiento del navegador está casi lleno. Libera espacio para conservar el funcionamiento offline.', 'warning');
      }
    } catch (error) {
      console.warn('Númina: comprobación de almacenamiento no disponible.', error);
    }
  }

  function setupServiceWorkerStability() {
    if (!('serviceWorker' in navigator)) return;
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloadingForController) return;
      if (bootIsVisible() && !pendingWrites) {
        reloadingForController = true;
        setTimeout(() => location.reload(), 250);
      } else {
        appToast('Una actualización quedó lista. Usa “Actualizar ahora” cuando termines de guardar.');
      }
    });
  }

  function setupResumeChecks() {
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) {
        lastHiddenAt = Date.now();
        return;
      }
      if (lastHiddenAt && Date.now() - lastHiddenAt > 5 * 60000) {
        try {
          const registration = await navigator.serviceWorker?.getRegistration?.();
          await registration?.update?.();
        } catch { /* no-op */ }
        evaluateSyncBadge();
      }
    });
  }

  function checkStorageAvailability() {
    try {
      const key = '__numina_storage_test__';
      localStorage.setItem(key, '1');
      localStorage.removeItem(key);
      return true;
    } catch {
      showBootRecovery('El navegador bloqueó el almacenamiento local. Desactiva el modo privado o permite datos para este sitio.');
      return false;
    }
  }

  function initialize() {
    watchBoot();
    checkStorageAvailability();
    ensureStabilityBanner();
    watchSyncState();
    setupTabCoordination();
    setupServiceWorkerStability();
    setupResumeChecks();
    requestPersistentStorage();
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('submit', blockSecondaryActions, true);
    document.addEventListener('click', blockSecondaryActions, true);
    window.addEventListener('online', evaluateSyncBadge);
    window.addEventListener('offline', evaluateSyncBadge);
  }

  window.addEventListener('error', event => {
    if (bootIsVisible()) setTimeout(() => showBootRecovery(`Error de inicio: ${String(event.message || 'error desconocido').slice(0, 120)}`), 400);
  });
  window.addEventListener('unhandledrejection', event => {
    if (bootIsVisible()) setTimeout(() => showBootRecovery(`No se pudo completar el inicio: ${String(event.reason?.message || event.reason || 'error desconocido').slice(0, 120)}`), 400);
  });

  window.NuminaStability = Object.freeze({
    version: STABILITY_VERSION,
    clearRuntime: clearNuminaRuntime,
    retry: () => location.reload(),
    status: () => ({ secondaryTab, pendingWrites, online: navigator.onLine })
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
