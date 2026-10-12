/**
 * ui.js
 * Responsável por toda renderização e manipulação do DOM.
 * Não tem acesso direto ao Storage — tudo via State.
 */

const UI = (() => {

  // ── Formatação ────────────────────────────────────────────

  const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function formatBRL(value) {
    return fmt.format(parseFloat(value) || 0);
  }

  // ── Toast ─────────────────────────────────────────────────

  function toast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;

    container.appendChild(el);

    setTimeout(() => {
      el.classList.add('removing');
      el.addEventListener('animationend', () => el.remove());
    }, duration);
  }

  // ── Sync Indicator ────────────────────────────────────────

  function setSyncState(state) {
    const dot = document.getElementById('sync-dot');
    if (!dot) return;
    dot.className = `sync-dot ${state}`;
  }

  // ── Mês atual ─────────────────────────────────────────────

  function renderMonthLabel() {
    const monthKey = State.getMonthKey();
    const [year, month] = monthKey.split('-');
    const label = new Date(Number(year), Number(month) - 1, 1)
      .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    const el = document.getElementById('current-month-label');
    if (el) el.textContent = label.charAt(0).toUpperCase() + label.slice(1);
  }

  // ── Header / Title ────────────────────────────────────────

  function renderAppTitle() {
    const cfg = State.getConfig();
    const titleEl = document.getElementById('app-title');
    if (titleEl) titleEl.textContent = cfg.appName || 'Caixinhas';
  }

  // ── Section Titles (personalizáveis) ─────────────────────

  function renderSectionTitles() {
    const cfg = State.getConfig();
    const names = cfg.sectionNames || {};
    const descs = cfg.sectionDescs || {};

    const map = {
      fixo:      { nameEl: 'section-title-fixo',      descEl: 'section-desc-fixo'      },
      caixinhas: { nameEl: 'section-title-caixinhas',  descEl: 'section-desc-caixinhas'  },
      compras:   { nameEl: 'section-title-compras',    descEl: 'section-desc-compras'    },
    };

    Object.entries(map).forEach(([key, ids]) => {
      const nameEl = document.getElementById(ids.nameEl);
      const descEl = document.getElementById(ids.descEl);
      if (nameEl && names[key]) nameEl.textContent = names[key];
      if (descEl && descs[key]) descEl.textContent = descs[key];
    });
  }

  // ── Renda ─────────────────────────────────────────────────

  function renderRenda() {
    const { renda } = State.getData();
    const input = document.getElementById('input-renda');
    if (input && document.activeElement !== input) {
      input.value = renda > 0 ? renda : '';
    }

    const calc    = State.getCalculated();
    const metaEl  = document.getElementById('renda-meta');
    if (metaEl && renda > 0) {
      const usado = calc.totalGasto;
      const pct   = ((usado / renda) * 100).toFixed(1);
      metaEl.textContent = `${pct}% comprometido • ${formatBRL(usado)} alocado`;
    } else if (metaEl) {
      metaEl.textContent = '';
    }
  }

  // ── Barra de resumo ───────────────────────────────────────

  function renderBar() {
    const calc = State.getCalculated();

    const barFixo   = document.getElementById('bar-fixo');
    const barCaixas = document.getElementById('bar-caixinhas');
    const barLivre  = document.getElementById('bar-livre');

    const total = calc.pctFixo + calc.pctCaixa + calc.pctCompras;
    const pctAll = Math.min(total, 100);

    if (barFixo)   barFixo.style.width   = `${calc.pctFixo}%`;
    if (barCaixas) barCaixas.style.width = `${calc.pctCaixa + calc.pctCompras}%`;
    if (barLivre)  barLivre.style.width  = `${Math.max(0, 100 - pctAll)}%`;

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = formatBRL(val);
    };

    set('leg-fixo',      calc.totalFixo);
    set('leg-caixinhas', calc.totalCaixa + calc.totalCompras);
    set('leg-livre',     Math.max(0, calc.livre));
  }

  // ── Card Livre ────────────────────────────────────────────

  function renderLivre() {
    const calc  = State.getCalculated();
    const card  = document.getElementById('card-livre');
    const valor = document.getElementById('livre-valor');
    const status = document.getElementById('livre-status');

    if (!card) return;

    valor.textContent = formatBRL(calc.livre);

    card.classList.remove('state-ok', 'state-warn', 'state-danger');

    if (calc.renda === 0) {
      status.textContent = 'Informe sua renda para calcular';
      return;
    }

    if (calc.livre < 0) {
      card.classList.add('state-danger');
      status.textContent = `⚠ Ultrapassou em ${formatBRL(Math.abs(calc.livre))}`;
    } else if (calc.livre < calc.renda * 0.1) {
      card.classList.add('state-warn');
      status.textContent = '⚡ Pouco espaço — cuidado com gastos extras';
    } else {
      card.classList.add('state-ok');
      status.textContent = '✓ Orçamento equilibrado';
    }
  }

  // ── Seções ────────────────────────────────────────────────

  const SECTION_TOTALS = {
    fixo:      'total-fixo',
    caixinhas: 'total-caixinhas',
    compras:   'total-compras',
  };

  function renderSection(section) {
    const data  = State.getData()[section] || [];
    const listEl = document.getElementById(`list-${section}`);
    const totalEl = document.getElementById(SECTION_TOTALS[section]);

    if (!listEl) return;

    // Reconcilia o DOM (adiciona/remove linhas sem re-renderizar tudo)
    const existingIds = new Set(
      [...listEl.querySelectorAll('[data-item-id]')].map(el => el.dataset.itemId)
    );

    // Remove os que já não existem
    existingIds.forEach(id => {
      if (!data.find(i => i.id === id)) {
        listEl.querySelector(`[data-item-id="${id}"]`)?.remove();
      }
    });

    // Adiciona ou atualiza
    data.forEach((item, idx) => {
      let row = listEl.querySelector(`[data-item-id="${item.id}"]`);

      if (!row) {
        row = _createItemRow(item, section);
        listEl.appendChild(row);
      } else {
        // Atualiza apenas campos não focados
        const nameInput  = row.querySelector('.item-name-input');
        const valueInput = row.querySelector('.item-value-input');
        const emojiEl    = row.querySelector('.item-emoji');

        if (document.activeElement !== nameInput)
          nameInput.value = item.name;

        if (document.activeElement !== valueInput)
          valueInput.value = item.value || '';

        if (emojiEl) emojiEl.textContent = item.emoji || '';
      }
    });

    // Atualiza total da seção
    const total = data.reduce((acc, i) => acc + (parseFloat(i.value) || 0), 0);
    if (totalEl) totalEl.textContent = formatBRL(total);
  }

  function _createItemRow(item, section) {
    const li = document.createElement('li');
    li.className = 'item-row';
    li.dataset.itemId = item.id;

    li.innerHTML = `
      <span class="item-emoji" title="Clique para mudar emoji" tabindex="0" role="button">${item.emoji || ''}</span>
      <input
        type="text"
        class="item-name-input"
        value="${_escape(item.name)}"
        placeholder="Nome"
        aria-label="Nome do item"
      >
      <input
        type="number"
        class="item-value-input"
        value="${item.value || ''}"
        placeholder="0,00"
        min="0"
        step="0.01"
        aria-label="Valor em reais"
      >
      <button class="item-delete" aria-label="Remover item">✕</button>
    `;

    const nameInput  = li.querySelector('.item-name-input');
    const valueInput = li.querySelector('.item-value-input');
    const deleteBtn  = li.querySelector('.item-delete');
    const emojiEl    = li.querySelector('.item-emoji');

    nameInput.addEventListener('input', () => {
      State.updateItem(section, item.id, { name: nameInput.value });
    });

    valueInput.addEventListener('input', () => {
      State.updateItem(section, item.id, { value: parseFloat(valueInput.value) || 0 });
    });

    deleteBtn.addEventListener('click', () => {
      li.style.transition = 'opacity 0.2s, transform 0.2s';
      li.style.opacity    = '0';
      li.style.transform  = 'translateX(10px)';
      setTimeout(() => State.removeItem(section, item.id), 200);
    });

    emojiEl.addEventListener('click', () => {
      _promptEmoji(section, item.id);
    });

    emojiEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') _promptEmoji(section, item.id);
    });

    return li;
  }

  function _promptEmoji(section, id) {
    const emoji = prompt('Escolha um emoji para este item:', '');
    if (emoji !== null && emoji.trim()) {
      State.updateItem(section, id, { emoji: emoji.trim().slice(0, 2) });
    }
  }

  // ── Render tudo ───────────────────────────────────────────

  function renderAll() {
    renderAppTitle();
    renderMonthLabel();
    renderSectionTitles();
    renderRenda();
    renderBar();
    renderLivre();
    renderSection('fixo');
    renderSection('caixinhas');
    renderSection('compras');
  }

  // ── Settings Modal ────────────────────────────────────────

  function openSettingsModal() {
    const cfg = State.getConfig();

    // Preenche apenas os campos que existem no HTML atual
    _setVal('cfg-app-name',      cfg.appName);
    _setVal('cfg-user-name',     cfg.userName);
    _setVal('cfg-admin-password','');

    const pushToggle = document.getElementById('cfg-push-enabled');
    if (pushToggle) pushToggle.checked = cfg.pushEnabled || false;

    // Cor de destaque
    document.querySelectorAll('.color-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color === cfg.accentColor);
    });
    const colorInput = document.getElementById('cfg-custom-color');
    if (colorInput) colorInput.value = cfg.accentColor || '#a78bfa';

    // Nomes das seções
    const names = cfg.sectionNames || {};
    const descs = cfg.sectionDescs || {};
    _setVal('cfg-section-fixo-name',       names.fixo      || '');
    _setVal('cfg-section-fixo-desc',       descs.fixo      || '');
    _setVal('cfg-section-caixinhas-name',  names.caixinhas || '');
    _setVal('cfg-section-caixinhas-desc',  descs.caixinhas || '');
    _setVal('cfg-section-compras-name',    names.compras   || '');
    _setVal('cfg-section-compras-desc',    descs.compras   || '');

    // Se o modal existe, abre ele; senão a aba de config inline já está visível
    const modal = document.getElementById('modal-settings');
    if (modal) openModal('modal-settings');
  }

  // saveSettingsFromModal foi movido para app.js (_saveSettings)

  // ── Accent color ──────────────────────────────────────────

  function applyAccentColor(hex) {
    if (!hex) return;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    document.documentElement.style.setProperty('--accent', hex);
    document.documentElement.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
    document.documentElement.style.setProperty('--accent-dim',   `rgba(${r},${g},${b},0.12)`);
    document.documentElement.style.setProperty('--accent-hover', `rgba(${r},${g},${b},0.2)`);
    document.documentElement.style.setProperty('--bar-caixinhas', hex);
  }

  // ── History Modal ─────────────────────────────────────────

  function openHistoryModal() {
    const history  = Storage.getHistory();
    const listEl   = document.getElementById('history-list');
    listEl.innerHTML = '';

    const keys = Object.keys(history).sort((a, b) => b.localeCompare(a));

    if (!keys.length) {
      listEl.innerHTML = '<p style="color:var(--text-3);font-size:0.85rem">Nenhum histórico ainda.</p>';
    }

    keys.forEach(key => {
      const meta  = history[key];
      const [y, m] = key.split('-');
      const label = new Date(Number(y), Number(m) - 1, 1)
        .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <div>
          <div class="history-month">${label.charAt(0).toUpperCase() + label.slice(1)}</div>
          <div class="history-meta">Renda: ${formatBRL(meta.renda)} • Livre: ${formatBRL(meta.renda - (meta.totalFixo + meta.totalCaixa + meta.totalCompras))}</div>
        </div>
        <span style="color:var(--text-3);font-size:1.1rem">›</span>
      `;
      div.addEventListener('click', () => {
        State.loadMonth(key);
        renderAll();
        Lancamentos.render();
        closeModal('modal-history');
        toast(`Carregado: ${label}`, 'info');
      });
      listEl.appendChild(div);
    });

    openModal('modal-history');
  }

  // ── Modal helpers ─────────────────────────────────────────

  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.removeAttribute('hidden');
    el.querySelector('input, button')?.focus();
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('hidden', '');
  }

  // ── Add Item Modal ────────────────────────────────────────

  function openAddItemModal(section) {
    document.getElementById('add-item-target').value = section;
    document.getElementById('add-item-name').value   = '';
    document.getElementById('add-item-value').value  = '';
    document.getElementById('add-item-emoji').value  = '';

    const titles = { fixo: 'Nova Despesa Fixa', caixinhas: 'Nova Caixinha', compras: 'Novo Item para Comprar' };
    document.getElementById('add-item-title').textContent = titles[section] || 'Novo Item';

    openModal('modal-add-item');
    document.getElementById('add-item-name').focus();
  }

  function confirmAddItem() {
    const section = document.getElementById('add-item-target').value;
    const name    = document.getElementById('add-item-name').value.trim();
    const value   = parseFloat(document.getElementById('add-item-value').value) || 0;
    const emoji   = document.getElementById('add-item-emoji').value.trim().slice(0, 2);

    if (!name) {
      toast('Informe o nome do item', 'warn');
      document.getElementById('add-item-name').focus();
      return;
    }

    State.addItem(section, { name, value, emoji });
    closeModal('modal-add-item');
    toast(`"${name}" adicionado`, 'success');
  }

  // ── Utils ─────────────────────────────────────────────────

  function _setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  }

  function _getVal(id) {
    return document.getElementById(id)?.value?.trim() || '';
  }

  function _escape(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ── Public API ────────────────────────────────────────────

  return {
    toast,
    setSyncState,
    renderAll,
    renderRenda,
    renderBar,
    renderLivre,
    renderSection,
    renderAppTitle,
    renderSectionTitles,
    openSettingsModal,
    applyAccentColor,
    openHistoryModal,
    openModal,
    closeModal,
    openAddItemModal,
    confirmAddItem,
    formatBRL,
  };

})();