// ==================== UTILITÁRIOS ====================


// ---------- Segurança de renderização ----------
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[ch]));
}
const h = escapeHtml;

function safeExternalUrl(value) {
    try {
        const url = new URL(String(value || ''), window.location.origin);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
    } catch (_) {
        return '#';
    }
}

function encodedJsArg(value) {
    return encodeURIComponent(String(value ?? ''));
}

function setSafeText(element, value) {
    if (element) element.textContent = String(value ?? '');
}

function setOptions(selectEl, rows, formatter, keepValue = false) {
    if (!selectEl) return;
    const previous = keepValue ? selectEl.value : null;
    selectEl.replaceChildren();
    rows.forEach(row => {
        const opt = document.createElement('option');
        const data = formatter(row);
        opt.value = data.value;
        opt.textContent = data.label;
        if (keepValue && String(data.value) === String(previous)) opt.selected = true;
        selectEl.appendChild(opt);
    });
}

// ---------- Toast notification ----------
function showToast(msg, type = 'success') {
    const container = document.getElementById('toastContainer') || document.body;
    const toastEl = document.createElement('div');
    const tone = /erro|falha|❌/i.test(msg) ? 'danger' : /atenção|aviso|⚠️/i.test(msg) ? 'warning' : type;
    toastEl.className = `toast align-items-center border-0 text-bg-${tone}`;
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');
    toastEl.innerHTML = `<div class="d-flex"><div class="toast-body"></div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Fechar"></button></div>`;
    toastEl.querySelector('.toast-body').textContent = msg;
    container.appendChild(toastEl);
    if (window.bootstrap?.Toast) {
        const toast = new bootstrap.Toast(toastEl, { delay: 2800 });
        toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
        toast.show();
    } else {
        toastEl.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9999;padding:12px 16px;background:#172033;color:white;border-radius:10px';
        setTimeout(() => toastEl.remove(), 2800);
    }
}

// ---------- Modal ----------
let _genericBootstrapModal = null;

// Atalho usado por sprint5.js (Anexos): seta título + corpo e abre o modal genérico.
function showModal(title, body) {
    const t = document.getElementById('modalTitle');
    const b = document.getElementById('modalBody');
    if (t) t.innerHTML = title;
    if (b) b.innerHTML = body;
    openModal();
}

function openModal() {
    const el = document.getElementById('modal');
    if (!el) return;
    if (window.bootstrap?.Modal) {
        _genericBootstrapModal = bootstrap.Modal.getOrCreateInstance(el, { backdrop: true, keyboard: true });
        _genericBootstrapModal.show();
    } else {
        el.style.display = 'block';
        el.classList.add('show');
    }
}

function closeModal() {
    const el = document.getElementById('modal');
    if (!el) return;
    if (window.bootstrap?.Modal) {
        (bootstrap.Modal.getInstance(el) || _genericBootstrapModal)?.hide();
    } else {
        el.style.display = 'none';
        el.classList.remove('show');
    }
}

// ---------- Debounce ----------
let _calcDebounceTimer = null;
function debouncedCalc() {
    clearTimeout(_calcDebounceTimer);
    _calcDebounceTimer = setTimeout(updatePriceCalculation, 400);
}

