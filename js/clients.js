// ==================== CLIENTES ====================

function loadClients() {
    const result = db.exec('SELECT id, name, email, phone, city, total_spent, last_order FROM clients ORDER BY name');
    let rows = '';
    if (result.length > 0 && result[0].values.length > 0) {
        result[0].values.forEach(([id, name, email, phone, city, spent, lastOrder]) => {
            rows += `<tr>
                <td>${id}</td>
                <td>${h(name)}</td>
                <td>${h(email || '-')}</td>
                <td>${h(phone || '-')}</td>
                <td>${h(city  || '-')}</td>
                <td>R$ ${(spent || 0).toFixed(2)}</td>
                <td>${lastOrder ? new Date(lastOrder).toLocaleDateString('pt-BR') : '-'}</td>
                <td>
                    <button class="btn-info    btn-sm" onclick="showClientProfile(${id})">👤</button>
                    <button class="btn-warning btn-sm" onclick="showEditClientModal(${id})">✏️</button>
                    <button class="btn-danger  btn-sm" onclick="deleteClient(${id})">🗑️</button>
                </td>
            </tr>`;
        });
    } else {
        rows = '<tr><td colspan="8" style="text-align:center">Nenhum cliente cadastrado</td></tr>';
    }
    document.getElementById('clientsTableBody').innerHTML = rows;

    // Atualiza select da calculadora
    const sel = document.getElementById('calcClientId');
    sel.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '0';
    empty.textContent = 'Sem cliente';
    sel.appendChild(empty);
    if (result.length > 0 && result[0].values.length > 0) {
        result[0].values.forEach(([id, name]) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = name || `Cliente #${id}`;
            sel.appendChild(opt);
        });
    }
}

function showClientModal() {
    document.getElementById('modalTitle').innerHTML = '➕ Novo Cliente';
    document.getElementById('modalBody').innerHTML = clientFormHTML();
    openModal();
}

function showEditClientModal(clientId) {
    const r = db.exec('SELECT * FROM clients WHERE id = ?', [clientId]);
    if (!r.length) return;
    const [id, name, email, phone, address, city, state] = r[0].values[0];

    document.getElementById('modalTitle').innerHTML = '✏️ Editar Cliente';
    document.getElementById('modalBody').innerHTML =
        clientFormHTML({ name, email, phone, address, city, state }) +
        `<input type="hidden" id="clientEditId" value="${id}">`;
    openModal();
    // muda botão para editar
    document.querySelector('#modalBody .btn-primary').setAttribute('onclick', 'saveClient(true)');
    document.querySelector('#modalBody .btn-primary').textContent = 'Atualizar Cliente';
}

function clientFormHTML(data = {}) {
    return `
        <div class="input-group"><label>Nome *</label>
            <input type="text" id="clientName" value="${h(data.name || '')}"></div>
        <div class="input-group"><label>Email</label>
            <input type="email" id="clientEmail" value="${h(data.email || '')}"></div>
        <div class="input-group"><label>Telefone</label>
            <input type="text" id="clientPhone" value="${h(data.phone || '')}"></div>
        <div class="input-group"><label>Endereço</label>
            <input type="text" id="clientAddress" value="${h(data.address || '')}"></div>
        <div class="input-group"><label>Cidade</label>
            <input type="text" id="clientCity" value="${h(data.city || '')}"></div>
        <div class="input-group"><label>Estado</label>
            <input type="text" id="clientState" value="${h(data.state || '')}"></div>
        <button class="btn-primary" onclick="saveClient(false)" style="margin-top:15px;">Salvar Cliente</button>
    `;
}

function saveClient(isEdit = false) {
    const name    = document.getElementById('clientName').value.trim();
    const email   = document.getElementById('clientEmail').value.trim();
    const phone   = document.getElementById('clientPhone').value.trim();
    const address = document.getElementById('clientAddress').value.trim();
    const city    = document.getElementById('clientCity').value.trim();
    const state   = document.getElementById('clientState').value.trim();

    if (!name) { showToast('⚠️ Nome é obrigatório'); return; }

    if (isEdit) {
        const id = parseInt(document.getElementById('clientEditId').value);
        db.run('UPDATE clients SET name=?, email=?, phone=?, address=?, city=?, state=? WHERE id=?',
            [name, email, phone, address, city, state, id]);
        showToast('✅ Cliente atualizado!');
    } else {
        db.run('INSERT INTO clients (name, email, phone, address, city, state, total_spent, last_order) VALUES (?,?,?,?,?,?,0,NULL)',
            [name, email, phone, address, city, state]);
        showToast('✅ Cliente salvo!');
    }

    persistDB();
    closeModal();
    loadClients();
}

