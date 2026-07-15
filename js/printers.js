// ==================== IMPRESSORAS ====================

function updatePrinterKpis(statuses = _bambuLastStatuses || {}) {
    const rows = db.exec('SELECT id, bambu_ip, bambu_serial FROM printers');
    const printers = rows.length ? rows[0].values : [];
    let online = 0, busy = 0, offline = 0;
    printers.forEach(([id, ip, serial]) => {
        const s = statuses[String(id)];
        if (s?.connected) { online++; if (typeof isBambuBusy === 'function' && isBambuBusy(s)) busy++; }
        else if (ip && serial) offline++;
    });
    [['printerKpiTotal', printers.length], ['printerKpiOnline', online], ['printerKpiBusy', busy], ['printerKpiOffline', offline]].forEach(([id, value]) => {
        const el = document.getElementById(id); if (el) el.textContent = value;
    });
}

function loadPrinterDashboard() {
    const result = db.exec('SELECT id, name, value, lifetime_hours, wattage, speed_gph, hours_used, bambu_ip, bambu_serial FROM printers ORDER BY name');
    const grid = document.getElementById('printerDashboardGrid');
    if (!grid) return;
    const values = result.length ? result[0].values : [];
    updatePrinterKpis(_bambuLastStatuses || {});
    if (!values.length) {
        grid.innerHTML = '<div class="col-12"><div class="text-center text-body-secondary py-5"><i class="bi bi-printer fs-1 d-block mb-2"></i><h3 class="h6">Nenhuma impressora cadastrada</h3><p class="small mb-3">Cadastre sua primeira impressora para acompanhar custos e telemetria.</p><button class="btn btn-primary btn-sm" onclick="showPrinterModal()">Nova impressora</button></div></div>';
        return;
    }
    const energyPrice = parseFloat(currentSettings.energyPrice) || 1;
    const maintenancePerH = parseFloat(currentSettings.maintenancePerHour) || 0.50;
    grid.innerHTML = values.map(([id, name, value, lifetimeH, wattage, speedGph, hoursUsed, bambuIp, bambuSerial]) => {
        const lifetime = Math.max(Number(lifetimeH) || 1, 1);
        const used = Number(hoursUsed) || 0;
        const usedPct = Math.min(100, Math.round((used / lifetime) * 100));
        const totalPerH = (Number(value || 0) / lifetime) + ((Number(wattage || 0) * energyPrice) / 1000) + maintenancePerH;
        return `<div class="col-12 col-md-6 col-xxl-4">
          <article class="card s3d-printer-card h-100" id="printerCard-${id}">
            <div class="card-body d-flex flex-column">
              <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
                <div class="min-w-0"><div class="d-flex align-items-center gap-2"><span class="s3d-printer-icon"><i class="bi bi-printer"></i></span><h3 class="h6 mb-0 text-truncate">${h(name)}</h3></div><small class="text-body-secondary d-block mt-2">${Number(speedGph||0)} g/h · ${Number(wattage||0)} W</small></div>
                <span class="badge rounded-pill text-bg-secondary" id="printerStatusBadge-${id}" data-bambu-configured="${bambuIp && bambuSerial ? '1' : '0'}">${bambuIp && bambuSerial ? 'Conectando…' : 'Sem integração'}</span>
              </div>
              <div class="s3d-printer-life mb-3"><div class="d-flex justify-content-between small mb-1"><span class="text-body-secondary">Vida útil utilizada</span><strong>${usedPct}%</strong></div><div class="progress" role="progressbar"><div class="progress-bar ${usedPct>=90?'bg-danger':usedPct>=70?'bg-warning':'bg-success'}" style="width:${usedPct}%"></div></div><div class="d-flex justify-content-between small text-body-secondary mt-1"><span>${used.toFixed(1)} h</span><span>${lifetime} h</span></div></div>
              <div class="border rounded-3 p-3 bg-body-tertiary flex-grow-1" id="printerBambuPanel-${id}">${bambuIp && bambuSerial ? `<div class="small"><strong class="d-block mb-1">Integração Bambu configurada</strong><span class="text-body-secondary d-block">IP ${h(bambuIp)}</span><span class="text-body-secondary d-block text-truncate">Serial ${h(bambuSerial)}</span></div>` : '<div class="small text-body-secondary">Sem monitoramento em tempo real.</div>'}</div>
              <div class="d-flex justify-content-between align-items-center border-top pt-3 mt-3"><div><small class="text-body-secondary d-block">Custo operacional</small><strong>${money(totalPerH)}/h</strong></div><button class="btn btn-sm btn-outline-primary" onclick="showEditPrinterModal(${id})"><i class="bi bi-pencil me-1"></i>Editar</button></div>
            </div>
          </article>
        </div>`;
    }).join('');
    if (typeof _renderPrinterDashboard === 'function') _renderPrinterDashboard(_bambuLastStatuses || {});
}

