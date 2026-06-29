// ==================== ORÇAMENTOS ====================

function loadQuotes() {
    const rows = db.exec(`
        SELECT id, client_name, item_description, quantity, unit_price,
               total_with_shipping, shipping_cost, status, created_at, validity_date, order_id
        FROM quotes ORDER BY id DESC LIMIT 200`);

    const tbody = document.getElementById('quotesTableBody');
    if (!tbody) return;

    if (!rows.length || !rows[0].values.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">Nenhum orçamento registrado ainda.</td></tr>';
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
            <td>R$ ${Number(total).toFixed(2)}</td>
            <td><span style="color:${color};font-weight:600">${label}</span></td>
            <td>${date}<br><small style="color:var(--text-muted)">Válido: ${validity}</small></td>
            <td>
                ${st === 'aguardando' ? `<button class="btn-success btn-sm" onclick="setQuoteStatus(${id},'aceito')">✅</button>
                <button class="btn-danger btn-sm" onclick="setQuoteStatus(${id},'recusado')">❌</button>` : ''}
                ${convertBtn}
                <button class="btn-danger btn-sm" onclick="deleteQuote(${id})">🗑️</button>
            </td>
        </tr>`;
    }).join('');
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
    if (!confirm('Excluir este orçamento?')) return;
    db.run(`DELETE FROM quotes WHERE id=?`, [id]);
    persistDB();
    loadQuotes();
}

function convertQuoteToOrder(quoteId) {
    const r = db.exec(`SELECT client_id, item_description, quantity, unit_price, total_price, shipping_cost FROM quotes WHERE id=?`, [quoteId]);
    if (!r.length || !r[0].values.length) return;
    const [clientId, desc, qty, unitPrice, totalPrice, shippingCost] = r[0].values[0];

    db.run(`INSERT INTO orders (client_id, work_type, quantity, unit_price, total_price, shipping_cost, status, notes, date)
            VALUES (?,?,?,?,?,?,?,?,?)`,
        [clientId || null, 'personalized', qty, unitPrice, totalPrice, shippingCost,
         'pendente', desc || '', new Date().toISOString().slice(0, 10)]);

    const orderId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    db.run(`UPDATE quotes SET order_id=? WHERE id=?`, [orderId, quoteId]);
    persistDB();
    showToast(`✅ Pedido #${orderId} criado! Veja na aba Pedidos.`);
    loadQuotes();
    if (typeof loadOrders === 'function') loadOrders();
}
