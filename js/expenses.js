// ==================== DESPESAS ====================

const EXPENSE_CATEGORIES = ['Filamento', 'Energia', 'Manutenção', 'Aluguel',
    'Software/Assinatura', 'Marketing', 'Embalagem', 'Logística', 'Equipamento', 'Geral'];

const RECURRENCE_LABELS = { once:'Única', monthly:'Mensal', yearly:'Anual' };

function loadExpenses() {
    // Preenche filtro de período com meses disponíveis
    const months = db.exec(
        `SELECT DISTINCT strftime('%Y-%m', date) AS m FROM expenses ORDER BY m DESC`
    );
    const filterEl = document.getElementById('expensePeriodFilter');
    const currentVal = filterEl?.value || 'all';
    if (filterEl) {
        filterEl.replaceChildren();
        const allOpt = document.createElement('option');
        allOpt.value = 'all'; allOpt.textContent = 'Todos os meses';
        filterEl.appendChild(allOpt);
        if (months.length > 0 && months[0].values.length > 0) {
            months[0].values.forEach(([m]) => {
                const opt = document.createElement('option');
                opt.value = m; opt.textContent = m;
                if (m === currentVal) opt.selected = true;
                filterEl.appendChild(opt);
            });
        }
        if (currentVal !== 'all') filterEl.value = currentVal;
    }

    const period = filterEl?.value || 'all';
    let query, params;
    if (period !== 'all') {
        query = `SELECT id, category, description, amount, recurrence, date
                 FROM expenses WHERE strftime('%Y-%m', date) = ? ORDER BY date DESC`;
        params = [period];
    } else {
        query = `SELECT id, category, description, amount, recurrence, date
                 FROM expenses ORDER BY date DESC`;
        params = [];
    }

    const rows = db.exec(query, params);
    const listEl = document.getElementById('expensesList');
    const sumEl  = document.getElementById('expensesSummary');

    if (!rows.length || !rows[0].values.length) {
        if (listEl) listEl.innerHTML = '<p style="color:var(--text-muted);padding:12px 0;">Nenhuma despesa registrada.</p>';
        if (sumEl)  sumEl.innerHTML  = '';
        return;
    }

    let total = 0;
    const byCat = {};
    let tableRows = '';

    rows[0].values.forEach(([id, cat, desc, amount, recur, date]) => {
        total += parseFloat(amount) || 0;
        byCat[cat] = (byCat[cat] || 0) + (parseFloat(amount) || 0);
        tableRows += `<tr>
            <td>${new Date(date).toLocaleDateString('pt-BR')}</td>
            <td><span style="background:rgba(0,174,66,.15);color:var(--primary);padding:2px 8px;border-radius:10px;font-size:0.78em;">${h(cat)}</span></td>
            <td>${h(desc)}</td>
            <td>R$ ${Number(amount).toFixed(2)}</td>
            <td style="color:var(--text-muted);font-size:0.82em;">${RECURRENCE_LABELS[recur]||recur}</td>
            <td>
                <button class="btn-warning btn-sm" onclick="showExpenseModal(${id})">✏️</button>
                <button class="btn-danger  btn-sm" onclick="deleteExpense(${id})">🗑️</button>
            </td>
        </tr>`;
    });

    if (listEl) listEl.innerHTML = `
        <div class="table-container">
        <table style="font-size:0.87em;">
          <thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Valor</th><th>Recorrência</th><th>Ações</th></tr></thead>
          <tbody>${tableRows}</tbody>
          <tfoot><tr><td colspan="3"><strong>Total</strong></td><td><strong>R$ ${total.toFixed(2)}</strong></td><td colspan="2"></td></tr></tfoot>
        </table></div>`;

    // Resumo por categoria
    const sortedCats = Object.entries(byCat).sort((a,b) => b[1]-a[1]);
    const maxVal = sortedCats[0]?.[1] || 1;
    let catHtml = '<h4 style="margin-bottom:10px;">Por categoria</h4><div style="display:flex;flex-direction:column;gap:6px;">';
    sortedCats.forEach(([cat, val]) => {
        const pct = Math.round((val/total)*100);
        const barW = Math.round((val/maxVal)*100);
        catHtml += `<div style="display:flex;align-items:center;gap:10px;font-size:0.84em;">
            <div style="width:110px;text-align:right;color:var(--text-muted);">${h(cat)}</div>
            <div style="flex:1;background:rgba(0,0,0,.12);border-radius:4px;height:10px;">
                <div style="height:100%;width:${barW}%;background:var(--primary);border-radius:4px;"></div>
            </div>
            <div style="width:110px;">R$ ${val.toFixed(2)} <span style="color:var(--text-muted);">(${pct}%)</span></div>
        </div>`;
    });
    catHtml += '</div>';
    if (sumEl) sumEl.innerHTML = catHtml;
}