function deleteClient(clientId) {
    if (confirm('Excluir este cliente? Os pedidos vinculados a ele serão mantidos.')) {
        db.run('DELETE FROM clients WHERE id = ?', [clientId]);
        persistDB();
        loadClients();
    }
}

function showClientProfile(clientId) {
    const cr = db.exec('SELECT name, email, phone, address, city, state, total_spent, last_order FROM clients WHERE id = ?', [clientId]);
    if (!cr.length || !cr[0].values.length) return;
    const [name, email, phone, address, city, state, spent, lastOrder] = cr[0].values[0];

    const orders = db.exec(
        `SELECT id, work_type, material_name, quantity, total_price, profit, status, date
         FROM orders WHERE client_id = ? AND deleted_at IS NULL ORDER BY id DESC`,
        [clientId]
    );

    const statusNames = { quote:'Orçamento', approved:'Aprovado', paid:'Pago', printing:'Imprimindo',
        post:'Pós-proc.', packaging:'Embalagem', shipped:'Enviado', delivered:'Entregue', cancelled:'Cancelado' };
    const workTypeNames = { simple:'Brinde Simples', personalized:'Personalizado', technical:'Técnica', custom:'Sob Medida' };

    // WhatsApp link se tiver telefone
    const phoneClean = (phone || '').replace(/\D/g, '');
    const waLink = phoneClean ? `<a href="https://wa.me/55${phoneClean}" target="_blank" rel="noopener"
        style="color:var(--primary);text-decoration:none;">💬 WhatsApp</a>` : '';
    const mailLink = email ? `<a href="mailto:${h(email)}"
        style="color:var(--primary);text-decoration:none;">📧 E-mail</a>` : '';

    let html = `<div style="margin-bottom:16px;display:flex;flex-wrap:wrap;gap:16px;">
        <div><strong>📍</strong> ${h([address, city, state].filter(Boolean).join(', ') || 'Endereço não informado')}</div>
        <div><strong>📞</strong> ${h(phone || '—')} ${waLink}</div>
        <div><strong>📧</strong> ${h(email || '—')} ${mailLink}</div>
        <div><strong>💰 Total gasto:</strong> R$ ${(spent||0).toFixed(2)}</div>
        <div><strong>🗓️ Último pedido:</strong> ${lastOrder ? new Date(lastOrder).toLocaleDateString('pt-BR') : '—'}</div>
    </div>`;

    if (orders.length > 0 && orders[0].values.length > 0) {
        html += `<div class="table-container" style="max-height:380px;overflow-y:auto;">
        <table style="font-size:0.82em;">
          <thead><tr><th>#</th><th>Tipo</th><th>Material</th><th>Qtd</th><th>Total</th><th>Lucro</th><th>Status</th><th>Data</th></tr></thead>
          <tbody>`;
        orders[0].values.forEach(([id, wt, mat, qty, total, profit, status, date]) => {
            html += `<tr>
                <td>${id}</td>
                <td>${workTypeNames[wt]||wt}</td>
                <td>${h(mat||'—')}</td>
                <td>${qty}</td>
                <td>R$ ${(total||0).toFixed(2)}</td>
                <td>R$ ${(profit||0).toFixed(2)}</td>
                <td>${statusNames[status]||status}</td>
                <td style="white-space:nowrap;">${new Date(date).toLocaleDateString('pt-BR')}</td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
    } else {
        html += '<p style="color:var(--text-muted);">Nenhum pedido registrado para este cliente.</p>';
    }

    document.getElementById('modalTitle').innerHTML = `👤 ${h(name)}`;
    document.getElementById('modalBody').innerHTML = html;
    openModal();
}