// ---------- Tab switching ----------
function switchTab(tabId, event) {
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.remove('active', 'd-block');
        panel.classList.add('d-none');
    });
    document.querySelectorAll('.nav-item.tab-btn').forEach(button => button.classList.remove('active'));

    const targetPanel = document.getElementById(tabId);
    if (!targetPanel) return;
    targetPanel.classList.remove('d-none');
    targetPanel.classList.add('active', 'd-block');

    const btn = event?.currentTarget ?? event?.target?.closest?.('.tab-btn');
    if (btn) btn.classList.add('active');

    const sidebar = document.getElementById('appSidebar');
    if (sidebar && window.innerWidth < 992 && window.bootstrap?.Offcanvas) {
        bootstrap.Offcanvas.getInstance(sidebar)?.hide();
    }

    if (tabId === 'orders')     { loadOrders(); if (typeof renderPrintQueue === 'function') renderPrintQueue(); }
    if (tabId === 'production') { if (typeof loadProductionBoard === 'function') loadProductionBoard(); }
    if (tabId === 'finance')    { if (typeof loadFinanceDashboard === 'function') loadFinanceDashboard(); }
    if (tabId === 'consignments') { if (typeof loadConsignments === 'function') loadConsignments(); }
    if (tabId === 'products')   loadProducts();
    if (tabId === 'marketplaces') loadMarketplaces();
    if (tabId === 'clients')    loadClients();
    if (tabId === 'inventory')  loadMaterials();
    if (tabId === 'printers')   loadPrinters();
    if (tabId === 'packaging')  loadPackaging();
    if (tabId === 'addons')     loadAddons();
    if (tabId === 'calculator') {
        if (typeof initDeliveryType === 'function') initDeliveryType();
        if (typeof initCalculatorLivePreview === 'function') initCalculatorLivePreview();
        else if (typeof updatePriceCalculation === 'function') updatePriceCalculation();
    }
    if (tabId === 'insights')   { if (typeof loadInsights === 'function') loadInsights(); }
    if (tabId === 'settings') {
        if (typeof loadMelhorEnvioConfig === 'function') loadMelhorEnvioConfig();
    }
    if (tabId === 'expenses')    { if (typeof loadExpenses    === 'function') loadExpenses(); }
    if (tabId === 'maintenance') { if (typeof loadMaintenance === 'function') loadMaintenance(); }
    if (typeof Phase2UI !== 'undefined') Phase2UI.updateBadge();
    if (tabId === 'dashboard') {
        updateDashboard();
        updateStatsBar();
        updateAlertSystem();
    }
}

// ---------- Event listeners da calculadora e configurações ----------
let _settingsDebounceTimer = null;
function debouncedSaveSettings() {
    clearTimeout(_settingsDebounceTimer);
    _settingsDebounceTimer = setTimeout(saveSettings, 350);
}

function setupEventListeners() {
    // Inputs numéricos: debounce para não travar enquanto digita
    const calcInputs = [
        'calcWeight', 'calcPrintTime', 'calcQuantity',
        'calcCustomFee', 'calcDesignFee', 'calcFinishFee', 'calcBulkDiscount',
        'calcSetupTime', 'calcSupportTime', 'calcSandingTime',
        'calcPaintingTime', 'calcAssemblyTime', 'calcServiceTime',
        'calcPlatformFee', 'calcUrgencyMarkup',
        'calcDestCep', 'calcBoxLength', 'calcBoxWidth', 'calcBoxHeight'
    ];
    calcInputs.forEach(id => {
        document.getElementById(id)?.addEventListener('input', debouncedCalc);
    });
    // Selects: recálculo imediato
    ['calcWorkType', 'calcPrinter', 'calcMaterial', 'calcDifficulty', 'calcPackaging'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', updatePriceCalculation);
    });

    // Salvar configurações automaticamente durante a edição e gravar imediatamente ao sair do campo
    [
        'settingEnergyPrice', 'settingHourlyRate', 'settingProfitMargin',
        'settingLossRate', 'settingPackagingCost',
        'settingMaintenancePerHour', 'settingFailRate', 'settingTaxRate',
        'settingMonthlyGoal', 'settingAlertDays',
        'settingBrandName', 'settingQuoteValidityDays',
    ].forEach(id => {
        const el = document.getElementById(id);
        el?.addEventListener('input', debouncedSaveSettings);
        el?.addEventListener('change', saveSettingsNow);
    });

    // Bootstrap gerencia clique no backdrop e tecla ESC.
    const modalEl = document.getElementById('modal');
    modalEl?.addEventListener('hidden.bs.modal', () => {
        const body = document.getElementById('modalBody');
        if (body) body.innerHTML = '';
    });

    // Inicializa embalagens e adicionais na calculadora
    if (typeof refreshPackagingSelect === 'function') refreshPackagingSelect();
    if (typeof refreshAddonsChecklist === 'function')  refreshAddonsChecklist();

    // Calcular preço inicial
    updatePriceCalculation();
}

// ---------- Backup / Restore ----------
function backupData() {
    // Exporta o banco SQLite como binário (mais confiável que JSON)
    const data = db.export();
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `backup_3dprint_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.sqlite`;
    link.click();
    showToast('✅ Backup exportado!');
}

function restoreBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.sqlite,.db';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const buffer = await file.arrayBuffer();
        const SQL = await initSqlJs({
            locateFile: f => `js/${f}`
        });
        db = new SQL.Database(new Uint8Array(buffer));
        persistDB();
        loadSettings();
        loadClients();
        loadMaterials();
        loadPrinters();
        loadOrders();
        if (typeof loadProducts === 'function') loadProducts();
        if (typeof loadMarketplaces === 'function') loadMarketplaces();
        if (typeof loadMaintenance === 'function') loadMaintenance();
        if (typeof loadExpenses === 'function') loadExpenses();
        if (typeof loadQuotes === 'function') loadQuotes();
        updateDashboard();
        updateStatsBar();
        updateAlertSystem();
        showToast('✅ Backup restaurado com sucesso!');
    };
    input.click();
}

// ---------- Orçamento compartilhável (HTML autônomo para celular) ----------

// Extrai a construção do HTML em função reutilizável
function buildShareableHTML() {
    const p = calculatePrice();
    if (!p) return null;

    var filamentRows = '';
    if (p.filamentBreakdown && p.filamentBreakdown.length > 1) {
        p.filamentBreakdown.forEach(function(b) {
            filamentRows += '<tr><td style="padding-left:16px;color:#555;">' + b.label + ' (' + b.weight.toFixed(1) + 'g)</td>'
                + '<td style="text-align:right">R$ ' + b.cost.toFixed(2) + '</td></tr>';
        });
    }
    var badgeList = [];
    if (p.failRate > 0)       badgeList.push('Cobertura de falhas ' + (p.failRate*100).toFixed(0) + '%');
    if (p.urgencyPct > 0)     badgeList.push('Urgência +' + p.urgencyPct + '%');
    if (p.platformFeePct > 0) badgeList.push('Taxa marketplace ' + (p.platformFeePct*100).toFixed(0) + '%');
    if (p.bulkDiscount > 0)   badgeList.push('Desconto lote −' + (p.bulkDiscount*100).toFixed(0) + '%');
    var shipLabel = 'Frete estimado';
    if (p.shippingInfo) shipLabel = p.shippingInfo.source === 'melhor_envio'
        ? 'Frete Melhor Envio — ' + p.shippingInfo.region
        : 'Frete ' + p.shippingInfo.uf + '/' + p.shippingInfo.region;
    var now = new Date();
    var validity = new Date(now);
    validity.setDate(validity.getDate() + 15);

    return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>Orçamento — ' + now.toLocaleDateString('pt-BR') + '</title>'
        + '<style>'
        + '*{box-sizing:border-box;margin:0;padding:0}'
        + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f5;color:#222;padding:16px}'
        + '.card{background:#fff;border-radius:14px;padding:20px;margin-bottom:14px;box-shadow:0 2px 8px rgba(0,0,0,.08)}'
        + '.brand{color:#00AE42;font-size:1.3em;font-weight:800}'
        + '.price-box{background:#00AE42;color:#fff;border-radius:12px;padding:18px;text-align:center;margin-bottom:14px}'
        + '.price-box .label{font-size:.85em;opacity:.88}'
        + '.price-box .value{font-size:2em;font-weight:900;letter-spacing:-1px}'
        + '.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:.88em}'
        + '.row:last-child{border:none}'
        + '.row .lbl{color:#555}'
        + '.row .val{font-weight:600}'
        + '.section{font-weight:700;font-size:.8em;text-transform:uppercase;color:#00AE42;padding:10px 0 4px;letter-spacing:.5px}'
        + '.badge{display:inline-block;background:#e8f5e9;color:#1a5c2a;border:1px solid #a8d5b5;border-radius:20px;padding:3px 10px;font-size:.75em;margin:2px}'
        + '.footer{text-align:center;color:#999;font-size:.75em;margin-top:8px}'
        + '.total-row .val{color:#00AE42;font-size:1.1em}'
        + '</style></head><body>'
        + '<div class="card">'
        + '<div class="brand">🖨️ 3D Print Pro</div>'
        + '<div style="color:#888;font-size:.82em;margin-top:2px;">Orçamento gerado em ' + now.toLocaleString('pt-BR') + '</div>'
        + '</div>'
        + '<div class="price-box">'
        + '<div class="label">💰 Total a pagar</div>'
        + '<div class="value">R$ ' + p.totalWithShipping.toFixed(2).replace('.',',') + '</div>'
        + '<div style="font-size:.8em;opacity:.85;margin-top:4px;">' + p.quantity + 'x · Frete incluído</div>'
        + '</div>'
        + '<div class="card">'
        + '<div class="section">Detalhes do projeto</div>'
        + '<div class="row"><span class="lbl">Tipo</span><span class="val">' + p.workTypeLabel + '</span></div>'
        + '<div class="row"><span class="lbl">Material</span><span class="val">' + p.materialLabel + '</span></div>'
        + '<div class="row"><span class="lbl">Peso</span><span class="val">' + p.weight.toFixed(1) + 'g</span></div>'
        + '<div class="row"><span class="lbl">Tempo de impressão</span><span class="val">' + p.printTimeHuman + '</span></div>'
        + '<div class="row"><span class="lbl">Quantidade</span><span class="val">' + p.quantity + 'x</span></div>'
        + '</div>'
        + '<div class="card">'
        + '<div class="section">Composição do preço</div>'
        + '<div class="row"><span class="lbl">Preço unitário</span><span class="val">R$ ' + p.finalPrice.toFixed(2) + '</span></div>'
        + (p.platformFeePct > 0 ? '<div class="row"><span class="lbl">Taxa marketplace</span><span class="val" style="color:#e53e3e;">−R$ ' + p.platformFeeAmount.toFixed(2) + '</span></div>' : '')
        + (p.bulkDiscount > 0 ? '<div class="row"><span class="lbl">Desconto por lote</span><span class="val" style="color:#e53e3e;">−R$ ' + (p.priceBeforeDiscount * p.bulkDiscount).toFixed(2) + '</span></div>' : '')
        + '<div class="row"><span class="lbl">Subtotal (' + p.quantity + 'x)</span><span class="val">R$ ' + p.totalPrice.toFixed(2) + '</span></div>'
        + '<div class="row"><span class="lbl">' + shipLabel + '</span><span class="val">R$ ' + p.shippingCost.toFixed(2) + '</span></div>'
        + '<div class="row total-row"><span class="lbl"><strong>TOTAL</strong></span><span class="val"><strong>R$ ' + p.totalWithShipping.toFixed(2) + '</strong></span></div>'
        + '</div>'
        + (badgeList.length ? '<div class="card">' + badgeList.map(function(b){return '<span class="badge">'+b+'</span>';}).join('') + '</div>' : '')
        + '<div class="footer">'
        + '<p>Validade: ' + validity.toLocaleDateString('pt-BR') + ' · Gerado por 3D Print Pro</p>'
        + '</div></body></html>';
}

