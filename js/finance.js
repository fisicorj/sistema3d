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
            try { const cs=await fetch(`/api/relational/consignments-summary?month=${encodeURIComponent(month)}`,{cache:'no-store'}).then(r=>r.json()); data.consignment_owner=Number(cs.owner_amount||0); } catch(_) {}
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

    const max = Math.max(Math.abs(revenue), Math.abs(expenses), Math.abs(profit), Math.abs(net), 1);
    const bars = document.getElementById('financeBars');
    if (bars) bars.innerHTML = [
        ['Receita', revenue], ['Lucro bruto', profit], ['Despesas', expenses], ['Resultado', net]
    ].map(([name, value]) => `<div class="finance-bar-row"><span>${name}</span><div><i style="width:${Math.max(3, Math.abs(value) / max * 100)}%"></i></div><strong>${money(value)}</strong></div>`).join('');

    const indicators = document.getElementById('financeIndicators');
    if (indicators) indicators.innerHTML = `
        <div><span>Margem bruta</span><strong>${Number(data.gross_margin || 0).toFixed(1)}%</strong></div>
        <div><span>Margem líquida</span><strong>${Number(data.net_margin || 0).toFixed(1)}%</strong></div>
        <div><span>Ticket médio</span><strong>${money(Number(data.average_ticket || 0))}</strong></div>
        <div><span>Pedidos no período</span><strong>${Number(data.order_count || 0)}</strong></div>`;

    const pending = Array.isArray(data.pending) ? data.pending : [];
    const pendingEl = document.getElementById('financePending');
    if (!pendingEl) return;
    pendingEl.innerHTML = pending.length ? `<div class="responsive-table"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Total</th><th>Pago</th><th>Saldo</th><th></th></tr></thead><tbody>${pending.map(item => `<tr><td>#${item.id}</td><td>${h(item.client_name || 'Sem cliente')}</td><td>${money(item.total_price)}</td><td>${money(item.paid_amount)}</td><td><strong>${money(item.balance)}</strong></td><td><button class="btn-info btn-sm" onclick="registerPayment(${item.id},${Number(item.total_price || 0)},${Number(item.paid_amount || 0)})">Registrar</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">✅ Nenhuma cobrança pendente.</div>';
}
