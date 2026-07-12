// ==================== PRODUTOS E MARKETPLACES ====================

function safeSqlLike(text) {
    return String(text || '').replace(/'/g, "''");
}

function generateSku(name = 'PROD') {
    const base = String(name || 'PROD')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 12)
        .toUpperCase() || 'PROD';
    const stamp = Date.now().toString().slice(-5);
    return `${base}-${stamp}`;
}

function marketplaceGrossPrice(targetNet, feePct, fixedFee = 0) {
    const fee = Math.min(0.80, Math.max(0, Number(feePct || 0) / 100));
    const net = Number(targetNet || 0);
    const fixed = Number(fixedFee || 0);
    if (fee >= 0.80) return net + fixed;
    return (net + fixed) / (1 - fee);
}

function saveCalculationAsProduct() {
    if (!db || typeof calculatePrice !== 'function') return;
    const p = calculatePrice();
    const defaultName = `${p.workTypeLabel || 'Produto'} ${p.materialLabel || ''}`.trim();
    showProductModal({
        sku: generateSku(defaultName),
        name: defaultName,
        description: '',
        category: p.workTypeLabel || 'Produto',
        material_id: document.getElementById('calcMaterial')?.value || null,
        material_name: p.materialLabel,
        printer_id: document.getElementById('calcPrinter')?.value || null,
        weight_g: p.weight,
        print_time_h: p.printTime,
        print_time_label: p.printTimeHuman,
        difficulty: p.difficulty,
        cost_price: p.productionCost,
        cost_with_fail: p.costWithFail,
        sale_price: p.finalPrice,
        direct_price: p.finalPrice,
        margin_pct: p.profitMarkup * 100,
        stock_qty: 0,
        min_stock: 0,
        production_mode: 'demand',
        active: 1
    });
}

function showProductModal(product = null) {
    const isEdit = product && product.id;
    if (!product) {
        product = {
            sku: generateSku('PROD'), name: '', description: '', category: '', material_id: '', material_name: '', printer_id: '',
            weight_g: 0, print_time_h: 0, print_time_label: '', difficulty: 1, cost_price: 0, cost_with_fail: 0,
            sale_price: 0, direct_price: 0, margin_pct: Number(currentSettings?.profitMargin || 50),
            stock_qty: 0, min_stock: 0, production_mode: 'demand', active: 1
        };
    }
    document.getElementById('modalTitle').textContent = isEdit ? 'Editar Produto' : 'Novo Produto';
    document.getElementById('modalBody').innerHTML = `
        <input class="form-control" type="hidden" id="prodMaterialId" value="${Number(product.material_id || 0)}">
        <input class="form-control" type="hidden" id="prodPrinterId" value="${Number(product.printer_id || 0)}">
        <div class="row g-3">
            <div class="col-12 col-md-6"><label class="form-label">SKU</label><input class="form-control" id="prodSku" value="${product.sku || ''}"></div>
            <div class="col-12 col-md-6"><label class="form-label">Nome</label><input class="form-control" id="prodName" value="${h(product.name || '')}" placeholder="Ex.: Chaveiro personalizado"></div>
            <div class="col-12 col-md-6"><label class="form-label">Categoria</label><input class="form-control" id="prodCategory" value="${h(product.category || '')}" placeholder="Brindes, utilitários, decoração..."></div>
            <div class="col-12 col-md-6"><label class="form-label">Modo de venda</label><select class="form-select" id="prodMode"><option value="demand" ${product.production_mode !== 'batch' ? 'selected' : ''}>Sob demanda</option><option value="batch" ${product.production_mode === 'batch' ? 'selected' : ''}>Produção em lote</option></select></div>
            <div class="col-12 col-md-6"><label class="form-label">Peso (g)</label><input class="form-control" type="number" id="prodWeight" step="0.1" min="0" value="${Number(product.weight_g || 0).toFixed(1)}"></div>
            <div class="col-12 col-md-6"><label class="form-label">Tempo de impressão (h)</label><input class="form-control" type="number" id="prodTime" step="0.01" min="0" value="${Number(product.print_time_h || 0).toFixed(2)}"></div>
            <div class="col-12 col-md-6"><label class="form-label">Dificuldade</label><select class="form-select" id="prodDifficulty"><option value="1" ${Number(product.difficulty||1)===1?'selected':''}>Normal (×1)</option><option value="1.2" ${Number(product.difficulty||1)===1.2?'selected':''}>Médio (×1.2)</option><option value="1.5" ${Number(product.difficulty||1)===1.5?'selected':''}>Difícil (×1.5)</option><option value="2" ${Number(product.difficulty||1)===2?'selected':''}>Complexo (×2)</option></select></div>
            <div class="col-12 col-md-6"><label class="form-label">Material</label><input class="form-control" id="prodMaterialName" value="${h(product.material_name || '')}"></div>
            <div class="col-12 col-md-6"><label class="form-label">Custo real</label><input class="form-control" type="number" id="prodCost" step="0.01" min="0" value="${Number(product.cost_price || 0).toFixed(2)}"></div>
            <div class="col-12 col-md-6"><label class="form-label">Custo com falhas</label><input class="form-control" type="number" id="prodCostFail" step="0.01" min="0" value="${Number(product.cost_with_fail || 0).toFixed(2)}"></div>
            <div class="col-12 col-md-6"><label class="form-label">Preço venda direta</label><input class="form-control" type="number" id="prodSale" step="0.01" min="0" value="${Number(product.sale_price || product.direct_price || 0).toFixed(2)}"></div>
            <div class="col-12 col-md-6"><label class="form-label">Estoque atual</label><input class="form-control" type="number" id="prodStock" step="1" min="0" value="${Number(product.stock_qty || 0)}"></div>
            <div class="col-12 col-md-6"><label class="form-label">Estoque mínimo</label><input class="form-control" type="number" id="prodMinStock" step="1" min="0" value="${Number(product.min_stock || 0)}"></div>
        </div>
        <div class="col-12 col-md-6"><label class="form-label">Descrição para anúncio</label><textarea class="form-control" id="prodDescription" rows="4" placeholder="Descrição curta do produto">${h(product.description || '')}</textarea></div>
        <div class="alert alert-info mt-3">Para marketplace, salve o produto e abra a aba 🛒 Marketplaces para ver os preços com taxas.</div>
        <button class="btn btn-primary w-100 mt-3" onclick="saveProduct(${isEdit ? product.id : 'null'})" style="width:100%; margin-top:10px;">💾 Salvar Produto</button>
    `;
    openModal();
}