function showExpenseModal(expenseId = null) {
    let data = {};
    if (expenseId) {
        const r = db.exec('SELECT * FROM expenses WHERE id = ?', [expenseId]);
        if (r.length && r[0].values.length) {
            const [id, cat, desc, amount, recur, date] = r[0].values[0];
            data = { id, cat, desc, amount, recur, date: date?.slice(0,10) };
        }
    }

    const catOptions = EXPENSE_CATEGORIES.map(c =>
        `<option value="${c}" ${data.cat===c?'selected':''}>${c}</option>`
    ).join('');

    document.getElementById('modalTitle').innerHTML = expenseId ? '✏️ Editar Despesa' : '➕ Nova Despesa';
    document.getElementById('modalBody').innerHTML = `
        <div class="input-group"><label>Categoria</label>
            <select id="expCat">${catOptions}</select></div>
        <div class="input-group"><label>Descrição</label>
            <input type="text" id="expDesc" value="${h(data.desc||'')}" placeholder="Ex.: Conta de luz, Bambu Cloud..."></div>
        <div class="input-group"><label>Valor (R$)</label>
            <input type="number" id="expAmount" value="${data.amount||''}" min="0" step="0.01"></div>
        <div class="input-group"><label>Recorrência</label>
            <select id="expRecur">
                <option value="once"    ${data.recur==='once'   ?'selected':''}>Única (não se repete)</option>
                <option value="monthly" ${data.recur==='monthly'?'selected':''}>Mensal</option>
                <option value="yearly"  ${data.recur==='yearly' ?'selected':''}>Anual</option>
            </select></div>
        <div class="input-group"><label>Data</label>
            <input type="date" id="expDate" value="${data.date || new Date().toISOString().slice(0,10)}"></div>
        ${expenseId ? `<input type="hidden" id="expId" value="${expenseId}">` : ''}
        <button class="btn-primary" onclick="saveExpense(${expenseId?'true':'false'})" style="margin-top:12px;">
            ${expenseId ? 'Atualizar' : 'Salvar Despesa'}
        </button>`;
    openModal();
}

function saveExpense(isEdit = false) {
    const cat    = document.getElementById('expCat')?.value;
    const desc   = document.getElementById('expDesc')?.value?.trim();
    const amount = parseFloat(document.getElementById('expAmount')?.value);
    const recur  = document.getElementById('expRecur')?.value;
    const date   = document.getElementById('expDate')?.value;

    if (!desc) { showToast('⚠️ Descrição obrigatória'); return; }
    if (!amount || amount <= 0) { showToast('⚠️ Valor inválido'); return; }
    if (!date)  { showToast('⚠️ Data obrigatória'); return; }

    if (isEdit) {
        const id = parseInt(document.getElementById('expId')?.value);
        db.run('UPDATE expenses SET category=?,description=?,amount=?,recurrence=?,date=? WHERE id=?',
            [cat, desc, amount, recur, date, id]);
        showToast('✅ Despesa atualizada!');
    } else {
        db.run('INSERT INTO expenses (category,description,amount,recurrence,date) VALUES (?,?,?,?,?)',
            [cat, desc, amount, recur, date]);
        showToast('✅ Despesa salva!');
    }
    persistDB();
    closeModal();
    loadExpenses();
}

function deleteExpense(id) {
    if (confirm('Excluir esta despesa?')) {
        db.run('DELETE FROM expenses WHERE id = ?', [id]);
        persistDB();
        loadExpenses();
    }
}

// Retorna total de despesas num período (usado pelos Relatórios)
function getExpensesTotal(startMonth, endMonth) {
    const r = db.exec(
        `SELECT SUM(amount) FROM expenses
         WHERE strftime('%Y-%m', date) >= ? AND strftime('%Y-%m', date) <= ?`,
        [startMonth, endMonth]
    );
    return r[0]?.values[0]?.[0] ?? 0;
}

function getExpensesByMonth(startMonth, endMonth) {
    return db.exec(
        `SELECT strftime('%Y-%m', date) AS mes, SUM(amount) AS total
         FROM expenses
         WHERE strftime('%Y-%m', date) >= ? AND strftime('%Y-%m', date) <= ?
         GROUP BY mes ORDER BY mes`,
        [startMonth, endMonth]
    );
}
