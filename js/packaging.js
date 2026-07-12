// ==================== EMBALAGENS ====================

function loadPackaging() {
    const panel = document.getElementById('packagingTableBody');
    if (!panel) return;
    const rows = db.exec('SELECT id,name,description,cost,weight FROM packaging ORDER BY cost,name');
    const values = rows[0]?.values || [];
    _renderPackagingSummary(values);

    const countBadge = document.getElementById('packagingTableCount');
    if (countBadge) countBadge.textContent = `${values.length} ${values.length === 1 ? 'embalagem' : 'embalagens'}`;

    if (!values.length) {
        panel.innerHTML = `<tr><td colspan="5" class="text-center py-5">
            <i class="bi bi-box-seam fs-2 text-body-tertiary d-block mb-2"></i>
            <strong class="d-block">Nenhuma embalagem cadastrada</strong>
            <span class="text-body-secondary small">Cadastre embalagens para usá-las na Calculadora.</span>
        </td></tr>`;
        refreshPackagingSelect();
        return;
    }

    panel.innerHTML = values.map(([id, name, desc, cost, weight]) => `
        <tr>
            <td><div class="d-flex align-items-center gap-3"><span class="s3d-table-icon bg-primary-subtle text-primary"><i class="bi bi-box"></i></span><strong>${h(name)}</strong></div></td>
            <td class="text-body-secondary">${h(desc || 'Sem descrição')}</td>
            <td class="text-end fw-semibold">${money(parseFloat(cost) || 0)}</td>
            <td class="text-end"><span class="badge text-bg-light border">${parseFloat(weight || 0).toFixed(0)} g</span></td>
            <td class="text-end">
                <div class="s3d-actions d-inline-flex flex-row flex-nowrap align-items-center gap-1" role="group" aria-label="Ações da embalagem">
                    <button class="btn btn-outline-primary" type="button" title="Editar embalagem" onclick="showPackagingModal(${id})"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-outline-danger" type="button" title="Excluir embalagem" onclick="deletePackaging(${id})"><i class="bi bi-trash"></i></button>
                </div>
            </td>
        </tr>`).join('');
    refreshPackagingSelect();
}

function _renderPackagingSummary(values) {
    const el = document.getElementById('packagingSummary');
    if (!el) return;
    const count = values.length;
    const avgCost = count ? values.reduce((sum, row) => sum + (parseFloat(row[3]) || 0), 0) / count : 0;
    const avgWeight = count ? values.reduce((sum, row) => sum + (parseFloat(row[4]) || 0), 0) / count : 0;
    const lowest = count ? Math.min(...values.map(row => parseFloat(row[3]) || 0)) : 0;
    el.innerHTML = [
        ['bi-boxes', 'Embalagens', String(count), 'Opções cadastradas', 'primary'],
        ['bi-cash-coin', 'Custo médio', money(avgCost), 'Por embalagem', 'success'],
        ['bi-feather', 'Peso médio', `${avgWeight.toFixed(0)} g`, 'Somado ao frete', 'info'],
        ['bi-arrow-down-circle', 'Menor custo', money(lowest), 'Opção mais econômica', 'warning']
    ].map(([icon,label,value,note,tone]) => _catalogKpi(icon,label,value,note,tone)).join('');
}

function _catalogKpi(icon, label, value, note, tone) {
    return `<div class="col-12 col-sm-6 col-xl-3"><div class="card border shadow-sm h-100"><div class="card-body d-flex align-items-center gap-3"><span class="s3d-kpi-icon bg-${tone}-subtle text-${tone}-emphasis"><i class="bi ${icon}"></i></span><div class="min-w-0"><small class="text-body-secondary d-block">${label}</small><strong class="fs-5 d-block text-break">${value}</strong><span class="small text-body-secondary">${note}</span></div></div></div></div>`;
}

