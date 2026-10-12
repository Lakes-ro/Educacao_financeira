/**
 * admin.js — v3
 * MELHORIAS DE SINCRONIZAÇÃO:
 * - Realtime via Supabase SDK (supabase-js channel) em vez de WebSocket manual
 * - Auto-refresh: ao voltar online, recarrega dados do cliente selecionado
 * - Indicador de "última atualização" com timestamp
 * - Feed usa _viewingUserId em vez do config legado
 * - checkIncomingMessages usa Auth.getUserId() em vez de config
 * - Removido 'gisele' hardcoded em todos os lugares
 * - Seleção de mês no painel admin (navegar entre meses)
 * - Reconexão automática do realtime ao voltar online
 */

const Admin = (() => {

  const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  // ── Estado ────────────────────────────────────────────────
  let _isLoggedIn     = false;
  const SESSION_KEY   = 'caixinhas:admin-session';
  let _viewingUserId  = null;
  let _clientData     = null;
  let _clientMonthKey = null;
  let _lastUpdated    = null;
  let _realtimeChannel = null;

  // Charts
  let _chartPlanejadoReal = null;
  let _chartCategorias    = null;
  let _chartDistribuicao  = null;

  // ── Auth (mantém compatibilidade legada) ──────────────────

  function isLoggedIn() {
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn?.() && Auth.isAdmin?.()) return true;
    if (_isLoggedIn) return true;
    return localStorage.getItem(SESSION_KEY) === '1' ||
           sessionStorage.getItem(SESSION_KEY) === '1';
  }

  function tryLogin(password) {
    const cfg = Storage.getConfig();
    if (password === (cfg.adminPassword || 'admin')) {
      _isLoggedIn = true;
      localStorage.setItem(SESSION_KEY, '1');
      sessionStorage.setItem(SESSION_KEY, '1');
      return true;
    }
    return false;
  }

  function logout() {
    _isLoggedIn    = false;
    _viewingUserId = null;
    _clientData    = null;
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    _stopRealtime();
    if (typeof Auth !== 'undefined' && Auth.logout) {
      Auth.logout().then(() => {
        const c = document.getElementById('screen-client');
        const d = document.getElementById('screen-admin');
        const a = document.getElementById('screen-auth');
        if (c) c.setAttribute('hidden', '');
        if (d) d.setAttribute('hidden', '');
        if (a) a.classList.add('auth-visible'); // usa classe CSS
      });
    } else {
      Screen.show('client');
    }
  }

  // ── setViewingUserId ──────────────────────────────────────

  function setViewingUserId(userId) {
    _viewingUserId = userId;
    Storage.saveConfig({ clientUserId: userId });
    SupabaseSync.setAdminMode(userId);
  }

  // ── Entrar no painel ──────────────────────────────────────

  async function enter() {
    Screen.show('admin');
    _clientMonthKey = Storage.currentMonthKey();

    const emailEl = document.getElementById('admin-user-email');
    if (emailEl) emailEl.textContent = Auth.getUserEmail?.() || '';

    _renderMonthSelector();

    // Eventos inline do painel admin
    _bindAdminPanelEvents();

    // Online/offline para reconectar realtime
    window.addEventListener('online',  _onOnline);
    window.addEventListener('offline', _onOffline);

    if (_viewingUserId) {
      _setLoadingState(true);
      SupabaseSync.setAdminMode(_viewingUserId);
      await _loadAndRender();
      _startRealtime();
    }
  }

  // ── Seletor de mês ────────────────────────────────────────

  function _renderMonthSelector() {
    const el = document.getElementById('admin-month-selector');
    if (!el) return;

    // Gera últimos 6 meses
    const months = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      months.push({ key, label });
    }

    el.innerHTML = months.map(m =>
      `<option value="${m.key}" ${m.key === _clientMonthKey ? 'selected' : ''}>${m.label}</option>`
    ).join('');

    el.onchange = async () => {
      _clientMonthKey = el.value;
      if (_viewingUserId) {
        _setLoadingState(true);
        await _loadAndRender();
      }
    };
  }

  // ── Carregar + renderizar ─────────────────────────────────

  async function _loadAndRender() {
    await _loadClientDataFromSupabase();
    await _loadChartJs();
    const data = _clientData || { renda:0, fixo:[], caixinhas:[], compras:[], lancamentos:[] };
    _renderAdminData(data);
    _loadFeed();
  }

  // ── Carregar dados do cliente DO SUPABASE ─────────────────

  async function _loadClientDataFromSupabase() {
    const clientUserId = _viewingUserId || Storage.getConfig().clientUserId;

    if (!clientUserId || !SupabaseSync.isConfigured()) {
      _clientData = null;
      _setLoadingState(false);
      return;
    }

    SupabaseSync.setAdminMode(clientUserId);

    try {
      const result = await SupabaseSync.pullMonthData(_clientMonthKey, clientUserId);
      _clientData = (result.ok && result.data)
        ? { lancamentos: [], ...result.data }
        : null;
      _lastUpdated = new Date();
    } catch {
      _clientData = null;
    }

    _setLoadingState(false);
    _updateLastUpdatedLabel();
  }

  function _updateLastUpdatedLabel() {
    const el = document.getElementById('adm-sync-info');
    if (!el) return;
    if (!_lastUpdated) { el.textContent = ''; return; }
    const t = _lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.textContent = `☁️ Atualizado ${t}`;
  }

  // ── Recarregar (botão manual) ─────────────────────────────

  async function refreshClientData() {
    const clientUserId = _viewingUserId || Storage.getConfig().clientUserId;
    if (!clientUserId) {
      UI.toast('Nenhum cliente selecionado', 'warn');
      return;
    }
    _setLoadingState(true);
    await _loadAndRender();
    UI.toast('Dados atualizados ✓', 'success');
  }

  // ── Realtime via Supabase SDK ─────────────────────────────
  // Usa o cliente Supabase JS em vez de WebSocket manual
  // para sincronização mais robusta e reconexão automática

  function _startRealtime() {
    _stopRealtime(); // Para qualquer canal anterior

    const sb = Auth.getSupabase?.();
    if (!sb || !_viewingUserId) {
      // Fallback: WebSocket manual via SupabaseSync
      _startRealtimeLegacy();
      return;
    }

    _setRealtimeStatus('connecting');

    try {
      _realtimeChannel = sb
        .channel(`admin-watch-${_viewingUserId}`)
        .on(
          'postgres_changes',
          {
            event:  '*',
            schema: 'public',
            table:  'finance_months',
            filter: `user_id=eq.${_viewingUserId}`,
          },
          async (payload) => {
            console.log('[Realtime] finance_months atualizado:', payload);
            if (payload.new?.data) {
              _clientData = { lancamentos: [], ...payload.new.data };
              _lastUpdated = new Date();
              _updateLastUpdatedLabel();
              await _loadChartJs();
              _renderAdminData(_clientData);
              UI.toast('📡 Dados atualizados em tempo real', 'info', 2500);
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event:  'INSERT',
            schema: 'public',
            table:  'finance_activity',
            filter: `user_id=eq.${_viewingUserId}`,
          },
          (payload) => {
            const r = payload.new;
            if (r) _appendFeedItem({ action: r.action, detail: r.detail, icon: r.icon, ts: r.created_at }, true);
          }
        )
        .subscribe((status) => {
          console.log('[Realtime] Status:', status);
          if (status === 'SUBSCRIBED')  _setRealtimeStatus('live');
          if (status === 'CLOSED')      _setRealtimeStatus('connecting');
          if (status === 'CHANNEL_ERROR') _setRealtimeStatus('error');
        });
    } catch (err) {
      console.warn('[Realtime] Supabase SDK indisponível, usando fallback:', err);
      _startRealtimeLegacy();
    }
  }

  function _startRealtimeLegacy() {
    SupabaseSync.setCallbacks({
      onMonthChange: async (record) => {
        if (record.data) {
          _clientData  = { lancamentos: [], ...record.data };
          _lastUpdated = new Date();
          _updateLastUpdatedLabel();
          await _loadChartJs();
          _renderAdminData(_clientData);
          UI.toast('📡 Dados atualizados em tempo real', 'info', 2500);
        }
      },
      onActivity: (record) => {
        _appendFeedItem({ action: record.action, detail: record.detail, icon: record.icon, ts: record.created_at }, true);
      },
      onMessage: () => {},
    });

    const clientUserId = _viewingUserId || Storage.getConfig().clientUserId;
    SupabaseSync.connectRealtime(
      (status) => _setRealtimeStatus(status),
      clientUserId
    );
  }

  function _stopRealtime() {
    if (_realtimeChannel) {
      try { _realtimeChannel.unsubscribe(); } catch {}
      _realtimeChannel = null;
    }
    SupabaseSync.disconnectRealtime();
  }

  // Ao voltar online: reconecta realtime e atualiza dados
  function _onOnline() {
    UI.toast('Conexão restaurada — atualizando dados 🌐', 'info', 2500);
    if (_viewingUserId) {
      _loadClientDataFromSupabase().then(async () => {
        await _loadChartJs();
        if (_clientData) _renderAdminData(_clientData);
        _startRealtime();
      });
    }
  }

  function _onOffline() {
    UI.toast('Sem conexão — dados podem estar desatualizados 📴', 'warn');
    _setRealtimeStatus('error');
  }

  // ── Eventos do painel admin (bind único) ──────────────────

  let _panelEventsBound = false;
  function _bindAdminPanelEvents() {
    if (_panelEventsBound) return;
    _panelEventsBound = true;

    document.getElementById('btn-adm-refresh')?.addEventListener('click', refreshClientData);
    document.getElementById('btn-send-message')?.addEventListener('click', sendMessage);
    document.getElementById('btn-adm-view-report')?.addEventListener('click', () => Report.openReportModal());
    document.getElementById('btn-adm-history')?.addEventListener('click', () => UI.openHistoryModal());
    document.getElementById('btn-admin-logout')?.addEventListener('click', () => {
      if (confirm('Sair do painel admin?')) logout();
    });
    document.getElementById('btn-admin-settings')?.addEventListener('click', () => UI.openSettingsModal());
    document.getElementById('btn-adm-clear')?.addEventListener('click', () => {
      if (!_viewingUserId) { UI.toast('Selecione um cliente primeiro', 'warn'); return; }
      if (confirm('Limpar dados do mês deste cliente? Esta ação apagará os dados no Supabase.')) {
        _clearClientMonth();
      }
    });

    // Ctrl+Enter envia mensagem
    document.getElementById('admin-message-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendMessage();
    });
  }

  async function _clearClientMonth() {
    const sb = Auth.getSupabase?.();
    if (!sb || !_viewingUserId) return;
    try {
      await sb.from('finance_months')
        .delete()
        .eq('user_id', _viewingUserId)
        .eq('month_key', _clientMonthKey);
      _clientData = null;
      _renderAdminData({ renda:0, fixo:[], caixinhas:[], compras:[], lancamentos:[] });
      UI.toast('Dados do mês limpos ✓', 'warn');
    } catch (err) {
      UI.toast('Erro ao limpar: ' + err.message, 'warn');
    }
  }

  // ── Chart.js ──────────────────────────────────────────────

  function _loadChartJs() {
    return new Promise((resolve) => {
      if (window.Chart) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
      s.onload  = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
    });
  }

  // ── Renderização principal ────────────────────────────────

  function _renderAdminData(data) {
    if (!data) return;

    const renda        = parseFloat(data.renda) || 0;
    const totalFixo    = _sum(data.fixo);
    const totalCaixa   = _sum(data.caixinhas);
    const totalCompras = _sum(data.compras);
    const totalGasto   = totalFixo + totalCaixa + totalCompras;
    const livre        = renda - totalGasto;
    const pct          = renda > 0 ? ((totalGasto / renda) * 100).toFixed(1) : 0;

    const lancs         = data.lancamentos || [];
    const totalReceitas = lancs.filter(l => l.tipo === 'receita').reduce((a, l) => a + (parseFloat(l.valor)||0), 0);
    const totalDespesas = lancs.filter(l => l.tipo === 'despesa').reduce((a, l) => a + (parseFloat(l.valor)||0), 0);
    const saldoReal     = totalReceitas - totalDespesas;
    const cobertura     = renda > 0 ? ((totalReceitas / renda) * 100).toFixed(1) : 0;

    // KPIs
    _setText('adm-renda',    fmt.format(renda));
    _setText('adm-gasto',    fmt.format(totalGasto));
    _setText('adm-pct',      `${pct}%`);
    _setText('adm-receitas', fmt.format(totalReceitas));
    _setText('adm-despesas', fmt.format(totalDespesas));
    _setText('adm-cobertura',`${cobertura}%`);

    const livreEl = document.getElementById('adm-livre');
    if (livreEl) {
      livreEl.textContent = fmt.format(livre);
      livreEl.className   = 'kpi-value ' + (livre < 0 ? 'kpi-danger' : 'kpi-success');
    }

    const saldoEl = document.getElementById('adm-saldo-real');
    if (saldoEl) {
      saldoEl.textContent = fmt.format(saldoReal);
      saldoEl.className   = 'kpi-value ' + (saldoReal >= 0 ? 'kpi-success' : 'kpi-danger');
    }

    const pctEl = document.getElementById('adm-pct');
    if (pctEl) {
      const p = parseFloat(pct);
      pctEl.style.color = p > 100 ? 'var(--danger)' : p > 80 ? 'var(--warn, #fbbf24)' : 'var(--text)';
    }

    // Barra
    const pctF = renda > 0 ? (totalFixo / renda) * 100 : 0;
    const pctC = renda > 0 ? ((totalCaixa + totalCompras) / renda) * 100 : 0;
    const pctL = Math.max(0, 100 - pctF - pctC);
    _setWidth('adm-bar-fixo',      `${Math.min(pctF, 100)}%`);
    _setWidth('adm-bar-caixinhas', `${Math.min(pctC, 100)}%`);
    _setWidth('adm-bar-livre',     `${pctL}%`);
    _setText('adm-leg-fixo',       fmt.format(totalFixo));
    _setText('adm-leg-caixinhas',  fmt.format(totalCaixa + totalCompras));
    _setText('adm-leg-livre',      fmt.format(Math.max(0, livre)));

    // Análise e recomendações
    _renderAnalise({ renda, totalFixo, totalCaixa, totalCompras, totalGasto, livre,
                     totalReceitas, totalDespesas, saldoReal });
    _renderRecomendacoes({ renda, totalGasto, livre, totalReceitas, totalDespesas,
                           saldoReal, cobertura: parseFloat(cobertura), lancs, d: data });

    // Listas
    _renderAdminList('adm-list-fixo',      data.fixo,      'adm-total-fixo',      totalFixo);
    _renderAdminList('adm-list-caixinhas', data.caixinhas, 'adm-total-caixinhas', totalCaixa);
    _renderAdminList('adm-list-compras',   data.compras,   'adm-total-compras',   totalCompras);

    // Lançamentos
    Lancamentos.renderAdmin(lancs);

    // Gráficos
    if (window.Chart) {
      _renderCharts({ renda, totalFixo, totalCaixa, totalCompras, livre,
                      totalReceitas, totalDespesas, lancs });
    }

    // Badge de fonte
    const syncEl = document.getElementById('adm-sync-info');
    if (syncEl && _lastUpdated) {
      const t = _lastUpdated.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
      syncEl.textContent = `☁️ Supabase · ${t}`;
    }
  }

  // ── Análise ───────────────────────────────────────────────

  function _renderAnalise(nums) {
    const el = document.getElementById('adm-analise-grid');
    if (!el) return;
    el.innerHTML = [
      { label: '💰 Renda',              val: nums.renda,          cls: '' },
      { label: '🔒 Despesas Fixas',     val: nums.totalFixo,      cls: 'kpi-danger' },
      { label: '📦 Caixinhas',          val: nums.totalCaixa,     cls: '' },
      { label: '🛒 Compras',            val: nums.totalCompras,   cls: '' },
      { label: '📊 Comprometido',       val: nums.totalGasto,     cls: nums.totalGasto > nums.renda ? 'kpi-danger' : '' },
      { label: '✅ Saldo Livre',         val: nums.livre,          cls: nums.livre < 0 ? 'kpi-danger' : 'kpi-success' },
      { label: '📥 Receitas Reais',     val: nums.totalReceitas,  cls: 'kpi-success' },
      { label: '📤 Despesas Reais',     val: nums.totalDespesas,  cls: 'kpi-danger' },
      { label: '💵 Saldo Real',         val: nums.saldoReal,      cls: nums.saldoReal >= 0 ? 'kpi-success' : 'kpi-danger' },
    ].map(c => `
      <div class="adm-analise-item">
        <div class="adm-analise-label">${c.label}</div>
        <div class="adm-analise-val ${c.cls}">${fmt.format(c.val)}</div>
      </div>`).join('');
  }

  // ── Recomendações ─────────────────────────────────────────

  function _renderRecomendacoes(ctx) {
    const el = document.getElementById('adm-recomendacoes-list');
    if (!el) return;

    const recs  = [];
    const pctG  = ctx.renda > 0 ? (ctx.totalGasto / ctx.renda) * 100 : 0;
    const meses = 3;

    if (ctx.renda === 0) {
      recs.push({ tipo:'warn', txt:'⚠ Renda não informada — peça ao cliente para atualizar.' });
    }
    if (ctx.saldoReal > 0) {
      recs.push({ tipo:'ok',   txt:`✓ Saldo real positivo: ${fmt.format(ctx.saldoReal)}. Ótimo controle!` });
    } else if (ctx.saldoReal < 0) {
      recs.push({ tipo:'danger', txt:`🚨 Saldo real negativo: ${fmt.format(ctx.saldoReal)}. Rever gastos urgente.` });
    }
    if (pctG > 95 && ctx.renda > 0) {
      recs.push({ tipo:'danger', txt:`🚨 ${pctG.toFixed(1)}% da renda comprometida — sem margem de segurança.` });
    } else if (pctG > 80 && ctx.renda > 0) {
      recs.push({ tipo:'warn', txt:`⚡ ${pctG.toFixed(1)}% comprometido. Considerar corte de gastos.` });
    } else if (ctx.renda > 0) {
      recs.push({ tipo:'ok', txt:`✓ Comprometimento saudável: ${pctG.toFixed(1)}% da renda.` });
    }
    if (ctx.livre > ctx.renda * 0.2 && ctx.renda > 0) {
      recs.push({ tipo:'ok', txt:`✓ Margem livre de ${fmt.format(ctx.livre)} — boa reserva.` });
    }
    const fundoIdeal = ctx.totalGasto * meses;
    if (fundoIdeal > 0) {
      recs.push({ tipo:'info', txt:`💡 Fundo de emergência ideal: ${fmt.format(fundoIdeal)} (${meses}x despesas).` });
    }
    if (ctx.cobertura < 50 && ctx.renda > 0) {
      recs.push({ tipo:'warn', txt:`⚠ Cobertura de receitas reais: ${ctx.cobertura.toFixed(1)}%. Ampliar receitas.` });
    }

    // Top categoria de gasto
    const catMap = {};
    (ctx.lancs||[]).filter(l => l.tipo==='despesa').forEach(l => {
      catMap[l.categoria] = (catMap[l.categoria]||0) + (parseFloat(l.valor)||0);
    });
    const top = Object.entries(catMap).sort((a,b)=>b[1]-a[1])[0];
    if (top) recs.push({ tipo:'info', txt:`📊 Maior categoria de gasto: ${top[0]} (${fmt.format(top[1])}).` });

    if (!recs.length) recs.push({ tipo:'ok', txt:'✓ Sem alertas no momento.' });

    const cls = { ok:'adm-rec-ok', warn:'adm-rec-warn', danger:'adm-rec-danger', info:'adm-rec-info', neutral:'adm-rec-neutral' };
    el.innerHTML = recs.map(r => `<li class="adm-rec-item ${cls[r.tipo]||''}">${_esc(r.txt)}</li>`).join('');
  }

  // ── Gráficos ──────────────────────────────────────────────

  function _destroyChart(ref) {
    if (ref) { try { ref.destroy(); } catch(e) {} }
    return null;
  }

  function _renderCharts({ renda, totalFixo, totalCaixa, totalCompras, livre, totalReceitas, totalDespesas, lancs }) {
    const accent  = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#a78bfa';
    const success = '#34d399';
    const danger  = '#f87171';
    const warn    = '#fbbf24';
    const text2   = '#777';
    const gridClr = '#1a1a1a';
    const mono    = "'DM Mono', monospace";

    const fmtK = (v) => v >= 1000 ? 'R$' + (v/1000).toFixed(1) + 'k' : 'R$' + v;
    const tooltipOpts = {
      backgroundColor: '#1e1e1e',
      titleColor: '#e8e8e8',
      bodyColor: '#999',
      borderColor: '#333',
      borderWidth: 1,
    };

    // Chart 1: Planejado vs Real
    const c1 = document.getElementById('chart-planejadoReal') ||
               document.getElementById('chart-planejado-real');
    if (c1) {
      _chartPlanejadoReal = _destroyChart(_chartPlanejadoReal);
      const saldoR = totalReceitas - totalDespesas;
      _chartPlanejadoReal = new Chart(c1, {
        type: 'bar',
        data: {
          labels: ['Renda', 'Comprometido', 'Livre', 'Rec. Real', 'Desp. Real', 'Saldo Real'],
          datasets: [{
            data: [renda, totalFixo+totalCaixa+totalCompras, Math.max(0,livre), totalReceitas, totalDespesas, saldoR],
            backgroundColor: [accent+'cc', warn+'cc', success+'cc', success+'cc', danger+'cc', saldoR>=0?success+'cc':danger+'cc'],
            borderColor:     [accent,      warn,      success,      success,      danger,      saldoR>=0?success:danger],
            borderWidth: 1, borderRadius: 6,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display:false }, tooltip: tooltipOpts },
          scales: {
            x: { ticks: { color:text2, font:{size:10,family:mono} }, grid: { color:gridClr } },
            y: { ticks: { color:text2, font:{size:10,family:mono}, callback: fmtK }, grid: { color:gridClr } },
          },
        },
      });
    }

    // Chart 2: Top Categorias (horizontal)
    const c2 = document.getElementById('chart-categorias');
    if (c2) {
      _chartCategorias = _destroyChart(_chartCategorias);
      const catMap = {};
      lancs.filter(l=>l.tipo==='despesa').forEach(l => {
        catMap[l.categoria||'outros'] = (catMap[l.categoria||'outros']||0) + (parseFloat(l.valor)||0);
      });
      const sorted = Object.entries(catMap).sort((a,b)=>b[1]-a[1]).slice(0,7);
      if (sorted.length) {
        const wrap = c2.closest('.chart-wrap');
        if (wrap) wrap.style.height = Math.max(160, sorted.length*38+40)+'px';
        _chartCategorias = new Chart(c2, {
          type: 'bar',
          data: {
            labels: sorted.map(([k])=>k.charAt(0).toUpperCase()+k.slice(1)),
            datasets: [{ label:'R$', data:sorted.map(([,v])=>v), backgroundColor:accent+'bb', borderColor:accent, borderWidth:1, borderRadius:4, barThickness:22 }],
          },
          options: {
            indexAxis: 'y', responsive:true, maintainAspectRatio:false,
            plugins: { legend:{display:false}, tooltip:tooltipOpts },
            scales: {
              x: { ticks:{color:text2,font:{size:10},callback:fmtK}, grid:{color:gridClr} },
              y: { ticks:{color:text2,font:{size:10}}, grid:{display:false} },
            },
          },
        });
      }
    }

    // Chart 3: Doughnut distribuição
    const c3 = document.getElementById('chart-distribuicao');
    if (c3) {
      _chartDistribuicao = _destroyChart(_chartDistribuicao);
      _chartDistribuicao = new Chart(c3, {
        type: 'doughnut',
        data: {
          labels: ['Fixo', 'Caixinhas', 'Compras', 'Livre'],
          datasets: [{
            data: [totalFixo, totalCaixa, totalCompras, Math.max(0,livre)],
            backgroundColor: [danger+'cc', accent+'cc', warn+'cc', success+'cc'],
            borderColor: ['#0d0d0d'], borderWidth:3, hoverOffset:8,
          }],
        },
        options: {
          responsive:true, maintainAspectRatio:false, cutout:'62%',
          plugins: {
            legend: { position:'bottom', labels:{color:text2,font:{size:11,family:mono},padding:14,boxWidth:12} },
            tooltip: tooltipOpts,
          },
        },
      });
    }
  }

  // ── Listas somente leitura ────────────────────────────────

  function _renderAdminList(listId, items, totalId, total) {
    const el = document.getElementById(listId);
    if (!el) return;
    el.innerHTML = (!items?.length)
      ? '<li style="padding:12px 20px;font-size:0.8rem;color:var(--text-3)">Nenhum item</li>'
      : items.map(i => `
          <li class="item-row">
            <span class="item-emoji">${i.emoji||'•'}</span>
            <span style="flex:1;font-size:0.9rem">${_esc(i.name)}</span>
            <span style="font-family:var(--font-mono);font-size:0.88rem;color:var(--text-2)">${fmt.format(i.value)}</span>
          </li>`).join('');
    _setText(totalId, fmt.format(total));
  }

  // ── Feed ──────────────────────────────────────────────────

  function _loadFeed() {
    const listEl = document.getElementById('feed-list');
    if (listEl) listEl.innerHTML = '';

    const clientUserId = _viewingUserId || Storage.getConfig().clientUserId;
    if (!clientUserId || !SupabaseSync.isConfigured()) {
      Storage.getFeed().forEach(e => _appendFeedItem(e, false));
      return;
    }

    SupabaseSync.fetchActivity(
      _clientMonthKey || Storage.currentMonthKey(), 50, clientUserId
    ).then(res => {
      if (!res.ok || !res.data.length) {
        Storage.getFeed().forEach(e => _appendFeedItem(e, false));
        return;
      }
      res.data.forEach(r => _appendFeedItem({ action:r.action, detail:r.detail, icon:r.icon, ts:r.created_at }, false));
      const emptyEl = document.getElementById('feed-empty');
      if (emptyEl) emptyEl.hidden = true;
    });
  }

  function _appendFeedItem(entry, isNew = true) {
    const listEl  = document.getElementById('feed-list');
    const emptyEl = document.getElementById('feed-empty');
    const pulse   = document.getElementById('feed-pulse');
    if (!listEl) return;
    if (emptyEl) emptyEl.hidden = true;
    if (pulse)   pulse.hidden = false;

    const li = document.createElement('li');
    li.className = `feed-item${isNew?' feed-new':''}`;
    li.innerHTML = `
      <span class="feed-icon">${entry.icon||'•'}</span>
      <div class="feed-body">
        <div class="feed-text">${_esc(entry.detail||entry.action)}</div>
        <div class="feed-time">${_formatTime(entry.ts||new Date().toISOString())}</div>
      </div>`;
    listEl.prepend(li);
    if (isNew) {
      setTimeout(() => li.classList.remove('feed-new'), 4000);
      _maybePushNotification(entry);
    }
    const items = listEl.querySelectorAll('.feed-item');
    if (items.length > 80) items[items.length-1].remove();
  }

  // ── Realtime status ───────────────────────────────────────

  function _setRealtimeStatus(status) {
    const dot   = document.getElementById('realtime-dot');
    const label = document.getElementById('realtime-label');
    if (!dot) return;
    const map = {
      live:           { cls:'live',       txt:'ao vivo 🟢' },
      connecting:     { cls:'connecting', txt:'conectando...' },
      error:          { cls:'error',      txt:'sem sinal ⚠️' },
      not_configured: { cls:'',           txt:'desconectado' },
      offline:        { cls:'error',      txt:'offline 📴' },
    };
    const s = map[status] || { cls:'', txt: status };
    dot.className = `realtime-dot ${s.cls}`;
    if (label) label.textContent = s.txt;
  }

  // ── Enviar mensagem ───────────────────────────────────────

  async function sendMessage() {
    const input  = document.getElementById('admin-message-input');
    const typeEl = document.getElementById('admin-message-type');
    const text   = input?.value?.trim();
    const type   = typeEl?.value || 'info';

    if (!text)           { UI.toast('Digite uma mensagem primeiro', 'warn'); return; }
    if (!_viewingUserId) { UI.toast('Selecione um cliente primeiro', 'warn'); return; }

    const result = await SupabaseSync.pushMessage(text, type, _viewingUserId);
    UI.toast(result.ok ? '✅ Mensagem enviada!' : '❌ Erro ao enviar', result.ok ? 'success' : 'warn');
    if (result.ok && input) input.value = '';
  }

  // ── Push ──────────────────────────────────────────────────

  async function requestPushPermission() {
    if (!('Notification' in window)) return false;
    const result  = await Notification.requestPermission();
    const granted = result === 'granted';
    const hint    = document.getElementById('push-status-hint');
    if (hint) {
      hint.textContent = granted ? '✓ Notificações ativadas!' : '✕ Permissão negada.';
      hint.style.color = granted ? 'var(--success)' : 'var(--danger)';
    }
    return granted;
  }

  function _maybePushNotification(entry) {
    const cfg = Storage.getConfig();
    if (!cfg.pushEnabled || Notification.permission !== 'granted') return;
    new Notification('Caixinhas — Atividade', {
      body: entry.detail || entry.action,
      icon: 'icon-192.png',
      tag:  'caixinhas-activity',
    });
  }

  // ── Mensagens do admin para cliente ──────────────────────

  async function checkIncomingMessages() {
    // Usa getUserId() do Auth (não config legado)
    const userId = Auth.getUserId?.() || Storage.getConfig().clientUserId;
    if (!userId || !SupabaseSync.isConfigured()) {
      const local = Storage.getMessage();
      if (local) _showAlertBanner(local.text, local.type||'info');
      return;
    }
    const res = await SupabaseSync.fetchUnreadMessages(userId);
    if (res.ok && res.data.length) {
      const msg = res.data[0];
      _showAlertBanner(msg.text, msg.type||'info');
      SupabaseSync.markMessageRead(msg.id);
    }
  }

  function _showAlertBanner(text, type='info') {
    const banner = document.getElementById('admin-alert-banner');
    const textEl = document.getElementById('admin-alert-text');
    if (!banner||!textEl) return;
    textEl.textContent = text;
    banner.className = `admin-alert-banner type-${type}`;
    const icons = { info:'💬', warn:'⚠️', success:'✅', danger:'🚨' };
    const iconEl = banner.querySelector('.admin-alert-icon');
    if (iconEl) iconEl.textContent = icons[type]||'💬';
    banner.removeAttribute('hidden');
  }

  function dismissAlert() {
    const banner = document.getElementById('admin-alert-banner');
    if (banner) banner.setAttribute('hidden','');
    Storage.clearMessage();
  }

  // ── Utils ─────────────────────────────────────────────────

  function _setLoadingState(v) {
    const el = document.getElementById('adm-loading-banner');
    if (el) el.hidden = !v;
  }

  function _sum(list=[]) {
    return list.reduce((a,i)=>a+(parseFloat(i.value)||0),0);
  }

  function _setText(id,val) {
    const el=document.getElementById(id); if(el) el.textContent=val;
  }

  function _setWidth(id,val) {
    const el=document.getElementById(id); if(el) el.style.width=val;
  }

  function _esc(s) {
    return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _formatTime(iso) {
    try {
      const d    = new Date(iso);
      const diff = Math.floor((Date.now()-d)/60000);
      if (diff < 1)    return 'agora';
      if (diff < 60)   return `há ${diff}min`;
      if (diff < 1440) return `há ${Math.floor(diff/60)}h`;
      return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    } catch { return '—'; }
  }

  // ── Public API ────────────────────────────────────────────

  return {
    isLoggedIn, tryLogin, logout, enter,
    sendMessage, requestPushPermission,
    checkIncomingMessages, dismissAlert,
    refreshClientData,
    renderAdminData: _renderAdminData,
    setViewingUserId,
  };

})();

// ── Screen manager ────────────────────────────────────────

const Screen = (() => {
  const screens = ['auth', 'login', 'client', 'admin'];

  function show(name) {
    screens.forEach(s => {
      const el = document.getElementById(`screen-${s}`);
      if (!el) return;

      if (s === 'auth') {
        // screen-auth usa classe CSS (display:none por padrão no CSS)
        el.classList.toggle('auth-visible', name === 'auth');
      } else {
        if (s === name) el.removeAttribute('hidden');
        else            el.setAttribute('hidden', '');
      }
    });
  }

  return { show };
})();
