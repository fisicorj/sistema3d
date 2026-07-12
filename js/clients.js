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
                <td>${lastOrder ? new Date(lastOrder).toLocaleDateString('pt-BR') : '-'}</td><td class="text-end text-nowrap">
                <div class="s3d-actions d-inline-flex flex-row flex-nowrap align-items-center gap-1" role="group" aria-label="Ações do cliente">
                    <button class="btn btn-outline-secondary" onclick="showClientProfile(${id})" title="Perfil"><i class="bi bi-person"></i></button>
                    <button type="button" class="btn btn-outline-primary client-edit-btn" data-client-id="${id}" onclick="showEditClientModal(${id})" title="Editar cliente"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-outline-danger" onclick="deleteClient(${id})" title="Excluir"><i class="bi bi-trash"></i></button>
                </div></td></tr>`;
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
async function fetchClientConsignmentLocation(clientId) {
    if (!clientId || !window.RelationalAPI) return null;
    try {
        const payload = await RelationalAPI.list('consignment_locations', 1000, 0);
        return (payload.items || []).find(item => Number(item.client_id) === Number(clientId)) || null;
    } catch (error) {
        console.warn('[Clientes] Não foi possível carregar o local de consignação:', error);
        return null;
    }
}
function bindClientConsignmentTab() {
    const enabled = document.getElementById('clientConsignmentEnabled');
    const fields = document.getElementById('clientConsignmentFields');
    document.querySelectorAll('#clientFormTabs [data-bs-toggle="tab"]').forEach(button => {
        if (window.bootstrap?.Tab) bootstrap.Tab.getOrCreateInstance(button);
    });
    if (!enabled || !fields) return;
    enabled.classList.add('form-check-input');
    const refresh = () => {
        fields.classList.toggle('is-disabled', !enabled.checked);
        fields.querySelectorAll('input,select,textarea').forEach(el => { el.disabled = !enabled.checked; });
    };
    enabled.addEventListener('change', refresh);
    refresh();
}
function showClientModal() {
    document.getElementById('modalTitle').innerHTML = '➕ Novo Cliente';
    document.getElementById('modalBody').innerHTML = clientFormHTML(); openModal(); bindClientFormMasks(); bindClientConsignmentTab();
}
async function showEditClientModal(clientId) {
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
        const consignmentLocation = await fetchClientConsignmentLocation(id);
        modalBody.innerHTML = clientFormHTML({
            id, name, email, phone, address, city, state, document: clientDocument, postal_code,
            address_number, address_complement, consignment_location: consignmentLocation
        }, true);
        openModal();
        requestAnimationFrame(() => {
            bindClientFormMasks();
            bindClientConsignmentTab();
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
    const location = data.consignment_location || {};
    const consignmentEnabled = Boolean(location.id && location.active !== false);
    return `<form id="clientForm" onsubmit="event.preventDefault(); saveClient(${isEdit});" novalidate>
      <input type="hidden" id="clientEditId" value="${Number(data.id || 0)}">
      <input type="hidden" id="clientConsignmentLocationId" value="${Number(location.id || 0)}">

      <ul class="nav nav-tabs nav-fill mb-4" id="clientFormTabs" role="tablist">
        <li class="nav-item" role="presentation"><button class="nav-link active" id="client-data-tab" data-bs-toggle="tab" data-bs-target="#client-data-pane" type="button" role="tab" aria-controls="client-data-pane" aria-selected="true"><i class="bi bi-person-vcard me-2"></i>Dados do cliente</button></li>
        <li class="nav-item" role="presentation"><button class="nav-link" id="client-consignment-tab" data-bs-toggle="tab" data-bs-target="#client-consignment-pane" type="button" role="tab" aria-controls="client-consignment-pane" aria-selected="false"><i class="bi bi-shop me-2"></i>Consignação</button></li>
      </ul>

      <div class="tab-content">
        <div class="tab-pane fade show active" id="client-data-pane" role="tabpanel" aria-labelledby="client-data-tab" tabindex="0">
          <div class="alert alert-light border d-flex gap-2 align-items-start"><i class="bi bi-info-circle text-primary mt-1"></i><div><strong>Dados principais</strong><div class="small text-body-secondary">Nome, telefone e CEP são obrigatórios. O endereço pode ser preenchido automaticamente.</div></div></div>
          <div class="row g-3">
            <div class="col-12"><label class="form-label" for="clientName">Nome completo / Razão social *</label><input class="form-control" type="text" id="clientName" value="${h(data.name||'')}" minlength="2" maxlength="120" autocomplete="name" required>${clientError('clientName')}</div>
            <div class="col-md-6"><label class="form-label" for="clientPhone">Telefone / WhatsApp *</label><input class="form-control" type="tel" id="clientPhone" value="${h(formatPhone(data.phone||''))}" inputmode="numeric" maxlength="15" placeholder="(11) 99999-9999" autocomplete="tel" required>${clientError('clientPhone')}</div>
            <div class="col-md-6"><label class="form-label" for="clientDocument">CPF ou CNPJ</label><input class="form-control" type="text" id="clientDocument" value="${h(formatDocument(data.document||''))}" inputmode="numeric" maxlength="18" placeholder="000.000.000-00">${clientError('clientDocument')}</div>
            <div class="col-12"><label class="form-label" for="clientEmail">E-mail</label><input class="form-control" type="email" id="clientEmail" value="${h(data.email||'')}" maxlength="160" placeholder="cliente@exemplo.com" autocomplete="email">${clientError('clientEmail')}</div>
          </div>

          <hr class="my-4">
          <h3 class="h6 mb-3"><i class="bi bi-geo-alt text-primary me-2"></i>Endereço</h3>
          <div class="row g-3">
            <div class="col-md-4"><label class="form-label" for="clientPostalCode">CEP *</label><input class="form-control" type="text" id="clientPostalCode" value="${h(formatCep(data.postal_code||''))}" inputmode="numeric" maxlength="9" placeholder="00000-000" autocomplete="postal-code" required>${clientError('clientPostalCode')}<div id="clientCepStatus" class="form-text">Digite o CEP para preencher o endereço.</div></div>
            <div class="col-md-3"><label class="form-label" for="clientState">Estado</label><select class="form-select" id="clientState"><option value="">Selecione...</option>${states}</select>${clientError('clientState')}</div>
            <div class="col-md-5"><label class="form-label" for="clientCity">Cidade</label><input class="form-control" type="text" id="clientCity" value="${h(data.city||'')}" maxlength="100" autocomplete="address-level2">${clientError('clientCity')}</div>
            <div class="col-md-8"><label class="form-label" for="clientAddress">Logradouro</label><input class="form-control" type="text" id="clientAddress" value="${h(data.address||'')}" maxlength="180" placeholder="Rua, avenida, travessa..." autocomplete="address-line1">${clientError('clientAddress')}</div>
            <div class="col-md-4"><label class="form-label" for="clientAddressNumber">Número</label><input class="form-control" type="text" id="clientAddressNumber" value="${h(data.address_number||'')}" maxlength="20" placeholder="123 ou S/N" autocomplete="address-line2">${clientError('clientAddressNumber')}</div>
            <div class="col-12"><label class="form-label" for="clientAddressComplement">Complemento</label><input class="form-control" type="text" id="clientAddressComplement" value="${h(data.address_complement||'')}" maxlength="100" placeholder="Apto, bloco, sala...">${clientError('clientAddressComplement')}</div>
          </div>
        </div>

        <div class="tab-pane fade" id="client-consignment-pane" role="tabpanel" aria-labelledby="client-consignment-tab" tabindex="0">
          <div class="card border bg-body-tertiary mb-4"><div class="card-body d-flex flex-wrap justify-content-between align-items-center gap-3"><div><h3 class="h6 mb-1">Cliente de consignação</h3><p class="small text-body-secondary mb-0">Cadastre os dados do ponto onde seus produtos ficarão expostos.</p></div><div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="clientConsignmentEnabled" ${consignmentEnabled?'checked':''}><label class="form-check-label fw-semibold" for="clientConsignmentEnabled">Habilitado</label></div></div></div>
          <div id="clientConsignmentFields" class="row g-3">
            <div class="col-md-7"><label class="form-label" for="clientConsignmentName">Nome do local *</label><input id="clientConsignmentName" class="form-control" value="${h(location.name||'')}" maxlength="200" placeholder="Loja Centro, Clínica, Papelaria..."></div>
            <div class="col-md-5"><label class="form-label" for="clientConsignmentCommission">Comissão padrão (%) *</label><div class="input-group"><input id="clientConsignmentCommission" class="form-control" type="number" min="0" max="100" step="0.01" value="${Number(location.commission_pct ?? 0)}"><span class="input-group-text">%</span></div></div>
            <div class="col-md-6"><label class="form-label" for="clientConsignmentContact">Contato no local</label><input id="clientConsignmentContact" class="form-control" value="${h(location.contact||'')}" maxlength="160"></div>
            <div class="col-md-6"><label class="form-label" for="clientConsignmentPhone">Telefone do local</label><input id="clientConsignmentPhone" class="form-control" value="${h(location.phone||'')}" maxlength="40"></div>
            <div class="col-md-8"><label class="form-label" for="clientConsignmentAddress">Endereço do ponto</label><input id="clientConsignmentAddress" class="form-control" value="${h(location.address||'')}" maxlength="300" placeholder="Se vazio, será usado o endereço do cliente"></div>
            <div class="col-md-4"><label class="form-label" for="clientConsignmentDays">Prazo padrão</label><div class="input-group"><input id="clientConsignmentDays" class="form-control" type="number" min="1" max="3650" value="${Number(location.default_days || 30)}"><span class="input-group-text">dias</span></div></div>
            <div class="col-12"><div class="alert alert-info mb-0"><i class="bi bi-info-circle me-2"></i>Esses dados serão usados automaticamente ao criar uma nova consignação.</div></div>
          </div>
        </div>
      </div>

      <div class="d-flex flex-wrap justify-content-end gap-2 mt-4 pt-3 border-top"><button type="button" class="btn btn-outline-secondary" onclick="closeModal()">Cancelar</button><button type="submit" class="btn btn-primary"><i class="bi bi-check-lg me-1"></i>${isEdit?'Atualizar cliente':'Salvar cliente'}</button></div>
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
async function saveClient(isEdit=false) {
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
    let id = isEdit ? Number(document.getElementById('clientEditId')?.value || 0) : 0;
    if (isEdit && !id) { showToast('⚠️ Não foi possível identificar o cliente para edição.'); return; }
    if (clientDuplicateExists('email',email,id)) { setClientFieldError('clientEmail','Este e-mail já pertence a outro cliente.'); showToast('⚠️ E-mail já cadastrado.'); return; }
    if (clientDuplicateExists('document',documentValue,id)) { setClientFieldError('clientDocument','Este CPF/CNPJ já pertence a outro cliente.'); showToast('⚠️ CPF/CNPJ já cadastrado.'); return; }

    const consignmentEnabled = Boolean(document.getElementById('clientConsignmentEnabled')?.checked);
    const locationId = Number(document.getElementById('clientConsignmentLocationId')?.value || 0);
    const locationName = document.getElementById('clientConsignmentName')?.value.trim() || '';
    const commission = Number(document.getElementById('clientConsignmentCommission')?.value || 0);
    const defaultDays = Number(document.getElementById('clientConsignmentDays')?.value || 30);
    if (consignmentEnabled) {
        if (!locationName) { showToast('⚠️ Informe o nome do local de consignação.'); document.querySelector('[data-bs-target="#client-consignment-pane"]')?.click(); return; }
        if (commission < 0 || commission > 100) { showToast('⚠️ A comissão deve ficar entre 0% e 100%.'); return; }
        if (!Number.isInteger(defaultDays) || defaultDays < 1) { showToast('⚠️ Informe um prazo padrão válido.'); return; }
    }

    try {
        if (isEdit) {
            db.run('UPDATE clients SET name=?,email=?,phone=?,address=?,address_number=?,address_complement=?,city=?,state=?,document=?,postal_code=? WHERE id=?',[name,email,phone,address,addressNumber,addressComplement,city,state,documentValue,postalCode,id]);
        } else {
            db.run('INSERT INTO clients (name,email,phone,address,address_number,address_complement,city,state,document,postal_code,total_spent,last_order) VALUES (?,?,?,?,?,?,?,?,?,?,0,NULL)',[name,email,phone,address,addressNumber,addressComplement,city,state,documentValue,postalCode]);
            id = Number(db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] || 0);
        }
        await persistDBNow();
        if (window.RelationalSync) await window.RelationalSync.syncNow();

        if (window.RelationalAPI && id) {
            const locationPayload = {
                client_id:id, name:locationName || `${name} — consignação`,
                contact:document.getElementById('clientConsignmentContact')?.value.trim() || null,
                phone:document.getElementById('clientConsignmentPhone')?.value.trim() || null,
                address:document.getElementById('clientConsignmentAddress')?.value.trim() || [address,addressNumber,addressComplement,city,state].filter(Boolean).join(', ') || null,
                commission_pct:commission, default_days:defaultDays, active:consignmentEnabled,
                created_at:new Date().toISOString()
            };
            if (locationId) await RelationalAPI.update('consignment_locations', locationId, locationPayload);
            else if (consignmentEnabled) await RelationalAPI.create('consignment_locations', locationPayload);
        }
        showToast(isEdit ? '✅ Cliente atualizado!' : '✅ Cliente salvo!');
        closeModal(); await loadClients();
    } catch (error) {
        console.error(error); showToast(`❌ Não foi possível salvar: ${error.message || error}`);
    }
}

