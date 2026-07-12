// ==================== MATERIAIS / ESTOQUE ====================

function loadMaterials() {
    const result = db.exec('SELECT id, name, color, spool_weight, cost, stock, min_alert FROM materials ORDER BY name, color');
    let rows = '';
    let lowStockHtml = '';

    if (result.length > 0 && result[0].values.length > 0) {
        result[0].values.forEach(([id, name, color, spoolW, cost, stock, minAlert]) => {
            const isLow = stock < minAlert;
            rows += `<tr>
                <td>${h(name)}</td>
                <td>${h(color)}</td>
                <td>${spoolW}g</td>
                <td>R$ ${cost.toFixed(2)}/kg</td>
                <td class="${isLow ? 'stock-low' : 'stock-ok'}">${stock}g</td>
                <td>${minAlert}g</td>
                <td class="text-end text-nowrap">
                    <div class="btn-toolbar justify-content-end flex-nowrap" role="toolbar" aria-label="Ações do material">
                        <div class="s3d-actions d-inline-flex flex-row flex-nowrap align-items-center gap-1 me-1" role="group">
                            <button class="btn btn-outline-success" title="Adicionar estoque" onclick="addStock(${id})"><i class="bi bi-plus-lg"></i></button>
                            <button class="btn btn-outline-secondary" title="Histórico de estoque" onclick="showStockHistory(${id}, decodeURIComponent('${encodedJsArg(`${name} ${color}`)}'))"><i class="bi bi-clock-history"></i></button>
                        </div>
                        <div class="s3d-actions d-inline-flex flex-row flex-nowrap align-items-center gap-1" role="group">
                            <button class="btn btn-outline-primary" title="Editar material" onclick="showEditMaterialModal(${id})"><i class="bi bi-pencil"></i></button>
                            <button class="btn btn-outline-danger" title="Excluir material" onclick="deleteMaterial(${id})"><i class="bi bi-trash"></i></button>
                        </div>
                    </div>
                </td>
            </tr>`;

            if (isLow) {
                lowStockHtml += `<div class="alert-danger">
                    ⚠️ ${h(name)} ${h(color)}: apenas ${stock}g restantes (mínimo: ${minAlert}g)
                </div>`;
            }
        });
    } else {
        rows = '<tr><td colspan="7" style="text-align:center">Nenhum material cadastrado</td></tr>';
    }

    document.getElementById('inventoryTableBody').innerHTML = rows;
    document.getElementById('lowStockAlert').innerHTML =
        lowStockHtml || '<p style="color:#22543d">✅ Todos os materiais com estoque adequado</p>';

    // Atualiza select da calculadora
    const sel = document.getElementById('calcMaterial');
    sel.replaceChildren();
    if (result.length > 0 && result[0].values.length > 0) {
        result[0].values.forEach(([id, name, color, , , stock]) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = `${name || 'Material'} ${color || ''} — ${stock}g disponível`;
            sel.appendChild(opt);
        });
    }
    if (typeof updateCalcEnergyFactorBadge === 'function') updateCalcEnergyFactorBadge();
}

function showMaterialModal() {
    document.getElementById('modalTitle').innerHTML = '➕ Novo Material';
    document.getElementById('modalBody').innerHTML = materialFormHTML();
    openModal();
}

function showEditMaterialModal(matId) {
    const r = db.exec('SELECT id, name, color, spool_weight, cost, stock, min_alert, energy_factor FROM materials WHERE id = ?', [matId]);
    if (!r.length) return;
    const [id, name, color, spoolW, cost, stock, minAlert, ef] = r[0].values[0];

    document.getElementById('modalTitle').innerHTML = '✏️ Editar Material';
    document.getElementById('modalBody').innerHTML =
        materialFormHTML({ name, color, spoolWeight: spoolW, cost, stock, minAlert, energyFactor: ef }) +
        `<input type="hidden" id="matEditId" value="${id}">`;
    openModal();
    document.querySelector('#modalBody .btn-primary').setAttribute('onclick', 'saveMaterial(true)');
    document.querySelector('#modalBody .btn-primary').textContent = 'Atualizar Material';
}

