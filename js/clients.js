// ==================== CLIENTES ====================

const BRAZIL_STATES = [
    ['AC','Acre'],['AL','Alagoas'],['AP','Amapá'],['AM','Amazonas'],['BA','Bahia'],
    ['CE','Ceará'],['DF','Distrito Federal'],['ES','Espírito Santo'],['GO','Goiás'],
    ['MA','Maranhão'],['MT','Mato Grosso'],['MS','Mato Grosso do Sul'],['MG','Minas Gerais'],
    ['PA','Pará'],['PB','Paraíba'],['PR','Paraná'],['PE','Pernambuco'],['PI','Piauí'],
    ['RJ','Rio de Janeiro'],['RN','Rio Grande do Norte'],['RS','Rio Grande do Sul'],
    ['RO','Rondônia'],['RR','Roraima'],['SC','Santa Catarina'],['SP','São Paulo'],
    ['SE','Sergipe'],['TO','Tocantins']
];

function onlyDigits(value) { return String(value || '').replace(/\D/g, ''); }
function formatPhone(value) {
    const d = onlyDigits(value).slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
    return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}
function formatCep(value) {
    const d = onlyDigits(value).slice(0, 8);
    return d.length > 5 ? `${d.slice(0,5)}-${d.slice(5)}` : d;
}
function formatDocument(value) {
    const d = onlyDigits(value).slice(0, 14);
    if (d.length <= 11) {
        return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
    }
    return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}
function isValidEmail(email) {
    return !email || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}
function isValidCPF(cpf) {
    const d = onlyDigits(cpf);
    if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
    const calc = len => {
        let sum = 0;
        for (let i=0;i<len;i++) sum += Number(d[i]) * (len + 1 - i);
        const r = (sum * 10) % 11;
        return r === 10 ? 0 : r;
    };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}
function isValidCNPJ(cnpj) {
    const d = onlyDigits(cnpj);
    if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
    const digit = base => {
        let factor = base.length - 7, sum = 0;
        for (const n of base) { sum += Number(n) * factor--; if (factor < 2) factor = 9; }
        const r = sum % 11;
        return r < 2 ? 0 : 11 - r;
    };
    return digit(d.slice(0,12)) === Number(d[12]) && digit(d.slice(0,13)) === Number(d[13]);
}
function isValidDocument(value) {
    const d = onlyDigits(value);
    return !d || (d.length === 11 ? isValidCPF(d) : d.length === 14 ? isValidCNPJ(d) : false);
}
function setClientFieldError(id, message='') {
    const input = document.getElementById(id);
    const error = document.getElementById(`${id}Error`);
    if (input) input.classList.toggle('input-invalid', Boolean(message));
    if (error) { error.textContent = message; error.style.display = message ? 'block' : 'none'; }
}
function clearClientErrors() {
    ['clientName','clientEmail','clientPhone','clientDocument','clientPostalCode','clientAddress','clientAddressNumber','clientAddressComplement','clientCity','clientState']
        .forEach(id => setClientFieldError(id));
}
function bindClientFormMasks() {
    const phone = document.getElementById('clientPhone');
    const cep = document.getElementById('clientPostalCode');
    const doc = document.getElementById('clientDocument');

    if (phone) {
        phone.addEventListener('input', () => {
            phone.value = formatPhone(phone.value);
            setClientFieldError('clientPhone');
        });
    }

    if (cep) {
        let lastLookedUpCep = onlyDigits(cep.value);
        const triggerLookup = async () => {
            const digits = onlyDigits(cep.value);
            if (digits.length !== 8 || digits === lastLookedUpCep) return;
            lastLookedUpCep = digits;
            await lookupClientPostalCode(digits);
        };
        cep.addEventListener('input', () => {
            cep.value = formatCep(cep.value);
            setClientFieldError('clientPostalCode');
            if (onlyDigits(cep.value).length === 8) triggerLookup();
        });
        cep.addEventListener('blur', triggerLookup);
    }

    if (doc) {
        doc.addEventListener('input', () => {
            doc.value = formatDocument(doc.value);
            setClientFieldError('clientDocument');
        });
    }

    document.querySelectorAll('#clientForm input, #clientForm select').forEach(el => {
        el.addEventListener('blur', () => validateClientForm(false));
    });
}

