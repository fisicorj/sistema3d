// ==================== FRETE ====================

// Faixa padrão usada quando nenhuma regra está cadastrada
const DEFAULT_SHIPPING = [
    { region: 'Padrão', minWeight: 0,   maxWeight: 100,  cost: 15 },
    { region: 'Padrão', minWeight: 101, maxWeight: 300,  cost: 22 },
    { region: 'Padrão', minWeight: 301, maxWeight: 500,  cost: 32 },
    { region: 'Padrão', minWeight: 501, maxWeight: null, cost: 45 },
];

function normalizeCep(cep) {
    return String(cep || '').replace(/\D/g, '').slice(0, 8);
}

function formatCep(cep) {
    const c = normalizeCep(cep);
    return c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : c;
}

async function lookupCep() {
    const cepEl = document.getElementById('calcDestCep');
    const ufEl = document.getElementById('calcDestUf');
    const statusEl = document.getElementById('calcCepStatus');
    const cep = normalizeCep(cepEl?.value);

    if (!cep || cep.length !== 8) {
        if (statusEl) statusEl.textContent = 'Digite um CEP com 8 números.';
        if (ufEl) ufEl.value = '';
        updatePriceCalculation();
        return;
    }

    if (statusEl) statusEl.textContent = 'Consultando CEP...';
    try {
        const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { cache: 'no-store' });
        const data = await resp.json();
        if (!resp.ok || data.erro) throw new Error('CEP não encontrado');

        if (cepEl) cepEl.value = formatCep(cep);
        if (ufEl) ufEl.value = data.uf || '';
        if (statusEl) statusEl.textContent = `${data.localidade || ''}/${data.uf || ''} — frete calculado pela tabela local.`;
        updatePriceCalculation();
    } catch (e) {
        if (ufEl) ufEl.value = '';
        if (statusEl) statusEl.textContent = 'Não consegui consultar o CEP. Usando tabela padrão de peso.';
        updatePriceCalculation();
    }
}

function getCepShippingRule(totalWeight) {
    if (!db) return null;
    const uf = (document.getElementById('calcDestUf')?.value || '').trim().toUpperCase();
    if (!uf) return null;

    const exact = db.exec('SELECT uf, region, min_weight, max_weight, cost, delivery_days FROM shipping_cep_rates WHERE uf = ? ORDER BY min_weight', [uf]);
    const rows = exact?.[0]?.values?.length ? exact[0].values : (db.exec("SELECT uf, region, min_weight, max_weight, cost, delivery_days FROM shipping_cep_rates WHERE uf = 'BR' ORDER BY min_weight")?.[0]?.values || []);

    for (const [ruleUf, region, minW, maxW, cost, days] of rows) {
        if (totalWeight >= Number(minW || 0) && (maxW === null || totalWeight <= Number(maxW))) {
            return { uf: ruleUf, region, minWeight: minW, maxWeight: maxW, cost: parseFloat(cost) || 0, deliveryDays: parseInt(days || 0, 10) || 0 };
        }
    }
    return null;
}

function calculateShippingByCep(totalWeight) {
    return getCepShippingRule(totalWeight)?.cost ?? null;
}

function loadShippingTable() {
    loadLegacyShippingTable();
    loadCepShippingTable();
}

function loadLegacyShippingTable() {
    const rates = db.exec('SELECT id, region, min_weight, max_weight, cost FROM shipping_rates ORDER BY min_weight');

    let rows = '';
    if (rates.length > 0 && rates[0].values.length > 0) {
        rates[0].values.forEach(([id, region, minW, maxW, cost]) => {
            rows += `<tr>
                <td><input type="text"   data-id="${id}" data-col="region"     value="${h(region)}" class="ship-input" style="width:100px"></td>
                <td><input type="number" data-id="${id}" data-col="min_weight" value="${minW}"   class="ship-input" style="width:80px"></td>
                <td><input type="number" data-id="${id}" data-col="max_weight" value="${maxW ?? ''}" class="ship-input" style="width:80px" placeholder="∞"></td>
                <td><input type="number" data-id="${id}" data-col="cost"       value="${cost}"  class="ship-input" style="width:80px"></td>
                <td><button class="btn-danger btn-sm" onclick="deleteShippingRate(${id})">🗑️</button></td>
            </tr>`;
        });
    } else {
        rows = '<tr><td colspan="5" style="text-align:center; color:#888;">Nenhuma faixa cadastrada</td></tr>';
    }

    const el = document.getElementById('shippingTable');
    if (!el) return;
    el.innerHTML = `
        <p style="font-size:0.85em;color:var(--text-muted);margin-bottom:8px;">Fallback usado quando nenhum CEP é informado.</p>
        <table style="width:100%">
            <thead><tr><th>Região</th><th>Min (g)</th><th>Máx (g)</th><th>Valor (R$)</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <button class="btn-success" onclick="addShippingRow()" style="margin-top:10px;">➕ Adicionar Faixa</button>
    `;
}