function showPackagingModal(id = null) {
    let name = '', description = '', cost = '', weight = '';
    if (id) {
        const r = db.exec('SELECT name,description,cost,weight FROM packaging WHERE id=?', [id]);
        if (r.length && r[0].values.length) [name, description, cost, weight] = r[0].values[0];
    }
    document.getElementById('modalTitle').textContent = id ? 'Editar embalagem' : 'Nova embalagem';
    document.getElementById('modalBody').innerHTML = `
        <form class="row g-3" onsubmit="event.preventDefault(); savePackaging(${id || 'null'});">
            <div class="col-12"><label class="form-label" for="pkgName">Nome da embalagem</label><input class="form-control" type="text" id="pkgName" value="${h(name)}" placeholder="Ex.: Caixa kraft M" required></div>
            <div class="col-12"><label class="form-label" for="pkgDesc">Descrição</label><textarea class="form-control" id="pkgDesc" rows="3" placeholder="Dimensões, material ou aplicação">${h(description)}</textarea></div>
            <div class="col-12 col-md-6"><label class="form-label" for="pkgCost">Custo</label><div class="input-group"><span class="input-group-text">R$</span><input class="form-control" type="number" id="pkgCost" value="${cost}" min="0" step="0.01" placeholder="0,00"></div></div>
            <div class="col-12 col-md-6"><label class="form-label" for="pkgWeight">Peso</label><div class="input-group"><input class="form-control" type="number" id="pkgWeight" value="${weight}" min="0" step="1" placeholder="0"><span class="input-group-text">g</span></div><div class="form-text">Somado ao peso da peça na cotação de frete.</div></div>
            <div class="col-12 d-flex justify-content-end gap-2 pt-2"><button class="btn btn-outline-secondary" type="button" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" type="submit"><i class="bi bi-check-lg me-1"></i>Salvar embalagem</button></div>
        </form>`;
    openModal();
}

function savePackaging(id) {
    const name = document.getElementById('pkgName').value.trim();
    const desc = document.getElementById('pkgDesc').value.trim();
    const cost = parseFloat(document.getElementById('pkgCost').value) || 0;
    const weight = parseFloat(document.getElementById('pkgWeight').value) || 0;
    if (!name) { showToast('⚠️ Informe o nome da embalagem'); return; }
    if (id) db.run('UPDATE packaging SET name=?,description=?,cost=?,weight=? WHERE id=?', [name, desc, cost, weight, id]);
    else db.run('INSERT INTO packaging (name,description,cost,weight) VALUES (?,?,?,?)', [name, desc, cost, weight]);
    persistDB(); closeModal(); loadPackaging(); updatePriceCalculation(); showToast('✅ Embalagem salva!');
}

function deletePackaging(id) {
    if (!confirm('Remover esta embalagem?')) return;
    db.run('DELETE FROM packaging WHERE id=?', [id]);
    persistDB(); loadPackaging(); updatePriceCalculation(); showToast('🗑️ Embalagem removida.');
}

function refreshPackagingSelect() {
    const sel = document.getElementById('calcPackaging');
    if (!sel) return;
    const saved = sel.value;
    const rows = db.exec('SELECT id,name,cost FROM packaging ORDER BY cost');
    sel.innerHTML = '';
    if (rows.length && rows[0].values.length) rows[0].values.forEach(([id, name, cost]) => {
        const opt = document.createElement('option');
        opt.value = id; opt.textContent = `${name} — ${money(parseFloat(cost) || 0)}`;
        if (String(id) === String(saved)) opt.selected = true;
        sel.appendChild(opt);
    });
}

function getSelectedPackaging() {
    const sel = document.getElementById('calcPackaging');
    if (!sel || !sel.value) return { cost: parseFloat(currentSettings.packagingCost) || 3, weight: 0 };
    const r = db.exec('SELECT cost,weight FROM packaging WHERE id=?', [sel.value]);
    if (r.length && r[0].values.length) return { cost: r[0].values[0][0], weight: r[0].values[0][1] };
    return { cost: parseFloat(currentSettings.packagingCost) || 3, weight: 0 };
}