async function lookupClientPostalCode(cepValue) {
    const cep = onlyDigits(cepValue);
    if (cep.length !== 8) {
        setClientFieldError('clientPostalCode', 'O CEP deve possuir 8 dígitos.');
        return false;
    }

    const cepInput = document.getElementById('clientPostalCode');
    const addressInput = document.getElementById('clientAddress');
    const cityInput = document.getElementById('clientCity');
    const stateInput = document.getElementById('clientState');
    const lookupStatus = document.getElementById('clientCepStatus');

    if (cepInput) cepInput.disabled = true;
    if (lookupStatus) {
        lookupStatus.textContent = 'Consultando CEP...';
        lookupStatus.className = 'field-help cep-loading';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            cache: 'no-store',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.erro) {
            setClientFieldError('clientPostalCode', 'CEP não encontrado.');
            if (lookupStatus) lookupStatus.textContent = '';
            return false;
        }

        if (addressInput) addressInput.value = data.logradouro || '';
        const complementInput = document.getElementById('clientAddressComplement');
        if (complementInput && !complementInput.value && data.complemento) complementInput.value = data.complemento;
        if (cityInput) cityInput.value = data.localidade || '';
        if (stateInput) stateInput.value = data.uf || '';

        setClientFieldError('clientPostalCode');
        setClientFieldError('clientCity');
        setClientFieldError('clientState');
        if (lookupStatus) {
            lookupStatus.textContent = 'Endereço preenchido automaticamente.';
            lookupStatus.className = 'field-help cep-success';
        }
        document.getElementById('clientAddressNumber')?.focus();
        return true;
    } catch (error) {
        clearTimeout(timeoutId);
        console.error('Erro ao consultar CEP:', error);
        const isTimeout = error.name === 'AbortError';
        if (lookupStatus) {
            lookupStatus.textContent = isTimeout
                ? 'Tempo esgotado ao consultar o CEP. Preencha o endereço manualmente.'
                : 'Não foi possível consultar o CEP. Preencha o endereço manualmente.';
            lookupStatus.className = 'field-help cep-warning';
        }
        return false;
    } finally {
        if (cepInput) cepInput.disabled = false;
    }
}

