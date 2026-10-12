/**
 * report.js
 * Geração do relatório financeiro mensal.
 * Exibe no modal e permite copiar como texto.
 * (Sem envio por e-mail — visualização no próprio app)
 */

const Report = (() => {

  // ── Gera HTML (modal) ─────────────────────────────────────

  function buildReportHTML() {
    const data  = State.getData();
    const calc  = State.getCalculated();
    const cfg   = State.getConfig();
    const mKey  = State.getMonthKey();
    const label = _monthLabel(mKey);
    const fmt   = UI.formatBRL;

    const userName = cfg.userName ? `de ${cfg.userName} ` : '';
    const livreClass = calc.livre < 0 ? 'danger' : 'ok';

    let html = `
      <div style="text-align:center;margin-bottom:4px;">
        <div style="font-size:0.75rem;font-family:var(--font-mono);letter-spacing:0.1em;text-transform:uppercase;color:var(--text-3);">
          Relatório ${userName}— ${label}
        </div>
      </div>

      <div class="report-summary">
        <div class="report-summary-row">
          <span>Renda total</span>
          <span class="val" style="font-family:var(--font-mono)">${fmt(calc.renda)}</span>
        </div>
        <div class="report-summary-row">
          <span>Comprometido</span>
          <span class="val" style="font-family:var(--font-mono)">${fmt(calc.totalGasto)}</span>
        </div>
        <div style="border-top:1px solid var(--border);margin:4px 0;"></div>
        <div class="report-summary-row highlight ${livreClass}">
          <span style="font-weight:700">Livre para gastar</span>
          <span class="val">${fmt(calc.livre)}</span>
        </div>
      </div>
    `;

    if (data.fixo.length)      html += _sectionHTML('🔒 Não pode gastar',    data.fixo,      fmt);
    if (data.caixinhas.length) html += _sectionHTML('📦 Caixinhas',          data.caixinhas, fmt);
    if (data.compras.length)   html += _sectionHTML('🛒 O que preciso comprar', data.compras, fmt);

    // Lançamentos
    const lancs = data.lancamentos || [];
    if (lancs.length) {
      const totais = Lancamentos.calcTotais(lancs);
      const receitas = lancs.filter(l => l.tipo === 'receita');
      const despesas = lancs.filter(l => l.tipo === 'despesa');

      html += `
        <div class="report-section">
          <div class="report-section-title">📝 Lançamentos — Saldo ${fmt(totais.saldo)}</div>
      `;
      if (receitas.length) {
        html += `<div class="report-item" style="background:rgba(52,211,153,0.06)"><span class="report-item-name" style="color:var(--success)">📥 Total Receitas</span><span class="report-item-val" style="color:var(--success)">${fmt(totais.totalReceita)}</span></div>`;
        receitas.forEach(l => {
          html += `<div class="report-item"><span class="report-item-name" style="padding-left:12px">↳ ${_esc(l.descricao)}${l.data ? ' · '+_fmtData(l.data):''}</span><span class="report-item-val">${fmt(l.valor)}</span></div>`;
        });
      }
      if (despesas.length) {
        html += `<div class="report-item" style="background:rgba(248,113,113,0.06)"><span class="report-item-name" style="color:var(--danger)">📤 Total Despesas</span><span class="report-item-val" style="color:var(--danger)">${fmt(totais.totalDespesa)}</span></div>`;
        despesas.forEach(l => {
          html += `<div class="report-item"><span class="report-item-name" style="padding-left:12px">↳ ${_esc(l.descricao)}${l.data ? ' · '+_fmtData(l.data):''}</span><span class="report-item-val">${fmt(l.valor)}</span></div>`;
        });
      }
      html += '</div>';
    }

    return html;
  }

  function _sectionHTML(title, items, fmt) {
    const total = items.reduce((acc, i) => acc + (parseFloat(i.value) || 0), 0);
    const rows  = items.map(i => `
      <div class="report-item">
        <span class="report-item-name">${i.emoji || ''} ${_esc(i.name)}</span>
        <span class="report-item-val">${fmt(i.value)}</span>
      </div>
    `).join('');

    return `
      <div class="report-section">
        <div class="report-section-title">${title} — ${fmt(total)}</div>
        ${rows}
      </div>
    `;
  }

  // ── Gera texto plano (copiar) ─────────────────────────────

  function buildReportText() {
    const data  = State.getData();
    const calc  = State.getCalculated();
    const cfg   = State.getConfig();
    const mKey  = State.getMonthKey();
    const label = _monthLabel(mKey).toUpperCase();
    const fmt   = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
    const line  = '─'.repeat(36);
    const name  = cfg.userName ? `${cfg.userName} — ` : '';

    let txt = `${name}Relatório Financeiro\n${label}\n${line}\n\n`;
    txt += `💰 RENDA:        ${fmt(calc.renda)}\n`;
    txt += `📤 COMPROMETIDO: ${fmt(calc.totalGasto)}\n`;
    txt += `✅ LIVRE:        ${fmt(calc.livre)}\n\n`;

    if (data.fixo.length) {
      txt += `🔒 NÃO PODE GASTAR\n`;
      data.fixo.forEach(i => { txt += `   ${i.emoji || '•'} ${i.name}: ${fmt(i.value)}\n`; });
      txt += `   Total: ${fmt(calc.totalFixo)}\n\n`;
    }

    if (data.caixinhas.length) {
      txt += `📦 CAIXINHAS\n`;
      data.caixinhas.forEach(i => { txt += `   ${i.emoji || '•'} ${i.name}: ${fmt(i.value)}\n`; });
      txt += `   Total: ${fmt(calc.totalCaixa)}\n\n`;
    }

    if (data.compras.length) {
      txt += `🛒 O QUE PRECISO COMPRAR\n`;
      data.compras.forEach(i => { txt += `   ${i.emoji || '•'} ${i.name}: ${fmt(i.value)}\n`; });
      txt += `   Total: ${fmt(calc.totalCompras)}\n\n`;
    }

    txt += `${line}\nGerado em ${new Date().toLocaleString('pt-BR')}`;
    return txt;
  }

  // ── Abrir modal ───────────────────────────────────────────

  function openReportModal() {
    const bodyEl = document.getElementById('report-body');
    if (bodyEl) bodyEl.innerHTML = buildReportHTML();
    UI.openModal('modal-report');
  }

  // ── Copiar para área de transferência ─────────────────────

  async function copyReport() {
    const text = buildReportText();
    try {
      await navigator.clipboard.writeText(text);
      UI.toast('Relatório copiado!', 'success');
    } catch {
      // Fallback para navegadores sem Clipboard API
      const ta = Object.assign(document.createElement('textarea'), {
        value: text,
        style: 'position:fixed;opacity:0',
      });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      UI.toast('Relatório copiado!', 'success');
    }
  }

  // ── Utils ─────────────────────────────────────────────────

  function _monthLabel(mKey) {
    const [y, m] = mKey.split('-');
    const s = new Date(Number(y), Number(m) - 1, 1)
      .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function _esc(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _fmtData(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  // ── Public API ────────────────────────────────────────────

  return {
    openReportModal,
    copyReport,
    buildReportHTML,
  };

})();