function loadPrinters() {
    const result = db.exec('SELECT id, name, value, lifetime_hours, wattage, speed_gph, hours_used, bambu_ip, bambu_serial FROM printers ORDER BY name');
    const values = result.length ? result[0].values : [];
    const energyPrice = parseFloat(currentSettings.energyPrice) || 1;
    const maintenancePerH = parseFloat(currentSettings.maintenancePerHour) || 0.50;
    const body = document.getElementById('printersTableBody');
    if (body) body.innerHTML = values.length ? values.map(([id,name,value,lifetimeH,wattage,speedGph,hoursUsed,bambuIp,bambuSerial]) => {
        const lifetime = Math.max(Number(lifetimeH)||1,1), used=Number(hoursUsed)||0, pct=Math.min(100,Math.round(used/lifetime*100));
        const depr=(Number(value||0)/lifetime), energy=(Number(wattage||0)*energyPrice/1000), total=depr+energy+maintenancePerH;
        return `<tr><td><div class="d-flex align-items-center gap-2"><span class="s3d-table-icon"><i class="bi bi-printer"></i></span><div><strong class="d-block">${h(name)}</strong>${bambuIp&&bambuSerial?'<span class="badge text-bg-success-subtle text-success border border-success-subtle mt-1">Bambu configurada</span>':''}</div></div></td><td>${money(value)}</td><td><div class="small d-flex justify-content-between"><span>${used.toFixed(1)} h</span><span>${pct}%</span></div><div class="progress mt-1" style="height:.35rem"><div class="progress-bar ${pct>=90?'bg-danger':pct>=70?'bg-warning':'bg-success'}" style="width:${pct}%"></div></div><small class="text-body-secondary">de ${lifetime} h</small></td><td>${Number(wattage||0)} W</td><td>${Number(speedGph||0)} g/h</td><td><strong>${money(total)}/h</strong><small class="d-block text-body-secondary">Dep. ${money(depr)} · Energia ${money(energy)}</small></td><td class="text-end"><div class="s3d-actions d-inline-flex flex-row flex-nowrap align-items-center gap-1"><button class="btn btn-outline-primary" title="Editar" onclick="showEditPrinterModal(${id})"><i class="bi bi-pencil"></i></button><button class="btn btn-outline-danger" title="Excluir" onclick="deletePrinter(${id})"><i class="bi bi-trash"></i></button></div></td></tr>`;
    }).join('') : '<tr><td colspan="7" class="text-center text-body-secondary py-5">Nenhuma impressora cadastrada</td></tr>';
    const sel=document.getElementById('calcPrinter'); if(sel){sel.replaceChildren();values.forEach(([id,name])=>{const o=document.createElement('option');o.value=id;o.textContent=name||`Impressora #${id}`;sel.appendChild(o)});if(values.length&&typeof updatePriceCalculation==='function')updatePriceCalculation();}
    loadPrinterDashboard();
}

function showPrinterModal() {
    document.getElementById('modalTitle').innerHTML = '➕ Nova Impressora';
    document.getElementById('modalBody').innerHTML = printerFormHTML();
    openModal();
    updatePrinterCostPreview();
}

