// ==================== ADICIONAIS ====================

const ADDON_CATEGORIES = ['Acessório', 'Fixação', 'Pintura', 'Acabamento', 'Embalagem premium', 'Outro'];

function loadAddons() {
    const panel = document.getElementById('addonsTableBody');
    if (!panel) return;
    const rows = db.exec('SELECT id,name,category,unit_cost,description FROM addons ORDER BY category,name');
    const values = rows[0]?.values || [];
    _renderAddonsSummary(values);

    const countBadge = document.getElementById('addonsTableCount');
    if (countBadge) countBadge.textContent = `${values.length} ${values.length === 1 ? 'adicional' : 'adicionais'}`;

    if (!values.length) {
        panel.innerHTML = `<tr><td colspan="5" class="text-center py-5">
            <i class="bi bi-stars fs-2 text-body-tertiary d-block mb-2"></i>
            <strong class="d-block">Nenhum adicional cadastrado</strong>
            <span class="text-body-secondary small">Cadastre acessórios e acabamentos para usá-los na Calculadora.</span>
        </td></tr>`;
        refreshAddonsChecklist();
        return;
    }

    panel.innerHTML = values.map(([id, name, cat, cost, desc]) => `
        <tr>
            <td><div class="d-flex align-items-center gap-3"><span class="s3d-table-icon bg-info-subtle text-info-emphasis"><i class="bi bi-plus-circle"></i></span><strong>${h(name)}</strong></div></td>
            <td><span class="badge text-bg-light border">${h(cat || 'Outro')}</span></td>
            <td class="text-end fw-semibold">${money(parseFloat(cost) || 0)}</td>
            <td class="text-body-secondary">${h(desc || 'Sem descrição')}</td>
            <td class="text-end">
                <div class="s3d-actions d-inline-flex flex-row flex-nowrap align-items-center gap-1" role="group" aria-label="Ações do adicional">
                    <button class="btn btn-outline-primary" type="button" title="Editar adicional" onclick="showAddonModal(${id})"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-outline-danger" type="button" title="Excluir adicional" onclick="deleteAddon(${id})"><i class="bi bi-trash"></i></button>
                </div>
            </td>
        </tr>`).join('');
    refreshAddonsChecklist();
}

function _renderAddonsSummary(values) {
    const el = document.getElementById('addonsSummary');
    if (!el) return;
    const count = values.length;
    const categories = new Set(values.map(row => row[2] || 'Outro')).size;
    const avgCost = count ? values.reduce((sum, row) => sum + (parseFloat(row[3]) || 0), 0) / count : 0;
    const highest = count ? Math.max(...values.map(row => parseFloat(row[3]) || 0)) : 0;
    el.innerHTML = [
        ['bi-stars', 'Adicionais', String(count), 'Itens disponíveis', 'primary'],
        ['bi-tags', 'Categorias', String(categories), 'Grupos organizados', 'info'],
        ['bi-cash-coin', 'Custo médio', money(avgCost), 'Por adicional', 'success'],
        ['bi-arrow-up-circle', 'Maior custo', money(highest), 'Item mais caro', 'warning']
    ].map(([icon,label,value,note,tone]) => _addonKpi(icon,label,value,note,tone)).join('');
}

function _addonKpi(icon, label, value, note, tone) {
    return `<div class="col-12 col-sm-6 col-xl-3"><div class="card border shadow-sm h-100"><div class="card-body d-flex align-items-center gap-3"><span class="s3d-kpi-icon bg-${tone}-subtle text-${tone}-emphasis"><i class="bi ${icon}"></i></span><div class="min-w-0"><small class="text-body-secondary d-block">${label}</small><strong class="fs-5 d-block text-break">${value}</strong><span class="small text-body-secondary">${note}</span></div></div></div></div>`;
}

function showAddonModal(id = null) {
    let name = '', category = ADDON_CATEGORIES[0], unitCost = '', description = '';
    if (id) {
        const r = db.exec('SELECT name,category,unit_cost,description FROM addons WHERE id=?', [id]);
        if (r.length && r[0].values.length) [name, category, unitCost, description] = r[0].values[0];
    }
    const catOptions = ADDON_CATEGORIES.map(c => `<option value="${h(c)}" ${c === category ? 'selected' : ''}>${h(c)}</option>`).join('');

    document.getElementById('modalTitle').textContent = id ? 'Editar adicional' : 'Novo adicional';
    document.getElementById('modalBody').innerHTML = `
        <form class="row g-3" onsubmit="event.preventDefault(); saveAddon(${id || 'null'});">
            <div class="col-12"><label class="form-label" for="addonName">Nome do adicional</label><input class="form-control" type="text" id="addonName" value="${h(name)}" placeholder="Ex.: Corrente para chaveiro" required></div>
            <div class="col-12 col-md-6"><label class="form-label" for="addonCategory">Categoria</label><select class="form-select" id="addonCategory">${catOptions}</select></div>
            <div class="col-12 col-md-6"><label class="form-label" for="addonCost">Custo unitário</label><div class="input-group"><span class="input-group-text">R$</span><input class="form-control" type="number" id="addonCost" value="${unitCost}" min="0" step="0.01" placeholder="0,00"></div></div>
            <div class="col-12"><label class="form-label" for="addonDesc">Descrição</label><textarea class="form-control" id="addonDesc" rows="3" placeholder="Detalhes, acabamento ou aplicação">${h(description)}</textarea></div>
            <div class="col-12 d-flex justify-content-end gap-2 pt-2"><button class="btn btn-outline-secondary" type="button" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" type="submit"><i class="bi bi-check-lg me-1"></i>Salvar adicional</button></div>
        </form>`;
    openModal();
}