// ── Orçamento para o cliente (sem expor custos internos) ──────────────────────

function buildClientQuoteHTML() {
    const p = calculatePrice();
    if (!p) return null;

    const now = new Date();
    const validity = new Date(now);
    const validityDays = parseInt((typeof currentSettings !== 'undefined' && currentSettings.quoteValidityDays) || 15);
    validity.setDate(validity.getDate() + (isNaN(validityDays) ? 15 : validityDays));

    const brandName = (typeof currentSettings !== 'undefined' && currentSettings.brandName) || '3D Print Pro';
    const itemDesc = (document.getElementById('calcItemDescription')?.value || '').trim();

    var shipLabel = 'Frete';
    if (p.shippingInfo) {
        shipLabel = p.shippingInfo.source === 'melhor_envio'
            ? 'Frete ' + p.shippingInfo.region + (p.shippingInfo.deliveryDays ? ' (' + p.shippingInfo.deliveryDays + ' dias úteis)' : '')
            : 'Frete ' + p.shippingInfo.uf + '/' + p.shippingInfo.region + (p.shippingInfo.deliveryDays ? ' (' + p.shippingInfo.deliveryDays + ' dias úteis)' : '');
    }

    const fmt = function(v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ','); };

    var rows = '';
    rows += '<div class="row"><span class="lbl">Quantidade</span><span class="val">' + p.quantity + 'x</span></div>';
    rows += '<div class="row"><span class="lbl">Preço unitário</span><span class="val">' + fmt(p.finalPrice) + '</span></div>';
    if (p.bulkDiscount > 0) {
        rows += '<div class="row"><span class="lbl">Desconto por quantidade</span><span class="val disc">−' + (p.bulkDiscount * 100).toFixed(0) + '%</span></div>';
    }
    if (p.urgencyPct > 0) {
        rows += '<div class="row"><span class="lbl">Entrega urgente</span><span class="val">+' + p.urgencyPct + '%</span></div>';
    }
    rows += '<div class="row"><span class="lbl">Subtotal</span><span class="val">' + fmt(p.totalPrice) + '</span></div>';
    rows += '<div class="row"><span class="lbl">' + shipLabel + '</span><span class="val">' + fmt(p.shippingCost) + '</span></div>';
    rows += '<div class="row total-row"><span class="lbl"><strong>Total</strong></span><span class="val"><strong>' + fmt(p.totalWithShipping) + '</strong></span></div>';

    return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>Orçamento — ' + brandName + '</title>'
        + '<style>'
        + '*{box-sizing:border-box;margin:0;padding:0}'
        + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f0f4f0;color:#1a1a1a;padding:16px;max-width:480px;margin:0 auto}'
        + '.card{background:#fff;border-radius:16px;padding:20px;margin-bottom:14px;box-shadow:0 2px 12px rgba(0,0,0,.07)}'
        + '.brand{color:#00AE42;font-size:1.25em;font-weight:800;letter-spacing:-0.5px}'
        + '.date{color:#888;font-size:.78em;margin-top:3px}'
        + '.price-box{background:linear-gradient(135deg,#00AE42,#007a30);color:#fff;border-radius:16px;padding:22px;text-align:center;margin-bottom:14px;box-shadow:0 4px 16px rgba(0,174,66,.3)}'
        + '.price-box .label{font-size:.82em;opacity:.9;letter-spacing:.5px;text-transform:uppercase}'
        + '.price-box .value{font-size:2.4em;font-weight:900;letter-spacing:-2px;margin:6px 0}'
        + '.price-box .sub{font-size:.8em;opacity:.85}'
        + '.section{font-weight:700;font-size:.75em;text-transform:uppercase;color:#00AE42;padding:10px 0 6px;letter-spacing:.8px}'
        + '.row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f2f2f2;font-size:.9em}'
        + '.row:last-child{border:none}'
        + '.lbl{color:#555}'
        + '.val{font-weight:600;color:#1a1a1a}'
        + '.val.disc{color:#d97706}'
        + '.total-row{padding-top:12px;margin-top:4px}'
        + '.total-row .val strong{color:#00AE42;font-size:1.12em}'
        + '.validity{text-align:center;font-size:.75em;color:#999;margin-top:4px;line-height:1.6}'
        + '.pix-hint{background:#e8f5e9;border:1px solid #a8d5b5;border-radius:10px;padding:10px 14px;font-size:.82em;color:#1a5c2a;line-height:1.5}'
        + '</style></head><body>'

        + '<div class="card">'
        + '<div class="brand">🖨️ ' + brandName + '</div>'
        + '<div class="date">Orçamento gerado em ' + now.toLocaleString('pt-BR') + '</div>'
        + '</div>'

        + '<div class="price-box">'
        + '<div class="label">💰 Total a pagar</div>'
        + '<div class="value">' + fmt(p.totalWithShipping) + '</div>'
        + '<div class="sub">' + p.quantity + (p.quantity > 1 ? ' peças' : ' peça') + ' · Frete incluído</div>'
        + '</div>'

        + (itemDesc ? '<div class="card"><div class="section">Item</div><div style="font-size:.93em;color:#1a1a1a;padding:4px 0;">' + itemDesc.replace(/</g,'&lt;') + '</div></div>' : '')
        + '<div class="card">'
        + '<div class="section">Resumo do pedido</div>'
        + rows
        + '</div>'

        + '<div class="card">'
        + '<div class="pix-hint">📅 <strong>Validade deste orçamento:</strong> ' + validity.toLocaleDateString('pt-BR') + '<br>'
        + 'Para confirmar o pedido, entre em contato respondendo esta mensagem.</div>'
        + '</div>'

        + '<div class="validity">Gerado por ' + brandName + ' · Impressão 3D</div>'
        + '</body></html>';
}