function readProductFromModal() {
    const sale = parseFloat(document.getElementById('prodSale')?.value || 0) || 0;
    return {
        sku: document.getElementById('prodSku')?.value?.trim() || generateSku('PROD'),
        name: document.getElementById('prodName')?.value?.trim() || 'Produto sem nome',
        description: document.getElementById('prodDescription')?.value?.trim() || '',
        category: document.getElementById('prodCategory')?.value?.trim() || 'Geral',
        material_id: parseInt(document.getElementById('prodMaterialId')?.value || 0, 10) || null,
        material_name: document.getElementById('prodMaterialName')?.value?.trim() || '',
        printer_id: parseInt(document.getElementById('prodPrinterId')?.value || 0, 10) || null,
        weight_g: parseFloat(document.getElementById('prodWeight')?.value || 0) || 0,
        print_time_h: parseFloat(document.getElementById('prodTime')?.value || 0) || 0,
        difficulty: parseFloat(document.getElementById('prodDifficulty')?.value || 1) || 1,
        cost_price: parseFloat(document.getElementById('prodCost')?.value || 0) || 0,
        cost_with_fail: parseFloat(document.getElementById('prodCostFail')?.value || 0) || 0,
        sale_price: sale,
        direct_price: sale,
        stock_qty: parseInt(document.getElementById('prodStock')?.value || 0, 10) || 0,
        min_stock: parseInt(document.getElementById('prodMinStock')?.value || 0, 10) || 0,
        production_mode: document.getElementById('prodMode')?.value || 'demand',
        active: 1
    };
}

