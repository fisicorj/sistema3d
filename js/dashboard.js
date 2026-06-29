// ==================== DASHBOARD & STATS ====================

function updateDashboard() {
    renderSalesByTypeChart();
    renderMonthlyChart();
    renderMonthlyGoal();
    renderDelayedOrders();
    if (typeof loadProducts === 'function') loadProducts();
}

function renderSalesByTypeChart() {
    const typeNames = {
        simple: 'Brinde Simples', personalized: 'Personalizado',
        technical: 'Técnica', custom: 'Sob Medida'
    };

    const data = db.exec(`
        SELECT work_type, COUNT(*) AS qty, SUM(total_price) AS total
        FROM orders
        WHERE status NOT IN ('cancelled', 'quote') AND deleted_at IS NULL
        GROUP BY work_type
        ORDER BY total DESC
    `);

    let html = '';
    if (data.length > 0 && data[0].values.length > 0) {
        const maxTotal = Math.max(...data[0].values.map(v => v[2]));
        data[0].values.forEach(([type, qty, total]) => {
            const heightPx = Math.round((total / maxTotal) * 120);
            html += `
                <div class="bar-item">
                    <div style="text-align:center; font-size:0.75em; margin-bottom:4px;">
                        R$ ${total.toFixed(0)}
                    </div>
                    <div class="bar" style="height:${Math.max(20, heightPx)}px; width:70px;"></div>
                    <div class="bar-label">${typeNames[type] || type}<br>${qty} pedido(s)</div>
                </div>`;
        });
    } else {
        html = '<p style="text-align:center; color:#888;">Nenhum dado ainda</p>';
    }
    document.getElementById('salesByTypeChart').innerHTML = html;
}

function renderMonthlyChart() {
    const data = db.exec(`
        SELECT strftime('%Y-%m', date) AS month, SUM(total_price) AS total
        FROM orders
        WHERE status NOT IN ('cancelled', 'quote') AND deleted_at IS NULL
        GROUP BY month
        ORDER BY month DESC
        LIMIT 6
    `);

    let html = '';
    if (data.length > 0 && data[0].values.length > 0) {
        const rows = [...data[0].values].reverse();
        const maxTotal = Math.max(...rows.map(v => v[1]));
        rows.forEach(([month, total]) => {
            const heightPx = Math.round((total / maxTotal) * 120);
            html += `
                <div class="bar-item">
                    <div style="text-align:center; font-size:0.75em; margin-bottom:4px;">
                        R$ ${total.toFixed(0)}
                    </div>
                    <div class="bar" style="height:${Math.max(20, heightPx)}px; width:60px;"></div>
                    <div class="bar-label">${month}</div>
                </div>`;
        });
    } else {
        html = '<p style="text-align:center; color:#888;">Sem dados</p>';
    }
    document.getElementById('monthlyChart').innerHTML = html;
}

function updateStatsBar() {
    const currentMonth = new Date().toISOString().slice(0, 7);

    const monthly = db.exec(
        `SELECT SUM(total_price), SUM(profit) FROM orders
         WHERE strftime('%Y-%m', date) = ? AND status NOT IN ('cancelled', 'quote') AND deleted_at IS NULL`,
        [currentMonth]
    );
    const revenue = monthly[0]?.values[0]?.[0] ?? 0;
    const profit  = monthly[0]?.values[0]?.[1] ?? 0;

    const ordersCount = db.exec(
        `SELECT COUNT(*) FROM orders WHERE strftime('%Y-%m', date) = ? AND deleted_at IS NULL`, [currentMonth]
    );
    const orderCount = ordersCount[0]?.values[0]?.[0] ?? 0;

    const topProduct = db.exec(
        `SELECT material_name, COUNT(*) AS c FROM orders WHERE deleted_at IS NULL
         GROUP BY material_name ORDER BY c DESC LIMIT 1`
    );
    const topName = topProduct[0]?.values[0]?.[0] ?? '-';

    const failedCount = db.exec(`SELECT COUNT(*) FROM failed_prints`);
    const totalOrders = db.exec(`SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL`);
    const total = totalOrders[0]?.values[0]?.[0] ?? 0;
    const fails  = failedCount[0]?.values[0]?.[0] ?? 0;
    const failRate = total > 0 ? ((fails / total) * 100).toFixed(1) : '0.0';

    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    setText('monthlyRevenue', `R$ ${(revenue || 0).toFixed(0)}`);
    setText('monthlyProfit',  `R$ ${(profit  || 0).toFixed(0)}`);
    setText('monthlyOrders',  orderCount);
    setText('topProduct',     topName);
    setText('failRate',       `${failRate}%`);
}

