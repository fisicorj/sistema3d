// ==================== ITENS DE MANUTENÇÃO ====================
// Cada item representa um consumível ou peça com vida útil definida.
// O custo/hora de cada item = custo / vida_útil_em_horas.
// A soma de todos os itens ativos substitui o campo "Manutenção/h" na calculadora.

const MAINTENANCE_DEFAULTS = [
    { name: 'Bico de impressão (0.4mm)',  cost: 15.00,  lifespan_hours: 500,  notes: 'Trocar quando houver subextrusão ou entupimentos frequentes' },
    { name: 'Tubo PTFE',                  cost: 12.00,  lifespan_hours: 1000, notes: 'Verificar desgaste na entrada do hotend' },
    { name: 'Cama de vidro / PEI',        cost: 60.00,  lifespan_hours: 2000, notes: 'PEI perde aderência após muitos ciclos' },
    { name: 'Lubrificação dos trilhos',   cost: 5.00,   lifespan_hours: 200,  notes: 'Graxa para trilhos lineares' },
    { name: 'Correia de transmissão',     cost: 20.00,  lifespan_hours: 3000, notes: 'X e Y — verificar tensão regularmente' },
];

function loadMaintenance() {
    // Semeie itens padrão na primeira vez
    const count = db.exec('SELECT COUNT(*) FROM maintenance_items');
    if (count[0]?.values[0]?.[0] === 0) {
        MAINTENANCE_DEFAULTS.forEach(item => {
            db.run(
                'INSERT INTO maintenance_items (name, cost, lifespan_hours, active, notes) VALUES (?,?,?,1,?)',
                [item.name, item.cost, item.lifespan_hours, item.notes || '']
            );
        });
        persistDB();
    }

    _renderMaintenanceTable();
    _renderMaintenanceSummary();
}

function _renderMaintenanceTable() {
    const rows = db.exec(
        'SELECT id, name, cost, lifespan_hours, active, notes FROM maintenance_items ORDER BY name'
    );
    const tbody = document.getElementById('maintenanceTableBody');
    if (!tbody) return;

    if (!rows.length || !rows[0].values.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">Nenhum item cadastrado.</td></tr>';
        return;
    }

    tbody.innerHTML = rows[0].values.map(([id, name, cost, lifespanH, active, notes]) => {
        const cph    = lifespanH > 0 ? cost / lifespanH : 0;
        const isOn   = active === 1 || active === true;
        const rowOp  = isOn ? '1' : '0.45';
        return `<tr style="opacity:${rowOp};">
            <td>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                    <input type="checkbox" ${isOn ? 'checked' : ''}
                        onchange="toggleMaintenanceItem(${id}, this.checked)"
                        style="width:16px;height:16px;cursor:pointer;">
                    <span style="font-weight:${isOn?'600':'400'};">${h(name)}</span>
                </label>
                ${notes ? `<div style="font-size:0.75em;color:var(--text-muted);margin-top:2px;padding-left:22px;">${h(notes)}</div>` : ''}
            </td>
            <td style="text-align:right;">R$ ${Number(cost).toFixed(2)}</td>
            <td style="text-align:right;">${Number(lifespanH).toFixed(0)}h</td>
            <td style="text-align:right;font-weight:600;color:${isOn?'var(--primary)':'var(--text-muted)'};">
                R$ ${cph.toFixed(4)}/h
            </td>
            <td>
                <button class="btn-warning btn-sm" onclick="showMaintenanceModal(${id})">✏️</button>
                <button class="btn-danger  btn-sm" onclick="deleteMaintenanceItem(${id})">🗑️</button>
            </td>
        </tr>`;
    }).join('');
}