async function showEditPrinterModal(printerId) {
    const r = db.exec(
        'SELECT id,name,value,lifetime_hours,wattage,speed_gph,bambu_ip,bambu_serial,bambu_access_code FROM printers WHERE id=?',
        [printerId]
    );
    if (!r.length) return;
    const [id, name, value, lifetimeH, wattage, speedGph, localIp, localSerial, localCode] = r[0].values[0];

    // Busca configuração Bambu do servidor (fonte autoritativa, sobrevive ao refreshResource)
    let bambuIp = localIp || '', bambuSerial = localSerial || '', bambuAccessCode = localCode || '';
    let bambuHasCode = false;
    try {
        const cfgRes = await fetch('/api/bambu-config', { cache: 'no-store' });
        if (cfgRes.ok) {
            const cfgAll = await cfgRes.json();
            const cfg = cfgAll[String(id)];
            if (cfg) {
                bambuIp      = cfg.ip     || bambuIp;
                bambuSerial  = cfg.serial || bambuSerial;
                bambuHasCode = cfg.has_code || false;
                // access_code não é exposto por segurança — mantém o valor do sql.js se disponível
            }
        }
    } catch (_) {}

    document.getElementById('modalTitle').innerHTML = '✏️ Editar Impressora';
    document.getElementById('modalBody').innerHTML =
        printerFormHTML({ name, value, lifetime: lifetimeH, wattage, speed: speedGph,
                          bambuIp, bambuSerial, bambuAccessCode,
                          bambuHasCode, editId: id }) +
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
        <details style="margin-bottom:12px;" ${data.bambuIp ? 'open' : ''}>
            <summary style="cursor:pointer;font-weight:600;font-size:.9em;color:var(--text-muted);padding:6px 0;">
                🖨️ Bambu Lab — Monitoramento MQTT (opcional)
            </summary>
            <div style="margin-top:8px;padding:10px;background:rgba(0,0,0,.06);border-radius:8px;">
                <div class="field-group" style="margin-bottom:8px;"><label style="font-size:.85em;">IP da impressora</label>
                    <input type="text" id="printerBambuIp" value="${h(data.bambuIp || '')}" placeholder="192.168.x.x"></div>
                <div class="field-group" style="margin-bottom:8px;">
                    <label style="font-size:.85em;">Número de série
                        <small style="font-weight:400;color:var(--text-muted);">— necessário para o tópico MQTT <code>device/{serial}/report</code></small>
                    </label>
                    <input type="text" id="printerBambuSerial" value="${h(data.bambuSerial || '')}" placeholder="01SXXXXXXXXXXXXXXX">
                </div>
                <div class="field-group" style="margin-bottom:8px;"><label style="font-size:.85em;">Access Code
                    ${data.bambuHasCode && !data.bambuAccessCode ? '<span style="color:#38a169;font-size:.85em;font-weight:400;">✅ configurado</span>' : ''}
                </label>
                    <div class="password-field">
                        <input type="password" id="printerBambuAccessCode" value="${h(data.bambuAccessCode || '')}"
                               placeholder="${data.bambuHasCode && !data.bambuAccessCode ? '(mantém o atual — deixe vazio para não alterar)' : '8 caracteres'}">
                        <button type="button" onclick="toggleSecretField('printerBambuAccessCode', this)">👁</button>
                    </div></div>
                <div style="display:flex;align-items:center;gap:10px;margin-top:6px;">
                    <button type="button" class="btn-secondary btn-sm" onclick="testPrinterBambu(${data.editId || 0})">🔌 Testar conexão</button>
                    <span id="bambuTestBadge" style="font-size:.82em;color:var(--text-muted);">—</span>
                </div>
            </div>
        </details>
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

async function savePrinter(isEdit = false) {
    const name          = document.getElementById('printerName').value.trim();
    const value         = parseFloat(document.getElementById('printerValue').value) || 0;
    const lifetime      = parseFloat(document.getElementById('printerLifetime').value) || 0;
    const wattage       = parseFloat(document.getElementById('printerWattage').value) || 0;
    const speed         = parseFloat(document.getElementById('printerSpeed').value) || 0;
    const bambuIp       = (document.getElementById('printerBambuIp')?.value || '').trim();
    const bambuSerial   = (document.getElementById('printerBambuSerial')?.value || '').trim();
    const bambuCode     = (document.getElementById('printerBambuAccessCode')?.value || '').trim();

    if (!name) { showToast('⚠️ Nome da impressora é obrigatório'); return; }

    // Se campo access_code veio vazio em edição, preserva o valor já gravado no banco
    // (o placeholder "(mantém o atual)" indica que o usuário deixou em branco intencionalmente)
    const codeForDB = bambuCode || null;

    let printerId;
    if (isEdit) {
        printerId = parseInt(document.getElementById('printerEditId').value);
        if (bambuCode) {
            // Atualiza tudo, incluindo o novo access_code
            db.run('UPDATE printers SET name=?, value=?, lifetime_hours=?, wattage=?, speed_gph=?, bambu_ip=?, bambu_serial=?, bambu_access_code=? WHERE id=?',
                [name, value, lifetime, wattage, speed, bambuIp || null, bambuSerial || null, codeForDB, printerId]);
        } else {
            // access_code em branco: preserva o que já está no banco
            db.run('UPDATE printers SET name=?, value=?, lifetime_hours=?, wattage=?, speed_gph=?, bambu_ip=?, bambu_serial=? WHERE id=?',
                [name, value, lifetime, wattage, speed, bambuIp || null, bambuSerial || null, printerId]);
        }
        showToast('✅ Impressora atualizada!');
    } else {
        db.run('INSERT INTO printers (name, value, lifetime_hours, wattage, speed_gph, hours_used, bambu_ip, bambu_serial, bambu_access_code) VALUES (?,?,?,?,?,?,?,?,?)',
            [name, value, lifetime, wattage, speed, 0, bambuIp || null, bambuSerial || null, bambuCode || null]);
        printerId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
        showToast('✅ Impressora salva!');
    }

    // Notifica o servidor para iniciar/atualizar MQTT
    // Se access_code veio vazio em edição, o servidor mantém o que já está em memória
    if (bambuIp && bambuSerial) {
        const body = { printer_id: printerId, ip: bambuIp, serial: bambuSerial };
        if (bambuCode) body.access_code = bambuCode;
        try {
            const response = await fetch('/api/bambu-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                cache: 'no-store'
            });
            const saved = await response.json().catch(() => ({}));
            if (!response.ok || saved.ok === false) throw new Error(saved.error || `HTTP ${response.status}`);
            // Mantém IP e serial no espelho para que o formulário continue preenchido
            // mesmo após fechar/reabrir a tela. O access code permanece somente no servidor.
            db.run('UPDATE printers SET bambu_ip=?, bambu_serial=? WHERE id=?', [saved.ip || bambuIp, saved.serial || bambuSerial, printerId]);
        } catch (error) {
            showToast(`⚠️ Impressora salva, mas a configuração Bambu falhou: ${error.message || error}`);
        }
    }

    persistDB();
    closeModal();
    loadPrinters();
    loadPrinterDashboard();
}

