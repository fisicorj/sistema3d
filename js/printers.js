// ==================== IMPRESSORAS ====================

function loadPrinters() {
    const result = db.exec('SELECT id, name, value, lifetime_hours, wattage, speed_gph, hours_used FROM printers ORDER BY name');
    let rows = '';

    const energyPrice    = parseFloat(currentSettings.energyPrice)       || 1;     // R$/kWh
    const maintenancePerH = parseFloat(currentSettings.maintenancePerHour) || 0.50; // R$/h

    if (result.length > 0 && result[0].values.length > 0) {
        result[0].values.forEach(([id, name, value, lifetimeH, wattage, speedGph, hoursUsed]) => {
            const deprPerH   = value / lifetimeH;
            const energyPerH = (wattage * energyPrice) / 1000;
            const totalPerH  = deprPerH + energyPerH + maintenancePerH;
            const used       = parseFloat(hoursUsed) || 0;
            const usedPct    = Math.min(100, Math.round((used / lifetimeH) * 100));
            const usedColor  = usedPct >= 90 ? '#e53e3e' : usedPct >= 70 ? '#d97706' : '#38a169';

            rows += `<tr>
                <td><strong>${h(name)}</strong></td>
                <td>R$ ${value.toFixed(0)}</td>
                <td>
                    ${lifetimeH}h total<br>
                    <span style="color:${usedColor};font-size:0.82em;">
                        ${used.toFixed(1)}h usadas (${usedPct}%)
                    </span>
                    <div style="background:rgba(0,0,0,0.12);border-radius:4px;height:5px;margin-top:3px;">
                        <div style="height:100%;width:${usedPct}%;background:${usedColor};border-radius:4px;"></div>
                    </div>
                </td>
                <td>${wattage}W</td>
                <td>${speedGph}g/h</td>
                <td>
                    <span style="color:var(--text-muted);font-size:0.8em;">
                        depr: R$${deprPerH.toFixed(3)} +
                        energia: R$${energyPerH.toFixed(3)} +
                        manut: R$${maintenancePerH.toFixed(3)}
                    </span><br>
                    <strong style="color:var(--green-lite);">= R$ ${totalPerH.toFixed(3)}/h</strong>
                </td>
                <td>
                    <button class="btn-primary btn-sm" onclick="showEditPrinterModal(${id})">✏️</button>
                    <button class="btn-danger  btn-sm" onclick="deletePrinter(${id})">🗑️</button>
                </td>
            </tr>`;
        });
    } else {
        rows = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px;">Nenhuma impressora cadastrada</td></tr>';
    }
    document.getElementById('printersTableBody').innerHTML = rows;

    // Atualiza select da calculadora
    const sel = document.getElementById('calcPrinter');
    sel.replaceChildren();
    if (result.length > 0 && result[0].values.length > 0) {
        result[0].values.forEach(([id, name]) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = name || `Impressora #${id}`;
            sel.appendChild(opt);
        });
        updatePriceCalculation();
    }
}

function showPrinterModal() {
    document.getElementById('modalTitle').innerHTML = '➕ Nova Impressora';
    document.getElementById('modalBody').innerHTML = printerFormHTML();
    openModal();
    updatePrinterCostPreview();
}

function showEditPrinterModal(printerId) {
    const r = db.exec('SELECT * FROM printers WHERE id = ?', [printerId]);
    if (!r.length) return;
    const [id, name, value, lifetimeH, wattage, speedGph] = r[0].values[0];

    document.getElementById('modalTitle').innerHTML = '✏️ Editar Impressora';
    document.getElementById('modalBody').innerHTML =
        printerFormHTML({ name, value, lifetime: lifetimeH, wattage, speed: speedGph }) +
        `<input type="hidden" id="printerEditId" value="${id}">`;
    openModal();
    updatePrinterCostPreview();
    document.querySelector('#modalBody .btn-primary').setAttribute('onclick', 'savePrinter(true)');
    document.querySelector('#modalBody .btn-primary').textContent = 'Atualizar Impressora';
}

