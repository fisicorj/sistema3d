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
        <input type="hidden" id="prodMaterialId" value="${Number(product.material_id || 0)}">
        <input type="hidden" id="prodPrinterId" value="${Number(product.printer_id || 0)}">
        <div class="form-grid">
            <div class="field-group"><label>SKU</label><input id="prodSku" value="${product.sku || ''}"></div>
            <div class="field-group"><label>Nome</label><input id="prodName" value="${product.name || ''}" placeholder="Ex.: Chaveiro personalizado"></div>
            <div class="field-group"><label>Categoria</label><input id="prodCategory" value="${product.category || ''}" placeholder="Brindes, utilitários, decoração..."></div>
            <div class="field-group"><label>Modo de venda</label><select id="prodMode"><option value="demand" ${product.production_mode !== 'batch' ? 'selected' : ''}>Sob demanda</option><option value="batch" ${product.production_mode === 'batch' ? 'selected' : ''}>Produção em lote</option></select></div>
            <div class="field-group"><label>Peso (g)</label><input type="number" id="prodWeight" step="0.1" min="0" value="${Number(product.weight_g || 0).toFixed(1)}"></div>
            <div class="field-group"><label>Tempo de impressão (h)</label><input type="number" id="prodTime" step="0.01" min="0" value="${Number(product.print_time_h || 0).toFixed(2)}"></div>
            <div class="field-group"><label>Dificuldade</label><select id="prodDifficulty"><option value="1" ${Number(product.difficulty||1)===1?'selected':''}>Normal (×1)</option><option value="1.2" ${Number(product.difficulty||1)===1.2?'selected':''}>Médio (×1.2)</option><option value="1.5" ${Number(product.difficulty||1)===1.5?'selected':''}>Difícil (×1.5)</option><option value="2" ${Number(product.difficulty||1)===2?'selected':''}>Complexo (×2)</option></select></div>
            <div class="field-group"><label>Material</label><input id="prodMaterialName" value="${product.material_name || ''}"></div>
            <div class="field-group"><label>Custo real</label><input type="number" id="prodCost" step="0.01" min="0" value="${Number(product.cost_price || 0).toFixed(2)}"></div>
            <div class="field-group"><label>Custo com falhas</label><input type="number" id="prodCostFail" step="0.01" min="0" value="${Number(product.cost_with_fail || 0).toFixed(2)}"></div>
            <div class="field-group"><label>Preço venda direta</label><input type="number" id="prodSale" step="0.01" min="0" value="${Number(product.sale_price || product.direct_price || 0).toFixed(2)}"></div>
            <div class="field-group"><label>Estoque atual</label><input type="number" id="prodStock" step="1" min="0" value="${Number(product.stock_qty || 0)}"></div>
            <div class="field-group"><label>Estoque mínimo</label><input type="number" id="prodMinStock" step="1" min="0" value="${Number(product.min_stock || 0)}"></div>
        </div>
        <div class="field-group"><label>Descrição para anúncio</label><textarea id="prodDescription" rows="4" placeholder="Descrição curta do produto">${product.description || ''}</textarea></div>
        <div class="info-box">Para marketplace, salve o produto e abra a aba 🛒 Marketplaces para ver os preços com taxas.</div>
        <button class="btn-primary" onclick="saveProduct(${isEdit ? product.id : 'null'})" style="width:100%; margin-top:10px;">💾 Salvar Produto</button>
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
        el.innerHTML = `<div class="empty-state"><div>🏷️</div><strong>Nenhum produto cadastrado</strong><p>Use “Novo Produto” ou salve um cálculo da calculadora.</p></div>`;
        return;
    }
    let html = '<div class="product-card-grid">';
    r[0].values.forEach(row => {
        const [id, sku, name, category, material, weight, time, costFail, sale, stock, minStock, mode, active] = row;
        const low = Number(minStock) > 0 && Number(stock) <= Number(minStock);
        const margin = Number(sale || 0) - Number(costFail || 0);
        html += `<article class="product-card ${low ? 'low-stock' : ''}">
            <div class="product-card-top">
                <span class="sku-pill">${h(sku || '')}</span>
                <span class="stock-pill ${low ? 'danger' : 'ok'}">${low ? '⚠️ Estoque baixo' : '✅ Estoque ok'}</span>
            </div>
            <h3>${h(name)}</h3>
            <p>${h(category || 'Geral')} • ${h(material || 'Material não definido')}</p>
            <div class="product-metrics">
                <div><small>Peso</small><strong>${Number(weight || 0).toFixed(1)}g</strong></div>
                <div><small>Tempo</small><strong>${formatHoursHuman(time || 0)}</strong></div>
                <div><small>Custo</small><strong>${money(costFail)}</strong></div>
                <div><small>Venda</small><strong>${money(sale)}</strong></div>
            </div>
            <div class="product-footer">
                <div class="product-stock"><span>Estoque</span><strong>${stock} / min. ${minStock}</strong><small>${mode === 'batch' ? 'Produção em lote' : 'Sob demanda'} • Margem ${money(margin)}</small></div>
                <div class="product-actions">
                    <button class="btn-info btn-sm" onclick="editProduct(${id})">✏️</button>
                    <button class="btn-primary btn-sm" onclick="createOrderFromProduct(${id})">🧾 Pedido</button>
                    <button class="btn-danger btn-sm" onclick="openAttachments('products',${id},'${name}')"><i class="bi bi-paperclip"></i></button>
                    <button class="btn-danger btn-sm" onclick="deleteProduct(${id})">🗑️</button>
                </div>
            </div>
        </article>`;
    });
    html += '</div>';
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
            <div class="field-group"><label>${h(name)}</label><input id="mkName_${h(code)}" value="${h(name)}"></div>
            <div class="field-group"><label>Taxa %</label><input type="number" id="mkFee_${h(code)}" value="${Number(fee || 0)}" step="0.1" min="0" max="80"></div>
            <div class="field-group"><label>Fixo R$</label><input type="number" id="mkFixed_${h(code)}" value="${Number(fixed || 0)}" step="0.01" min="0"></div>
            <label style="font-size:.8em;"><input type="checkbox" id="mkActive_${h(code)}" ${active ? 'checked' : ''}> ativo</label>
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