function saveProduct(id = null) {
    const p = readProductFromModal();
    const now = new Date().toISOString();
    try {
        if (id) {
            db.run(`UPDATE products SET sku=?, name=?, description=?, category=?, material_id=?, material_name=?, printer_id=?,
                    weight_g=?, print_time_h=?, difficulty=?,
                    cost_price=?, cost_with_fail=?, sale_price=?, direct_price=?, stock_qty=?, min_stock=?, production_mode=?, active=?, updated_at=?
                    WHERE id=?`,
                [p.sku, p.name, p.description, p.category, p.material_id, p.material_name, p.printer_id,
                 p.weight_g, p.print_time_h, p.difficulty,
                 p.cost_price, p.cost_with_fail, p.sale_price, p.direct_price, p.stock_qty, p.min_stock, p.production_mode, p.active, now, id]);
        } else {
            db.run(`INSERT INTO products (sku,name,description,category,material_name,weight_g,print_time_h,print_time_label,difficulty,
                    cost_price,cost_with_fail,sale_price,direct_price,margin_pct,stock_qty,min_stock,production_mode,active,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [p.sku, p.name, p.description, p.category, p.material_name, p.weight_g, p.print_time_h, formatHoursHuman(p.print_time_h), 1,
                 p.cost_price, p.cost_with_fail, p.sale_price, p.direct_price, Number(currentSettings?.profitMargin || 0), p.stock_qty, p.min_stock,
                 p.production_mode, p.active, now, now]);
        }
    } catch (e) {
        showToast('⚠️ Erro ao salvar. Verifique se o SKU já existe.');
        console.error(e);
        return;
    }
    persistDB();
    closeModal();
    loadProducts();
    loadMarketplaces();
    updateDashboard();
    showToast('✅ Produto salvo!');
}

function loadProducts() {
    const el = document.getElementById('productsList');
    if (!el || !db) return;
    const q = document.getElementById('productSearch')?.value?.trim() || '';
    let sql, params;
    if (q) {
        const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
        sql = `SELECT id, sku, name, category, material_name, weight_g, print_time_h, cost_with_fail, sale_price, stock_qty, min_stock, production_mode, active FROM products WHERE deleted_at IS NULL AND (name LIKE ? OR sku LIKE ? OR category LIKE ?) ORDER BY id DESC`;
        params = [like, like, like];
    } else {
        sql = `SELECT id, sku, name, category, material_name, weight_g, print_time_h, cost_with_fail, sale_price, stock_qty, min_stock, production_mode, active FROM products WHERE deleted_at IS NULL ORDER BY id DESC`;
        params = [];
    }
    const r = db.exec(sql, params);
    if (!r.length || !r[0].values.length) {
        ['productsActiveCount','productsLowStockCount','productsStockTotal'].forEach(id => { const node=document.getElementById(id); if(node) node.textContent='0'; });
        const valueNode=document.getElementById('productsPotentialValue'); if(valueNode) valueNode.textContent=money(0);
        el.innerHTML = `<div class="text-center text-body-secondary py-5"><i class="bi bi-tags d-block fs-2 mb-2"></i><strong class="d-block text-body mb-1">Nenhum produto cadastrado</strong><span>Use “Novo produto” ou salve um cálculo da calculadora.</span></div>`;
        return;
    }
    let html = '<div class="row g-3">';
    r[0].values.forEach(row => {
        const [id, sku, name, category, material, weight, time, costFail, sale, stock, minStock, mode, active] = row;
        const low = Number(minStock) > 0 && Number(stock) <= Number(minStock);
        const margin = Number(sale || 0) - Number(costFail || 0);
        html += `<div class="col-12 col-md-6 col-xl-4"><article class="card h-100 shadow-sm s3d-product-card ${low ? 'border-warning' : ''}"><div class="card-body d-flex flex-column">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-3">
                <span class="badge text-bg-light border">${h(sku || '')}</span>
                <span class="badge ${low ? 'text-bg-warning' : 'text-bg-success'}">${low ? '⚠️ Estoque baixo' : '✅ Estoque ok'}</span>
            </div>
            <h3>${h(name)}</h3>
            <p>${h(category || 'Geral')} • ${h(material || 'Material não definido')}</p>
            <div class="row g-2 my-3">
                <div class="col-6"><div class="p-2 rounded bg-body-tertiary border"><small class="text-body-secondary d-block">Peso</small><strong>${Number(weight || 0).toFixed(1)}g</strong></div></div>
                <div class="col-6"><div class="p-2 rounded bg-body-tertiary border"><small class="text-body-secondary d-block">Tempo</small><strong>${formatHoursHuman(time || 0)}</strong></div></div>
                <div class="col-6"><div class="p-2 rounded bg-body-tertiary border"><small class="text-body-secondary d-block">Custo</small><strong>${money(costFail)}</strong></div></div>
                <div class="col-6"><div class="p-2 rounded bg-body-tertiary border"><small class="text-body-secondary d-block">Venda</small><strong>${money(sale)}</strong></div></div>
            </div>
            <div class="mt-auto pt-3 border-top d-flex flex-wrap justify-content-between gap-3">
                <div class="small"><span>Estoque</span><strong>${stock} / min. ${minStock}</strong><small>${mode === 'batch' ? 'Produção em lote' : 'Sob demanda'} • Margem ${money(margin)}</small></div>
                <div class="d-flex flex-wrap gap-2 align-items-center">
                    <button class="btn btn-primary btn-sm" title="Criar pedido" onclick="createOrderFromProduct(${id})"><i class="bi bi-receipt me-1"></i>Pedido</button>
                    <button class="btn btn-outline-secondary btn-sm" title="Anexos" onclick="openAttachments('products',${id},decodeURIComponent('${encodedJsArg(name)}'))"><i class="bi bi-paperclip"></i></button>
                    <div class="s3d-actions d-inline-flex flex-row flex-nowrap align-items-center gap-1" role="group" aria-label="Editar ou excluir produto">
                        <button class="btn btn-outline-primary" title="Editar produto" onclick="editProduct(${id})"><i class="bi bi-pencil"></i></button>
                        <button class="btn btn-outline-danger" title="Excluir produto" onclick="deleteProduct(${id})"><i class="bi bi-trash"></i></button>
                    </div>
                </div>
            </div>
        </div></article></div>`;
    });
    html += '</div>';
    const values = r[0].values;
    const setText = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
    setText('productsActiveCount', values.filter(r => Number(r[12] || 0) === 1).length);
    setText('productsLowStockCount', values.filter(r => Number(r[9] || 0) <= Number(r[10] || 0)).length);
    setText('productsStockTotal', values.reduce((sum, r) => sum + Number(r[9] || 0), 0));
    setText('productsPotentialValue', money(values.reduce((sum, r) => sum + Number(r[8] || 0) * Number(r[9] || 0), 0)));
    el.innerHTML = html;
}

function getProductById(id) {
    const r = db.exec(`SELECT id, sku, name, description, category, material_id, material_name, printer_id, weight_g, print_time_h,
        print_time_label, difficulty, cost_price, cost_with_fail, sale_price, direct_price, margin_pct, stock_qty, min_stock, production_mode, active
        FROM products WHERE id=? AND deleted_at IS NULL`, [id]);
    if (!r.length || !r[0].values.length) return null;
    const cols = r[0].columns;
    const obj = {};
    cols.forEach((c, i) => obj[c] = r[0].values[0][i]);
    return obj;
}

function editProduct(id) {
    const product = getProductById(id);
    if (product) showProductModal(product);
}

function deleteProduct(id) {
    if (!confirm('Excluir este produto?')) return;
    const old=dbRowObject('SELECT * FROM products WHERE id=? AND deleted_at IS NULL',[id]);
    db.run('UPDATE products SET deleted_at=?, active=0 WHERE id=?', [new Date().toISOString(), id]);
    auditLog('products',id,'soft_delete',old,null);
    persistDB();
    loadProducts();
    loadMarketplaces();
    updateDashboard();
}

function createOrderFromProduct(id) {
    const p = getProductById(id);
    if (!p) return;
    const qty = Math.max(1, parseInt(prompt('Quantidade do pedido:', '1') || '1', 10) || 1);
    const total = Number(p.sale_price || 0) * qty;
    const profit = (Number(p.sale_price || 0) - Number(p.cost_with_fail || 0)) * qty;
    db.run(`INSERT INTO orders (product_id, client_id, work_type, material_id, material_name, weight, print_time, difficulty, quantity,
            unit_price, total_price, profit, status, shipping_cost, date, notes, channel)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, 0, 'custom', p.material_id || null, p.material_name || '', p.weight_g || 0, p.print_time_h || 0,
         p.difficulty || 1, qty, p.sale_price || 0, total, profit, 'quote', 0, new Date().toISOString(), `Produto: ${p.sku} - ${p.name}`, 'direct']);
    persistDB();
    showToast('✅ Pedido criado a partir do produto!');
    loadOrders();
    updateStatsBar();
}

function exportProductsToCSV() {
    const r = db.exec(`SELECT sku,name,category,material_name,weight_g,print_time_h,cost_with_fail,sale_price,stock_qty,min_stock,production_mode FROM products WHERE deleted_at IS NULL ORDER BY id`);
    if (!r.length || !r[0].values.length) return showToast('Nenhum produto para exportar');
    const header = 'SKU,Produto,Categoria,Material,Peso(g),Tempo(h),Custo,Fenda,Estoque,Estoque Min,Modo\n'.replace('Fenda','Venda');
    const rows = r[0].values.map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `produtos_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
}

function loadMarketplaces() {
    renderMarketplaceConfigs();
    renderMarketplaceProducts();
}

function renderMarketplaceConfigs() {
    const el = document.getElementById('marketplaceConfigList');
    if (!el || !db) return;
    const r = db.exec('SELECT code,name,fee_pct,fixed_fee,active FROM marketplace_configs ORDER BY id');
    if (!r.length) return;
    el.innerHTML = r[0].values.map(([code, name, fee, fixed, active]) => `
        <div style="display:grid;grid-template-columns:1.4fr .8fr .8fr .4fr;gap:8px;align-items:end;margin-bottom:8px;">
            <div class="col-12 col-md-6"><label class="form-label">${h(name)}</label><input class="form-control" id="mkName_${h(code)}" value="${h(name)}"></div>
            <div class="col-12 col-md-6"><label class="form-label">Taxa %</label><input class="form-control" type="number" id="mkFee_${h(code)}" value="${Number(fee || 0)}" step="0.1" min="0" max="80"></div>
            <div class="col-12 col-md-6"><label class="form-label">Fixo R$</label><input class="form-control" type="number" id="mkFixed_${h(code)}" value="${Number(fixed || 0)}" step="0.01" min="0"></div>
            <label style="font-size:.8em;"><input class="form-control" type="checkbox" id="mkActive_${h(code)}" ${active ? 'checked' : ''}> ativo</label>
        </div>`).join('');
}

function saveMarketplaceConfigs() {
    const r = db.exec('SELECT code FROM marketplace_configs ORDER BY id');
    if (!r.length) return;
    r[0].values.forEach(([code]) => {
        const name = document.getElementById(`mkName_${code}`)?.value || code;
        const fee = parseFloat(document.getElementById(`mkFee_${code}`)?.value || 0) || 0;
        const fixed = parseFloat(document.getElementById(`mkFixed_${code}`)?.value || 0) || 0;
        const active = document.getElementById(`mkActive_${code}`)?.checked ? 1 : 0;
        db.run('UPDATE marketplace_configs SET name=?, fee_pct=?, fixed_fee=?, active=? WHERE code=?', [name, fee, fixed, active, code]);
    });
    persistDB();
    renderMarketplaceProducts();
    showToast('✅ Taxas salvas!');
}

function renderMarketplaceProducts() {
    const el = document.getElementById('marketplaceProductsList');
    if (!el || !db) return;
    const products = db.exec('SELECT id,sku,name,sale_price,cost_with_fail FROM products WHERE active=1 AND deleted_at IS NULL ORDER BY id DESC');
    const markets = db.exec('SELECT code,name,fee_pct,fixed_fee FROM marketplace_configs WHERE active=1 ORDER BY id');
    if (!products.length || !products[0].values.length) {
        el.innerHTML = '<p style="color:#888;">Cadastre produtos para calcular preços por marketplace.</p>';
        return;
    }
    const mks = markets?.[0]?.values || [];
    let html = '';
    products[0].values.forEach(([id, sku, name, sale, cost]) => {
        html += `<div class="order-item" style="margin-bottom:12px;"><div class="order-header"><strong>${h(sku)} — ${h(name)}</strong><span>${money(sale)}</span></div>`;
        html += '<div class="order-details" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">';
        mks.forEach(([code, mkName, fee, fixed]) => {
            const gross = marketplaceGrossPrice(sale, fee, fixed);
            const profit = sale - Number(cost || 0);
            html += `<div><strong>${h(mkName)}</strong><br>Preço anúncio: ${money(gross)}<br><small>Taxa ${Number(fee).toFixed(1)}% + ${money(fixed)} • líquido desejado ${money(sale)} • lucro direto ${money(profit)}</small></div>`;
        });
        html += '</div></div>';
    });
    el.innerHTML = html;
}