function deleteClient(clientId) { if(confirm('Mover este cliente para a lixeira? Os pedidos vinculados serão mantidos.')) { const old=dbRowObject('SELECT * FROM clients WHERE id=? AND deleted_at IS NULL',[clientId]); db.run('UPDATE clients SET deleted_at=? WHERE id=?',[new Date().toISOString(),clientId]); auditLog('clients',clientId,'soft_delete',old,null); persistDB(); loadClients(); showToast('Cliente movido para a lixeira.'); } }
async function showClientProfile(clientId) {
    const cr=db.exec('SELECT name,email,phone,address,city,state,total_spent,last_order,document,postal_code,address_number,address_complement FROM clients WHERE id=? AND deleted_at IS NULL',[clientId]);
    if(!cr.length||!cr[0].values.length)return;
    const [name,email,phone,address,city,state,spent,lastOrder,documentValue,postalCode,addressNumber,addressComplement]=cr[0].values[0];
    const orders=db.exec(`SELECT id,work_type,material_name,quantity,total_price,profit,status,date FROM orders WHERE client_id=? AND deleted_at IS NULL ORDER BY id DESC`,[clientId]);
    const statusNames = STATUS_NAMES;
    const workTypeNames = WORK_TYPE_NAMES;
    let waDigits=onlyDigits(phone); if(waDigits&&!waDigits.startsWith('55'))waDigits='55'+waDigits;
    const waLink=waDigits?`<a href="https://wa.me/${waDigits}" target="_blank" rel="noopener" class="inline-action-link">💬 WhatsApp</a>`:'';
    const mailLink=email?`<a href="mailto:${encodeURIComponent(email)}" class="inline-action-link">📧 E-mail</a>`:'';
    const consignmentLocation = await fetchClientConsignmentLocation(clientId);
    let html=`<div class="client-profile-grid">
      <div><small>Documento</small><strong>${h(formatDocument(documentValue)||'—')}</strong></div>
      <div><small>Telefone</small><strong>${h(phone||'—')} ${waLink}</strong></div>
      <div><small>E-mail</small><strong>${h(email||'—')} ${mailLink}</strong></div>
      <div><small>CEP</small><strong>${h(postalCode||'—')}</strong></div>
      <div class="wide"><small>Endereço</small><strong>${h([[address,addressNumber].filter(Boolean).join(', '),addressComplement,city,state].filter(Boolean).join(' — ')||'Não informado')}</strong></div>
      <div><small>Total gasto</small><strong>R$ ${(spent||0).toFixed(2)}</strong></div>
      <div><small>Último pedido</small><strong>${lastOrder?new Date(lastOrder).toLocaleDateString('pt-BR'):'—'}</strong></div></div>`;
    if (consignmentLocation) html += `<div class="alert alert-primary mt-3"><div class="d-flex justify-content-between gap-3"><div><strong><i class="bi bi-shop"></i> ${h(consignmentLocation.name)}</strong><small class="d-block">Cliente de consignação · prazo padrão ${Number(consignmentLocation.default_days||30)} dias</small></div><span class="badge text-bg-primary align-self-start">${Number(consignmentLocation.commission_pct||0).toFixed(1)}%</span></div><small class="d-block mt-2">${h(consignmentLocation.address||'Endereço do cliente')} ${consignmentLocation.contact?'· Contato: '+h(consignmentLocation.contact):''}</small></div>`;
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
