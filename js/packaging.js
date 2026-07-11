// ==================== EMBALAGENS ====================

function loadPackaging() {
    const panel = document.getElementById('packagingTableBody');
    if (!panel) return;
    const rows = db.exec('SELECT id,name,description,cost,weight FROM packaging ORDER BY cost');
    if (!rows.length || !rows[0].values.length) {
        panel.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px;">Nenhuma embalagem cadastrada.</td></tr>';
        refreshPackagingSelect();
        return;
    }
    panel.innerHTML = rows[0].values.map(([id, name, desc, cost, weight]) => `
        <tr>
            <td>${h(name)}</td>
            <td style="color:var(--text-muted);">${h(desc || '—')}</td>
            <td>R$ ${parseFloat(cost).toFixed(2)}</td>
            <td>${parseFloat(weight).toFixed(0)}g</td>
            <td>
                <button class="btn-primary btn-sm" onclick="showPackagingModal(${id})">✏️</button>
                <button class="btn-danger btn-sm" onclick="deletePackaging(${id})">🗑️</button>
            </td>
        </tr>`).join('');
    refreshPackagingSelect();
}

function showPackagingModal(id = null) {
    let name = '', description = '', cost = '', weight = '';
    if (id) {
        const r = db.exec('SELECT name,description,cost,weight FROM packaging WHERE id=?', [id]);
        if (r.length && r[0].values.length) {
            [name, description, cost, weight] = r[0].values[0];
        }
    }
    document.getElementById('modalTitle').textContent = id ? 'Editar Embalagem' : 'Nova Embalagem';
    document.getElementById('modalBody').innerHTML = `
        <div class="field-group">
            <label>Nome da embalagem</label>
            <input type="text" id="pkgName" value="${h(name)}" placeholder="Ex: Caixinha kraft M">
        </div>
        <div class="field-group">
            <label>Descrição</label>
            <input type="text" id="pkgDesc" value="${h(description)}" placeholder="Detalhes opcionais">
        </div>
        <div class="field-group">
            <label>Custo (R$)</label>
            <input type="number" id="pkgCost" value="${cost}" min="0" step="0.10" placeholder="0.00">
        </div>
        <div class="field-group">
            <label>Peso da embalagem (g)</label>
            <input type="number" id="pkgWeight" value="${weight}" min="0" step="1" placeholder="0">
            <small>Somado ao peso da peça para cálculo de frete</small>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;">
            <button class="btn-primary" style="flex:1" onclick="savePackaging(${id || 'null'})">💾 Salvar</button>
            <button class="btn-danger" style="flex:1" onclick="closeModal()">Cancelar</button>
        </div>`;
    openModal();
}

function savePackaging(id) {
    const name   = document.getElementById('pkgName').value.trim();
    const desc   = document.getElementById('pkgDesc').value.trim();
    const cost   = parseFloat(document.getElementById('pkgCost').value)   || 0;
    const weight = parseFloat(document.getElementById('pkgWeight').value) || 0;
    if (!name) { showToast('⚠️ Informe o nome da embalagem'); return; }

    if (id) {
        db.run('UPDATE packaging SET name=?,description=?,cost=?,weight=? WHERE id=?', [name, desc, cost, weight, id]);
    } else {
        db.run('INSERT INTO packaging (name,description,cost,weight) VALUES (?,?,?,?)', [name, desc, cost, weight]);
    }
    persistDB();
    closeModal();
    loadPackaging();
    updatePriceCalculation();
    showToast('✅ Embalagem salva!');
}

function deletePackaging(id) {
    if (!confirm('Remover esta embalagem?')) return;
    db.run('DELETE FROM packaging WHERE id=?', [id]);
    persistDB();
    loadPackaging();
    updatePriceCalculation();
    showToast('🗑️ Embalagem removida.');
}

// Atualiza o select da calculadora
function refreshPackagingSelect() {
    const sel = document.getElementById('calcPackaging');
    if (!sel) return;
    const saved = sel.value;
    const rows = db.exec('SELECT id,name,cost FROM packaging ORDER BY cost');
    sel.innerHTML = '';
    if (rows.length && rows[0].values.length) {
        rows[0].values.forEach(([id, name, cost]) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = `${h(name)} — R$ ${parseFloat(cost).toFixed(2)}`;
            if (String(id) === String(saved)) opt.selected = true;
            sel.appendChild(opt);
        });
    }
}

// Retorna o custo + peso da embalagem selecionada
function getSelectedPackaging() {
    const sel = document.getElementById('calcPackaging');
    if (!sel || !sel.value) return { cost: parseFloat(currentSettings.packagingCost) || 3, weight: 0 };
    const r = db.exec('SELECT cost,weight FROM packaging WHERE id=?', [sel.value]);
    if (r.length && r[0].values.length) {
        return { cost: r[0].values[0][0], weight: r[0].values[0][1] };
    }
    return { cost: parseFloat(currentSettings.packagingCost) || 3, weight: 0 };
}