async function shareClientQuote() {
    const html = buildClientQuoteHTML();
    if (!html) return;
    const now = new Date();
    const filename = 'orcamento_cliente_' + now.toISOString().slice(0, 10) + '.html';
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const file = new File([blob], filename, { type: 'text/html' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: 'Orçamento', text: 'Segue o orçamento conforme solicitado.' });
            return;
        } catch (e) {
            if (e.name === 'AbortError') return;
        }
    }
    // Fallback: download direto
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(a.href); }, 30000);
    showToast('✅ Orçamento para cliente gerado! Envie pelo WhatsApp ou e-mail.');
}

function buildWhatsAppText() {
    const p = calculatePrice();
    if (!p) return null;

    const brandName = (typeof currentSettings !== 'undefined' && currentSettings.brandName) || '';
    const validityDays = parseInt((typeof currentSettings !== 'undefined' && currentSettings.quoteValidityDays) || 15);
    const validity = new Date();
    validity.setDate(validity.getDate() + (isNaN(validityDays) ? 15 : validityDays));
    const validityStr = validity.toLocaleDateString('pt-BR');

    const itemDesc = (document.getElementById('calcItemDescription')?.value || '').trim();
    const fmt = function(v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ','); };

    const shipLabel = p.shippingInfo
        ? ('Frete ' + (p.shippingInfo.region || p.shippingInfo.uf || ''))
        : 'Frete';

    var lines = [];
    if (brandName) lines.push('🖨️ *' + brandName + '*');
    lines.push('');
    if (itemDesc) lines.push('📦 *' + itemDesc + '*');
    lines.push('');
    lines.push('Quantidade: *' + p.quantity + 'x*');
    lines.push('Preço unitário: *' + fmt(p.finalPrice) + '*');
    if (p.bulkDiscount > 0) lines.push('Desconto por quantidade: *−' + (p.bulkDiscount * 100).toFixed(0) + '%*');
    if (p.urgencyPct > 0)   lines.push('Urgência: *+' + p.urgencyPct + '%*');
    lines.push('Subtotal: ' + fmt(p.totalPrice));
    lines.push(shipLabel + ': ' + fmt(p.shippingCost));
    lines.push('');
    lines.push('💰 *Total: ' + fmt(p.totalWithShipping) + '*');
    lines.push('');
    lines.push('_Válido até ' + validityStr + '. Responda para confirmar o pedido._');

    return lines.join('\n');
}

