/**
 * lancamentos.js
 * Módulo de lançamentos: receitas e despesas realizadas no mês.
 * Separado do planejamento (caixinhas/fixo) — registra o que realmente aconteceu.
 */

const Lancamentos = (() => {

  const CATEGORIAS = {
    alimentacao: { label: 'Alimentação',  emoji: '🍽' },
    transporte:  { label: 'Transporte',   emoji: '🚗' },
    saude:       { label: 'Saúde',        emoji: '💊' },
    lazer:       { label: 'Lazer',        emoji: '🎉' },
    educacao:    { label: 'Educação',     emoji: '📚' },
    moradia:     { label: 'Moradia',      emoji: '🏠' },
    roupas:      { label: 'Roupas',       emoji: '👗' },
    salario:     { label: 'Salário',      emoji: '💰' },
    freelance:   { label: 'Freelance',    emoji: '💻' },
    outros:      { label: 'Outros',       emoji: '📌' },
  };

  const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  // ── Estado local ──────────────────────────────────────────

  let _filtroAtivo = 'todos';
  let _editingId   = null;

  // ── Persistência (via Storage) ────────────────────────────

  function _getLancamentos() {
    const data = State.getData();
    return data.lancamentos || [];
  }

  function _calcTotais(lista) {
    const totalReceita = lista
      .filter(l => l.tipo === 'receita')
      .reduce((acc, l) => acc + (parseFloat(l.valor) || 0), 0);
    const totalDespesa = lista
      .filter(l => l.tipo === 'despesa')
      .reduce((acc, l) => acc + (parseFloat(l.valor) || 0), 0);
    return { totalReceita, totalDespesa, saldo: totalReceita - totalDespesa };
  }

  // ── Renderização (tela cliente) ───────────────────────────

  function render() {
    const todos   = _getLancamentos();
    const filtro  = _filtroAtivo;
    const lista   = filtro === 'todos' ? todos : todos.filter(l => l.tipo === filtro);
    const totais  = _calcTotais(todos);

    const listEl  = document.getElementById('list-lancamentos');
    const emptyEl = document.getElementById('lanc-empty');

    if (!listEl) return;

    // Badges de totais
    _setText('badge-total-receita', `+ ${fmt.format(totais.totalReceita)}`);
    _setText('badge-total-despesa', `- ${fmt.format(totais.totalDespesa)}`);

    // Saldo real
    const saldoEl = document.getElementById('lanc-saldo-valor');
    const barEl   = document.getElementById('lanc-saldo-bar');
    if (saldoEl) {
      saldoEl.textContent = fmt.format(totais.saldo);
      saldoEl.style.color = totais.saldo >= 0 ? 'var(--success)' : 'var(--danger)';
    }
    if (barEl) {
      barEl.classList.toggle('saldo-negativo', totais.saldo < 0);
    }

    // Lista
    listEl.innerHTML = '';
    if (!lista.length) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    // Ordena por data desc
    const ordenada = [...lista].sort((a, b) => {
      if (a.data && b.data) return b.data.localeCompare(a.data);
      return b.ts?.localeCompare(a.ts || '') || 0;
    });

    ordenada.forEach(lanc => {
      listEl.appendChild(_criarLancItem(lanc));
    });
  }

  function _criarLancItem(lanc) {
    const cat   = CATEGORIAS[lanc.categoria] || CATEGORIAS.outros;
    const isRec = lanc.tipo === 'receita';
    const li    = document.createElement('li');
    li.className = 'item-row lanc-row';
    li.dataset.lancId = lanc.id;

    li.innerHTML = `
      <span class="item-emoji">${cat.emoji}</span>
      <div class="lanc-info">
        <span class="lanc-descricao">${_esc(lanc.descricao)}</span>
        <span class="lanc-meta">${cat.label}${lanc.data ? ' · ' + _fmtData(lanc.data) : ''}${lanc.obs ? ' · ' + _esc(lanc.obs) : ''}</span>
      </div>
      <span class="lanc-valor ${isRec ? 'valor-receita' : 'valor-despesa'}">
        ${isRec ? '+' : '-'} ${fmt.format(lanc.valor)}
      </span>
      <div class="lanc-actions">
        <button class="item-delete lanc-edit-btn" title="Editar" style="opacity:1;color:var(--text-3)">✏</button>
        <button class="item-delete" title="Remover">✕</button>
      </div>
    `;

    // Editar
    li.querySelector('.lanc-edit-btn').addEventListener('click', () => abrirModal(lanc));

    // Remover
    li.querySelector('.item-delete:last-child').addEventListener('click', () => {
      li.style.transition = 'opacity 0.2s, transform 0.2s';
      li.style.opacity    = '0';
      li.style.transform  = 'translateX(10px)';
      setTimeout(() => remover(lanc.id), 200);
    });

    return li;
  }

  // ── Modal ─────────────────────────────────────────────────

  function abrirModal(lancExistente = null) {
    _editingId = lancExistente?.id || null;

    const titleEl = document.getElementById('lanc-modal-title');
    if (titleEl) titleEl.textContent = _editingId ? 'Editar Lançamento' : 'Novo Lançamento';

    // Preenche campos
    _setVal('lanc-descricao', lancExistente?.descricao || '');
    _setVal('lanc-valor',     lancExistente?.valor     || '');
    _setVal('lanc-obs',       lancExistente?.obs       || '');
    _setVal('lanc-data',      lancExistente?.data      || _hojeISO());
    _setVal('lanc-edit-id',   _editingId               || '');

    const catEl = document.getElementById('lanc-categoria');
    if (catEl) catEl.value = lancExistente?.categoria || 'alimentacao';

    // Tipo toggle
    const tipo = lancExistente?.tipo || 'despesa';
    _setVal('lanc-tipo', tipo);
    document.querySelectorAll('.lanc-tipo-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tipo === tipo);
    });

    UI.openModal('modal-lancamento');
    setTimeout(() => document.getElementById('lanc-descricao')?.focus(), 80);
  }

  function salvar() {
    const descricao  = document.getElementById('lanc-descricao')?.value?.trim();
    const valorRaw   = parseFloat(document.getElementById('lanc-valor')?.value);
    const tipo       = document.getElementById('lanc-tipo')?.value || 'despesa';
    const categoria  = document.getElementById('lanc-categoria')?.value || 'outros';
    const data       = document.getElementById('lanc-data')?.value || _hojeISO();
    const obs        = document.getElementById('lanc-obs')?.value?.trim() || '';

    if (!descricao) {
      UI.toast('Informe a descrição', 'warn');
      document.getElementById('lanc-descricao')?.focus();
      return;
    }
    if (!valorRaw || valorRaw <= 0) {
      UI.toast('Informe um valor válido', 'warn');
      document.getElementById('lanc-valor')?.focus();
      return;
    }

    const payload = { descricao, valor: valorRaw, tipo, categoria, data, obs };

    if (_editingId) {
      _atualizar(_editingId, payload);
      UI.toast('Lançamento atualizado', 'success');
    } else {
      _adicionar(payload);
      UI.toast(`${tipo === 'receita' ? 'Receita' : 'Despesa'} registrada`, 'success');
    }

    UI.closeModal('modal-lancamento');
    render();
  }

  // ── CRUD (via State) ──────────────────────────────────────

  function _adicionar(payload) {
    const novoItem = {
      id: _uid(),
      ts: new Date().toISOString(),
      ...payload,
    };
    // State.addLancamento persiste, loga e emite eventos
    State.addLancamento(novoItem);
  }

  function _atualizar(id, patch) {
    State.updateLancamento(id, patch);
  }

  function remover(id) {
    State.removeLancamento(id);
    render();
  }

  // ── Filtros ───────────────────────────────────────────────

  function setFiltro(filtro) {
    _filtroAtivo = filtro;
    document.querySelectorAll('.lanc-filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === filtro);
    });
    render();
  }

  // ── Render Admin ──────────────────────────────────────────

  function renderAdmin(lancamentos) {
    const lista  = lancamentos || _getLancamentos();
    const totais = _calcTotais(lista);

    _setText('adm-badge-receita',   `+ ${fmt.format(totais.totalReceita)}`);
    _setText('adm-badge-despesa',   `- ${fmt.format(totais.totalDespesa)}`);

    // KPIs extra
    _setText('adm-receitas',    fmt.format(totais.totalReceita));
    _setText('adm-despesas',    fmt.format(totais.totalDespesa));

    const saldoEl = document.getElementById('adm-saldo-real');
    if (saldoEl) {
      saldoEl.textContent = fmt.format(totais.saldo);
      saldoEl.className   = `kpi-value ${totais.saldo >= 0 ? 'kpi-success' : 'kpi-danger'}`;
    }

    // Saldo bar admin
    const saldoValEl = document.getElementById('adm-lanc-saldo-valor');
    if (saldoValEl) {
      saldoValEl.textContent = fmt.format(totais.saldo);
      saldoValEl.style.color = totais.saldo >= 0 ? 'var(--success)' : 'var(--danger)';
    }

    // Lista admin (somente leitura)
    const listEl  = document.getElementById('adm-list-lancamentos');
    const emptyEl = document.getElementById('adm-lanc-empty');

    if (!listEl) return;

    if (!lista.length) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    const ordenada = [...lista].sort((a, b) =>
      (b.data || '').localeCompare(a.data || '') || (b.ts || '').localeCompare(a.ts || '')
    );

    listEl.innerHTML = ordenada.map(lanc => {
      const cat   = CATEGORIAS[lanc.categoria] || CATEGORIAS.outros;
      const isRec = lanc.tipo === 'receita';
      return `
        <li class="item-row lanc-row">
          <span class="item-emoji">${cat.emoji}</span>
          <div class="lanc-info">
            <span class="lanc-descricao">${_esc(lanc.descricao)}</span>
            <span class="lanc-meta">${cat.label}${lanc.data ? ' · ' + _fmtData(lanc.data) : ''}</span>
          </div>
          <span class="lanc-valor ${isRec ? 'valor-receita' : 'valor-despesa'}">
            ${isRec ? '+' : '-'} ${fmt.format(lanc.valor)}
          </span>
        </li>
      `;
    }).join('');
  }

  // ── Utils ─────────────────────────────────────────────────

  function _uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function _hojeISO() {
    return new Date().toISOString().split('T')[0];
  }

  function _fmtData(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function _esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function _setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  }

  // ── Public API ────────────────────────────────────────────

  return {
    render,
    renderAdmin,
    abrirModal,
    salvar,
    remover,
    setFiltro,
    calcTotais: _calcTotais,
    getLancamentos: _getLancamentos,
  };

})();