function loadCepShippingTable() {
    const el = document.getElementById('cepShippingTable');
    if (!el) return;
    const rates = db.exec('SELECT id, uf, region, min_weight, max_weight, cost, delivery_days FROM shipping_cep_rates ORDER BY uf, min_weight');
    let rows = '';
    if (rates.length > 0 && rates[0].values.length > 0) {
        rates[0].values.forEach(([id, uf, region, minW, maxW, cost, days]) => {
            rows += `<tr>
                <td><input type="text" data-id="${id}" data-col="uf" value="${h(uf)}" class="cep-ship-input" style="width:48px;text-transform:uppercase"></td>
                <td><input type="text" data-id="${id}" data-col="region" value="${h(region)}" class="cep-ship-input" style="width:110px"></td>
                <td><input type="number" data-id="${id}" data-col="min_weight" value="${minW}" class="cep-ship-input" style="width:70px"></td>
                <td><input type="number" data-id="${id}" data-col="max_weight" value="${maxW ?? ''}" class="cep-ship-input" style="width:70px" placeholder="∞"></td>
                <td><input type="number" data-id="${id}" data-col="cost" value="${cost}" class="cep-ship-input" style="width:70px" step="0.01"></td>
                <td><input type="number" data-id="${id}" data-col="delivery_days" value="${days}" class="cep-ship-input" style="width:55px"></td>
                <td><button class="btn-danger btn-sm" onclick="deleteCepShippingRate(${id})">🗑️</button></td>
            </tr>`;
        });
    } else {
        rows = '<tr><td colspan="7" style="text-align:center; color:#888;">Nenhuma regra por CEP cadastrada</td></tr>';
    }
    el.innerHTML = `
        <p style="font-size:0.85em;color:var(--text-muted);margin-bottom:8px;">O CEP identifica a UF pelo ViaCEP. O valor é calculado por UF + peso. Use UF = BR como fallback para demais estados.</p>
        <div style="max-height:340px;overflow:auto;">
        <table style="width:100%">
            <thead><tr><th>UF</th><th>Região</th><th>Min</th><th>Máx</th><th>R$</th><th>Dias</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        </div>
        <button class="btn-success" onclick="addCepShippingRow()" style="margin-top:10px;">➕ Adicionar Regra por UF</button>
    `;
}

function addShippingRow() {
    db.run('INSERT INTO shipping_rates (region, min_weight, max_weight, cost) VALUES (?,?,?,?)', ['Padrão', 0, null, 20]);
    persistDB();
    loadShippingTable();
}

function deleteShippingRate(id) {
    db.run('DELETE FROM shipping_rates WHERE id = ?', [id]);
    persistDB();
    loadShippingTable();
}

function addCepShippingRow() {
    db.run('INSERT INTO shipping_cep_rates (uf, region, min_weight, max_weight, cost, delivery_days) VALUES (?,?,?,?,?,?)', ['BR', 'Demais estados', 0, null, 35, 7]);
    persistDB();
    loadShippingTable();
}

function deleteCepShippingRate(id) {
    db.run('DELETE FROM shipping_cep_rates WHERE id = ?', [id]);
    persistDB();
    loadShippingTable();
}

