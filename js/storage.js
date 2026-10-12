/**
 * storage.js
 * Abstração localStorage. Toda leitura/escrita de dados passa por aqui.
 */

const Storage = (() => {

  const KEYS = {
    CONFIG:   'caixinhas:config',
    DATA:     (k) => `caixinhas:data:${k}`,
    HISTORY:  'caixinhas:history',
    MESSAGES: 'caixinhas:messages',
    FEED:     'caixinhas:feed',
  };

  // ── Helpers ───────────────────────────────────────────────

  function safeGet(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('[Storage] Falha ao salvar:', key, e);
      return false;
    }
  }

  // ── Config ────────────────────────────────────────────────

  const DEFAULT_CONFIG = {
    appName:       'Caixinhas',
    userName:      '',
    userId:        'usuario',
    accentColor:   '#a78bfa',
    adminPassword: '@Musica143r',
    supabaseUrl:   'https://ywossdxnqhrhznglsvcr.supabase.co',
    supabaseKey:   'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3b3NzZHhucWhyaHpuZ2xzdmNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxOTIzMjcsImV4cCI6MjA4OTc2ODMyN30.q654hvqIXjT2qi5fsLKYLx_VwCkFRCHNdYqHBfN08Uo',
    pushEnabled:   false,
    pushSubscription: null,
    // Nomes personalizáveis das seções de planejamento
    sectionNames: {
      fixo:      'Não pode gastar',
      caixinhas: 'Caixinhas',
      compras:   'O que preciso comprar',
    },
    sectionDescs: {
      fixo:      'Compromissos e despesas fixas do mês',
      caixinhas: 'Metas e reservas do mês',
      compras:   'Itens planejados para adquirir',
    },
  };

  function getConfig() {
    return { ...DEFAULT_CONFIG, ...safeGet(KEYS.CONFIG, {}) };
  }

  function saveConfig(partial) {
    const current = getConfig();
    return safeSet(KEYS.CONFIG, { ...current, ...partial });
  }

  // ── Month ─────────────────────────────────────────────────

  function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  const DEFAULT_MONTH = {
    renda:        0,
    fixo:         [],
    caixinhas:    [],
    compras:      [],
    lancamentos:  [],
    updatedAt:    null,
  };

  function getMonthData(monthKey = currentMonthKey()) {
    return { ...DEFAULT_MONTH, ...safeGet(KEYS.DATA(monthKey), {}) };
  }

  function saveMonthData(data, monthKey = currentMonthKey()) {
    const toSave = { ...data, updatedAt: new Date().toISOString() };
    const ok = safeSet(KEYS.DATA(monthKey), toSave);
    if (ok) _updateHistory(monthKey, toSave);
    return ok;
  }

  function clearMonthData(monthKey = currentMonthKey()) {
    localStorage.removeItem(KEYS.DATA(monthKey));
  }

  // ── History ───────────────────────────────────────────────

  function _updateHistory(monthKey, data) {
    const history = safeGet(KEYS.HISTORY, {});
    history[monthKey] = {
      renda:         data.renda,
      totalFixo:     _sum(data.fixo),
      totalCaixa:    _sum(data.caixinhas),
      totalCompras:  _sum(data.compras),
      updatedAt:     data.updatedAt,
    };
    safeSet(KEYS.HISTORY, history);
  }

  function getHistory() {
    return safeGet(KEYS.HISTORY, {});
  }

  // ── Messages (admin → cliente) ────────────────────────────

  function saveMessage(msg) {
    return safeSet(KEYS.MESSAGES, msg);
  }

  function getMessage() {
    return safeGet(KEYS.MESSAGES, null);
  }

  function clearMessage() {
    localStorage.removeItem(KEYS.MESSAGES);
  }

  // ── Feed (atividades locais p/ admin offline) ─────────────

  function appendFeedEntry(entry) {
    const feed = safeGet(KEYS.FEED, []);
    feed.unshift({ ...entry, ts: new Date().toISOString() });
    if (feed.length > 100) feed.length = 100;
    safeSet(KEYS.FEED, feed);
  }

  function getFeed() {
    return safeGet(KEYS.FEED, []);
  }

  // ── Export ────────────────────────────────────────────────

  function exportAll() {
    const config  = getConfig();
    const history = getHistory();
    const months  = {};
    Object.keys(history).forEach(k => { months[k] = getMonthData(k); });
    return {
      exportedAt: new Date().toISOString(),
      config: { ...config, supabaseKey: '[REDACTED]', adminPassword: '[REDACTED]' },
      history,
      months,
    };
  }

  // ── Utils ─────────────────────────────────────────────────

  function _sum(list = []) {
    return list.reduce((acc, i) => acc + (parseFloat(i.value) || 0), 0);
  }

  // ── Public API ────────────────────────────────────────────

  return {
    currentMonthKey,
    getConfig, saveConfig,
    getMonthData, saveMonthData, clearMonthData,
    getHistory,
    saveMessage, getMessage, clearMessage,
    appendFeedEntry, getFeed,
    exportAll,
  };

})();