async function copyWhatsAppQuote() {
    const text = buildWhatsAppText();
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        showToast('✅ Mensagem copiada! Cole no WhatsApp.');
    } catch (e) {
        // fallback legado
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('✅ Mensagem copiada! Cole no WhatsApp.');
    }
}

// ── Exportação interna (breakdown completo) ───────────────────────────────────

function downloadShareableHTML(html) {
    if (!html) html = buildShareableHTML();
    if (!html) return;
    var now = new Date();
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'orcamento_' + now.toISOString().slice(0,10) + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 30000);
    showToast('✅ HTML gerado! Envie o arquivo pelo WhatsApp ou e-mail.');
}

async function shareQuoteNative() {
    const html = buildShareableHTML();
    if (!html) return;
    const now = new Date();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const file = new File([blob], 'orcamento_' + now.toISOString().slice(0,10) + '.html', { type: 'text/html' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: 'Orçamento 3D Print' });
            return;
        } catch (e) {
            if (e.name === 'AbortError') return; // Usuário cancelou
        }
    }
    // Fallback: download direto
    downloadShareableHTML(html);
}

function generateShareableHTML() {
    downloadShareableHTML();
}

// ---------- Exportar orçamento como PDF (impressão) ----------
function generatePDF() {
    const p = calculatePrice();

    // Filament breakdown (AMS / multi-material)
    var filamentRows = '';
    if (p.filamentBreakdown && p.filamentBreakdown.length > 1) {
        p.filamentBreakdown.forEach(function(b) {
            filamentRows += '<tr><td style="padding-left:20px">' + b.label + ' (' + b.weight.toFixed(1) + 'g)</td>'
                + '<td style="text-align:right">R$ ' + b.cost.toFixed(2) + '</td></tr>';
        });
        if (p.purgeFilamentCost > 0) {
            filamentRows += '<tr><td style="padding-left:20px">Purge / wipe tower</td>'
                + '<td style="text-align:right">R$ ' + p.purgeFilamentCost.toFixed(2) + '</td></tr>';
        }
    }

    var addonsLabel = typeof getSelectedAddonsLabel === 'function' ? getSelectedAddonsLabel() : '';

    var badgeList = [];
    if (p.failRate > 0) badgeList.push('Falha ' + (p.failRate * 100).toFixed(0) + '%');
    if (p.urgencyPct > 0) badgeList.push('Urgencia +' + p.urgencyPct + '%');
    if (p.platformFeePct > 0) badgeList.push('Taxa plataforma ' + (p.platformFeePct * 100).toFixed(0) + '%');
    if (p.bulkDiscount > 0) badgeList.push('Desconto lote ' + (p.bulkDiscount * 100).toFixed(0) + '%');
    if (p.isAbrasive) badgeList.push('Material abrasivo');

    var shipLabel = 'Frete estimado';
    if (p.shippingInfo) {
        if (p.shippingInfo.source === 'melhor_envio') {
            shipLabel = 'Frete Melhor Envio - ' + p.shippingInfo.region;
            if (p.shippingInfo.deliveryDays) shipLabel += ' (' + p.shippingInfo.deliveryDays + ' dias)';
        } else {
            shipLabel = 'Frete ' + p.shippingInfo.uf + '/' + p.shippingInfo.region;
            if (p.shippingInfo.deliveryDays) shipLabel += ' (' + p.shippingInfo.deliveryDays + ' dias)';
        }
    }

    var html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'
        + '<title>Orcamento 3D Print - ' + new Date().toLocaleDateString('pt-BR') + '</title>'
        + '<style>'
        + 'body{font-family:Arial,sans-serif;padding:40px;max-width:720px;margin:0 auto;color:#222}'
        + '.logo{font-size:22px;font-weight:bold;color:#00AE42;text-align:center;margin-bottom:4px}'
        + '.sub{text-align:center;color:#555;font-size:14px;margin-bottom:20px}'
        + 'table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px}'
        + 'th,td{padding:8px 10px;border:1px solid #ddd;vertical-align:top}'
        + 'th{background:#00AE42;color:#fff;text-align:left}'
        + '.section{background:#f0f9f4;font-weight:bold}'
        + '.total-row{background:#00AE42;color:#fff;font-size:16px;font-weight:bold}'
        + '.badge{display:inline-block;background:#e8f5e9;border:1px solid #00AE42;border-radius:10px;padding:2px 8px;font-size:11px;margin:2px;color:#1a5c2a}'
        + '.footer{margin-top:30px;text-align:center;font-size:11px;color:#888}'
        + '@media print{button{display:none}}'
        + '</style></head><body>'
        + '<div class="logo">Impressora 3D Print Pro</div>'
        + '<div class="sub">Orcamento de Impressao 3D</div>'
        + '<p><strong>Data:</strong> ' + new Date().toLocaleString('pt-BR') + '&emsp;'
        + '<strong>Tipo:</strong> ' + p.workTypeLabel + '&emsp;'
        + '<strong>Qtd:</strong> ' + p.quantity + 'x</p>'
        + '<p><strong>Material:</strong> ' + p.materialLabel + '&emsp;'
        + '<strong>Impressora:</strong> ' + (p.printerName || '-') + '</p>'
        + '<p><strong>Peso:</strong> ' + p.weight.toFixed(1) + 'g&emsp;'
        + '<strong>Tempo:</strong> ' + p.printTimeHuman + ' (' + p.printTime.toFixed(2) + 'h)</p>';

    if (badgeList.length) {
        html += '<p>' + badgeList.map(function(b){ return '<span class="badge">' + b + '</span>'; }).join(' ') + '</p>';
    }

    html += '<table>'
        + '<tr><th>Descricao</th><th style="width:110px;text-align:right">Valor</th></tr>'
        + '<tr class="section"><td colspan="2">Custos de producao</td></tr>'
        + '<tr><td>Material (c/ ' + (parseFloat(currentSettings.lossRate) || 10) + '% de perdas)</td><td style="text-align:right">R$ ' + p.materialCost.toFixed(2) + '</td></tr>'
        + filamentRows
        + '<tr><td>Maquina: ' + p.printTimeHuman + ' x R$ ' + p.machineHourCost.toFixed(4) + '/h</td><td style="text-align:right">R$ ' + p.machineCost.toFixed(2) + '</td></tr>'
        + '<tr><td>  Depreciacao</td><td style="text-align:right">R$ ' + p.depreciationCost.toFixed(2) + '</td></tr>'
        + '<tr><td>  Manutencao/consumiveis</td><td style="text-align:right">R$ ' + p.maintenanceCost.toFixed(2) + '</td></tr>'
        + '<tr><td>  Energia eletrica</td><td style="text-align:right">R$ ' + p.energyCost.toFixed(2) + '</td></tr>';

    if (p.totalLaborMin > 0) html += '<tr><td>Mao de obra (' + p.totalLaborMin + ' min)</td><td style="text-align:right">R$ ' + p.laborCost.toFixed(2) + '</td></tr>';
    if (p.serviceFees > 0)   html += '<tr><td>Taxas de servico/design</td><td style="text-align:right">R$ ' + p.serviceFees.toFixed(2) + '</td></tr>';
    if (p.difficultyCost > 0) html += '<tr><td>Dificuldade x' + p.difficulty + '</td><td style="text-align:right">R$ ' + p.difficultyCost.toFixed(2) + '</td></tr>';

    html += '<tr><td>Embalagem</td><td style="text-align:right">R$ ' + p.packagingCost.toFixed(2) + '</td></tr>';
    if (p.addonsCost > 0) html += '<tr><td>Adicionais' + (addonsLabel ? ' (' + addonsLabel + ')' : '') + '</td><td style="text-align:right">R$ ' + p.addonsCost.toFixed(2) + '</td></tr>';

    html += '<tr class="section"><td>Custo de producao / unidade</td><td style="text-align:right">R$ ' + p.productionCost.toFixed(2) + '</td></tr>'
        + '<tr><td>Cobertura de falhas (' + (p.failRate * 100).toFixed(0) + '%)</td><td style="text-align:right">R$ ' + p.costWithFail.toFixed(2) + '</td></tr>'
        + '<tr class="section"><td colspan="2">Precificacao</td></tr>'
        + '<tr><td>Margem de lucro (' + (p.profitMarkup * 100).toFixed(0) + '%)</td><td style="text-align:right">R$ ' + (p.costWithFail * p.profitMarkup).toFixed(2) + '</td></tr>';

    if (p.bulkDiscount > 0) html += '<tr><td>Desconto por lote (-' + (p.bulkDiscount * 100).toFixed(0) + '%)</td><td style="text-align:right;color:#c00">-R$ ' + (p.priceBeforeDiscount * p.bulkDiscount).toFixed(2) + '</td></tr>';
    if (p.urgencyPct > 0)   html += '<tr><td>Urgencia (+' + p.urgencyPct + '%)</td><td style="text-align:right;color:#007a00">+R$ ' + (p.receivedPerUnit - p.priceBeforeDiscount * (1 - p.bulkDiscount)).toFixed(2) + '</td></tr>';

    html += '<tr><td>Preco unitario cobrado</td><td style="text-align:right">R$ ' + p.finalPrice.toFixed(2) + '</td></tr>';
    if (p.platformFeePct > 0) html += '<tr><td>Taxa plataforma (-' + (p.platformFeePct * 100).toFixed(0) + '%)</td><td style="text-align:right;color:#c00">-R$ ' + p.platformFeeAmount.toFixed(2) + '</td></tr>'
        + '<tr><td>Voce recebe por unidade</td><td style="text-align:right">R$ ' + p.receivedPerUnit.toFixed(2) + '</td></tr>';

    html += '<tr><td><strong>Subtotal (' + p.quantity + 'x)</strong></td><td style="text-align:right"><strong>R$ ' + p.totalPrice.toFixed(2) + '</strong></td></tr>'
        + '<tr><td>' + shipLabel + '</td><td style="text-align:right">R$ ' + p.shippingCost.toFixed(2) + '</td></tr>'
        + '<tr class="total-row"><td>TOTAL COM FRETE</td><td style="text-align:right">R$ ' + p.totalWithShipping.toFixed(2) + '</td></tr>'
        + '</table>'
        + '<p style="font-size:12px;color:#555"><strong>Lucro bruto:</strong> R$ ' + p.grossProfit.toFixed(2);

    if (p.taxRate > 0) html += ' | <strong>Apos IR (' + (p.taxRate * 100).toFixed(0) + '%):</strong> R$ ' + p.netProfit.toFixed(2);

    html += '</p>'
        + '<div class="footer"><p>Validade do orcamento: 15 dias | Gerado por 3D Print Pro</p></div>'
        + '<br><button onclick="window.print()" style="padding:10px 20px;background:#00AE42;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">Imprimir / Salvar como PDF</button>'
        + '</body></html>';

    // Usa Blob URL para não depender de pop-ups desbloqueados.
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href   = url;
    a.target = '_blank';
    a.rel    = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
}
