// ==================== ORÇAMENTOS ====================

let quotesCurrentPage = 1;
const QUOTES_PAGE_SIZE = 50;

function loadQuotes(page = quotesCurrentPage) {
    quotesCurrentPage = Math.max(1, Number(page) || 1);
    const countResult = db.exec(`SELECT COUNT(*) FROM quotes WHERE deleted_at IS NULL`);
    const totalRows = Number(countResult?.[0]?.values?.[0]?.[0] || 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / QUOTES_PAGE_SIZE));
    if (quotesCurrentPage > totalPages) quotesCurrentPage = totalPages;
    const offset = (quotesCurrentPage - 1) * QUOTES_PAGE_SIZE;

    const rows = db.exec(`
        SELECT id, client_name, item_description, quantity, unit_price,
               total_with_shipping, shipping_cost, status, created_at, validity_date, order_id
        FROM quotes WHERE deleted_at IS NULL ORDER BY id DESC LIMIT ? OFFSET ?`, [QUOTES_PAGE_SIZE, offset]);

    const tbody = document.getElementById('quotesTableBody');
    const pager = document.getElementById('quotesPagination');
    if (!tbody) return;

    if (!rows.length || !rows[0].values.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">Nenhum orçamento registrado ainda.</td></tr>';
        if (pager) pager.innerHTML = '';
        return;
    }

    const statusLabel = { aguardando: '⏳ Aguardando', aceito: '✅ Aceito', recusado: '❌ Recusado', expirado: '🕐 Expirado' };
    const statusColor = { aguardando: '#b45309', aceito: '#166534', recusado: '#991b1b', expirado: '#6b7280' };

    tbody.innerHTML = rows[0].values.map(([id, clientName, desc, qty, unitPrice, total, shipping, status, createdAt, validityDate, orderId]) => {
        const date = new Date(createdAt).toLocaleDateString('pt-BR');
        const validity = validityDate ? new Date(validityDate).toLocaleDateString('pt-BR') : '—';
        const st = status || 'aguardando';
        const color = statusColor[st] || '#6b7280';
        const label = statusLabel[st] || st;
        const canConvert = st === 'aceito' && !orderId;
        const convertBtn = canConvert
            ? `<button class="btn-primary btn-sm" onclick="convertQuoteToOrder(${id})">📦 Criar Pedido</button>`
            : (orderId ? `<span style="color:var(--text-muted);font-size:.8em;">Pedido #${orderId}</span>` : '');
        return `<tr>
            <td>#${id}</td>
            <td>${h(clientName || '—')}<br><small style="color:var(--text-muted)">${h(desc || '')}</small></td>
            <td style="text-align:center">${qty}x</td>
            <td>${money(total)}</td>
            <td><span style="color:${color};font-weight:600">${label}</span></td>
            <td>${date}<br><small style="color:var(--text-muted)">Válido: ${validity}</small></td>
            <td>
                ${st === 'aguardando' ? `<button class="btn-success btn-sm" onclick="setQuoteStatus(${id},'aceito')">✅</button>
                <button class="btn-danger btn-sm" onclick="setQuoteStatus(${id},'recusado')">❌</button>` : ''}
                ${convertBtn}
                <button class="btn-danger btn-sm" onclick="openAttachments('quotes',${id},'Orçamento #${id}')"><i class="bi bi-paperclip"></i></button>
                <button class="btn-danger btn-sm" onclick="deleteQuote(${id})">🗑️</button>
            </td>
        </tr>`;
    }).join('');

    if (pager) {
        const first = totalRows ? offset + 1 : 0;
        const last = Math.min(offset + QUOTES_PAGE_SIZE, totalRows);
        pager.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
            <span style="color:var(--text-muted);font-size:.88rem;">Exibindo ${first}–${last} de ${totalRows}</span>
            <div style="display:flex;align-items:center;gap:8px;">
                <button class="btn-secondary btn-sm" onclick="loadQuotes(${quotesCurrentPage - 1})" ${quotesCurrentPage <= 1 ? 'disabled' : ''}>← Anterior</button>
                <span style="font-size:.88rem;">Página ${quotesCurrentPage} de ${totalPages}</span>
                <button class="btn-secondary btn-sm" onclick="loadQuotes(${quotesCurrentPage + 1})" ${quotesCurrentPage >= totalPages ? 'disabled' : ''}>Próxima →</button>
            </div>
        </div>`;
    }
}

function saveCurrentQuote() {
    const p = calculatePrice();
    if (!p) { showToast('⚠️ Calcule o preço antes de salvar o orçamento.'); return; }

    const clientId = parseInt(document.getElementById('calcClientId')?.value) || 0;
    const clientName = (() => {
        const sel = document.getElementById('calcClientId');
        const opt = sel?.options[sel.selectedIndex];
        return (opt && opt.value !== '0') ? opt.textContent.split('—')[0].trim() : '';
    })();
    const itemDesc = (document.getElementById('calcItemDescription')?.value || '').trim();

    const validityDays = parseInt((typeof currentSettings !== 'undefined' && currentSettings.quoteValidityDays) || 15);
    const validityDate = new Date();
    validityDate.setDate(validityDate.getDate() + (isNaN(validityDays) ? 15 : validityDays));

    const whatsappText = typeof buildWhatsAppText === 'function' ? buildWhatsAppText() : '';

    db.run(`INSERT INTO quotes
        (client_id, client_name, item_description, quantity, unit_price, total_price, shipping_cost, total_with_shipping, status, whatsapp_text, validity_date, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [clientId || null, clientName, itemDesc,
         p.quantity, p.finalPrice, p.totalPrice, p.shippingCost, p.totalWithShipping,
         'aguardando', whatsappText,
         validityDate.toISOString().slice(0, 10),
         new Date().toISOString()]);

    persistDB();
    showToast('✅ Orçamento salvo!');
    if (typeof loadQuotes === 'function') loadQuotes();
}

