// Relatórios calculados no backend relacional (SQLite/PostgreSQL/SQL Server).
async function generateReport() {
    const startMonth = document.getElementById('reportStartMonth').value;
    const endMonth = document.getElementById('reportEndMonth').value;
    if (!startMonth || !endMonth) { showToast('⚠️ Selecione o período'); return; }
    if (startMonth > endMonth) { showToast('⚠️ Data inicial deve ser anterior à final'); return; }
    try {
        const url = `/api/relational/reports?start=${encodeURIComponent(startMonth)}&end=${encodeURIComponent(endMonth)}`;
        const response = await fetch(url, {cache:'no-store'});
        const data = await response.json();
        if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
        renderRelationalReport(data, startMonth, endMonth);
    } catch (error) {
        console.warn('[Relatórios] fallback local:', error);
        generateReportLocal();
    }
}

function renderRelationalReport(data, startMonth, endMonth) {
    const t = data.totals || {};
    const revenue = Number(t.revenue || 0);
    const profit = Number(t.profit || 0);
    const count = Number(t.orders || 0);
    const margin = revenue ? profit / revenue * 100 : 0;
    const expMap = Object.fromEntries((data.expenses_monthly || []).map(x => [x.month, Number(x.amount || 0)]));
    const totalExpenses = Object.values(expMap).reduce((a, b) => a + b, 0);
    const net = revenue - totalExpenses;

    const summary = [
        ['Faturamento', money(revenue), 'bi-currency-dollar', 'primary'],
        ['Lucro bruto', money(profit), 'bi-graph-up-arrow', 'success'],
        ['Margem', `${margin.toFixed(1)}%`, 'bi-percent', margin >= 30 ? 'success' : 'warning'],
        ['Pedidos', count, 'bi-bag-check', 'secondary'],
        ['Ticket médio', money(t.average_ticket || 0), 'bi-receipt', 'info'],
        ['Resultado líquido', money(net), 'bi-wallet2', net >= 0 ? 'success' : 'danger']
    ];

    let html = `<section class="row g-3 mb-4">${summary.map(([label, value, icon, tone]) => `<div class="col-12 col-sm-6 col-xl-2"><article class="s3d-report-kpi card border shadow-sm h-100"><div class="card-body"><span class="s3d-report-icon text-bg-${tone}"><i class="bi ${icon}"></i></span><small class="text-body-secondary d-block">${h(label)}</small><strong>${h(String(value))}</strong></div></article></div>`).join('')}</section>`;

    const monthly = data.monthly || [];
    if (monthly.length) {
        html += `<section class="card border shadow-sm mb-4"><div class="card-header bg-body d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-2"><div><h2 class="h5 mb-1">Evolução mensal</h2><p class="small text-body-secondary mb-0">Receita, despesas, lucro e resultado por mês.</p></div><span class="badge text-bg-secondary">Banco: ${h(data.engine || '—')}</span></div><div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead class="table-light"><tr><th>Mês</th><th class="text-end">Pedidos</th><th class="text-end">Receita</th><th class="text-end">Despesas</th><th class="text-end">Lucro</th><th class="text-end">Resultado</th></tr></thead><tbody>${monthly.map(x => { const e = expMap[x.month] || 0; const result = Number(x.revenue || 0) - e; return `<tr><td class="fw-semibold">${h(x.month)}</td><td class="text-end">${x.orders}</td><td class="text-end">${money(x.revenue)}</td><td class="text-end">${money(e)}</td><td class="text-end">${money(x.profit)}</td><td class="text-end fw-bold ${result >= 0 ? 'text-success' : 'text-danger'}">${money(result)}</td></tr>`; }).join('')}</tbody></table></div></section>`;
    }

    const reportTable = (title, subtitle, icon, heads, rows) => rows.length ? `<section class="card border shadow-sm mb-4"><div class="card-header bg-body"><h2 class="h5 mb-1"><i class="bi ${icon} me-2 text-primary"></i>${title}</h2><p class="small text-body-secondary mb-0">${subtitle}</p></div><div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead class="table-light"><tr>${heads.map((x, i) => `<th${i ? ' class="text-end"' : ''}>${x}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div></section>` : '';

    html += reportTable('Por tipo de trabalho', 'Distribuição dos pedidos e da rentabilidade.', 'bi-tags', ['Tipo', 'Pedidos', 'Receita', 'Lucro'], (data.by_type || []).map(x => `<tr><td class="fw-semibold">${h(getWorkTypeLabel(x.type))}</td><td class="text-end">${x.orders}</td><td class="text-end">${money(x.revenue)}</td><td class="text-end">${money(x.profit)}</td></tr>`));
    html += `<div class="row g-4"><div class="col-12 col-xl-6">${reportTable('Top clientes', 'Clientes com maior faturamento no período.', 'bi-people', ['Cliente', 'Pedidos', 'Total'], (data.top_clients || []).map(x => `<tr><td class="fw-semibold">${h(x.name)}</td><td class="text-end">${x.orders}</td><td class="text-end">${money(x.total)}</td></tr>`))}</div><div class="col-12 col-xl-6">${reportTable('Materiais mais usados', 'Consumo e frequência nos pedidos.', 'bi-box-seam', ['Material', 'Peso', 'Pedidos'], (data.top_materials || []).map(x => `<tr><td class="fw-semibold">${h(x.name)}</td><td class="text-end">${formatDecimal(x.grams)} g</td><td class="text-end">${x.orders}</td></tr>`))}</div></div>`;
    html += `<div class="d-flex justify-content-end mt-3"><button class="btn btn-primary" onclick="exportReportCSV('${startMonth}','${endMonth}')"><i class="bi bi-file-earmark-spreadsheet me-1"></i>Exportar CSV completo</button></div>`;
    document.getElementById('reportResult').innerHTML = html;
}

// ==================== RELATÓRIOS ====================

function generateReportLocal() {
    const startMonth = document.getElementById('reportStartMonth').value;
    const endMonth   = document.getElementById('reportEndMonth').value;

    if (!startMonth || !endMonth) { showToast('⚠️ Selecione o período'); return; }
    if (startMonth > endMonth)    { showToast('⚠️ Data inicial deve ser anterior à final'); return; }

    // ── Totais gerais ──────────────────────────────────────────────────────
    const totals = db.exec(
        `SELECT SUM(total_price), SUM(profit), COUNT(*), AVG(total_price)
         FROM orders
         WHERE strftime('%Y-%m', date) >= ? AND strftime('%Y-%m', date) <= ?
         AND status NOT IN ('cancelled','quote') AND deleted_at IS NULL`,
        [startMonth, endMonth]
    );
    const [revenue=0, profit=0, count=0, avgTicket=0] = totals[0]?.values[0] ?? [];
    const margin = revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : 0;

    // ── Evolução mensal ────────────────────────────────────────────────────
    const monthly = db.exec(
        `SELECT strftime('%Y-%m', date) AS mes,
                SUM(total_price) AS fat,
                SUM(profit) AS luc,
                COUNT(*) AS qtd
         FROM orders
         WHERE strftime('%Y-%m', date) >= ? AND strftime('%Y-%m', date) <= ?
         AND status NOT IN ('cancelled','quote') AND deleted_at IS NULL
         GROUP BY mes ORDER BY mes`,
        [startMonth, endMonth]
    );

    // ── Por tipo de trabalho ───────────────────────────────────────────────
    const byType = db.exec(
        `SELECT work_type, COUNT(*) AS qty, SUM(total_price) AS total, SUM(profit) AS lucro
         FROM orders
         WHERE strftime('%Y-%m', date) >= ? AND strftime('%Y-%m', date) <= ?
         AND status NOT IN ('cancelled','quote') AND deleted_at IS NULL
         GROUP BY work_type ORDER BY total DESC`,
        [startMonth, endMonth]
    );

    // ── Top materiais ──────────────────────────────────────────────────────
    const topMaterials = db.exec(
        `SELECT material_name, COUNT(*) AS qty, SUM(total_price) AS total
         FROM orders
         WHERE strftime('%Y-%m', date) >= ? AND strftime('%Y-%m', date) <= ?
         AND status NOT IN ('cancelled','quote') AND deleted_at IS NULL
         GROUP BY material_name ORDER BY qty DESC LIMIT 5`,
        [startMonth, endMonth]
    );

    // ── Top clientes ───────────────────────────────────────────────────────
    const topClients = db.exec(
        `SELECT COALESCE(c.name,'Sem cliente') AS nome, COUNT(o.id) AS qty, SUM(o.total_price) AS total
         FROM orders o
         LEFT JOIN clients c ON o.client_id = c.id
         WHERE strftime('%Y-%m', o.date) >= ? AND strftime('%Y-%m', o.date) <= ?
         AND o.status NOT IN ('cancelled','quote') AND o.deleted_at IS NULL
         GROUP BY o.client_id ORDER BY total DESC LIMIT 5`,
        [startMonth, endMonth]
    );

    // ── Montar HTML ────────────────────────────────────────────────────────
    let html = '';

    // Cards de resumo
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:20px;">
        ${statCard('Faturamento', 'R$ ' + formatDecimal(revenue))}
        ${statCard('Lucro Bruto', 'R$ ' + formatDecimal(profit))}
        ${statCard('Margem Média', margin + '%')}
        ${statCard('Pedidos', count)}
        ${statCard('Ticket Médio', 'R$ ' + formatDecimal(avgTicket))}
    </div>`;

    // Gráfico de evolução mensal
    if (monthly.length > 0 && monthly[0].values.length > 0) {
        const rows = monthly[0].values;
        const maxFat = Math.max(...rows.map(r => r[1] || 0), 1);
        html += `<h4 style="margin:16px 0 8px;">📈 Evolução Mensal</h4>
        <div style="display:flex;align-items:flex-end;gap:8px;height:130px;padding:0 4px;overflow-x:auto;">`;
        rows.forEach(([mes, fat, luc, qtd]) => {
            const h = Math.max(8, Math.round(((fat||0) / maxFat) * 110));
            const mg = fat > 0 ? ((luc/fat)*100).toFixed(0) : 0;
            html += `<div style="display:flex;flex-direction:column;align-items:center;min-width:54px;">
                <div style="font-size:0.65em;color:var(--text-muted);margin-bottom:2px;">R$${Math.round(fat||0)}</div>
                <div title="Fat: R$ ${formatDecimal(fat)} | Lucro: R$ ${formatDecimal(luc)} | Margem: ${mg}% | ${qtd} pedidos"
                     style="background:var(--primary,#00AE42);width:40px;height:${h}px;border-radius:4px 4px 0 0;cursor:default;"></div>
                <div style="font-size:0.65em;margin-top:4px;color:var(--text-muted);">${mes.slice(5)}</div>
            </div>`;
        });
        html += `</div>`;

        // Tabela detalhada dos meses
        html += `<div class="table-container" style="margin-top:10px;">
        <table style="font-size:0.85em;">
          <thead><tr><th>Mês</th><th>Pedidos</th><th>Faturamento</th><th>Lucro</th><th>Margem</th></tr></thead><tbody>`;
        rows.forEach(([mes, fat, luc, qtd]) => {
            const mg = fat > 0 ? ((luc/fat)*100).toFixed(1) : '0.0';
            html += `<tr><td>${mes}</td><td>${qtd}</td><td>R$ ${formatDecimal(fat)}</td><td>R$ ${formatDecimal(luc)}</td><td>${mg}%</td></tr>`;
        });
        html += `</tbody></table></div>`;
    }

    // Por tipo de trabalho
    if (byType.length > 0 && byType[0].values.length > 0) {
        html += `<h4 style="margin:20px 0 8px;">🏷️ Por Tipo de Trabalho</h4>
        <div class="table-container"><table style="font-size:0.85em;">
          <thead><tr><th>Tipo</th><th>Pedidos</th><th>Faturamento</th><th>Lucro</th><th>Margem</th></tr></thead><tbody>`;
        byType[0].values.forEach(([type, qty, total, lucro]) => {
            const mg = total > 0 ? ((lucro/total)*100).toFixed(1) : '0.0';
            html += `<tr><td>${typeof getWorkTypeLabel === 'function' ? getWorkTypeLabel(type) : h(type)}</td><td>${qty}</td><td>R$ ${formatDecimal(total)}</td><td>R$ ${formatDecimal(lucro)}</td><td>${mg}%</td></tr>`;
        });
        html += `</tbody></table></div>`;
    }

    // Top materiais
    if (topMaterials.length > 0 && topMaterials[0].values.length > 0) {
        html += `<h4 style="margin:20px 0 8px;">🧱 Materiais Mais Usados</h4>
        <div class="table-container"><table style="font-size:0.85em;">
          <thead><tr><th>Material</th><th>Pedidos</th><th>Faturamento</th></tr></thead><tbody>`;
        topMaterials[0].values.forEach(([name, qty, total]) => {
            html += `<tr><td>${h(name)}</td><td>${qty}</td><td>R$ ${formatDecimal(total)}</td></tr>`;
        });
        html += `</tbody></table></div>`;
    }

    // Top clientes
    if (topClients.length > 0 && topClients[0].values.length > 0) {
        html += `<h4 style="margin:20px 0 8px;">👥 Top Clientes</h4>
        <div class="table-container"><table style="font-size:0.85em;">
          <thead><tr><th>Cliente</th><th>Pedidos</th><th>Faturamento</th></tr></thead><tbody>`;
        topClients[0].values.forEach(([nome, qty, total]) => {
            html += `<tr><td>${h(nome)}</td><td>${qty}</td><td>R$ ${formatDecimal(total)}</td></tr>`;
        });
        html += `</tbody></table></div>`;
    }

    // ── Fluxo de Caixa (integração com Despesas) ──────────────────────────
    if (typeof getExpensesByMonth === 'function') {
        const expByMonth = getExpensesByMonth(startMonth, endMonth);
        const totalExpenses = typeof getExpensesTotal === 'function'
            ? getExpensesTotal(startMonth, endMonth) : 0;
        const netResult = (revenue||0) - (totalExpenses||0);
        const netColor  = netResult >= 0 ? '#38a169' : '#e53e3e';

        html += `<h4 style="margin:24px 0 10px;">💰 Fluxo de Caixa</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px;">
            ${statCard('Receita', 'R$ '+formatDecimal(revenue))}
            ${statCard('Despesas', 'R$ '+formatDecimal(totalExpenses))}
            ${statCard('Resultado', `<span style="color:${netColor};">R$ ${formatDecimal(netResult)}</span>`)}
        </div>`;

        // Comparativo mensal receita vs despesas
        if (monthly.length > 0 && monthly[0].values.length > 0) {
            const expMap = {};
            if (expByMonth.length > 0 && expByMonth[0].values.length > 0) {
                expByMonth[0].values.forEach(([m, v]) => { expMap[m] = v; });
            }
            html += `<div class="table-container"><table style="font-size:0.84em;">
              <thead><tr><th>Mês</th><th>Receita</th><th>Despesas</th><th>Resultado</th></tr></thead><tbody>`;
            monthly[0].values.forEach(([mes, fat]) => {
                const exp = expMap[mes] || 0;
                const net = (fat||0) - exp;
                const clr = net >= 0 ? '#38a169' : '#e53e3e';
                html += `<tr>
                    <td>${mes}</td>
                    <td>R$ ${formatDecimal(fat)}</td>
                    <td>R$ ${formatDecimal(exp)}</td>
                    <td style="color:${clr};font-weight:700;">R$ ${formatDecimal(net)}</td>
                </tr>`;
            });
            html += `</tbody></table></div>`;
        }
    }

    // Botão exportar
    html += `<div style="margin-top:16px;">
        <button class="btn btn-primary" onclick="exportReportCSV('${startMonth}','${endMonth}')">📎 Exportar CSV completo</button>
    </div>`;

    document.getElementById('reportResult').innerHTML = html;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function statCard(label, value) {
    return `<div class="card border shadow-sm h-100"><div class="card-body text-center"><small class="text-body-secondary d-block mb-1">${label}</small><strong class="fs-5">${value}</strong></div></div>`;
}

// ── Exportar relatório como CSV ────────────────────────────────────────────
function exportReportCSV(startMonth, endMonth) {
    const orders = db.exec(
        `SELECT o.id, COALESCE(c.name,'Sem cliente'), o.work_type, o.material_name,
                o.weight, o.print_time, o.quantity,
                o.unit_price, o.total_price, o.profit, o.status,
                strftime('%Y-%m', o.date)
         FROM orders o
         LEFT JOIN clients c ON o.client_id = c.id
         WHERE strftime('%Y-%m', o.date) >= ? AND strftime('%Y-%m', o.date) <= ?
         AND o.status NOT IN ('cancelled','quote') AND o.deleted_at IS NULL
         ORDER BY o.date`,
        [startMonth, endMonth]
    );
    if (!orders.length || !orders[0].values.length) { showToast('Nenhum dado para exportar'); return; }

    const header = 'ID,Cliente,Tipo,Material,Peso(g),Tempo(h),Qtd,Preço Unit,Total,Lucro,Status,Mês\n';
    const rows = orders[0].values.map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + header + rows], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `relatorio_${startMonth}_${endMonth}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
