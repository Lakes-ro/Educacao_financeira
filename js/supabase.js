/**
 * supabase.js
 * Sincronização com Supabase + Realtime (WebSocket).
 *
 * Cole suas credenciais nas constantes abaixo:
 *   supabase.com → seu projeto → Settings → API
 */

const SupabaseSync = (() => {

  // ── Credenciais ───────────────────────────────────────────
  const SUPABASE_URL = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3b3NzZHhucWhyaHpuZ2xzdmNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxOTIzMjcsImV4cCI6MjA4OTc2ODMyN30.q654hvqIXjT2qi5fsLKYLx_VwCkFRCHNdYqHBfN08Uo';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3b3NzZHhucWhyaHpuZ2xzdmNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxOTIzMjcsImV4cCI6MjA4OTc2ODMyN30.q654hvqIXjT2qi5fsLKYLx_VwCkFRCHNdYqHBfN08Uo';

  let _url    = '';
  let _key    = '';
  let _userId = '';

  let _onMonthChange = null;
  let _onActivity    = null;
  let _onMessage     = null;

  // ── Init ──────────────────────────────────────────────────

  function init() {
    const cfg = Storage.getConfig();
    _url    = SUPABASE_URL !== 'COLE_AQUI_A_URL_DO_PROJETO' ? SUPABASE_URL : '';
    _key    = SUPABASE_KEY !== 'COLE_AQUI_A_ANON_KEY'       ? SUPABASE_KEY : '';
    _userId = cfg.userId?.trim() || cfg.userName?.trim() || 'usuario';
  }

  function isConfigured() {
    return Boolean(_url && _key);
  }

  function getUserId() { return _userId; }

  // ── Headers ───────────────────────────────────────────────

  function _headers(extra = {}) {
    return {
      'Content-Type':  'application/json',
      'apikey':         _key,
      'Authorization': `Bearer ${_key}`,
      ...extra,
    };
  }

  // Headers para fetch com keepalive (usado no flushToRemote)
  function getBeaconHeaders() {
    return _headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' });
  }

  // URL base da tabela (usada no flushToRemote do state.js)
  function getRestUrl(table) {
    return `${_url}/rest/v1/${table}`;
  }

  // ── REST: finance_months ──────────────────────────────────

  async function pushMonthData(monthKey, data) {
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    try {
      const res = await fetch(`${_url}/rest/v1/finance_months`, {
        method:  'POST',
        headers: _headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body:    JSON.stringify({
          month_key:  monthKey,
          user_id:    _userId,
          data,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) return { ok: false, reason: await res.text() };
      return { ok: true };
    } catch { return { ok: false, reason: 'network_error' }; }
  }

  async function pullMonthData(monthKey) {
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    try {
      const res = await fetch(
        `${_url}/rest/v1/finance_months?month_key=eq.${monthKey}&user_id=eq.${encodeURIComponent(_userId)}&select=data,updated_at`,
        { headers: _headers() }
      );
      if (!res.ok) return { ok: false, reason: await res.text() };
      const rows = await res.json();
      if (!rows.length) return { ok: true, data: null };
      return { ok: true, data: rows[0].data, updatedAt: rows[0].updated_at };
    } catch { return { ok: false, reason: 'network_error' }; }
  }

  // ── REST: finance_activity ────────────────────────────────

  async function logActivity(action, detail = '', icon = '•') {
    // Salva localmente sempre (funciona offline)
    Storage.appendFeedEntry({ action, detail, icon });

    if (!isConfigured() || !navigator.onLine) return;

    try {
      await fetch(`${_url}/rest/v1/finance_activity`, {
        method:  'POST',
        headers: _headers({ 'Prefer': 'return=minimal' }),
        body:    JSON.stringify({
          user_id:   _userId,
          month_key: Storage.currentMonthKey(),
          action,
          detail,
          icon,
        }),
      });
    } catch { /* silencioso — já salvo localmente */ }
  }

  async function fetchActivity(monthKey, limit = 50) {
    if (!isConfigured()) return { ok: false, data: [] };
    try {
      const res = await fetch(
        `${_url}/rest/v1/finance_activity?user_id=eq.${encodeURIComponent(_userId)}&month_key=eq.${monthKey}&order=created_at.desc&limit=${limit}`,
        { headers: _headers() }
      );
      if (!res.ok) return { ok: false, data: [] };
      return { ok: true, data: await res.json() };
    } catch { return { ok: false, data: [] }; }
  }

  // ── REST: finance_messages ────────────────────────────────

  async function pushMessage(text, type = 'info') {
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    try {
      const res = await fetch(`${_url}/rest/v1/finance_messages`, {
        method:  'POST',
        headers: _headers({ 'Prefer': 'return=minimal' }),
        body:    JSON.stringify({ user_id: _userId, text, type, read: false }),
      });
      if (!res.ok) return { ok: false, reason: await res.text() };
      return { ok: true };
    } catch { return { ok: false, reason: 'network_error' }; }
  }

  async function fetchUnreadMessages() {
    if (!isConfigured()) return { ok: false, data: [] };
    try {
      const res = await fetch(
        `${_url}/rest/v1/finance_messages?user_id=eq.${encodeURIComponent(_userId)}&read=eq.false&order=created_at.desc&limit=5`,
        { headers: _headers() }
      );
      if (!res.ok) return { ok: false, data: [] };
      return { ok: true, data: await res.json() };
    } catch { return { ok: false, data: [] }; }
  }

  async function markMessageRead(id) {
    if (!isConfigured()) return;
    try {
      await fetch(`${_url}/rest/v1/finance_messages?id=eq.${id}`, {
        method:  'PATCH',
        headers: _headers({ 'Prefer': 'return=minimal' }),
        body:    JSON.stringify({ read: true }),
      });
    } catch { /* silencioso */ }
  }

  // ── Realtime via WebSocket nativo ─────────────────────────

  let _ws             = null;
  let _wsHeartbeat    = null;
  let _reconnectTimer = null;

  function connectRealtime(onStatusChange) {
    if (!isConfigured()) {
      onStatusChange?.('not_configured');
      return;
    }

    const wsUrl = _url.replace('https://', 'wss://').replace('http://', 'ws://');

    function connect() {
      try {
        _ws = new WebSocket(`${wsUrl}/realtime/v1/websocket?apikey=${_key}&vsn=1.0.0`);

        _ws.onopen = () => {
          onStatusChange?.('live');
          ['finance_months', 'finance_activity', 'finance_messages'].forEach(table => {
            _ws.send(JSON.stringify({
              topic:   `realtime:public:${table}`,
              event:   'phx_join',
              payload: { config: { broadcast: { self: false }, presence: { key: '' } } },
              ref:     null,
            }));
          });
          _wsHeartbeat = setInterval(() => {
            if (_ws.readyState === WebSocket.OPEN) {
              _ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: null }));
            }
          }, 30000);
        };

        _ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.event === 'phx_reply' || msg.topic === 'phoenix') return;
            const { topic, payload } = msg;
            const record = payload?.record || payload?.new;
            if (!record) return;
            if (record.user_id && record.user_id !== _userId) return;
            if (topic?.includes('finance_months'))   _onMonthChange?.(record);
            else if (topic?.includes('finance_activity'))  _onActivity?.(record);
            else if (topic?.includes('finance_messages'))  _onMessage?.(record);
          } catch { /* ignora mensagens inválidas */ }
        };

        _ws.onerror = () => onStatusChange?.('error');

        _ws.onclose = () => {
          onStatusChange?.('connecting');
          clearInterval(_wsHeartbeat);
          clearTimeout(_reconnectTimer);
          _reconnectTimer = setTimeout(connect, 5000);
        };

      } catch { onStatusChange?.('error'); }
    }

    connect();
  }

  function disconnectRealtime() {
    clearTimeout(_reconnectTimer);
    clearInterval(_wsHeartbeat);
    _ws?.close();
    _ws = null;
  }

  function setCallbacks({ onMonthChange, onActivity, onMessage }) {
    _onMonthChange = onMonthChange || null;
    _onActivity    = onActivity    || null;
    _onMessage     = onMessage     || null;
  }

  // ── Test connection ───────────────────────────────────────

  async function testConnection(url, key) {
    try {
      const res = await fetch(`${url.trim()}/rest/v1/`, {
        headers: { 'apikey': key.trim(), 'Authorization': `Bearer ${key.trim()}` },
      });
      return res.status < 500;
    } catch { return false; }
  }

  // ── Public API ────────────────────────────────────────────

  return {
    init,
    isConfigured,
    getUserId,
    getRestUrl,
    getBeaconHeaders,
    pushMonthData,
    pullMonthData,
    logActivity,
    fetchActivity,
    pushMessage,
    fetchUnreadMessages,
    markMessageRead,
    connectRealtime,
    disconnectRealtime,
    setCallbacks,
    testConnection,
  };

})();