async function testPrinterBambu(editId) {
    const badge  = document.getElementById('bambuTestBadge');
    const ip     = document.getElementById('printerBambuIp')?.value.trim();
    const serial = document.getElementById('printerBambuSerial')?.value.trim();
    const code   = document.getElementById('printerBambuAccessCode')?.value.trim();

    if (!ip || !serial || !code) {
        if (badge) { badge.textContent = '⚠️ Preencha IP, serial e access code'; badge.style.color = '#d97706'; }
        return;
    }

    // Usa o id da impressora em edição, ou 0 como slot temporário de teste
    const testId = parseInt(editId) || 0;

    if (badge) { badge.textContent = '⏳ Conectando…'; badge.style.color = 'var(--text-muted)'; }

    try {
        // Envia config ao servidor para iniciar/atualizar conexão MQTT
        const res = await fetch('/api/bambu-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ printer_id: testId, ip, serial, access_code: code })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Falha ao enviar config');
    } catch (err) {
        if (badge) { badge.textContent = '❌ Servidor offline'; badge.style.color = '#e53e3e'; }
        return;
    }

    // Aguarda 3s para a conexão MQTT estabelecer, depois verifica status
    await new Promise(r => setTimeout(r, 3000));
    try {
        const res  = await fetch('/api/bambu-status', { cache: 'no-store' });
        const all  = await res.json();
        const s    = all[String(testId)];
        if (!s) {
            badge.textContent = '⚪ Sem resposta ainda — aguarde e verifique o IP';
            badge.style.color = 'var(--text-muted)';
        } else if (s.connected) {
            badge.textContent = '🟢 Conectado! Serial: ' + h(s.serial || serial);
            badge.style.color = '#38a169';
        } else {
            badge.textContent = '🔴 Falha — ' + h(s.error || 'verifique IP/serial/access code');
            badge.style.color = '#e53e3e';
        }
    } catch (_) {
        badge.textContent = '❌ Erro ao verificar status';
        badge.style.color = '#e53e3e';
    }
}

function deletePrinter(printerId) {
    if (confirm('Excluir esta impressora?')) {
        db.run('DELETE FROM printers WHERE id = ?', [printerId]);
        persistDB();
        loadPrinters();
        loadPrinterDashboard();
    }
}