function saveShippingSettings() {
    document.querySelectorAll('.ship-input').forEach(input => {
        const id  = input.dataset.id;
        const col = input.dataset.col;
        const val = input.value === '' ? null : input.value;
        db.run(`UPDATE shipping_rates SET ${col} = ? WHERE id = ?`, [val, id]);
    });
    document.querySelectorAll('.cep-ship-input').forEach(input => {
        const id  = input.dataset.id;
        const col = input.dataset.col;
        let val = input.value === '' ? null : input.value;
        if (col === 'uf') val = String(val || 'BR').trim().toUpperCase().slice(0, 2);
        db.run(`UPDATE shipping_cep_rates SET ${col} = ? WHERE id = ?`, [val, id]);
    });
    persistDB();
    showToast('✅ Tabelas de frete salvas!');
    updatePriceCalculation();
}

function loadDefaultShipping() {
    if (confirm('Isso apagará as faixas atuais e carregará os valores padrão. Confirmar?')) {
        db.run('DELETE FROM shipping_rates');
        DEFAULT_SHIPPING.forEach(({ region, minWeight, maxWeight, cost }) => {
            db.run('INSERT INTO shipping_rates (region, min_weight, max_weight, cost) VALUES (?,?,?,?)', [region, minWeight, maxWeight, cost]);
        });
        db.run('DELETE FROM shipping_cep_rates');
        DEFAULT_CEP_SHIPPING.forEach(r => db.run('INSERT INTO shipping_cep_rates (uf, region, min_weight, max_weight, cost, delivery_days) VALUES (?,?,?,?,?,?)', r));
        persistDB();
        loadShippingTable();
        showToast('✅ Frete padrão carregado!');
        updatePriceCalculation();
    }
}

// ==================== MELHOR ENVIO ====================
let melhorEnvioSelectedQuote = null;
let melhorEnvioLastSignature = '';

function getMelhorEnvioSignature() {
    const cep = normalizeCep(document.getElementById('calcDestCep')?.value || '');
    const quantity = Math.max(1, readInt('calcQuantity', 1));
    const pieceWeight = readWeightGrams('calcWeight', 0);
    const selectedPkg = typeof getSelectedPackaging === 'function' ? getSelectedPackaging() : null;
    const packagingWeight = selectedPkg ? selectedPkg.weight : 0;
    const shippingWeight = (pieceWeight + packagingWeight) * quantity;
    const length = readNumber('calcBoxLength', 15);
    const width = readNumber('calcBoxWidth', 10);
    const height = readNumber('calcBoxHeight', 5);
    return [cep, Math.ceil(shippingWeight || 0), length, width, height].join('|');
}

function invalidateMelhorEnvioQuote() {
    melhorEnvioSelectedQuote = null;
    melhorEnvioLastSignature = '';
    const el = document.getElementById('melhorEnvioCalcStatus');
    if (el) el.textContent = 'Cotação Melhor Envio não atualizada para os dados atuais.';
}

function clearMelhorEnvioQuote() {
    melhorEnvioSelectedQuote = null;
    melhorEnvioLastSignature = '';
    const el = document.getElementById('melhorEnvioCalcStatus');
    if (el) el.textContent = 'Usando tabela local de frete.';
    updatePriceCalculation();
}

function getMelhorEnvioShippingQuote(totalWeight) {
    const current = getMelhorEnvioSignature();
    if (!melhorEnvioSelectedQuote || melhorEnvioLastSignature !== current) return null;
    return melhorEnvioSelectedQuote;
}

function parseMelhorEnvioQuote(q) {
    const price = parseFloat(q.custom_price || q.price || q.total || 0);
    if (!Number.isFinite(price) || price <= 0 || q.error) return null;
    const company = q.company?.name || q.company?.picture ? (q.company?.name || '') : (q.company || '');
    return {
        id: q.id,
        name: q.name || q.service || 'Serviço',
        company: company || q.company_name || '',
        price,
        deliveryDays: parseInt(q.custom_delivery_time || q.delivery_time || q.delivery_range?.min || 0, 10) || 0,
        raw: q
    };
}

function chooseBestMelhorEnvioQuote(quotes) {
    const valid = (Array.isArray(quotes) ? quotes : [])
        .map(parseMelhorEnvioQuote)
        .filter(Boolean)
        .sort((a, b) => a.price - b.price);
    return valid[0] || null;
}


