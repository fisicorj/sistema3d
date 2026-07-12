async function loadFinanceDashboard() {
    if (!db) return;
    const input = document.getElementById('financeMonth');
    if (!input) return;
    if (!input.value) input.value = new Date().toISOString().slice(0, 7);
    const month = input.value;

    try {
        // Garante que alterações recentes do espelho chegaram ao banco selecionado.
        if (window.RelationalSync) await window.RelationalSync.syncNow();
        if (window.RelationalSync) {
            const data = await window.RelationalSync.finance(month);
            renderFinanceData(data);
            return;
        }
    } catch (error) {
        console.warn('[Financeiro] Consulta relacional indisponível; usando espelho local.', error);
    }
    renderFinanceData(localFinanceData(month));
}

function localFinanceData(month) {
    const one = (sql, params = []) => db.exec(sql, params)[0]?.values[0]?.[0] || 0;
    const revenue = one(`SELECT SUM(total_price) FROM orders WHERE strftime('%Y-%m',date)=? AND status NOT IN ('quote','cancelled') AND deleted_at IS NULL`, [month]);
    const profit = one(`SELECT SUM(profit) FROM orders WHERE strftime('%Y-%m',date)=? AND status NOT IN ('quote','cancelled') AND deleted_at IS NULL`, [month]);
    const expenses = one(`SELECT SUM(amount) FROM expenses WHERE strftime('%Y-%m',date)=?`, [month]);
    const receivable = one(`SELECT SUM(MAX(total_price-COALESCE(paid_amount,0),0)) FROM orders WHERE status NOT IN ('quote','cancelled','delivered') AND deleted_at IS NULL`);
    const orderCount = one(`SELECT COUNT(*) FROM orders WHERE strftime('%Y-%m',date)=? AND status NOT IN ('quote','cancelled') AND deleted_at IS NULL`, [month]);
    const result = db.exec(`SELECT o.id,COALESCE(c.name,'Sem cliente'),o.total_price,COALESCE(o.paid_amount,0),o.status FROM orders o LEFT JOIN clients c ON c.id=o.client_id WHERE o.deleted_at IS NULL AND o.status NOT IN ('quote','cancelled','delivered') AND COALESCE(o.paid_amount,0)<o.total_price ORDER BY (o.total_price-COALESCE(o.paid_amount,0)) DESC LIMIT 10`);
    const pending = (result[0]?.values || []).map(row => ({
        id: row[0], client_name: row[1], total_price: row[2], paid_amount: row[3],
        status: row[4], balance: Number(row[2] || 0) - Number(row[3] || 0)
    }));
    return {
        revenue, profit, expenses, net: revenue - expenses, receivable,
        gross_margin: revenue ? profit / revenue * 100 : 0,
        net_margin: revenue ? (revenue - expenses) / revenue * 100 : 0,
        average_ticket: orderCount ? revenue / orderCount : 0,
        order_count: orderCount, pending
    };
}

function renderFinanceData(data) {
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    const revenue = Number(data.revenue || 0);
    const profit = Number(data.profit || 0);
    const expenses = Number(data.expenses || 0);
    const net = Number(data.net ?? (revenue - expenses));
    set('finRevenue', money(revenue));
    set('finExpenses', money(expenses));
    set('finNet', money(net));
    set('finReceivable', money(Number(data.receivable || 0)));
    set('finConsignment', money(Number(data.consignment_owner || 0)));

    const max = Math.max(
        Math.abs(Number(data.order_revenue ?? revenue - Number(data.consignment_owner || 0))),
        Math.abs(Number(data.consignment_owner || 0)),
        Math.abs(Number(data.consignment_commission || 0)),
        Math.abs(expenses), Math.abs(net), 1
    );
    const rows = [
        ['Pedidos', Number(data.order_revenue ?? revenue - Number(data.consignment_owner || 0)), 'primary'],
        ['Consignação líquida', Number(data.consignment_owner || 0), 'info'],
        ['Comissão dos locais', Number(data.consignment_commission || 0), 'warning'],
        ['Despesas', expenses, 'danger'],
        ['Resultado', net, net >= 0 ? 'success' : 'danger']
    ];
    const bars = document.getElementById('financeBars');
    if (bars) bars.innerHTML = rows.map(([name, value, tone]) => {
        const width = Math.max(2, Math.abs(value) / max * 100);
        return `<div class="s3d-finance-bar-item">
            <div class="d-flex justify-content-between align-items-center gap-3 mb-2">
                <span class="fw-semibold">${h(name)}</span><strong>${money(value)}</strong>
            </div>
            <div class="progress" role="progressbar" aria-label="${h(name)}" aria-valuenow="${Math.round(width)}" aria-valuemin="0" aria-valuemax="100">
                <div class="progress-bar bg-${tone}" style="width:${width}%"></div>
            </div>
        </div>`;
    }).join('');

    const metrics = [
        ['Margem bruta', `${Number(data.gross_margin || 0).toFixed(1)}%`, 'bi-percent'],
        ['Margem líquida', `${Number(data.net_margin || 0).toFixed(1)}%`, 'bi-graph-up'],
        ['Ticket médio', money(Number(data.average_ticket || 0)), 'bi-receipt'],
        ['Pedidos no período', Number(data.order_count || 0), 'bi-bag-check'],
        ['Unidades consignadas', Number(data.consignment_quantity || 0), 'bi-shop-window']
    ];
    const indicators = document.getElementById('financeIndicators');
    if (indicators) indicators.innerHTML = metrics.map(([label, value, icon]) => `<div class="s3d-metric-item">
        <span class="s3d-metric-icon"><i class="bi ${icon}"></i></span>
        <div class="min-w-0"><small class="text-body-secondary d-block">${h(label)}</small><strong>${h(String(value))}</strong></div>
    </div>`).join('');

    const pending = Array.isArray(data.pending) ? data.pending : [];
    set('financePendingCount', `${pending.length} ${pending.length === 1 ? 'pendente' : 'pendentes'}`);
    const pendingEl = document.getElementById('financePending');
    if (!pendingEl) return;
    pendingEl.innerHTML = pending.length ? `<div class="table-responsive"><table class="table table-hover align-middle mb-0">
        <thead class="table-light"><tr><th>Pedido</th><th>Cliente</th><th class="text-end">Total</th><th class="text-end">Pago</th><th class="text-end">Saldo</th><th class="text-end">Ação</th></tr></thead>
        <tbody>${pending.map(item => `<tr>
            <td><span class="badge text-bg-secondary">#${item.id}</span></td>
            <td class="fw-semibold">${h(item.client_name || 'Sem cliente')}</td>
            <td class="text-end">${money(item.total_price)}</td>
            <td class="text-end">${money(item.paid_amount)}</td>
            <td class="text-end fw-bold text-warning-emphasis">${money(item.balance)}</td>
            <td class="text-end"><button class="btn btn-sm btn-primary" onclick="registerPayment(${item.id},${Number(item.total_price || 0)},${Number(item.paid_amount || 0)})"><i class="bi bi-cash-coin me-1"></i>Registrar</button></td>
        </tr>`).join('')}</tbody></table></div>` : `<div class="text-center py-5"><i class="bi bi-check-circle display-6 text-success"></i><h3 class="h6 mt-3">Nenhuma cobrança pendente</h3><p class="text-body-secondary mb-0">Todos os pedidos estão com os pagamentos em dia.</p></div>`;
}