function renderMonthlyGoal() {
    const goal = parseFloat(currentSettings?.monthlyGoal) || 0;
    const el = document.getElementById('monthlyGoalBar');
    if (!el) return;
    if (goal <= 0) { el.style.display = 'none'; return; }
    el.style.display = '';

    const currentMonth = new Date().toISOString().slice(0, 7);
    const r = db.exec(
        `SELECT SUM(total_price) FROM orders
         WHERE strftime('%Y-%m', date) = ? AND status NOT IN ('cancelled','quote') AND deleted_at IS NULL`,
        [currentMonth]
    );
    const revenue = r[0]?.values[0]?.[0] ?? 0;
    const pct = Math.min(100, Math.round((revenue / goal) * 100));
    const color = pct >= 100 ? '#38a169' : pct >= 60 ? '#d97706' : '#e53e3e';

    document.getElementById('monthlyGoalContent').innerHTML = `
        <div style="margin-bottom:6px;display:flex;justify-content:space-between;font-size:0.88em;">
            <span>R$ ${revenue.toFixed(2).replace('.',',')} faturado</span>
            <span style="font-weight:700;color:${color};">${pct}% da meta</span>
            <span style="color:var(--text-muted);">Meta: R$ ${goal.toFixed(2).replace('.',',')}</span>
        </div>
        <div style="background:rgba(0,0,0,0.15);border-radius:8px;height:14px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:8px;transition:width 0.4s;"></div>
        </div>
        ${pct >= 100 ? '<div style="margin-top:6px;font-size:0.83em;color:#38a169;">🎉 Meta atingida este mês!</div>' : ''}
    `;
}

function renderDelayedOrders() {
    const panel = document.getElementById('delayedOrdersPanel');
    const list  = document.getElementById('delayedOrdersList');
    if (!panel || !list) return;

    const days = Math.max(1, parseInt(currentSettings?.alertDays) || 7);
    const rows = db.exec(
        `SELECT o.id, o.work_type, o.status, o.date, c.name, c.phone, c.email,
                CAST(julianday('now') - julianday(o.date) AS INTEGER) AS dias
         FROM orders o
         LEFT JOIN clients c ON o.client_id = c.id
         WHERE o.status NOT IN ('delivered','cancelled')
         AND o.deleted_at IS NULL
         AND julianday('now') - julianday(o.date) > ?
         ORDER BY o.date`,
        [days]
    );

    if (!rows.length || !rows[0].values.length) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = '';

    const workTypeNames = { simple:'Brinde Simples', personalized:'Personalizado', technical:'Técnica', custom:'Sob Medida' };
    const statusNames   = { quote:'Orçamento', approved:'Aprovado', paid:'Pago', printing:'Imprimindo',
        post:'Pós-proc.', packaging:'Embalagem', shipped:'Enviado' };

    let html = '';
    rows[0].values.forEach(([id, wt, status, date, clientName, phone, email, dias]) => {
        const phoneClean = (phone || '').replace(/\D/g, '');
        const msg = encodeURIComponent(`Olá${clientName ? ' ' + clientName : ''}! Tudo bem? Passando para atualizar sobre seu pedido #${id} de ${workTypeNames[wt]||wt}. Ele está atualmente em: ${statusNames[status]||status}. Qualquer dúvida, estou à disposição!`);
        const waBtn  = phoneClean
            ? `<a href="https://wa.me/55${phoneClean}?text=${msg}" target="_blank" rel="noopener" class="btn-primary btn-sm" style="text-decoration:none;">💬 WhatsApp</a>` : '';
        const mailBtn = email
            ? `<a href="mailto:${h(email)}?subject=Atualização%20pedido%20%23${id}&body=${encodeURIComponent(`Olá${clientName ? ' ' + clientName : ''}!\n\nSeu pedido #${id} está em: ${statusNames[status]||status}.\n\nQualquer dúvida, estou à disposição!`)}" class="btn-info btn-sm" style="text-decoration:none;">📧 E-mail</a>` : '';

        html += `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;
                              padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
            <div>
                <strong>#${id}</strong> — ${workTypeNames[wt]||wt}
                <span style="font-size:0.8em;color:var(--text-muted);margin-left:6px;">${statusNames[status]||status}</span><br>
                <span style="font-size:0.82em;">👤 ${h(clientName||'Sem cliente')} · ⏰ ${dias} dias sem atualização</span>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">${waBtn}${mailBtn}</div>
        </div>`;
    });

    list.innerHTML = html;
}

function updateAlertSystem() {
    let html = '';

    const lowStock = db.exec(
        'SELECT name, color, stock, min_alert FROM materials WHERE stock < min_alert'
    );
    if (lowStock.length > 0 && lowStock[0].values.length > 0) {
        lowStock[0].values.forEach(([name, color, stock, minAlert]) => {
            html += `<div class="alert-danger">
                ⚠️ Estoque baixo: ${name} ${color} — ${stock}g restante (mínimo ${minAlert}g)
            </div>`;
        });
    }

    const delayed = db.exec(
        `SELECT COUNT(*) FROM orders
         WHERE status NOT IN ('delivered','cancelled')
         AND deleted_at IS NULL
         AND julianday('now') - julianday(date) > 7`
    );
    const delayedCount = delayed[0]?.values[0]?.[0] ?? 0;
    if (delayedCount > 0) {
        html += `<div class="alert-warning">
            ⏰ ${delayedCount} pedido(s) com mais de 7 dias sem conclusão
        </div>`;
    }

    const lowProducts = db.exec('SELECT sku, name, stock_qty, min_stock FROM products WHERE active=1 AND stock_qty <= min_stock AND min_stock > 0');
    if (lowProducts.length > 0 && lowProducts[0].values.length > 0) {
        lowProducts[0].values.forEach(([sku, name, stock, minStock]) => {
            html += `<div class="alert-warning">🏷️ Estoque baixo de produto: ${sku} — ${name} (${stock}/${minStock})</div>`;
        });
    }

    const alertsEl = document.getElementById('alertsList');
    if (alertsEl) alertsEl.innerHTML = html || '<p style="color:#22543d">✅ Nenhum alerta no momento</p>';
}