function meField(base) {
    return document.getElementById(base) || document.getElementById(base + '2');
}
function meSet(base, prop, value) {
    const a = document.getElementById(base);
    const b = document.getElementById(base + '2');
    [a,b].forEach(el => { if (!el) return; if (prop === 'checked') el.checked = !!value; else el.value = value ?? ''; });
}
function meStatus(text) {
    const a = document.getElementById('meConfigStatus');
    const b = document.getElementById('meConfigStatus2');
    if (a) a.textContent = text;
    if (b) b.textContent = text;
}

async function loadMelhorEnvioConfig() {
    try {
        const resp = await fetch('/api/melhor-envio/config', { cache: 'no-store' });
        const cfg = await resp.json();
        meSet('meEnabled', 'checked', !!cfg.enabled);
        meSet('meEnvironment', 'value', cfg.environment || 'production');
        meSet('meOriginCep', 'value', cfg.origin_cep || '');
        meSet('meServices', 'value', cfg.services || '');
        meSet('meUserAgent', 'value', cfg.user_agent || '');
        meSet('meAccessToken', 'value', '');
        meStatus(cfg.has_token ? 'Token configurado no servidor local.' : 'Token ainda não configurado.');
    } catch (e) {
        meStatus('Servidor local não respondeu. As configurações não são armazenadas no navegador.');
    }
}

async function saveMelhorEnvioConfig() {
    const payload = {
        enabled: meField('meEnabled')?.checked || false,
        environment: meField('meEnvironment')?.value || 'production',
        origin_cep: normalizeCep(meField('meOriginCep')?.value || ''),
        services: meField('meServices')?.value || '',
        user_agent: meField('meUserAgent')?.value || '',
        access_token: meField('meAccessToken')?.value || meField('meAccessToken2')?.value || ''
    };
    try {
        const resp = await fetch('/api/melhor-envio/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || 'Erro ao salvar');
        meSet('meAccessToken', 'value', '');
        meStatus(data.has_token ? 'Integração salva. Token configurado.' : 'Integração salva, mas sem token.');
        showToast('✅ Integração Melhor Envio salva!');
    } catch (e) {
        meStatus('Erro ao salvar no servidor local: ' + e.message + '. Confira se abriu pelo iniciar_windows.bat/server.py.');
        showToast('❌ Não foi possível salvar no servidor local');
    }
}

async function quoteMelhorEnvioFromCalculator() {
    const status = document.getElementById('melhorEnvioCalcStatus');
    const cep = normalizeCep(document.getElementById('calcDestCep')?.value || '');
    if (cep.length !== 8) {
        if (status) status.textContent = 'Informe um CEP de destino válido antes de cotar.';
        return;
    }

    const p = calculatePrice();
    const payload = {
        to_cep: cep,
        weight_kg: Math.max(0.01, (p.shippingWeight || 0) / 1000),
        length_cm: readNumber('calcBoxLength', 15),
        width_cm: readNumber('calcBoxWidth', 10),
        height_cm: readNumber('calcBoxHeight', 5),
        insurance_value: Math.max(1, p.totalPrice || p.finalPrice || 1)
    };

    if (status) status.textContent = 'Consultando Melhor Envio...';
    try {
        const resp = await fetch('/api/melhor-envio/calculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || data.details || 'Erro na cotação');
        const best = chooseBestMelhorEnvioQuote(data.quotes);
        if (!best) throw new Error('A API não retornou serviços válidos para esse CEP/peso.');
        melhorEnvioSelectedQuote = best;
        melhorEnvioLastSignature = getMelhorEnvioSignature();
        if (status) {
            const prazo = best.deliveryDays ? ` • ${best.deliveryDays} dias` : '';
            status.textContent = `Melhor Envio: ${best.company ? best.company + ' ' : ''}${best.name} — ${money(best.price)}${prazo}`;
        }
        updatePriceCalculation();
    } catch (e) {
        melhorEnvioSelectedQuote = null;
        melhorEnvioLastSignature = '';
        if (status) status.textContent = 'Falha Melhor Envio: ' + e.message + ' Usando tabela local.';
        updatePriceCalculation();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (document.getElementById('meEnabled')) loadMelhorEnvioConfig();
    }, 800);
});
