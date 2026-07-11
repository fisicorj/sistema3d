// ==================== ADICIONAIS ====================

const ADDON_CATEGORIES = ['Acessório', 'Fixação', 'Pintura', 'Acabamento', 'Embalagem premium', 'Outro'];

function loadAddons() {
    const panel = document.getElementById('addonsTableBody');
    if (!panel) return;
    const rows = db.exec('SELECT id,name,category,unit_cost,description FROM addons ORDER BY category,name');
    if (!rows.length || !rows[0].values.length) {
        panel.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px;">Nenhum adicional cadastrado.</td></tr>';
        refreshAddonsChecklist();
        return;
    }
    panel.innerHTML = rows[0].values.map(([id, name, cat, cost, desc]) => `
        <tr>
            <td>${h(name)}</td>
            <td><span class="status-badge status-approved">${cat || '—'}</span></td>
            <td>R$ ${parseFloat(cost).toFixed(2)}</td>
            <td style="color:var(--text-muted);">${h(desc || '—')}</td>
            <td>
                <button class="btn-primary btn-sm" onclick="showAddonModal(${id})">✏️</button>
                <button class="btn-danger btn-sm" onclick="deleteAddon(${id})">🗑️</button>
            </td>
        </tr>`).join('');
    refreshAddonsChecklist();
}

function showAddonModal(id = null) {
    let name = '', category = ADDON_CATEGORIES[0], unit_cost = '', description = '';
    if (id) {
        const r = db.exec('SELECT name,category,unit_cost,description FROM addons WHERE id=?', [id]);
        if (r.length && r[0].values.length) {
            [name, category, unit_cost, description] = r[0].values[0];
        }
    }
    const catOptions = ADDON_CATEGORIES.map(c =>
        `<option value="${c}" ${c === category ? 'selected' : ''}>${c}</option>`).join('');

    document.getElementById('modalTitle').textContent = id ? 'Editar Adicional' : 'Novo Adicional';
    document.getElementById('modalBody').innerHTML = `
        <div class="field-group">
            <label>Nome do adicional</label>
            <input type="text" id="addonName" value="${h(name)}" placeholder="Ex: Corrente de chaveiro">
        </div>
        <div class="field-group">
            <label>Categoria</label>
            <select id="addonCategory">${catOptions}</select>
        </div>
        <div class="field-group">
            <label>Custo unitário (R$)</label>
            <input type="number" id="addonCost" value="${unit_cost}" min="0" step="0.10" placeholder="0.00">
        </div>
        <div class="field-group">
            <label>Descrição</label>
            <input type="text" id="addonDesc" value="${h(description)}" placeholder="Detalhes opcionais">
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;">
            <button class="btn-primary" style="flex:1" onclick="saveAddon(${id || 'null'})">💾 Salvar</button>
            <button class="btn-danger" style="flex:1" onclick="closeModal()">Cancelar</button>
        </div>`;
    openModal();
}

function saveAddon(id) {
    const name     = document.getElementById('addonName').value.trim();
    const category = document.getElementById('addonCategory').value;
    const cost     = parseFloat(document.getElementById('addonCost').value) || 0;
    const desc     = document.getElementById('addonDesc').value.trim();
    if (!name) { showToast('⚠️ Informe o nome do adicional'); return; }

    if (id) {
        db.run('UPDATE addons SET name=?,category=?,unit_cost=?,description=? WHERE id=?',
               [name, category, cost, desc, id]);
    } else {
        db.run('INSERT INTO addons (name,category,unit_cost,description) VALUES (?,?,?,?)',
               [name, category, cost, desc]);
    }
    persistDB();
    closeModal();
    loadAddons();
    updatePriceCalculation();
    showToast('✅ Adicional salvo!');
}

function deleteAddon(id) {
    if (!confirm('Remover este adicional?')) return;
    db.run('DELETE FROM addons WHERE id=?', [id]);
    persistDB();
    loadAddons();
    updatePriceCalculation();
    showToast('🗑️ Adicional removido.');
}