function printerFormHTML(data = {}) {
    return `
        <div class="field-group"><label>Nome</label>
            <input type="text" id="printerName" value="${h(data.name || '')}" placeholder="Ex: Ender 3"></div>
        <div class="field-group"><label>Valor de compra (R$)</label>
            <input type="number" id="printerValue" value="${data.value ?? 2000}" oninput="updatePrinterCostPreview()"></div>
        <div class="field-group"><label>Vida Útil Estimada (horas)
            <small style="font-weight:400;color:var(--text-dim);">— tempo total de impressão até obsolescência</small></label>
            <input type="number" id="printerLifetime" value="${data.lifetime ?? 5000}" oninput="updatePrinterCostPreview()"></div>
        <div class="field-group"><label>Consumo Médio (Watts)</label>
            <input type="number" id="printerWattage" value="${data.wattage ?? 150}" oninput="updatePrinterCostPreview()"></div>
        <div class="field-group"><label>Velocidade Média de impressão (g/h)</label>
            <input type="number" id="printerSpeed" value="${data.speed ?? 15}"></div>
        <div class="info-box" id="printerCostPreview" style="margin-bottom:12px;font-size:0.83em;line-height:1.8;"></div>
        <button class="btn-primary" onclick="savePrinter(false)" style="width:100%;margin-top:4px;">Salvar Impressora</button>
    `;
}

function updatePrinterCostPreview() {
    const value    = parseFloat(document.getElementById('printerValue')?.value)    || 0;
    const lifetime = parseFloat(document.getElementById('printerLifetime')?.value) || 1;
    const wattage  = parseFloat(document.getElementById('printerWattage')?.value)  || 0;
    const energyPrice     = parseFloat(currentSettings.energyPrice)       || 1;
    const maintenancePerH = parseFloat(currentSettings.maintenancePerHour) || 0.50;

    const deprPerH   = value / lifetime;
    const energyPerH = (wattage * energyPrice) / 1000;
    const totalPerH  = deprPerH + energyPerH + maintenancePerH;

    const el = document.getElementById('printerCostPreview');
    if (el) el.innerHTML =
        `📊 <strong>Custo/hora estimado:</strong><br>
         Depreciação: R$ ${deprPerH.toFixed(4)}/h &nbsp;|&nbsp;
         Energia (${wattage}W × R$${energyPrice}/kWh): R$ ${energyPerH.toFixed(4)}/h &nbsp;|&nbsp;
         Manutenção/consumíveis: R$ ${maintenancePerH.toFixed(4)}/h<br>
         <strong>Total: R$ ${totalPerH.toFixed(4)}/h</strong>
         &nbsp;→ em 8h de impressão: <strong>R$ ${(totalPerH * 8).toFixed(2)}</strong>`;
}

function savePrinter(isEdit = false) {
    const name     = document.getElementById('printerName').value.trim();
    const value    = parseFloat(document.getElementById('printerValue').value);
    const lifetime = parseFloat(document.getElementById('printerLifetime').value);
    const wattage  = parseFloat(document.getElementById('printerWattage').value);
    const speed    = parseFloat(document.getElementById('printerSpeed').value);

    if (!name) { showToast('⚠️ Nome da impressora é obrigatório'); return; }

    if (isEdit) {
        const id = parseInt(document.getElementById('printerEditId').value);
        db.run('UPDATE printers SET name=?, value=?, lifetime_hours=?, wattage=?, speed_gph=? WHERE id=?',
            [name, value, lifetime, wattage, speed, id]);
        showToast('✅ Impressora atualizada!');
    } else {
        db.run('INSERT INTO printers (name, value, lifetime_hours, wattage, speed_gph) VALUES (?,?,?,?,?)',
            [name, value, lifetime, wattage, speed]);
        showToast('✅ Impressora salva!');
    }

    persistDB();
    closeModal();
    loadPrinters();
}

function deletePrinter(printerId) {
    if (confirm('Excluir esta impressora?')) {
        db.run('DELETE FROM printers WHERE id = ?', [printerId]);
        persistDB();
        loadPrinters();
    }
}
