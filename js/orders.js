// ==================== PEDIDOS ====================

function saveQuoteAsOrder() {
    const price       = calculatePrice();
    const clientId    = parseInt(document.getElementById('calcClientId').value) || 0;
    const workType    = document.getElementById('calcWorkType').value;
    const printerId   = parseInt(document.getElementById('calcPrinter').value) || null;
    const materialId  = parseInt(document.getElementById('calcMaterial').value) || null;
    const materialSelect = document.getElementById('calcMaterial');
    const materialName   = materialSelect.options[materialSelect.selectedIndex]?.text?.split(' - ')[0] || 'PLA';
    const weight      = price.weight;
    const printTime   = price.printTime;
    const difficulty  = parseFloat(document.getElementById('calcDifficulty').value) || 1;
    const quantity    = parseInt(document.getElementById('calcQuantity').value)     || 1;

    db.run(`INSERT INTO orders
        (client_id, work_type, printer_id, material_id, material_name,
         weight, print_time, difficulty, quantity, unit_price, total_price,
         profit, status, shipping_cost, date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [clientId, workType, printerId, materialId, materialName,
         weight, printTime, difficulty, quantity,
         price.finalPrice, price.totalPrice, price.netProfit,
         'quote', price.shippingCost, new Date().toISOString(), '']);

    // CORREÇÃO: estoque só é descontado quando status mudar para 'printing',
    // não no orçamento. Removi o updateStock daqui.

    persistDB();
    showToast('✅ Orçamento salvo como pedido!');
    loadOrders();
    updateDashboard();
    updateStatsBar();
}

let _ordersPage = 0;
const ORDERS_PER_PAGE = 20;
let _timerInterval = null;

function startOrdersTimer() {
    if (_timerInterval) clearInterval(_timerInterval);
    _timerInterval = setInterval(() => {
        document.querySelectorAll('[data-print-start]').forEach(el => {
            const start = new Date(el.dataset.printStart);
            const elapsed = (Date.now() - start) / 3600000; // horas
            const est = parseFloat(el.dataset.printEst) || 0;
            const h = Math.floor(elapsed);
            const m = Math.round((elapsed - h) * 60);
            const pct = est > 0 ? Math.min(100, Math.round((elapsed / est) * 100)) : null;
            const color = pct >= 100 ? '#e53e3e' : pct >= 80 ? '#d97706' : '#38a169';
            el.innerHTML = `⏱️ ${h}h${String(m).padStart(2,'0')}m decorrido`
                + (pct !== null ? ` <span style="color:${color};font-weight:700;">(${pct}% do estimado)</span>` : '');
        });
    }, 30000);
    // Dispara imediatamente
    document.querySelectorAll('[data-print-start]').forEach(el => el.dispatchEvent(new Event('update')));
}

function loadOrders(resetPage = false) {
    if (resetPage) _ordersPage = 0;
    const statusFilter = document.getElementById('orderStatusFilter')?.value || 'all';
    const showDeleted = statusFilter === 'deleted';

    const baseQuery = `SELECT o.id, o.work_type, o.material_name, o.weight, o.print_time,
                        o.quantity, o.unit_price, o.total_price, o.profit,
                        o.status, o.shipping_cost, o.date, o.notes,
                        c.name AS client_name,
                        o.printing_started_at, o.paid_amount, o.printer_id
                 FROM orders o
                 LEFT JOIN clients c ON o.client_id = c.id`;

    let whereClause, params;
    if (showDeleted) {
        whereClause = ' WHERE o.deleted_at IS NOT NULL';
        params = [];
    } else if (statusFilter !== 'all') {
        whereClause = ' WHERE o.deleted_at IS NULL AND o.status = ?';
        params = [statusFilter];
    } else {
        whereClause = ' WHERE o.deleted_at IS NULL';
        params = [];
    }

    const countResult = db.exec(`SELECT COUNT(*) FROM orders o${whereClause}`, params);
    const total = countResult[0]?.values[0]?.[0] ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / ORDERS_PER_PAGE));
    _ordersPage = Math.min(_ordersPage, totalPages - 1);

    const result = db.exec(
        baseQuery + whereClause + ` ORDER BY o.id DESC LIMIT ${ORDERS_PER_PAGE} OFFSET ${_ordersPage * ORDERS_PER_PAGE}`,
        params
    );
    let html = '<div class="vstack gap-3">';

    if (result.length > 0 && result[0].values.length > 0) {
        result[0].values.forEach(o => {
            const [id, workType, materialName, weight, printTime,
                   qty, unitPrice, totalPrice, profit,
                   status, shippingCost, date, notes, clientName,
                   printingStartedAt, paidAmount, printerId] = o;

            const statusOptions = Object.entries(STATUS_NAMES).map(([val, label]) =>
                `<option value="${val}" ${status === val ? 'selected' : ''}>${label}</option>`
            ).join('');

            // Badge de pagamento
            const paid = parseFloat(paidAmount) || 0;
            const payColor = paid >= totalPrice ? '#38a169' : paid > 0 ? '#d97706' : '#e53e3e';
            const payLabel = paid >= totalPrice ? '✅ Pago' : paid > 0 ? `⚠️ Parcial R$${paid.toFixed(2)}` : '❌ Pendente';
            const payBadge = status !== 'quote' && status !== 'cancelled'
                ? `<span style="font-size:0.72em;color:${payColor};margin-left:6px;">${payLabel}</span>` : '';

            // Timer de impressão + widget Bambu (só para pedidos em impressão)
            const isPrinting = status === 'printing';
            const timerEl = printingStartedAt
                ? `<div data-print-start="${printingStartedAt}" data-print-est="${printTime}" style="font-size:0.8em;color:var(--text-muted);margin-top:2px;"></div>` : '';
            const bambuEl = isPrinting
                ? `<div data-bambu-widget${printerId ? ` data-printer-id="${printerId}"` : ''} style="margin-top:2px;"></div>` : '';

            if (showDeleted) {
                html += `
                    <article class="card border-secondary-subtle opacity-75"><div class="card-body">
                        <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                            <strong>#${id} — ${getWorkTypeLabel(workType)}</strong>
                            <span class="status-badge" style="background:#888;">🗑️ Arquivado</span>
                        </div>
                        <div class="row g-2 small mb-3">
                            <div>👤 ${h(clientName || 'Sem cliente')}</div>
                            <div>🧱 ${h(materialName)} — ${weight}g</div>
                            <div>💰 R$ ${totalPrice.toFixed(2)}</div>
                            <div>📅 ${new Date(date).toLocaleDateString('pt-BR')}</div>
                        </div>
                        <div class="d-flex flex-wrap gap-2 pt-3 border-top">
                            <button class="btn btn-primary btn-sm" onclick="restoreOrder(${id})">↩️ Restaurar</button>
                            <button class="btn btn-danger btn-sm"  onclick="hardDeleteOrder(${id})">❌ Apagar</button>
                        </div>
                    </div></article>`;
            } else {
                html += `
                    <article class="card shadow-sm s3d-order-card"><div class="card-body">
                        <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                            <strong>#${id} — ${getWorkTypeLabel(workType)}</strong>
                            <span class="status-badge status-${h(status)}">${h(STATUS_NAMES[status] || status)}</span>
                            ${payBadge}
                        </div>
                        <div class="row g-2 small mb-3">
                            <div>👤 ${h(clientName || 'Sem cliente')}</div>
                            <div>🧱 ${h(materialName)} — ${weight}g</div>
                            <div>⏱️ ${formatHoursHuman(printTime)} | 🔢 ${qty}×</div>
                            <div>💰 R$ ${totalPrice.toFixed(2)}</div>
                            <div>📅 ${new Date(date).toLocaleDateString('pt-BR')}</div>
                            ${timerEl}
                            ${bambuEl}
                        </div>
                        <div class="d-flex flex-wrap gap-2 pt-3 border-top">
                            <select class="form-select form-select-sm w-auto" aria-label="Alterar status" onchange="updateOrderStatus(${id}, this.value)">
                                ${statusOptions}
                            </select>
                            <button class="btn btn-outline-secondary btn-sm" title="Ver timeline do pedido"     onclick="showOrderTimeline(${id})">🧭</button>
                            <button class="btn btn-outline-success btn-sm" title="Notas e histórico"             onclick="showOrderNotes(${id})">📝</button>
                            <button class="btn btn-outline-info btn-sm" title="Registrar pagamento"           onclick="registerPayment(${id}, ${totalPrice.toFixed(2)}, ${paid.toFixed(2)})">💳</button>
                            <button class="btn btn-outline-info btn-sm" title="Imprimir etiqueta"             onclick="printOrderLabel(${id})">🏷️</button>
                            <button class="btn btn-outline-info btn-sm" title="Registrar falha de impressão"  onclick="reportFailedPrint(${id})">⚠️</button>
                            <button class="btn btn-outline-danger btn-sm" title="Anexos"                        onclick="openAttachments('orders',${id},'Pedido #${id}')"><i class="bi bi-paperclip"></i></button>
                            <button class="btn btn-outline-danger btn-sm" title="Excluir pedido"                onclick="deleteOrder(${id})">🗑️</button>
                        </div>
                    </div></article>`;
            }
        });
    } else {
        html += '<div class="text-center text-body-secondary py-5"><i class="bi bi-box-seam d-block fs-2 mb-2"></i>Nenhum pedido encontrado.</div>';
    }

    html += '</div>';

    // Paginação
    if (total > ORDERS_PER_PAGE) {
        const from = _ordersPage * ORDERS_PER_PAGE + 1;
        const to   = Math.min((_ordersPage + 1) * ORDERS_PER_PAGE, total);
        html += `<div class="d-flex align-items-center justify-content-center gap-3 py-3 small">
            <button class="btn btn-primary btn-sm" onclick="_ordersPage--;loadOrders()" ${_ordersPage === 0 ? 'disabled' : ''}>← Anterior</button>
            <span>${from}–${to} de ${total}</span>
            <button class="btn btn-primary btn-sm" onclick="_ordersPage++;loadOrders()" ${to >= total ? 'disabled' : ''}>Próxima →</button>
        </div>`;
    }

    const summary = db.exec(`SELECT status, total_price, paid_amount FROM orders WHERE deleted_at IS NULL`);
    const summaryRows = summary[0]?.values || [];
    const setText = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
    setText('ordersOpenCount', summaryRows.filter(r => !['delivered','cancelled'].includes(r[0])).length);
    setText('ordersPrintingCount', summaryRows.filter(r => r[0] === 'printing').length);
    setText('ordersDeliveredCount', summaryRows.filter(r => r[0] === 'delivered').length);
    const receivable = summaryRows.reduce((sum, r) => sum + Math.max(0, Number(r[1] || 0) - Number(r[2] || 0)), 0);
    setText('ordersReceivableValue', money(receivable));
    document.getElementById('ordersList').innerHTML = html;
    startOrdersTimer();
    // Renderiza widgets Bambu imediatamente com o último status conhecido
    if (typeof _renderOrderCards === 'function') _renderOrderCards(_bambuLastStatuses || {});
}

// ── Notas / histórico por pedido ──────────────────────────────────────────
function showOrderNotes(orderId) {
    const notes = db.exec(
        'SELECT note, created_at FROM order_notes WHERE order_id = ? ORDER BY id DESC',
        [orderId]
    );

    let listHtml = '';
    if (notes.length > 0 && notes[0].values.length > 0) {
        notes[0].values.forEach(([note, ts]) => {
            listHtml += `<div style="padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.08);font-size:0.88em;">
                <div style="color:var(--text-muted);font-size:0.8em;margin-bottom:2px;">
                    ${new Date(ts).toLocaleString('pt-BR')}</div>
                <div>${h(note)}</div>
            </div>`;
        });
    } else {
        listHtml = '<p style="color:var(--text-muted);font-size:0.85em;">Nenhuma nota ainda.</p>';
    }

    document.getElementById('modalTitle').innerHTML = `📝 Notas — Pedido #${orderId}`;
    document.getElementById('modalBody').innerHTML = `
        <div style="max-height:280px;overflow-y:auto;margin-bottom:14px;">${listHtml}</div>
        <div class="field-group">
            <label>Nova nota</label>
            <textarea id="newOrderNote" rows="3" style="width:100%;resize:vertical;"
                placeholder="Ex.: Cliente pediu cor diferente, aguardando aprovação..."></textarea>
        </div>
        <button class="btn btn-primary" onclick="saveOrderNote(${orderId})">💾 Salvar nota</button>`;
    openModal();
}

function saveOrderNote(orderId) {
    const note = document.getElementById('newOrderNote')?.value?.trim();
    if (!note) { showToast('⚠️ Digite uma nota'); return; }
    db.run('INSERT INTO order_notes (order_id, note, created_at) VALUES (?,?,?)',
        [orderId, note, new Date().toISOString()]);
    persistDB();
    showToast('✅ Nota salva!');
    showOrderNotes(orderId); // Recarrega modal
}

// ── Pagamentos ─────────────────────────────────────────────────────────────
function registerPayment(orderId, totalPrice, paidSoFar) {
    document.getElementById('modalTitle').innerHTML = `💳 Pagamento — Pedido #${orderId}`;
    document.getElementById('modalBody').innerHTML = `
        <div style="margin-bottom:12px;font-size:0.9em;">
            <strong>Total do pedido:</strong> R$ ${Number(totalPrice).toFixed(2)}<br>
            <strong>Já recebido:</strong> R$ ${Number(paidSoFar).toFixed(2)}<br>
            <strong>Saldo:</strong> R$ ${Math.max(0, totalPrice - paidSoFar).toFixed(2)}
        </div>
        <div class="field-group">
            <label>Valor recebido agora (R$)</label>
            <input type="number" id="paymentAmount" value="${Math.max(0, totalPrice - paidSoFar).toFixed(2)}" min="0" step="0.01">
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;">
            <button class="btn btn-primary" onclick="savePayment(${orderId}, ${paidSoFar})">💾 Registrar</button>
            <button class="btn btn-success" onclick="savePayment(${orderId}, 0, true)">✅ Quitado total</button>
        </div>`;
    openModal();
}

function savePayment(orderId, paidSoFar, fullPayment = false) {
    const totalRow = db.exec('SELECT total_price FROM orders WHERE id = ?', [orderId]);
    const total = parseFloat(totalRow[0]?.values[0]?.[0]) || 0;
    let newPaid;
    if (fullPayment) {
        newPaid = total;
    } else {
        const amount = parseFloat(document.getElementById('paymentAmount')?.value) || 0;
        newPaid = Math.min(total, (parseFloat(paidSoFar) || 0) + amount);
    }
    db.run('UPDATE orders SET paid_amount = ? WHERE id = ?', [newPaid, orderId]);
    persistDB();
    closeModal();
    showToast(`✅ Pagamento registrado — R$ ${newPaid.toFixed(2)} de R$ ${total.toFixed(2)}`);
    loadOrders();
    updateStatsBar();
}

// ── Etiqueta imprimível ───────────────────────────────────────────────────
function printOrderLabel(orderId) {
    const r = db.exec(
        `SELECT o.id, o.work_type, o.material_name, o.weight, o.print_time,
                o.quantity, o.total_price, o.status, o.date, o.notes,
                c.name, c.phone, c.address, c.city
         FROM orders o LEFT JOIN clients c ON o.client_id = c.id
         WHERE o.id = ?`, [orderId]
    );
    if (!r.length || !r[0].values.length) return;
    const [id, wt, mat, weight, pt, qty, total, status, date, notes,
           cName, cPhone, cAddr, cCity] = r[0].values[0];
    const workTypeNames = WORK_TYPE_NAMES;
    const statusNames = STATUS_NAMES;

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Etiqueta #${id}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;background:#fff;color:#111;padding:16px}
  .label{border:2px solid #111;border-radius:8px;padding:16px;max-width:400px;margin:0 auto}
  .order-num{font-size:3em;font-weight:900;text-align:center;letter-spacing:-2px;color:#00AE42;margin-bottom:8px}
  .row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #ddd;font-size:.88em}
  .row:last-child{border:none}
  .lbl{color:#555}
  .section{font-weight:700;font-size:.7em;text-transform:uppercase;color:#00AE42;margin:10px 0 4px}
  .notes{font-size:.8em;color:#444;margin-top:8px;background:#f9f9f9;border-radius:4px;padding:8px}
  @media print{button{display:none}}
</style></head><body>
<div class="label">
  <div class="order-num">#${String(id).padStart(4,'0')}</div>
  <div class="section">Pedido</div>
  <div class="row"><span class="lbl">Tipo</span><span>${h(workTypeNames[wt] || wt)}</span></div>
  <div class="row"><span class="lbl">Material</span><span>${h(mat||'—')}</span></div>
  <div class="row"><span class="lbl">Peso</span><span>${weight}g</span></div>
  <div class="row"><span class="lbl">Quantidade</span><span>${qty}×</span></div>
  <div class="row"><span class="lbl">Status</span><span>${h(statusNames[status] || status)}</span></div>
  <div class="row"><span class="lbl">Data</span><span>${new Date(date).toLocaleDateString('pt-BR')}</span></div>
  <div class="section">Cliente</div>
  <div class="row"><span class="lbl">Nome</span><span>${h(cName||'—')}</span></div>
  <div class="row"><span class="lbl">Telefone</span><span>${h(cPhone||'—')}</span></div>
  <div class="row"><span class="lbl">Endereço</span><span>${h([cAddr,cCity].filter(Boolean).join(', ')||'—')}</span></div>
  ${notes ? `<div class="notes">📝 ${h(notes)}</div>` : ''}
</div>
<br>
<button onclick="window.print()" style="padding:10px 24px;background:#00AE42;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">🖨️ Imprimir Etiqueta</button>
</body></html>`;

    const blob = new Blob([html], {type:'text/html;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

function updateOrderStatus(orderId, newStatus) {
    const prev = db.exec('SELECT status, material_id, weight, quantity, client_id, total_price FROM orders WHERE id = ?', [orderId]);
    if (prev.length === 0) return;
    const [prevStatus, materialId, weight, quantity, clientId, totalPrice] = prev[0].values[0];
    const printedStatuses = ['printing','post','packaging','shipped','delivered'];
    const wasPrinted = printedStatuses.includes(prevStatus);
    const willBePrinted = printedStatuses.includes(newStatus);
    const grams = (parseFloat(weight) || 0) * (parseInt(quantity) || 1);

    if (materialId && grams > 0 && !wasPrinted && willBePrinted) {
        updateStock(materialId, grams, 'saida_pedido', orderId, `Pedido #${orderId} entrou em produção`);
    }

    // Timer: registra quando entrou em impressão; acumula horas na impressora
    if (newStatus === 'printing' && prevStatus !== 'printing') {
        db.run('UPDATE orders SET printing_started_at = ? WHERE id = ?', [new Date().toISOString(), orderId]);
        const prRow = db.exec('SELECT printer_id, print_time FROM orders WHERE id = ?', [orderId]);
        const [prid, ptime] = prRow[0]?.values[0] ?? [];
        if (prid && ptime) {
            db.run('UPDATE printers SET hours_used = COALESCE(hours_used,0) + ? WHERE id = ?',
                [parseFloat(ptime) || 0, prid]);
        }
    }
    if (prevStatus === 'printing' && newStatus !== 'printing') {
        db.run('UPDATE orders SET printing_started_at = NULL WHERE id = ?', [orderId]);
    }
    if (materialId && grams > 0 && wasPrinted && ['quote','approved','paid','cancelled'].includes(newStatus)) {
        updateStock(materialId, -grams, 'estorno_pedido', orderId, `Pedido #${orderId} saiu da produção/cancelado`);
    }

    // Atualiza total_spent e last_order do cliente ao entregar/cancelar
    if (clientId && clientId > 0) {
        const wasDelivered = prevStatus === 'delivered';
        const willBeDelivered = newStatus === 'delivered';
        if (!wasDelivered && willBeDelivered) {
            // Entrou em "Entregue" → soma ao total_spent
            db.run(`UPDATE clients SET
                total_spent = COALESCE(total_spent, 0) + ?,
                last_order  = ?
                WHERE id = ?`, [parseFloat(totalPrice) || 0, new Date().toISOString(), clientId]);
        } else if (wasDelivered && !willBeDelivered) {
            // Saiu de "Entregue" (correção) → subtrai do total_spent
            db.run(`UPDATE clients SET
                total_spent = MAX(0, COALESCE(total_spent, 0) - ?)
                WHERE id = ?`, [parseFloat(totalPrice) || 0, clientId]);
        }
    }

    db.run('UPDATE orders SET status = ? WHERE id = ?', [newStatus, orderId]);
    persistDB();
    loadOrders();
    loadMaterials();
    loadClients();
    updateStatsBar();
}

function deleteOrder(orderId) {
    if (confirm('Arquivar este pedido? Ele ficará na lixeira e pode ser restaurado.')) {
        db.run('UPDATE orders SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), orderId]);
        persistDB();
        loadOrders();
        updateDashboard();
        updateStatsBar();
    }
}

function restoreOrder(orderId) {
    db.run('UPDATE orders SET deleted_at = NULL WHERE id = ?', [orderId]);
    persistDB();
    loadOrders();
    updateDashboard();
    updateStatsBar();
    showToast('✅ Pedido restaurado.');
}

function hardDeleteOrder(orderId) {
    if (confirm('Mover este pedido para a lixeira?')) {
        const old=dbRowObject('SELECT * FROM orders WHERE id=?',[orderId]);
        db.run('UPDATE orders SET deleted_at=? WHERE id = ?', [new Date().toISOString(), orderId]);
        auditLog('orders',orderId,'soft_delete',old,null);
        persistDB();
        loadOrders();
        updateDashboard();
        updateStatsBar();
    }
}

function reportFailedPrint(orderId) {
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');
    if (!title || !body) {
        showToast('Não foi possível abrir o formulário de falha.');
        return;
    }

    title.textContent = `Registrar falha — Pedido #${orderId}`;
    body.innerHTML = `
        <form id="failedPrintForm" onsubmit="saveFailedPrintReport(event, ${orderId})">
            <div class="form-group">
                <label for="failedPrintReason">Motivo da falha *</label>
                <textarea id="failedPrintReason" rows="4" maxlength="500" required
                    placeholder="Ex.: descolamento da mesa, quebra de suporte, falta de energia..."></textarea>
                <small>Descreva o ocorrido para facilitar análises futuras.</small>
            </div>
            <div class="form-group">
                <label for="failedPrintMaterial">Material perdido (g)</label>
                <input id="failedPrintMaterial" type="number" min="0" step="0.1" value="0" inputmode="decimal">
                <small>O valor será descontado automaticamente do estoque.</small>
            </div>
            <div class="modal-actions" style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
                <button type="submit" class="btn-danger">Registrar falha</button>
            </div>
        </form>`;
    openModal();
    setTimeout(() => document.getElementById('failedPrintReason')?.focus(), 0);
}

function saveFailedPrintReport(event, orderId) {
    event.preventDefault();
    const reason = document.getElementById('failedPrintReason')?.value?.trim() || '';
    const materialLost = Math.max(0, Number(document.getElementById('failedPrintMaterial')?.value) || 0);
    if (!reason) {
        showToast('Informe o motivo da falha.');
        document.getElementById('failedPrintReason')?.focus();
        return;
    }

    const orderRow = db.exec('SELECT material_id FROM orders WHERE id = ?', [orderId]);
    const materialId = orderRow[0]?.values[0]?.[0] || null;
    if (materialId && materialLost > 0) {
        updateStock(materialId, materialLost, 'falha_impressao', orderId,
            `Falha no pedido #${orderId}: ${reason.slice(0, 80)}`);
    }

    db.run('INSERT INTO failed_prints (order_id, fail_reason, material_lost, date) VALUES (?, ?, ?, ?)',
        [orderId, reason, materialLost, new Date().toISOString()]);
    persistDBNow().catch(() => false);
    closeModal();
    showToast(`⚠️ Falha registrada${materialLost > 0 ? ` — ${formatDecimal(materialLost, 1)}g deduzidos do estoque` : ''}.`);
    loadMaterials();
    updateStatsBar();
}

// ── Fila de impressão ─────────────────────────────────────────────────────
function renderPrintQueue() {
    const panel   = document.getElementById('printQueuePanel');
    const content = document.getElementById('printQueueContent');
    if (!panel || !content) return;

    const rows = db.exec(
        `SELECT o.id, o.work_type, o.material_name, o.weight, o.print_time, o.quantity,
                o.status, o.date, c.name AS client_name,
                p.name AS printer_name, o.printer_id
         FROM orders o
         LEFT JOIN clients c ON o.client_id = c.id
         LEFT JOIN printers p ON o.printer_id = p.id
         WHERE o.status IN ('approved','paid','printing') AND o.deleted_at IS NULL
         ORDER BY CASE o.status WHEN 'printing' THEN 0 WHEN 'paid' THEN 1 ELSE 2 END, o.id`
    );

    if (!rows.length || !rows[0].values.length) { panel.style.display = 'none'; return; }
    panel.style.display = '';

    // Agrupa por impressora para calcular carga total
    const byPrinter = {};
    rows[0].values.forEach(r => {
        const pId   = r[10] || 'sem';
        const pName = r[9]  || 'Sem impressora';
        if (!byPrinter[pId]) byPrinter[pId] = { name: pName, items: [], totalH: 0 };
        byPrinter[pId].items.push(r);
        byPrinter[pId].totalH += (parseFloat(r[4]) || 0) * (parseInt(r[5]) || 1);
    });
    const workTypeNames = WORK_TYPE_NAMES;
    const statusNames   = STATUS_NAMES;

    let html = '';
    Object.values(byPrinter).forEach(({ name: pName, items, totalH }) => {
        const h_ = Math.floor(totalH), m_ = Math.round((totalH - h_) * 60);
        html += `<div style="margin-bottom:14px;">
            <div style="font-weight:700;font-size:0.88em;margin-bottom:6px;color:var(--primary);">
                🖨️ ${h(pName)} — fila total: ${h_}h${String(m_).padStart(2,'0')}m
            </div>`;
        items.forEach(([id, wt, mat, weight, pt, qty, status, date, cName]) => {
            const ptH = Math.floor(parseFloat(pt)||0);
            const ptM = Math.round(((parseFloat(pt)||0) - ptH) * 60);
            html += `<div style="display:flex;justify-content:space-between;align-items:center;
                                  padding:6px 10px;background:rgba(255,255,255,0.06);border-radius:6px;
                                  margin-bottom:4px;font-size:0.84em;flex-wrap:wrap;gap:6px;">
                <div>
                    <strong>#${id}</strong> · ${h(workTypeNames[wt] || wt)} · ${h(mat||'—')} · ${weight}g × ${qty}
                    <span style="color:var(--text-muted);margin-left:4px;">👤 ${h(cName||'—')}</span>
                </div>
                <div style="display:flex;gap:6px;align-items:center;">
                    <span style="color:var(--text-muted);">${ptH}h${String(ptM).padStart(2,'0')}m</span>
                    <span class="status-badge status-${h(status)}">${h(statusNames[status] || status)}</span>
                </div>
            </div>`;
        });
        html += '</div>';
    });

    content.innerHTML = html;
}

function importOrdersFromCSV() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { showToast('⚠️ CSV vazio ou sem dados'); return; }

        // Detecta separador (vírgula ou ponto-e-vírgula)
        const sep = lines[0].includes(';') ? ';' : ',';

        // Ignora cabeçalho
        const rows = lines.slice(1);
        let imported = 0, skipped = 0;

        rows.forEach(line => {
            // Divide respeitando campos entre aspas
            const cols = [];
            let cur = '', inQ = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') { inQ = !inQ; continue; }
                if (ch === sep && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
                cur += ch;
            }
            cols.push(cur.trim());

            // Formato atual:
            // ID, Cliente, Tipo, Material, Peso(g), Tempo(h), Qtd, Preço Unit, Total, Valor Pago, Lucro, Status, Data
            // Também aceita o formato antigo sem Valor Pago e Lucro.
            if (cols.length < 8) { skipped++; return; }

            let clientName, workType, materialName, weightRaw, printTimeRaw, qtyRaw, unitPriceRaw, totalPriceRaw, paidRaw, profitRaw, status, dateRaw;
            if (cols.length >= 13) {
                [, clientName, workType, materialName, weightRaw, printTimeRaw, qtyRaw, unitPriceRaw, totalPriceRaw, paidRaw, profitRaw, status, dateRaw] = cols;
            } else {
                [, clientName, workType, materialName, weightRaw, printTimeRaw, qtyRaw, unitPriceRaw, totalPriceRaw, status, dateRaw] = cols;
                paidRaw = '0'; profitRaw = '';
            }

            const weight    = parseFloat(weightRaw)    || 0;
            const printTime = parseFloat(printTimeRaw) || 0;
            const qty       = parseInt(qtyRaw)         || 1;
            const unitPrice = parseFloat(unitPriceRaw) || 0;
            const totalPrice= parseFloat(totalPriceRaw)|| 0;
            const paidAmount= parseFloat(paidRaw) || 0;
            const parsedProfit = parseFloat(profitRaw);
            const profit = Number.isFinite(parsedProfit) ? parsedProfit : null;
            const orderDate = dateRaw ? new Date(dateRaw).toISOString() : new Date().toISOString();
            const validStatus = STATUS_NAMES[status] ? status : 'quote';

            // Tenta casar cliente pelo nome
            let clientId = 0;
            if (clientName && clientName !== 'Sem cliente') {
                const cr = db.exec('SELECT id FROM clients WHERE name = ? LIMIT 1', [clientName]);
                clientId = cr[0]?.values[0]?.[0] || 0;
            }

            try {
                db.run(`INSERT INTO orders
                    (client_id, work_type, material_name, weight, print_time,
                     quantity, unit_price, total_price, paid_amount, profit, status, date, notes)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [clientId, workType || 'simple', materialName || '',
                     weight, printTime, qty, unitPrice, totalPrice, paidAmount,
                     profit, validStatus, orderDate, 'Importado via CSV']);
                imported++;
            } catch(_) { skipped++; }
        });

        if (imported > 0) {
            persistDB();
            loadOrders(true);
            updateDashboard();
            updateStatsBar();
        }
        showToast(`✅ ${imported} pedido(s) importado(s)${skipped > 0 ? ` · ${skipped} ignorado(s)` : ''}.`);
    };
    input.click();
}

/** Desconta gramas do estoque de um material pelo ID */
function updateStock(materialId, gramsUsed, movementType = 'ajuste', orderId = null, notes = '') {
    const r = db.exec('SELECT stock FROM materials WHERE id = ?', [materialId]);
    if (r.length > 0 && r[0].values.length > 0) {
        const previousStock = parseFloat(r[0].values[0][0]) || 0;
        const newStock = Math.max(0, previousStock - gramsUsed);
        db.run('UPDATE materials SET stock = ? WHERE id = ?', [newStock, materialId]);
        try {
            db.run(`INSERT INTO stock_movements
                (material_id, order_id, movement_type, grams, previous_stock, new_stock, notes, date)
                VALUES (?,?,?,?,?,?,?,?)`,
                [materialId, orderId, movementType, gramsUsed, previousStock, newStock, notes, new Date().toISOString()]);
        } catch (e) {
            console.warn('Não foi possível registrar movimentação de estoque:', e);
        }
    }
}

function exportOrdersToCSV() {
    const orders = db.exec(`SELECT o.id, c.name, o.work_type, o.material_name,
                                   o.weight, o.print_time, o.quantity,
                                   o.unit_price, o.total_price, o.paid_amount, o.profit, o.status, o.date
                            FROM orders o
                            LEFT JOIN clients c ON o.client_id = c.id
                            WHERE o.deleted_at IS NULL`);
    if (!orders.length || !orders[0].values.length) {
        showToast('Nenhum pedido para exportar');
        return;
    }
    const header = 'ID,Cliente,Tipo,Material,Peso(g),Tempo(h),Qtd,Preço Unit,Total,Valor Pago,Lucro,Status,Data\n';
    const rows = orders[0].values.map(o => o.map(v => `"${v ?? ''}"`).join(',')).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pedidos_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
}
