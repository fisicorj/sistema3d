// ==================== ITENS DE MANUTENÇÃO ====================
// Cada item representa um consumível ou peça com vida útil definida.
// O custo/hora de cada item = custo / vida útil em horas.

const MAINTENANCE_DEFAULTS = [
    { name: 'Bico de impressão (0.4mm)', cost: 15.00, lifespan_hours: 500, notes: 'Trocar quando houver subextrusão ou entupimentos frequentes' },
    { name: 'Tubo PTFE', cost: 12.00, lifespan_hours: 1000, notes: 'Verificar desgaste na entrada do hotend' },
    { name: 'Cama de vidro / PEI', cost: 60.00, lifespan_hours: 2000, notes: 'PEI perde aderência após muitos ciclos' },
    { name: 'Lubrificação dos trilhos', cost: 5.00, lifespan_hours: 200, notes: 'Graxa para trilhos lineares' },
    { name: 'Correia de transmissão', cost: 20.00, lifespan_hours: 3000, notes: 'X e Y — verificar tensão regularmente' },
];

function loadMaintenance() {
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
    const rows = db.exec('SELECT id, name, cost, lifespan_hours, active, notes FROM maintenance_items ORDER BY active DESC, name');
    const tbody = document.getElementById('maintenanceTableBody');
    const countBadge = document.getElementById('maintenanceTableCount');
    if (!tbody) return;

    const values = rows[0]?.values || [];
    if (countBadge) countBadge.textContent = `${values.length} ${values.length === 1 ? 'item' : 'itens'}`;

    if (!values.length) {
        tbody.innerHTML = `
            <tr><td colspan="5" class="text-center py-5">
                <i class="bi bi-wrench-adjustable fs-2 text-body-tertiary d-block mb-2"></i>
                <strong class="d-block">Nenhum item cadastrado</strong>
                <span class="text-body-secondary small">Cadastre peças e consumíveis para calcular o custo por hora.</span>
            </td></tr>`;
        return;
    }

    tbody.innerHTML = values.map(([id, name, cost, lifespanH, active, notes]) => {
        const cph = lifespanH > 0 ? Number(cost) / Number(lifespanH) : 0;
        const isOn = active === 1 || active === true;
        return `<tr class="${isOn ? '' : 'opacity-50'}">
            <td>
                <div class="d-flex align-items-start gap-3">
                    <div class="form-check form-switch mt-1 mb-0">
                        <input class="form-check-input" type="checkbox" role="switch"
                            id="maintenanceActive_${id}" ${isOn ? 'checked' : ''}
                            onchange="toggleMaintenanceItem(${id}, this.checked)">
                    </div>
                    <div class="min-w-0">
                        <label class="fw-semibold mb-0" for="maintenanceActive_${id}">${h(name)}</label>
                        ${notes ? `<div class="small text-body-secondary mt-1">${h(notes)}</div>` : ''}
                    </div>
                </div>
            </td>
            <td class="text-end fw-medium">${money(Number(cost) || 0)}</td>
            <td class="text-end"><span class="badge text-bg-light border">${Number(lifespanH).toFixed(0)} h</span></td>
            <td class="text-end"><strong class="${isOn ? 'text-primary' : 'text-body-secondary'}">R$ ${cph.toFixed(4)}/h</strong></td>
            <td class="text-end">
                <div class="s3d-actions d-inline-flex flex-row flex-nowrap align-items-center gap-1" role="group" aria-label="Ações do item">
                    <button class="btn btn-outline-primary" type="button" title="Editar item" onclick="showMaintenanceModal(${id})"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-outline-danger" type="button" title="Excluir item" onclick="deleteMaintenanceItem(${id})"><i class="bi bi-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function _renderMaintenanceSummary() {
    const el = document.getElementById('maintenanceSummary');
    if (!el) return;

    const r = db.exec('SELECT SUM(cost / lifespan_hours), COUNT(*), SUM(cost) FROM maintenance_items WHERE active = 1 AND lifespan_hours > 0');
    const total = parseFloat(r[0]?.values[0]?.[0]) || 0;
    const count = parseInt(r[0]?.values[0]?.[1]) || 0;
    const replacementValue = parseFloat(r[0]?.values[0]?.[2]) || 0;
    const fallback = readNumberFromSettings('maintenancePerHour', 0.50);
    const usingItems = count > 0 && total > 0;
    const effectiveCph = usingItems ? total : fallback;

    el.innerHTML = `
        <div class="row g-3">
            ${_maintenanceKpi('bi-toggle-on', 'Itens ativos', String(count), count ? 'Incluídos na precificação' : 'Usando valor de fallback', 'primary')}
            ${_maintenanceKpi('bi-speedometer2', 'Custo de manutenção', `R$ ${effectiveCph.toFixed(4)}/h`, usingItems ? 'Calculado pelos itens ativos' : 'Definido em Configurações', 'success')}
            ${_maintenanceKpi('bi-clock-history', 'Projeção para 100 h', money(effectiveCph * 100), 'Reserva operacional estimada', 'warning')}
            ${_maintenanceKpi('bi-arrow-repeat', 'Reposição total', money(replacementValue), 'Valor dos itens ativos', 'info')}
        </div>
        <div class="alert ${usingItems ? 'alert-primary' : 'alert-warning'} d-flex align-items-start gap-3 mt-3 mb-0" role="alert">
            <i class="bi ${usingItems ? 'bi-calculator' : 'bi-exclamation-triangle'} fs-5"></i>
            <div class="small">
                ${usingItems
                    ? `A calculadora utiliza a soma de <strong>${count} ${count === 1 ? 'item ativo' : 'itens ativos'}</strong>, resultando em <strong>R$ ${total.toFixed(4)}/h</strong>.`
                    : `Nenhum item ativo. A calculadora está usando o valor de fallback de <strong>${money(fallback)}/h</strong> definido em Configurações.`}
            </div>
        </div>`;

    _updateCalcMaintenanceInfo(effectiveCph, usingItems ? count : 0);
}

function _maintenanceKpi(icon, label, value, note, tone) {
    return `<div class="col-12 col-sm-6 col-xl-3">
        <div class="card border shadow-sm h-100 s3d-maintenance-kpi">
            <div class="card-body d-flex gap-3 align-items-center">
                <span class="s3d-kpi-icon bg-${tone}-subtle text-${tone}-emphasis"><i class="bi ${icon}"></i></span>
                <div class="min-w-0">
                    <small class="text-body-secondary d-block">${label}</small>
                    <strong class="d-block fs-5 text-break">${value}</strong>
                    <span class="small text-body-secondary">${note}</span>
                </div>
            </div>
        </div>
    </div>`;
}

function _updateCalcMaintenanceInfo(cph, itemCount) {
    const el = document.getElementById('calcMaintenanceInfo');
    if (!el) return;
    el.textContent = itemCount > 0
        ? `(${itemCount} ${itemCount === 1 ? 'item ativo' : 'itens ativos'} — R$ ${cph.toFixed(4)}/h)`
        : '(usando configuração manual)';
    el.classList.toggle('text-primary', itemCount > 0);
    el.classList.toggle('text-body-secondary', itemCount === 0);
}

function showMaintenanceModal(itemId = null) {
    let data = {};
    if (itemId) {
        const r = db.exec('SELECT id, name, cost, lifespan_hours, notes FROM maintenance_items WHERE id = ?', [itemId]);
        if (r.length && r[0].values.length) {
            const [id, name, cost, lh, notes] = r[0].values[0];
            data = { id, name, cost, lh, notes: notes || '' };
        }
    }

    document.getElementById('modalTitle').textContent = itemId ? 'Editar item de manutenção' : 'Novo item de manutenção';
    document.getElementById('modalBody').innerHTML = `
        <form id="maintenanceForm" class="row g-3" onsubmit="event.preventDefault(); saveMaintenanceItem(${itemId ? 'true' : 'false'});">
            <div class="col-12">
                <label class="form-label" for="maintName">Nome do item ou peça</label>
                <input class="form-control" type="text" id="maintName" value="${h(data.name || '')}" placeholder="Ex.: Bico 0.6 mm, extrusor, rolamento" required>
            </div>
            <div class="col-12 col-md-6">
                <label class="form-label" for="maintCost">Custo de reposição</label>
                <div class="input-group"><span class="input-group-text">R$</span><input class="form-control" type="number" id="maintCost" value="${data.cost || ''}" min="0.01" step="0.01" placeholder="0,00" required></div>
            </div>
            <div class="col-12 col-md-6">
                <label class="form-label" for="maintLifespan">Vida útil estimada</label>
                <div class="input-group"><input class="form-control" type="number" id="maintLifespan" value="${data.lh || ''}" min="1" step="1" placeholder="500" required><span class="input-group-text">horas</span></div>
            </div>
            <div class="col-12">
                <div class="alert alert-success mb-0 d-flex justify-content-between align-items-center gap-3">
                    <span><i class="bi bi-calculator me-2"></i>Custo estimado por hora</span>
                    <strong id="maintPreviewValue">—</strong>
                </div>
            </div>
            <div class="col-12">
                <label class="form-label" for="maintNotes">Observação</label>
                <textarea class="form-control" id="maintNotes" rows="3" placeholder="Ex.: Trocar ao apresentar desgaste ou perda de precisão">${h(data.notes || '')}</textarea>
            </div>
            ${itemId ? `<input type="hidden" id="maintEditId" value="${itemId}">` : ''}
            <div class="col-12 d-flex justify-content-end gap-2 pt-2">
                <button class="btn btn-outline-secondary" type="button" onclick="closeModal()">Cancelar</button>
                <button class="btn btn-primary" type="submit"><i class="bi bi-check-lg me-1"></i>${itemId ? 'Atualizar item' : 'Salvar item'}</button>
            </div>
        </form>`;

    openModal();
    const costEl = document.getElementById('maintCost');
    const lifespanEl = document.getElementById('maintLifespan');
    costEl?.addEventListener('input', updateMaintPreview);
    lifespanEl?.addEventListener('input', updateMaintPreview);
    updateMaintPreview();
}

function updateMaintPreview() {
    const cost = parseFloat(document.getElementById('maintCost')?.value) || 0;
    const lifespan = parseFloat(document.getElementById('maintLifespan')?.value) || 0;
    const el = document.getElementById('maintPreviewValue');
    if (!el) return;
    el.textContent = cost > 0 && lifespan > 0 ? `R$ ${(cost / lifespan).toFixed(4)}/h` : '—';
}

function saveMaintenanceItem(isEdit = false) {
    const name = document.getElementById('maintName')?.value?.trim();
    const cost = parseFloat(document.getElementById('maintCost')?.value);
    const lifespan = parseFloat(document.getElementById('maintLifespan')?.value);
    const notes = document.getElementById('maintNotes')?.value?.trim() || '';

    if (!name) { showToast('⚠️ Nome obrigatório'); return; }
    if (!cost || cost <= 0) { showToast('⚠️ Custo inválido'); return; }
    if (!lifespan || lifespan <= 0) { showToast('⚠️ Vida útil inválida'); return; }

    if (isEdit) {
        const id = parseInt(document.getElementById('maintEditId')?.value, 10);
        db.run('UPDATE maintenance_items SET name=?,cost=?,lifespan_hours=?,notes=? WHERE id=?', [name, cost, lifespan, notes, id]);
        showToast('✅ Item atualizado!');
    } else {
        db.run('INSERT INTO maintenance_items (name, cost, lifespan_hours, active, notes) VALUES (?,?,?,1,?)', [name, cost, lifespan, notes]);
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