// Renderiza checklist de adicionais na aba Custos da calculadora
function refreshAddonsChecklist() {
    const container = document.getElementById('addonsChecklist');
    if (!container) return;
    const rows = db.exec('SELECT id,name,category,unit_cost FROM addons ORDER BY category,name');
    if (!rows.length || !rows[0].values.length) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:0.83em;">Nenhum adicional cadastrado. Cadastre em Adicionais.</p>';
        return;
    }

    // Agrupa por categoria
    const byCategory = {};
    rows[0].values.forEach(([id, name, cat, cost]) => {
        const c = cat || 'Outro';
        if (!byCategory[c]) byCategory[c] = [];
        byCategory[c].push({ id, name, cost });
    });

    container.innerHTML = Object.entries(byCategory).map(([cat, items]) => `
        <div style="margin-bottom:12px;">
            <div style="font-size:0.72em;font-weight:700;letter-spacing:1px;color:var(--text-dim);
                        text-transform:uppercase;margin-bottom:6px;">${h(cat)}</div>
            ${items.map(item => `
            <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;
                          border-radius:6px;cursor:pointer;transition:background 0.1s;"
                   onmouseover="this.style.background='rgba(255,255,255,0.05)'"
                   onmouseout="this.style.background='transparent'">
                <input type="checkbox" id="addon_${item.id}" value="${item.id}"
                       style="accent-color:var(--green);width:15px;height:15px;"
                       onchange="onAddonChange(${item.id}, this.checked)">
                <span style="flex:1;font-size:0.85em;color:var(--text);">${h(item.name)}</span>
                <span style="font-size:0.8em;color:var(--green-lite);font-weight:600;white-space:nowrap;">
                    R$ ${parseFloat(item.cost).toFixed(2)}
                </span>
                <span style="display:none;" id="addonQtyWrap_${item.id}">
                    <input type="number" id="addonQty_${item.id}" value="1" min="1" max="99"
                           style="width:48px;padding:3px 5px;font-size:0.8em;
                                  background:var(--surface2);border:1px solid var(--border-light);
                                  border-radius:5px;color:var(--text);text-align:center;"
                           onchange="updatePriceCalculation()">
                    <span style="font-size:0.75em;color:var(--text-dim);">×</span>
                </span>
            </label>`).join('')}
        </div>`).join('');
}

function onAddonChange(id, checked) {
    const wrap = document.getElementById(`addonQtyWrap_${id}`);
    if (wrap) wrap.style.display = checked ? 'inline-flex' : 'none';
    updatePriceCalculation();
}

// Retorna custo total dos adicionais selecionados
function getSelectedAddonsCost() {
    const rows = db.exec('SELECT id,unit_cost FROM addons');
    if (!rows.length || !rows[0].values.length) return 0;
    let total = 0;
    rows[0].values.forEach(([id, cost]) => {
        const chk = document.getElementById(`addon_${id}`);
        if (chk && chk.checked) {
            const qty = parseInt(document.getElementById(`addonQty_${id}`)?.value) || 1;
            total += parseFloat(cost) * qty;
        }
    });
    return total;
}

// Retorna lista descritiva dos adicionais selecionados (para relatório/PDF)
function getSelectedAddonsLabel() {
    const rows = db.exec('SELECT id,name,unit_cost FROM addons');
    if (!rows.length || !rows[0].values.length) return '';
    const selected = [];
    rows[0].values.forEach(([id, name, cost]) => {
        const chk = document.getElementById(`addon_${id}`);
        if (chk && chk.checked) {
            const qty = parseInt(document.getElementById(`addonQty_${id}`)?.value) || 1;
            selected.push(`${h(name)}${qty > 1 ? ` ×${qty}` : ''} (R$ ${(parseFloat(cost) * qty).toFixed(2)})`);
        }
    });
    return selected.join(', ');
}