function _renderMaintenanceSummary() {
    const el = document.getElementById('maintenanceSummary');
    if (!el) return;

    const r = db.exec(
        'SELECT SUM(cost / lifespan_hours), COUNT(*) FROM maintenance_items WHERE active = 1 AND lifespan_hours > 0'
    );
    const total  = parseFloat(r[0]?.values[0]?.[0]) || 0;
    const count  = parseInt(r[0]?.values[0]?.[1]) || 0;
    const settingFallback = readNumberFromSettings('maintenancePerHour', 0.50);
    const usingItems = count > 0 && total > 0;

    el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:12px;">
        <div class="stat-card" style="padding:10px;text-align:center;">
            <div style="font-size:.75em;color:var(--text-muted);margin-bottom:4px;">Itens ativos</div>
            <div style="font-size:1.2em;font-weight:700;">${count}</div>
        </div>
        <div class="stat-card" style="padding:10px;text-align:center;">
            <div style="font-size:.75em;color:var(--text-muted);margin-bottom:4px;">Custo de manutenção/h</div>
            <div style="font-size:1.2em;font-weight:700;color:var(--primary);">
                R$ ${(usingItems ? total : settingFallback).toFixed(4)}/h
            </div>
        </div>
        <div class="stat-card" style="padding:10px;text-align:center;">
            <div style="font-size:.75em;color:var(--text-muted);margin-bottom:4px;">Por 100h impressas</div>
            <div style="font-size:1.2em;font-weight:700;">
                R$ ${((usingItems ? total : settingFallback) * 100).toFixed(2)}
            </div>
        </div>
    </div>
    <div class="info-box" style="margin-top:12px;font-size:0.83em;">
        ${usingItems
            ? `Calculadora usa a <strong>soma dos ${count} itens ativos</strong> (R$ ${total.toFixed(4)}/h).
               O campo "Manutenção/h" nas Configurações fica como fallback quando não há itens ativos.`
            : `Nenhum item ativo — calculadora usa o valor definido em
               <strong>Configurações → Manutenção/h</strong> (R$ ${settingFallback.toFixed(2)}/h).
               Ative ou cadastre itens acima para usar o cálculo detalhado.`
        }
    </div>`;

    // Atualiza a info do custo/h na calculadora
    _updateCalcMaintenanceInfo(usingItems ? total : settingFallback, usingItems ? count : 0);
}

function _updateCalcMaintenanceInfo(cph, itemCount) {
    const el = document.getElementById('calcMaintenanceInfo');
    if (!el) return;
    if (itemCount > 0) {
        el.textContent = `(${itemCount} itens ativos — R$ ${cph.toFixed(4)}/h)`;
        el.style.color = 'var(--primary)';
    } else {
        el.textContent = '(usando configuração manual)';
        el.style.color = 'var(--text-muted)';
    }
}

// ── Modal cadastro/edição ─────────────────────────────────────────
function showMaintenanceModal(itemId = null) {
    let data = {};
    if (itemId) {
        const r = db.exec('SELECT id, name, cost, lifespan_hours, notes FROM maintenance_items WHERE id = ?', [itemId]);
        if (r.length && r[0].values.length) {
            const [id, name, cost, lh, notes] = r[0].values[0];
            data = { id, name, cost, lh, notes: notes || '' };
        }
    }

    document.getElementById('modalTitle').innerHTML = itemId ? '✏️ Editar Item de Manutenção' : '➕ Novo Item de Manutenção';
    document.getElementById('modalBody').innerHTML = `
        <div class="field-group">
            <label>Nome do item / peça</label>
            <input type="text" id="maintName" value="${h(data.name || '')}"
                placeholder="Ex.: Bico 0.6mm, Extrusor, Rolamento...">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="field-group">
                <label>Custo de reposição (R$)</label>
                <input type="number" id="maintCost" value="${data.cost || ''}" min="0" step="0.01"
                    placeholder="Ex.: 15.00" oninput="updateMaintPreview()">
            </div>
            <div class="field-group">
                <label>Vida útil estimada (horas)</label>
                <input type="number" id="maintLifespan" value="${data.lh || ''}" min="1" step="1"
                    placeholder="Ex.: 500" oninput="updateMaintPreview()">
            </div>
        </div>
        <div id="maintPreview" style="background:rgba(0,174,66,.1);border-radius:6px;padding:8px;
             font-size:0.85em;text-align:center;margin-bottom:10px;">
            Custo/hora: <strong id="maintPreviewValue">—</strong>
        </div>
        <div class="field-group">
            <label>Observação (opcional)</label>
            <input type="text" id="maintNotes" value="${h(data.notes || '')}"
                placeholder="Ex.: Trocar ao atingir temperatura de 300°C">
        </div>
        ${itemId ? `<input type="hidden" id="maintEditId" value="${itemId}">` : ''}
        <button class="btn-primary" onclick="saveMaintenanceItem(${itemId ? 'true' : 'false'})" style="margin-top:12px;">
            ${itemId ? 'Atualizar' : 'Salvar item'}
        </button>`;

    // Pré-calcula preview
    if (data.cost && data.lh) updateMaintPreview();
    openModal();
}

function updateMaintPreview() {
    const cost     = parseFloat(document.getElementById('maintCost')?.value) || 0;
    const lifespan = parseFloat(document.getElementById('maintLifespan')?.value) || 0;
    const el       = document.getElementById('maintPreviewValue');
    if (!el) return;
    if (cost > 0 && lifespan > 0) {
        el.textContent = 'R$ ' + (cost / lifespan).toFixed(4) + '/h';
        el.style.color = 'var(--primary)';
    } else {
        el.textContent = '—';
        el.style.color = 'var(--text-muted)';
    }
}

function saveMaintenanceItem(isEdit = false) {
    const name     = document.getElementById('maintName')?.value?.trim();
    const cost     = parseFloat(document.getElementById('maintCost')?.value);
    const lifespan = parseFloat(document.getElementById('maintLifespan')?.value);
    const notes    = document.getElementById('maintNotes')?.value?.trim() || '';

    if (!name)              { showToast('⚠️ Nome obrigatório'); return; }
    if (!cost || cost <= 0) { showToast('⚠️ Custo inválido'); return; }
    if (!lifespan || lifespan <= 0) { showToast('⚠️ Vida útil inválida'); return; }

    if (isEdit) {
        const id = parseInt(document.getElementById('maintEditId')?.value);
        db.run('UPDATE maintenance_items SET name=?,cost=?,lifespan_hours=?,notes=? WHERE id=?',
            [name, cost, lifespan, notes, id]);
        showToast('✅ Item atualizado!');
    } else {
        db.run('INSERT INTO maintenance_items (name, cost, lifespan_hours, active, notes) VALUES (?,?,?,1,?)',
            [name, cost, lifespan, notes]);
        showToast('✅ Item salvo!');
    }
    persistDB();
    closeModal();
    loadMaintenance();
    if (typeof updatePriceCalculation === 'function') updatePriceCalculation();
}

function toggleMaintenanceItem(id, active) {
    db.run('UPDATE maintenance_items SET active = ? WHERE id = ?', [active ? 1 : 0, id]);
    persistDB();
    _renderMaintenanceTable();
    _renderMaintenanceSummary();
    if (typeof updatePriceCalculation === 'function') updatePriceCalculation();
}

function deleteMaintenanceItem(id) {
    if (!confirm('Excluir este item de manutenção?')) return;
    db.run('DELETE FROM maintenance_items WHERE id = ?', [id]);
    persistDB();
    loadMaintenance();
    if (typeof updatePriceCalculation === 'function') updatePriceCalculation();
}