function setQuoteStatus(id, status) {
    db.run(`UPDATE quotes SET status=? WHERE id=?`, [status, id]);
    persistDB();
    loadQuotes();
}

function deleteQuote(id) {
    if (!confirm('Mover este orçamento para a lixeira?')) return;
    const old=dbRowObject('SELECT * FROM quotes WHERE id=? AND deleted_at IS NULL',[id]);
    db.run(`UPDATE quotes SET deleted_at=? WHERE id=?`, [new Date().toISOString(), id]);
    auditLog('quotes',id,'soft_delete',old,null);
    persistDB();
    loadQuotes();
}

function convertQuoteToOrder(quoteId) {
    const r = db.exec(`SELECT client_id, item_description, quantity, unit_price, total_price, shipping_cost FROM quotes WHERE id=? AND deleted_at IS NULL`, [quoteId]);
    if (!r.length || !r[0].values.length) return;
    const [clientId, desc, qty, unitPrice, totalPrice, shippingCost] = r[0].values[0];

    // Gera opções de tipo de trabalho a partir do mapa global para evitar lista desatualizada.
    const workTypeOptions = typeof WORK_TYPE_NAMES !== 'undefined'
        ? Object.entries(WORK_TYPE_NAMES).map(([v, l]) => `<option value="${h(v)}">${h(l)}</option>`).join('')
        : '<option value="custom">Sob Medida</option>';

    document.getElementById('modalTitle').textContent = '📦 Converter Orçamento em Pedido';
    document.getElementById('modalBody').innerHTML = `
        <p style="margin-bottom:12px;">Orçamento <strong>#${quoteId}</strong> — ${h(desc || 'sem descrição')}</p>
        <div class="field-group">
            <label for="convertWorkType">Tipo de trabalho *</label>
            <select id="convertWorkType">${workTypeOptions}</select>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;">
            <button class="btn-primary" onclick="_doConvertQuote(${quoteId}, ${clientId || 'null'}, ${qty}, ${unitPrice}, ${totalPrice}, ${shippingCost})">✅ Criar Pedido</button>
            <button class="btn-secondary" onclick="closeModal()">Cancelar</button>
        </div>`;
    openModal();
}

function _doConvertQuote(quoteId, clientId, qty, unitPrice, totalPrice, shippingCost) {
    const workType = document.getElementById('convertWorkType')?.value || 'custom';
    const r = db.exec(`SELECT item_description FROM quotes WHERE id=? AND deleted_at IS NULL`, [quoteId]);
    const desc = r[0]?.values[0]?.[0] || '';

    db.run(`INSERT INTO orders (client_id, work_type, quantity, unit_price, total_price, shipping_cost, status, notes, date)
            VALUES (?,?,?,?,?,?,?,?,?)`,
        [clientId || null, workType, qty, unitPrice, totalPrice, shippingCost,
         'quote', desc, new Date().toISOString().slice(0, 10)]);

    const orderId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    db.run(`UPDATE quotes SET order_id=? WHERE id=?`, [orderId, quoteId]);
    persistDB();
    closeModal();
    showToast(`✅ Pedido #${orderId} criado! Veja na aba Pedidos.`);
    loadQuotes();
    if (typeof loadOrders === 'function') loadOrders();
}
