// ==================== RELATÓRIOS ====================

function generateReport() {
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
        ${statCard('Faturamento', 'R$ ' + fmt2(revenue))}
        ${statCard('Lucro Bruto', 'R$ ' + fmt2(profit))}
        ${statCard('Margem Média', margin + '%')}
        ${statCard('Pedidos', count)}
        ${statCard('Ticket Médio', 'R$ ' + fmt2(avgTicket))}
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
                <div title="Fat: R$ ${fmt2(fat)} | Lucro: R$ ${fmt2(luc)} | Margem: ${mg}% | ${qtd} pedidos"
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
            html += `<tr><td>${mes}</td><td>${qtd}</td><td>R$ ${fmt2(fat)}</td><td>R$ ${fmt2(luc)}</td><td>${mg}%</td></tr>`;
        });
        html += `</tbody></table></div>`;
    }

    // Por tipo de trabalho
    if (byType.length > 0 && byType[0].values.length > 0) {
        const typeNames = { simple:'Brinde Simples', personalized:'Personalizado', technical:'Técnica', custom:'Sob Medida' };
        html += `<h4 style="margin:20px 0 8px;">🏷️ Por Tipo de Trabalho</h4>
        <div class="table-container"><table style="font-size:0.85em;">
          <thead><tr><th>Tipo</th><th>Pedidos</th><th>Faturamento</th><th>Lucro</th><th>Margem</th></tr></thead><tbody>`;
        byType[0].values.forEach(([type, qty, total, lucro]) => {
            const mg = total > 0 ? ((lucro/total)*100).toFixed(1) : '0.0';
            html += `<tr><td>${typeNames[type]||type}</td><td>${qty}</td><td>R$ ${fmt2(total)}</td><td>R$ ${fmt2(lucro)}</td><td>${mg}%</td></tr>`;
        });
        html += `</tbody></table></div>`;
    }

    // Top materiais
    if (topMaterials.length > 0 && topMaterials[0].values.length > 0) {
        html += `<h4 style="margin:20px 0 8px;">🧱 Materiais Mais Usados</h4>
        <div class="table-container"><table style="font-size:0.85em;">
          <thead><tr><th>Material</th><th>Pedidos</th><th>Faturamento</th></tr></thead><tbody>`;
        topMaterials[0].values.forEach(([name, qty, total]) => {
            html += `<tr><td>${h(name)}</td><td>${qty}</td><td>R$ ${fmt2(total)}</td></tr>`;
        });
        html += `</tbody></table></div>`;
    }

    // Top clientes
    if (topClients.length > 0 && topClients[0].values.length > 0) {
        html += `<h4 style="margin:20px 0 8px;">👥 Top Clientes</h4>
        <div class="table-container"><table style="font-size:0.85em;">
          <thead><tr><th>Cliente</th><th>Pedidos</th><th>Faturamento</th></tr></thead><tbody>`;
        topClients[0].values.forEach(([nome, qty, total]) => {
            html += `<tr><td>${h(nome)}</td><td>${qty}</td><td>R$ ${fmt2(total)}</td></tr>`;
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
            ${statCard('Receita', 'R$ '+fmt2(revenue))}
            ${statCard('Despesas', 'R$ '+fmt2(totalExpenses))}
            ${statCard('Resultado', `<span style="color:${netColor};">R$ ${fmt2(netResult)}</span>`)}
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
                    <td>R$ ${fmt2(fat)}</td>
                    <td>R$ ${fmt2(exp)}</td>
                    <td style="color:${clr};font-weight:700;">R$ ${fmt2(net)}</td>
                </tr>`;
            });
            html += `</tbody></table></div>`;
        }
    }

    // Botão exportar
    html += `<div style="margin-top:16px;">
        <button class="btn-primary" onclick="exportReportCSV('${startMonth}','${endMonth}')">📎 Exportar CSV completo</button>
    </div>`;

    document.getElementById('reportResult').innerHTML = html;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt2(v) { return (Number(v)||0).toFixed(2).replace('.',','); }

function statCard(label, value) {
    return `<div class="stat-card" style="padding:10px;text-align:center;">
        <div style="font-size:0.78em;color:var(--text-muted);margin-bottom:4px;">${label}</div>
        <div style="font-size:1.15em;font-weight:700;">${value}</div>
    </div>`;
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