function saveAddon(id) {
    const name = document.getElementById('addonName').value.trim();
    const category = document.getElementById('addonCategory').value;
    const cost = parseFloat(document.getElementById('addonCost').value) || 0;
    const desc = document.getElementById('addonDesc').value.trim();
    if (!name) { showToast('⚠️ Informe o nome do adicional'); return; }
    if (id) db.run('UPDATE addons SET name=?,category=?,unit_cost=?,description=? WHERE id=?', [name, category, cost, desc, id]);
    else db.run('INSERT INTO addons (name,category,unit_cost,description) VALUES (?,?,?,?)', [name, category, cost, desc]);
    persistDB(); closeModal(); loadAddons(); updatePriceCalculation(); showToast('✅ Adicional salvo!');
}

function deleteAddon(id) {
    if (!confirm('Remover este adicional?')) return;
    db.run('DELETE FROM addons WHERE id=?', [id]);
    persistDB(); loadAddons(); updatePriceCalculation(); showToast('🗑️ Adicional removido.');
}

function refreshAddonsChecklist() {
    const container = document.getElementById('addonsChecklist');
    if (!container) return;
    const rows = db.exec('SELECT id,name,category,unit_cost FROM addons ORDER BY category,name');
    const values = rows[0]?.values || [];
    if (!values.length) {
        container.innerHTML = '<div class="alert alert-light border small mb-0"><i class="bi bi-info-circle me-2"></i>Nenhum adicional cadastrado. Cadastre em Adicionais.</div>';
        return;
    }

    const byCategory = {};
    values.forEach(([id, name, cat, cost]) => {
        const category = cat || 'Outro';
        if (!byCategory[category]) byCategory[category] = [];
        byCategory[category].push({ id, name, cost });
    });

    container.innerHTML = Object.entries(byCategory).map(([cat, items]) => `
        <section class="mb-3">
            <h6 class="text-uppercase text-body-secondary small fw-bold mb-2">${h(cat)}</h6>
            <div class="list-group">
                ${items.map(item => `
                    <div class="list-group-item py-3">
                        <div class="d-flex flex-column flex-sm-row align-items-sm-center gap-3">
                            <div class="flex-grow-1 min-w-0">
                                <strong class="d-block text-break">${h(item.name)}</strong>
                                <small class="text-body-secondary">${money(parseFloat(item.cost) || 0)} por unidade</small>
                            </div>
                            <div class="d-flex align-items-center gap-3 flex-shrink-0">
                                <div class="form-check form-switch m-0 d-flex align-items-center gap-2">
                                    <input class="form-check-input m-0" role="switch" type="checkbox" id="addon_${item.id}" value="${item.id}" onchange="onAddonChange(${item.id}, this.checked)" aria-describedby="addonState_${item.id}">
                                    <label class="form-check-label small fw-semibold text-body-secondary text-nowrap" id="addonState_${item.id}" for="addon_${item.id}">Desligado</label>
                                </div>
                                <span class="d-none align-items-center gap-1" id="addonQtyWrap_${item.id}">
                                    <label class="small text-body-secondary mb-0" for="addonQty_${item.id}">Qtd.</label>
                                    <input class="form-control form-control-sm text-center" type="number" id="addonQty_${item.id}" value="1" min="1" max="99" aria-label="Quantidade de ${h(item.name)}" style="width:4.5rem" onchange="updatePriceCalculation()">
                                </span>
                            </div>
                        </div>
                    </div>`).join('')}
            </div>
        </section>`).join('');
}

function onAddonChange(id, checked) {
    const wrap = document.getElementById(`addonQtyWrap_${id}`);
    const state = document.getElementById(`addonState_${id}`);
    const control = document.getElementById(`addon_${id}`);
    const row = control?.closest('.list-group-item');

    if (wrap) {
        wrap.classList.toggle('d-none', !checked);
        wrap.classList.toggle('d-flex', checked);
    }
    if (state) {
        state.textContent = checked ? 'Ligado' : 'Desligado';
        state.classList.toggle('text-success', checked);
        state.classList.toggle('text-body-secondary', !checked);
    }
    if (row) {
        row.classList.toggle('border-success', checked);
        row.classList.toggle('bg-success-subtle', checked);
    }
    updatePriceCalculation();
}

function getSelectedAddonsCost() {
    const rows = db.exec('SELECT id,unit_cost FROM addons');
    if (!rows.length || !rows[0].values.length) return 0;
    let total = 0;
    rows[0].values.forEach(([id, cost]) => {
        const chk = document.getElementById(`addon_${id}`);
        if (chk && chk.checked) {
            const qty = parseInt(document.getElementById(`addonQty_${id}`)?.value, 10) || 1;
            total += parseFloat(cost) * qty;
        }
    });
    return total;
}

function getSelectedAddonsLabel() {
    const rows = db.exec('SELECT id,name,unit_cost FROM addons');
    if (!rows.length || !rows[0].values.length) return '';
    const selected = [];
    rows[0].values.forEach(([id, name, cost]) => {
        const chk = document.getElementById(`addon_${id}`);
        if (chk && chk.checked) {
            const qty = parseInt(document.getElementById(`addonQty_${id}`)?.value, 10) || 1;
            selected.push(`${name}${qty > 1 ? ` ×${qty}` : ''} (${money((parseFloat(cost) || 0) * qty)})`);
        }
    });
    return selected.join(', ');
}