function loadClients() {
    const result = db.exec('SELECT id, name, email, phone, city, state, total_spent, last_order FROM clients WHERE deleted_at IS NULL ORDER BY name');
    let rows = '';
    if (result.length > 0 && result[0].values.length > 0) {
        result[0].values.forEach(([id, name, email, phone, city, state, spent, lastOrder]) => {
            rows += `<tr><td>${id}</td><td>${h(name)}</td><td>${h(email || '-')}</td><td>${h(phone || '-')}</td>
                <td>${h([city,state].filter(Boolean).join(' / ') || '-')}</td><td>R$ ${(spent || 0).toFixed(2)}</td>
                <td>${lastOrder ? new Date(lastOrder).toLocaleDateString('pt-BR') : '-'}</td><td>
                <button class="btn-info btn-sm" onclick="showClientProfile(${id})" title="Perfil">👤</button>
                <button type="button" class="btn-warning btn-sm client-edit-btn" data-client-id="${id}" onclick="showEditClientModal(${id})" title="Editar cliente">✏️</button>
                <button class="btn-danger btn-sm" onclick="deleteClient(${id})" title="Excluir">🗑️</button></td></tr>`;
        });
    } else rows = '<tr><td colspan="8" style="text-align:center">Nenhum cliente cadastrado</td></tr>';
    document.getElementById('clientsTableBody').innerHTML = rows;
    const sel = document.getElementById('calcClientId');
    if (sel) {
        sel.replaceChildren();
        const empty = document.createElement('option'); empty.value='0'; empty.textContent='Sem cliente'; sel.appendChild(empty);
        if (result.length) result[0].values.forEach(([id,name]) => { const opt=document.createElement('option'); opt.value=id; opt.textContent=name||`Cliente #${id}`; sel.appendChild(opt); });
    }
}
function showClientModal() {
    document.getElementById('modalTitle').innerHTML = '➕ Novo Cliente';
    document.getElementById('modalBody').innerHTML = clientFormHTML(); openModal(); bindClientFormMasks();
}
function showEditClientModal(clientId) {
    try {
        const r = db.exec('SELECT id,name,email,phone,address,city,state,document,postal_code,address_number,address_complement FROM clients WHERE id=? AND deleted_at IS NULL', [Number(clientId)]);
        if (!r.length || !r[0].values.length) {
            showToast('⚠️ Cliente não encontrado.');
            return;
        }

        const [id,name,email,phone,address,city,state,clientDocument,postal_code,address_number,address_complement] = r[0].values[0];
        const modalTitle = document.getElementById('modalTitle');
        const modalBody = document.getElementById('modalBody');
        if (!modalTitle || !modalBody) throw new Error('Janela de edição não encontrada no documento.');
        modalTitle.textContent = '✏️ Editar Cliente';
        modalBody.innerHTML = clientFormHTML({
            id, name, email, phone, address, city, state, document: clientDocument, postal_code,
            address_number, address_complement
        }, true);
        openModal();
        requestAnimationFrame(() => {
            bindClientFormMasks();
            document.getElementById('clientName')?.focus();
        });
    } catch (error) {
        console.error('Erro ao abrir edição do cliente:', error);
        showToast(`❌ Não foi possível abrir a edição: ${error.message || error}`);
    }
}
function clientError(id) { return `<small class="field-error" id="${id}Error" style="display:none"></small>`; }
function clientFormHTML(data={}, isEdit=false) {
    const states = BRAZIL_STATES.map(([uf,name]) => `<option value="${uf}" ${data.state===uf?'selected':''}>${uf} — ${name}</option>`).join('');
    return `<form id="clientForm" onsubmit="event.preventDefault(); saveClient(${isEdit});" novalidate>
      <input type="hidden" id="clientEditId" value="${Number(data.id || 0)}">
      <div class="field-grid two-columns">
        <div class="field-group field-span-2"><label for="clientName">Nome completo / Razão social *</label><input type="text" id="clientName" value="${h(data.name||'')}" minlength="2" maxlength="120" autocomplete="name" required>${clientError('clientName')}</div>
        <div class="field-group"><label for="clientPhone">Telefone / WhatsApp *</label><input type="tel" id="clientPhone" value="${h(formatPhone(data.phone||''))}" inputmode="numeric" maxlength="15" placeholder="(11) 99999-9999" autocomplete="tel" required>${clientError('clientPhone')}</div>
        <div class="field-group"><label for="clientDocument">CPF ou CNPJ</label><input type="text" id="clientDocument" value="${h(formatDocument(data.document||''))}" inputmode="numeric" maxlength="18" placeholder="000.000.000-00">${clientError('clientDocument')}</div>
        <div class="field-group field-span-2"><label for="clientEmail">E-mail</label><input type="email" id="clientEmail" value="${h(data.email||'')}" maxlength="160" placeholder="cliente@exemplo.com" autocomplete="email">${clientError('clientEmail')}</div>
        <div class="field-group"><label for="clientPostalCode">CEP *</label><input type="text" id="clientPostalCode" value="${h(formatCep(data.postal_code||''))}" inputmode="numeric" maxlength="9" placeholder="00000-000" autocomplete="postal-code" required>${clientError('clientPostalCode')}<small id="clientCepStatus" class="field-help">Digite o CEP para preencher o endereço.</small></div>
        <div class="field-group"><label for="clientState">Estado</label><select id="clientState"><option value="">Selecione...</option>${states}</select>${clientError('clientState')}</div>
        <div class="field-group"><label for="clientCity">Cidade</label><input type="text" id="clientCity" value="${h(data.city||'')}" maxlength="100" autocomplete="address-level2">${clientError('clientCity')}</div>
        <div class="field-group field-span-2"><label for="clientAddress">Logradouro</label><input type="text" id="clientAddress" value="${h(data.address||'')}" maxlength="180" placeholder="Rua, avenida, travessa..." autocomplete="address-line1">${clientError('clientAddress')}</div>
        <div class="field-group"><label for="clientAddressNumber">Número</label><input type="text" id="clientAddressNumber" value="${h(data.address_number||'')}" maxlength="20" placeholder="Ex.: 123 ou S/N" autocomplete="address-line2">${clientError('clientAddressNumber')}</div>
        <div class="field-group"><label for="clientAddressComplement">Complemento</label><input type="text" id="clientAddressComplement" value="${h(data.address_complement||'')}" maxlength="100" placeholder="Apto, bloco, sala...">${clientError('clientAddressComplement')}</div>
      </div>
      <div class="form-validation-note">* Campos obrigatórios: nome, telefone e CEP. O endereço pode ser preenchido automaticamente pelo CEP.</div>
      <div class="card-actions"><button type="submit" class="btn-primary">${isEdit?'Atualizar Cliente':'Salvar Cliente'}</button><button type="button" class="btn-secondary" onclick="closeModal()">Cancelar</button></div>
    </form>`;
}
function validateClientForm(showAll=true) {
    clearClientErrors();
    let ok = true;
    const name = document.getElementById('clientName')?.value.trim() || '';
    const email = document.getElementById('clientEmail')?.value.trim().toLowerCase() || '';
    const phone = onlyDigits(document.getElementById('clientPhone')?.value || '');
    const documentValue = onlyDigits(document.getElementById('clientDocument')?.value || '');
    const cep = onlyDigits(document.getElementById('clientPostalCode')?.value || '');
    const state = document.getElementById('clientState')?.value || '';
    const invalid = (id,msg) => { setClientFieldError(id,msg); ok=false; };

    if (name.length < 2) invalid('clientName', 'Informe um nome com pelo menos 2 caracteres.');
    if (![10,11].includes(phone.length)) invalid('clientPhone', 'Informe DDD e telefone com 10 ou 11 dígitos.');
    if (cep.length !== 8) invalid('clientPostalCode', 'Informe um CEP com 8 dígitos.');
    if (!isValidEmail(email)) invalid('clientEmail', 'Informe um e-mail válido, como nome@dominio.com.');
    if (documentValue && !isValidDocument(documentValue)) invalid('clientDocument', 'CPF ou CNPJ inválido.');
    if (state && !BRAZIL_STATES.some(([uf]) => uf === state)) invalid('clientState', 'Selecione um estado válido.');
    return ok;
}
function clientDuplicateExists(field,value,currentId=0) {
    if (!value) return false;
    const result=db.exec(`SELECT id FROM clients WHERE lower(${field})=lower(?) AND id<>? LIMIT 1`,[value,currentId]);
    return result.length>0 && result[0].values.length>0;
}
function saveClient(isEdit=false) {
    if (!validateClientForm(true)) { showToast('⚠️ Revise os campos destacados.'); return; }
    const name=document.getElementById('clientName').value.trim();
    const email=document.getElementById('clientEmail').value.trim().toLowerCase();
    const phone=formatPhone(document.getElementById('clientPhone').value);
    const documentValue=onlyDigits(document.getElementById('clientDocument').value);
    const postalCode=formatCep(document.getElementById('clientPostalCode').value);
    const address=document.getElementById('clientAddress').value.trim();
    const addressNumber=document.getElementById('clientAddressNumber')?.value.trim() || '';
    const addressComplement=document.getElementById('clientAddressComplement')?.value.trim() || '';
    const city=document.getElementById('clientCity').value.trim();
    const state=document.getElementById('clientState').value;
    const id = isEdit ? Number(document.getElementById('clientEditId')?.value || 0) : 0;
    if (isEdit && !id) { showToast('⚠️ Não foi possível identificar o cliente para edição.'); return; }
    if (clientDuplicateExists('email',email,id)) { setClientFieldError('clientEmail','Este e-mail já pertence a outro cliente.'); showToast('⚠️ E-mail já cadastrado.'); return; }
    if (clientDuplicateExists('document',documentValue,id)) { setClientFieldError('clientDocument','Este CPF/CNPJ já pertence a outro cliente.'); showToast('⚠️ CPF/CNPJ já cadastrado.'); return; }
    if (isEdit) {
        db.run('UPDATE clients SET name=?,email=?,phone=?,address=?,address_number=?,address_complement=?,city=?,state=?,document=?,postal_code=? WHERE id=?',[name,email,phone,address,addressNumber,addressComplement,city,state,documentValue,postalCode,id]);
        showToast('✅ Cliente atualizado!');
    } else {
        db.run('INSERT INTO clients (name,email,phone,address,address_number,address_complement,city,state,document,postal_code,total_spent,last_order) VALUES (?,?,?,?,?,?,?,?,?,?,0,NULL)',[name,email,phone,address,addressNumber,addressComplement,city,state,documentValue,postalCode]);
        showToast('✅ Cliente salvo!');
    }
    persistDB(); closeModal(); loadClients();
}
function deleteClient(clientId) { if(confirm('Mover este cliente para a lixeira? Os pedidos vinculados serão mantidos.')) { const old=dbRowObject('SELECT * FROM clients WHERE id=? AND deleted_at IS NULL',[clientId]); db.run('UPDATE clients SET deleted_at=? WHERE id=?',[new Date().toISOString(),clientId]); auditLog('clients',clientId,'soft_delete',old,null); persistDB(); loadClients(); showToast('Cliente movido para a lixeira.'); } }
function showClientProfile(clientId) {
    const cr=db.exec('SELECT name,email,phone,address,city,state,total_spent,last_order,document,postal_code,address_number,address_complement FROM clients WHERE id=? AND deleted_at IS NULL',[clientId]);
    if(!cr.length||!cr[0].values.length)return;
    const [name,email,phone,address,city,state,spent,lastOrder,documentValue,postalCode,addressNumber,addressComplement]=cr[0].values[0];
    const orders=db.exec(`SELECT id,work_type,material_name,quantity,total_price,profit,status,date FROM orders WHERE client_id=? AND deleted_at IS NULL ORDER BY id DESC`,[clientId]);
    const statusNames = STATUS_NAMES;
    const workTypeNames = WORK_TYPE_NAMES;
    let waDigits=onlyDigits(phone); if(waDigits&&!waDigits.startsWith('55'))waDigits='55'+waDigits;
    const waLink=waDigits?`<a href="https://wa.me/${waDigits}" target="_blank" rel="noopener" class="inline-action-link">💬 WhatsApp</a>`:'';
    const mailLink=email?`<a href="mailto:${h(email)}" class="inline-action-link">📧 E-mail</a>`:'';
    let html=`<div class="client-profile-grid">
      <div><small>Documento</small><strong>${h(formatDocument(documentValue)||'—')}</strong></div>
      <div><small>Telefone</small><strong>${h(phone||'—')} ${waLink}</strong></div>
      <div><small>E-mail</small><strong>${h(email||'—')} ${mailLink}</strong></div>
      <div><small>CEP</small><strong>${h(postalCode||'—')}</strong></div>
      <div class="wide"><small>Endereço</small><strong>${h([[address,addressNumber].filter(Boolean).join(', '),addressComplement,city,state].filter(Boolean).join(' — ')||'Não informado')}</strong></div>
      <div><small>Total gasto</small><strong>R$ ${(spent||0).toFixed(2)}</strong></div>
      <div><small>Último pedido</small><strong>${lastOrder?new Date(lastOrder).toLocaleDateString('pt-BR'):'—'}</strong></div></div>`;
    if(orders.length&&orders[0].values.length){ html+=`<div class="table-container" style="max-height:380px;overflow:auto"><table><thead><tr><th>#</th><th>Tipo</th><th>Material</th><th>Qtd</th><th>Total</th><th>Lucro</th><th>Status</th><th>Data</th></tr></thead><tbody>`; orders[0].values.forEach(([id,wt,mat,qty,total,profit,status,date])=>{html+=`<tr><td>${id}</td><td>${workTypeNames[wt]||h(wt)}</td><td>${h(mat||'—')}</td><td>${qty}</td><td>R$ ${(total||0).toFixed(2)}</td><td>R$ ${(profit||0).toFixed(2)}</td><td>${statusNames[status]||h(status)}</td><td>${new Date(date).toLocaleDateString('pt-BR')}</td></tr>`}); html+='</tbody></table></div>'; }
    else html+='<p class="empty-state-text">Nenhum pedido registrado para este cliente.</p>';
    document.getElementById('modalTitle').innerHTML=`👤 ${h(name)}`; document.getElementById('modalBody').innerHTML=html; openModal();
}


// Mantém a edição disponível mesmo quando a tabela é recriada dinamicamente.
window.showEditClientModal = showEditClientModal;
window.showClientModal = showClientModal;
if (!window.__clientEditDelegationBound) {
    window.__clientEditDelegationBound = true;
    document.addEventListener('click', (event) => {
        const button = event.target.closest('.client-edit-btn');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        showEditClientModal(Number(button.dataset.clientId));
    });
}
