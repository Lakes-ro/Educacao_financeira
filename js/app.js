/**
 * app.js
 * Bootstrap da aplicação. Conecta tudo.
 * Gerencia fluxo: cliente ↔ login ↔ admin
 */

(function App() {

  // ── Boot ──────────────────────────────────────────────────

  function init() {
    SupabaseSync.init();
    State.loadMonth();

    const cfg = Storage.getConfig();
    UI.applyAccentColor(cfg.accentColor);

    // Determina tela inicial
    if (Admin.isLoggedIn()) {
      Screen.show('admin');
      Admin.enter();
    } else {
      Screen.show('client');
      UI.renderAll();
      Admin.checkIncomingMessages();
    }

    _bindStateEvents();
    _bindClientEvents();
    Lancamentos.render();
    _bindLoginEvents();
    _bindAdminEvents();
    _bindModalEvents();
    _bindNetworkEvents();

    // Atualiza título da tela de login
    const cfg2 = Storage.getConfig();
    const loginTitle = document.getElementById('login-app-title');
    if (loginTitle) loginTitle.textContent = cfg2.appName || 'Caixinhas';
  }

  // ── State subscriptions ───────────────────────────────────

  function _bindStateEvents() {
    State.subscribe((event) => {
      switch (event) {
        case 'updated':
          UI.renderRenda();
          UI.renderBar();
          UI.renderLivre();
          UI.renderSection('fixo');
          UI.renderSection('caixinhas');
          UI.renderSection('compras');
          break;

        case 'loaded':
          UI.renderAll();
          Lancamentos.render();
          break;

        case 'config-changed':
          UI.renderAll();
          SupabaseSync.init(); // reinicializa com nova config
          break;

        case 'sync-start': UI.setSyncState('syncing'); break;
        case 'sync-ok':    UI.setSyncState('online');  break;
        case 'sync-error': UI.setSyncState('error');   break;

        case 'lancamentos-updated':
          Lancamentos.render();
          if (Admin.isLoggedIn()) Lancamentos.renderAdmin();
          break;
      }
    });
  }

  // ── Eventos do cliente ────────────────────────────────────

  function _bindClientEvents() {
    // Renda
    _on('input-renda', 'input', (e) => State.setRenda(e.target.value));

    // Header
    _on('btn-settings', 'click', () => UI.openSettingsModal());
    _on('btn-report',   'click', () => Report.openReportModal());
    _on('btn-history',  'click', () => UI.openHistoryModal());

    // Botão admin (vai para login)
    _on('btn-admin-access', 'click', () => {
      if (Admin.isLoggedIn()) {
        Admin.enter();
      } else {
        Screen.show('login');
        setTimeout(() => document.getElementById('login-password')?.focus(), 100);
      }
    });

    // Adicionar itens
    document.querySelectorAll('.btn-add-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.dataset.target;
        if (section) UI.openAddItemModal(section);
      });
    });

    _on('btn-confirm-add-item', 'click', () => UI.confirmAddItem());

    document.getElementById('modal-add-item')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') UI.confirmAddItem();
    });

    // Dispensar alerta admin
    _on('btn-dismiss-alert', 'click', () => Admin.dismissAlert());

    // Lançamentos
    _on('btn-add-lancamento', 'click', () => Lancamentos.abrirModal());
    _on('btn-lanc-salvar',    'click', () => Lancamentos.salvar());

    // Tipo toggle no modal de lançamento
    document.querySelectorAll('.lanc-tipo-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.lanc-tipo-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tipoInput = document.getElementById('lanc-tipo');
        if (tipoInput) tipoInput.value = btn.dataset.tipo;
      });
    });

    // Filtros de lançamentos
    document.querySelectorAll('.lanc-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => Lancamentos.setFiltro(btn.dataset.filter));
    });

    // Enter no modal de lançamento
    document.getElementById('modal-lancamento')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'SELECT') Lancamentos.salvar();
    });

    // Bottom Nav
    _initBottomNav();
  }

  // ── Bottom Nav ────────────────────────────────────────────

  const TAB_SECTIONS = {
    inicio:        ['inicio'],
    planejamento:  ['fixo', 'caixinhas', 'compras'],
    lancamentos:   ['lancamentos'],
    relatorio:     ['_relatorio'],
    configuracoes: ['configuracoes'],
  };

  let _activeTab = 'inicio';

  function _initBottomNav() {
    document.querySelectorAll('.bnav-btn').forEach(btn => {
      btn.addEventListener('click', () => _switchTab(btn.dataset.tab));
    });
    _switchTab('inicio');
  }

  function _switchTab(tab) {
    // 'configuracoes' é uma aba inline — não abre modal

    _activeTab = tab;

    // Botão central (lançar) mostra a seção E abre o modal
    if (tab === 'lancamentos') {
      _applyTab(tab);
      Lancamentos.abrirModal();
      return;
    }

    if (tab === 'relatorio') {
      _renderReportInline();
    }

    _applyTab(tab);
  }

  function _applyTab(tab) {
    // Atualiza botões
    document.querySelectorAll('.bnav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Mostra/oculta seções pelo data-section
    const toShow = TAB_SECTIONS[tab] || [];
    document.querySelectorAll('[data-section]').forEach(el => {
      const sec = el.dataset.section;
      el.classList.toggle('section-hidden', !toShow.includes(sec));
    });

    // Seção inline de relatório
    const reportInline = document.getElementById('section-relatorio-inline');
    if (reportInline) {
      reportInline.classList.toggle('section-hidden', tab !== 'relatorio');
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _renderReportInline() {
    let sec = document.getElementById('section-relatorio-inline');
    if (!sec) {
      sec = document.createElement('section');
      sec.id = 'section-relatorio-inline';
      sec.dataset.section = '_relatorio';
      sec.className = 'card tab-relatorio-card section-hidden';
      sec.innerHTML = `
        <div class="card-label">Relatório do Mês</div>
        <div id="report-inline-body" class="report-inline-body"></div>
        <div style="display:flex;gap:10px;margin-top:8px">
          <button class="btn-secondary" id="btn-copy-report-inline" style="flex:1">📋 Copiar relatório</button>
        </div>
      `;
      document.querySelector('.app-main').appendChild(sec);
      document.getElementById('btn-copy-report-inline')
        ?.addEventListener('click', () => Report.copyReport());
    }
    const body = document.getElementById('report-inline-body');
    if (body) body.innerHTML = Report.buildReportHTML();
  }

  // ── Eventos de login ──────────────────────────────────────

  function _bindLoginEvents() {
    _on('btn-login-submit', 'click', _handleLogin);
    _on('btn-login-cancel', 'click', () => Screen.show('client'));

    document.getElementById('login-password')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') _handleLogin();
    });
  }

  function _handleLogin() {
    const input = document.getElementById('login-password');
    const errorEl = document.getElementById('login-error');
    const password = input?.value || '';

    const ok = Admin.tryLogin(password);

    if (ok) {
      if (errorEl) errorEl.setAttribute('hidden', '');
      if (input) input.value = '';
      Admin.enter();
    } else {
      if (errorEl) errorEl.removeAttribute('hidden');
      input?.select();
    }
  }

  // ── Eventos do admin ──────────────────────────────────────

  function _bindAdminEvents() {
    _on('btn-admin-logout',       'click', () => Admin.logout());
    _on('btn-admin-settings',     'click', () => UI.openSettingsModal());
    _on('btn-send-message',       'click', () => Admin.sendMessage());
    _on('btn-adm-view-report',    'click', () => Report.openReportModal());
    _on('btn-adm-history',        'click', () => UI.openHistoryModal());
    _on('btn-adm-clear',          'click', () => {
      if (confirm('Limpar todos os dados do mês atual?')) {
        State.clearCurrentMonth();
        Admin.renderAdminData();
        UI.toast('Dados limpos', 'warn');
      }
    });

    // Enter no textarea da mensagem
    document.getElementById('admin-message-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) Admin.sendMessage();
    });
  }

  // ── Eventos de settings ───────────────────────────────────

  function _bindModalEvents() {
    // Salvar settings
    _on('btn-save-settings', 'click', _saveSettings);

    // Push notifications toggle
    _on('cfg-push-enabled', 'change', async (e) => {
      if (e.target.checked) {
        const granted = await Admin.requestPushPermission();
        if (!granted) e.target.checked = false;
      }
    });

    // Limpar dados
    _on('btn-clear-data', 'click', () => {
      if (confirm('Apagar todos os dados do mês atual?')) {
        State.clearCurrentMonth();
        UI.toast('Dados do mês apagados', 'warn');
        UI.closeModal('modal-settings');
      }
    });

    // Relatório — copiar
    _on('btn-copy-report', 'click', () => Report.copyReport());

    // Color swatches
    document.getElementById('color-picker-row')?.addEventListener('click', (e) => {
      const swatch = e.target.closest('.color-swatch');
      if (!swatch) return;
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      const color = swatch.dataset.color;
      if (color) {
        document.getElementById('cfg-custom-color').value = color;
        UI.applyAccentColor(color);
      }
    });

    document.getElementById('cfg-custom-color')?.addEventListener('input', (e) => {
      UI.applyAccentColor(e.target.value);
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    });

    // Fechar modais por [data-close-modal]
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => UI.closeModal(btn.dataset.closeModal));
    });

    // Fechar por overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) UI.closeModal(overlay.id);
      });
    });

    // ESC fecha modais
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.modal-overlay:not([hidden])').forEach(el => {
        UI.closeModal(el.id);
      });
    });
  }

  function _saveSettings() {
    const newPassword = document.getElementById('cfg-admin-password')?.value?.trim();

    // Nomes personalizados das seções (usa o atual se campo vazio)
    const cfg = Storage.getConfig();
    const currentNames = cfg.sectionNames || {};
    const currentDescs = cfg.sectionDescs || {};

    const partial = {
      appName:     document.getElementById('cfg-app-name')?.value?.trim()   || 'Caixinhas',
      userName:    document.getElementById('cfg-user-name')?.value?.trim()  || '',
      accentColor: document.getElementById('cfg-custom-color')?.value       || '#a78bfa',
      pushEnabled: document.getElementById('cfg-push-enabled')?.checked     || false,
      sectionNames: {
        fixo:      document.getElementById('cfg-section-fixo-name')?.value?.trim()      || currentNames.fixo      || 'Não pode gastar',
        caixinhas: document.getElementById('cfg-section-caixinhas-name')?.value?.trim() || currentNames.caixinhas || 'Caixinhas',
        compras:   document.getElementById('cfg-section-compras-name')?.value?.trim()   || currentNames.compras   || 'O que preciso comprar',
      },
      sectionDescs: {
        fixo:      document.getElementById('cfg-section-fixo-desc')?.value?.trim()      || currentDescs.fixo      || 'Compromissos e despesas fixas do mês',
        caixinhas: document.getElementById('cfg-section-caixinhas-desc')?.value?.trim() || currentDescs.caixinhas || 'Metas e reservas do mês',
        compras:   document.getElementById('cfg-section-compras-desc')?.value?.trim()   || currentDescs.compras   || 'Itens planejados para adquirir',
      },
    };

    if (newPassword && newPassword.length >= 4) {
      partial.adminPassword = newPassword;
    }

    State.saveConfig(partial);
    SupabaseSync.init();
    UI.applyAccentColor(partial.accentColor);
    UI.renderAppTitle();
    UI.renderSectionTitles();
    UI.closeModal('modal-settings');
    UI.toast('Configurações salvas', 'success');

    const loginTitle = document.getElementById('login-app-title');
    if (loginTitle) loginTitle.textContent = partial.appName;
  }

  // ── Online/Offline ────────────────────────────────────────

  function _bindNetworkEvents() {
    UI.setSyncState(navigator.onLine ? 'online' : 'offline');

    // ── Voltou online ────────────────────────────────────────
    window.addEventListener('online', () => {
      UI.setSyncState('online');
      UI.toast('De volta online — sincronizando... 🌐', 'info');

      const monthKey = State.getMonthKey();

      // Se há dados pendentes, envia primeiro
      if (Storage.getPendingSync()) {
        SupabaseSync.pushMonthData(monthKey, State.getData()).then(res => {
          if (res.ok) {
            Storage.setPendingSync(false);
            UI.setSyncState('online');
            UI.toast('Dados sincronizados ✓', 'success');
          }
        });
      } else {
        // Sem pendências: verifica se remoto tem algo mais novo
        SupabaseSync.pullMonthData(monthKey).then(remote => {
          if (remote.ok && remote.data && remote.updatedAt > (State.getData().updatedAt || '')) {
            State.loadMonth(monthKey);
            if (Admin.isLoggedIn()) Admin.renderAdminData();
            UI.toast('Dados atualizados do servidor ✓', 'success');
          }
        });
      }

      Admin.checkIncomingMessages();
    });

    // ── Ficou offline ────────────────────────────────────────
    window.addEventListener('offline', () => {
      UI.setSyncState('offline');
      UI.toast('Sem conexão — dados salvos localmente 📴', 'warn');
    });

    // ── Troca de app / minimiza ──────────────────────────────
    // Garante que dados sejam enviados quando a usuária sai do app
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        // App foi para background ou outra aba foi aberta
        State.flushToRemote();
      } else if (document.visibilityState === 'visible') {
        // App voltou ao foco — verifica se há dados mais novos no servidor
        if (navigator.onLine && SupabaseSync.isConfigured()) {
          const monthKey = State.getMonthKey();
          SupabaseSync.pullMonthData(monthKey).then(remote => {
            if (!remote.ok || !remote.data) return;
            const localUpdated  = State.getData().updatedAt || '';
            const remoteUpdated = remote.updatedAt || '';
            if (remoteUpdated > localUpdated) {
              // Servidor tem dados mais recentes (editados em outro dispositivo)
              State.loadMonth(monthKey);
              Lancamentos.render();
              if (Admin.isLoggedIn()) Admin.renderAdminData();
              UI.toast('Dados atualizados 🔄', 'info', 2000);
            } else if (Storage.getPendingSync()) {
              // Local tem dados não enviados
              State.flushToRemote();
            }
          }).catch(() => {});
        }
      }
    });

    // ── Fecha a página / PWA ──────────────────────────────────
    window.addEventListener('pagehide', () => {
      State.flushToRemote();
    });

    // ── Sync periódico (a cada 3 min) ────────────────────────
    setInterval(() => {
      if (!navigator.onLine || !SupabaseSync.isConfigured()) return;
      if (Storage.getPendingSync()) {
        State.flushToRemote();
      }
    }, 3 * 60 * 1000);
  }

  // ── Helper ────────────────────────────────────────────────

  function _on(id, event, handler) {
    document.getElementById(id)?.addEventListener(event, handler);
  }

  // ── Start ─────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', init);

})();