function materialFormHTML(data = {}) {
    const autoFactor = typeof getEnergyFactorFromName === 'function'
        ? getEnergyFactorFromName(data.name || '')
        : 1.00;
    const efValue = (data.energyFactor && data.energyFactor > 0) ? data.energyFactor : autoFactor;
    return `
        <div class="field-group"><label>Material</label>
            <input type="text" id="matName" value="${h(data.name || '')}" placeholder="Ex: PLA"></div>
        <div class="field-group"><label>Cor</label>
            <input type="text" id="matColor" value="${h(data.color || '')}" placeholder="Ex: Branco"></div>
        <div class="field-group"><label>Peso da Bobina (g)</label>
            <input type="number" id="matSpoolWeight" value="${data.spoolWeight ?? 1000}"></div>
        <div class="field-group"><label>Custo (R$/kg)</label>
            <input type="number" id="matCost" value="${data.cost ?? 90}" step="0.01"></div>
        <div class="field-group"><label>Fator de Energia
            <small style="font-weight:400;color:var(--text-muted);">PLA=1.00, PETG=1.10, ABS=1.30, Nylon=1.40</small></label>
            <input type="number" id="matEnergyFactor" value="${efValue}" min="0.5" max="3.0" step="0.05">
            <small>Multiplica o custo de energia pela maior demanda térmica do material.</small></div>
        <div class="field-group"><label>Estoque (g)</label>
            <input type="number" id="matStock" value="${data.stock ?? 1000}"></div>
        <div class="field-group"><label>Alerta Mínimo (g)</label>
            <input type="number" id="matMinAlert" value="${data.minAlert ?? 200}"></div>
        <button class="btn-primary" onclick="saveMaterial(false)" style="margin-top:15px;">Salvar Material</button>
    `;
}

function saveMaterial(isEdit = false) {
    const name        = document.getElementById('matName').value.trim();
    const color       = document.getElementById('matColor').value.trim();
    const spoolW      = parseFloat(document.getElementById('matSpoolWeight').value);
    const cost        = parseFloat(document.getElementById('matCost').value);
    const stock       = parseFloat(document.getElementById('matStock').value);
    const minAlert    = parseFloat(document.getElementById('matMinAlert').value);
    const energyFactor = parseFloat(document.getElementById('matEnergyFactor')?.value) || 1.00;

    if (!name) { showToast('⚠️ Nome do material é obrigatório'); return; }

    if (isEdit) {
        const id = parseInt(document.getElementById('matEditId').value);
        db.run('UPDATE materials SET name=?, color=?, spool_weight=?, cost=?, stock=?, min_alert=?, energy_factor=? WHERE id=?',
            [name, color, spoolW, cost, stock, minAlert, energyFactor, id]);
        showToast('✅ Material atualizado!');
    } else {
        db.run('INSERT INTO materials (name, color, spool_weight, cost, stock, min_alert, energy_factor) VALUES (?,?,?,?,?,?,?)',
            [name, color, spoolW, cost, stock, minAlert, energyFactor]);
        showToast('✅ Material salvo!');
    }

    persistDB();
    closeModal();
    loadMaterials();
}

function addStock(matId) {
    const matRow = db.exec('SELECT name, color, cost FROM materials WHERE id = ?', [matId]);
    if (!matRow.length) return;
    const [matName, matColor, currentCost] = matRow[0].values[0];

    document.getElementById('modalTitle').innerHTML = `➕ Entrada de Estoque — ${h(matName)} ${h(matColor)}`;
    document.getElementById('modalBody').innerHTML = `
        <div class="field-group">
            <label>Quantidade adicionada (gramas)</label>
            <input type="number" id="stockQtyG" value="1000" min="1" step="1">
        </div>
        <div class="field-group">
            <label>Preço pago pela bobina/lote (R$)</label>
            <input type="number" id="stockCostTotal" value="" min="0" step="0.01"
                placeholder="Ex.: 89.90 — deixe vazio para manter custo atual">
            <small>Se informado, recalcula o custo/kg do material automaticamente.</small>
        </div>
        <div class="field-group">
            <label>Observação (opcional)</label>
            <input type="text" id="stockNotes" placeholder="Ex.: Compra Bambu Store">
        </div>
        <div class="info-box" style="font-size:0.83em;">
            Custo/kg atual: <strong>R$ ${Number(currentCost).toFixed(2)}</strong>
        </div>
        <button class="btn-primary" onclick="saveAddStock(${matId})" style="margin-top:12px;">Confirmar entrada</button>
    `;
    openModal();
}

