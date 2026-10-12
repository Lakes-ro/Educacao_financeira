/**
 * pwa.js — v2
 * CORREÇÕES:
 * - Detecta novo Service Worker disponível e força atualização automática
 *   via postMessage SKIP_WAITING — sem precisar fechar abas ou limpar cache
 * - Mostra toast discreto "App atualizado" quando nova versão é aplicada
 * - Mantém lógica de instalação PWA (Android + iOS)
 */

(function PWA() {

  let _deferredPrompt = null;
  let _domReady       = false;

  // ── Captura antecipada do prompt de instalação ────────────
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredPrompt = e;
    if (_domReady) _showInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    _deferredPrompt = null;
    _hideInstallBanner();
    console.log('[PWA] App instalado com sucesso!');
  });

  // ── DOM pronto ────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    _domReady = true;

    if (_deferredPrompt) _showInstallBanner();

    document.getElementById('btn-install')?.addEventListener('click', async () => {
      if (!_deferredPrompt) return;
      _deferredPrompt.prompt();
      const { outcome } = await _deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        _hideInstallBanner();
        if (typeof UI !== 'undefined') UI.toast('App instalado!', 'success');
      }
      _deferredPrompt = null;
    });

    document.getElementById('btn-install-dismiss')
      ?.addEventListener('click', _hideInstallBanner);

    // iOS Safari
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
               || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                      || window.navigator.standalone === true;

    if (isIos && !isStandalone) {
      const banner = document.getElementById('install-banner');
      if (banner) {
        const span = banner.querySelector('span');
        if (span) span.textContent = '📲 Safari: toque em ⎙ → "Adicionar à Tela de Início"';
        document.getElementById('btn-install')?.setAttribute('hidden', '');
        banner.removeAttribute('hidden');
      }
    }

    if (isStandalone) _hideInstallBanner();
  });

  // ── Registro do Service Worker ────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js', { scope: './' })
        .then((reg) => {
          console.log('[PWA] Service Worker registrado. Scope:', reg.scope);

          // Detecta nova versão disponível
          reg.addEventListener('updatefound', () => {
            const newSW = reg.installing;
            if (!newSW) return;

            newSW.addEventListener('statechange', () => {
              if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                // Nova versão instalada — força ativação imediata
                console.log('[PWA] Nova versão disponível — aplicando automaticamente');
                newSW.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
        })
        .catch((err) => {
          console.warn('[PWA] Falha ao registrar Service Worker:', err);
        });

      // Quando o SW tomar controle (após SKIP_WAITING), recarrega a página
      // para garantir que todos os assets novos sejam usados
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        console.log('[PWA] Novo SW ativo — recarregando para aplicar atualização');

        // Toast rápido antes de recarregar (se UI estiver disponível)
        if (typeof UI !== 'undefined') {
          UI.toast('🔄 App atualizado! Recarregando...', 'info', 1800);
          setTimeout(() => window.location.reload(), 1900);
        } else {
          window.location.reload();
        }
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────

  function _showInstallBanner() {
    document.getElementById('install-banner')?.removeAttribute('hidden');
  }

  function _hideInstallBanner() {
    document.getElementById('install-banner')?.setAttribute('hidden', '');
  }

})();