function saveAddStock(matId) {
    const amount    = parseFloat(document.getElementById('stockQtyG')?.value) || 0;
    const costTotal = parseFloat(document.getElementById('stockCostTotal')?.value);
    const notes     = document.getElementById('stockNotes')?.value?.trim() || 'Entrada manual de estoque';

    if (amount <= 0) { showToast('⚠️ Quantidade inválida'); return; }

    // Atualiza custo/kg se preço informado
    if (!isNaN(costTotal) && costTotal > 0) {
        const newCostPerKg = (costTotal / amount) * 1000;
        db.run('UPDATE materials SET cost = ? WHERE id = ?', [newCostPerKg, matId]);
        // Registra compra no histórico
        db.run('INSERT INTO stock_purchases (material_id, quantity_g, total_cost, cost_per_kg, date, notes) VALUES (?,?,?,?,?,?)',
            [matId, amount, costTotal, newCostPerKg, new Date().toISOString(), notes]);
        showToast(`✅ ${amount}g adicionados — novo custo/kg: R$ ${newCostPerKg.toFixed(2)}`);
    } else {
        showToast(`✅ ${amount}g adicionados ao estoque`);
    }

    updateStock(matId, -amount, 'entrada_manual', null, notes);
    persistDB();
    closeModal();
    loadMaterials();
    updateAlertSystem();
}

function deleteMaterial(matId) {
    if (confirm('Excluir este material?')) {
        db.run('DELETE FROM materials WHERE id = ?', [matId]);
        persistDB();
        loadMaterials();
    }
}

function showStockHistory(matId, matLabel) {
    const rows = db.exec(
        `SELECT sm.date, sm.movement_type, sm.grams, sm.previous_stock, sm.new_stock, sm.notes, sm.order_id
         FROM stock_movements sm
         WHERE sm.material_id = ?
         ORDER BY sm.id DESC
         LIMIT 100`,
        [matId]
    );

    const typeLabels = {
        saida_pedido:    '📦 Saída — Pedido',
        estorno_pedido:  '↩️ Estorno — Pedido',
        entrada_manual:  '➕ Entrada manual',
        falha_impressao: '⚠️ Falha de impressão',
        ajuste:          '🔧 Ajuste'
    };

    let tableHTML = '';
    if (rows.length > 0 && rows[0].values.length > 0) {
        tableHTML = `<div class="table-container" style="max-height:420px;overflow-y:auto;">
        <table style="font-size:0.82em;">
          <thead><tr><th>Data</th><th>Tipo</th><th>Gramas</th><th>Estoque Ant.</th><th>Estoque Nov.</th><th>Obs</th></tr></thead>
          <tbody>`;
        rows[0].values.forEach(([date, type, grams, prev, next, notes, orderId]) => {
            const label = typeLabels[type] || type;
            const sign  = grams > 0 ? `<span style="color:#e53e3e;">−${Math.abs(grams).toFixed(1)}g</span>`
                                    : `<span style="color:#38a169;">+${Math.abs(grams).toFixed(1)}g</span>`;
            const obs   = orderId ? `Pedido #${orderId}${notes ? ' — ' + h(notes) : ''}` : h(notes || '—');
            tableHTML += `<tr>
                <td style="white-space:nowrap;">${new Date(date).toLocaleString('pt-BR')}</td>
                <td>${label}</td>
                <td>${sign}</td>
                <td>${(prev||0).toFixed(0)}g</td>
                <td>${(next||0).toFixed(0)}g</td>
                <td style="font-size:0.9em;color:var(--text-muted);">${obs}</td>
            </tr>`;
        });
        tableHTML += `</tbody></table></div>`;
    } else {
        tableHTML = '<p style="color:var(--text-muted);padding:12px 0;">Nenhuma movimentação registrada ainda.</p>';
    }

    document.getElementById('modalTitle').innerHTML = `📋 Histórico — ${h(matLabel)}`;
    document.getElementById('modalBody').innerHTML = tableHTML;
    openModal();
}
