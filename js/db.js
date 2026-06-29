// ==================== BANCO DE DADOS ====================
let db = null;
let currentSettings = {};
const DB_STORAGE_KEY = '3dprint_db'; // fallback legado no navegador
const DB_API_URL = '/api/db';        // persistência real em arquivo SQLite local
let sqliteServerPersistence = false;
let persistTimer = null;

async function loadAllPartials() {
    const panels = document.querySelectorAll('[data-partial]');
    await Promise.all(Array.from(panels).map(async panel => {
        const url = panel.dataset.partial;
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (res.ok) panel.innerHTML = await res.text();
        } catch (e) {
            console.warn('Falha ao carregar partial:', url, e);
        }
    }));
}

async function initDB() {
    // Carrega todos os parciais HTML antes de inicializar o banco,
    // garantindo que todos os elementos DOM existam quando as funções de carga forem chamadas.
    await loadAllPartials();

    const SQL = await initSqlJs({
        locateFile: file => `js/${file}`
    });

    db = await loadSQLiteDatabase(SQL);
    createTables();
    migrateSettings();
    initDefaultData();
    loadSettings();
    loadClients(); loadMaterials(); loadPrinters(); loadOrders();
    loadPackaging(); loadAddons();
    if (typeof loadProducts === 'function') loadProducts();
    if (typeof loadMarketplaces === 'function') loadMarketplaces();
    if (typeof loadQuotes === 'function') loadQuotes();
    updateDashboard(); updateStatsBar(); updateAlertSystem();
    setupEventListeners();
}

async function loadSQLiteDatabase(SQL) {
    // 1) Preferência: arquivo SQLite salvo pelo servidor local Python.
    try {
        const response = await fetch(DB_API_URL, { cache: 'no-store' });
        if (response.ok) {
            const buffer = await response.arrayBuffer();
            if (buffer.byteLength > 0) {
                sqliteServerPersistence = true;
                console.info('Banco SQLite carregado do arquivo local.');
                return new SQL.Database(new Uint8Array(buffer));
            }
        } else if (response.status === 204 || response.status === 404) {
            sqliteServerPersistence = true;
        }
    } catch (e) {
        console.warn('Servidor SQLite local indisponível. Usando fallback no navegador.', e);
    }

    // 2) Fallback: banco salvo anteriormente no navegador.
    const saved = localStorage.getItem(DB_STORAGE_KEY);
    if (saved) {
        try {
            return new SQL.Database(new Uint8Array(JSON.parse(saved)));
        } catch (e) {
            console.warn('Banco do navegador corrompido, criando novo.', e);
        }
    }

    return new SQL.Database();
}

function updatePersistenceStatus(text, ok = true) {
    const el = document.getElementById('sqlitePersistenceStatus');
    if (!el) return;
    el.textContent = text;
    el.style.color = ok ? 'var(--success)' : 'var(--warning)';
}

async function writeDBToSQLiteFile(data) {
    try {
        const response = await fetch(DB_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: data
        });
        if (response.ok) {
            sqliteServerPersistence = true;
            updatePersistenceStatus('SQLite local salvo em app_data/sistema3d.sqlite', true);
            return true;
        }
        console.error('Erro ao salvar SQLite local:', response.status, await response.text());
    } catch (e) {
        console.warn('Servidor SQLite local indisponível; dados salvos apenas no navegador.', e);
    }
    updatePersistenceStatus('Servidor local indisponível: usando fallback do navegador', false);
    return false;
}

function persistBrowserFallback(data) {
    try {
        localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(Array.from(data)));
    } catch (e) {
        console.warn('Não foi possível salvar fallback no navegador:', e);
    }
}

function persistDB(delay = 250) {
    if (!db) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
        const data = db.export();
        persistBrowserFallback(data);
        await writeDBToSQLiteFile(data);
    }, delay);
}

async function persistDBNow() {
    if (!db) return false;
    clearTimeout(persistTimer);
    const data = db.export();
    persistBrowserFallback(data);
    return await writeDBToSQLiteFile(data);
}

// Tentativa extra de salvar quando o usuário fecha/atualiza a página.
window.addEventListener('beforeunload', () => {
    if (!db) return;
    try {
        const data = db.export();
        persistBrowserFallback(data);
        if (navigator.sendBeacon) {
            navigator.sendBeacon(DB_API_URL, new Blob([data], { type: 'application/octet-stream' }));
        }
    } catch (e) {
        console.warn('Falha ao salvar no fechamento da página:', e);
    }
});

function createTables() {
    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER,
        work_type TEXT, printer_id INTEGER, material_id INTEGER, material_name TEXT,
        weight REAL, print_time REAL, difficulty REAL, quantity INTEGER,
        unit_price REAL, total_price REAL, profit REAL, status TEXT,
        shipping_cost REAL, date TEXT, notes TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, phone TEXT,
        address TEXT, city TEXT, state TEXT, total_spent REAL, last_order DATE)`);
    db.run(`CREATE TABLE IF NOT EXISTS materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, color TEXT,
        spool_weight REAL, cost REAL, stock REAL, min_alert REAL)`);
    db.run(`CREATE TABLE IF NOT EXISTS printers (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, value REAL,
        lifetime_hours REAL, wattage REAL, speed_gph REAL)`);
    db.run(`CREATE TABLE IF NOT EXISTS shipping_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT, region TEXT,
        min_weight REAL, max_weight REAL, cost REAL)`);
    db.run(`CREATE TABLE IF NOT EXISTS shipping_cep_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uf TEXT NOT NULL DEFAULT 'BR',
        region TEXT NOT NULL DEFAULT 'Brasil',
        min_weight REAL NOT NULL DEFAULT 0,
        max_weight REAL,
        cost REAL NOT NULL DEFAULT 0,
        delivery_days INTEGER NOT NULL DEFAULT 7)`);
    db.run(`CREATE TABLE IF NOT EXISTS failed_prints (
        id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER,
        fail_reason TEXT, material_lost REAL, date TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        material_id INTEGER,
        order_id INTEGER,
        movement_type TEXT NOT NULL,
        grams REAL NOT NULL DEFAULT 0,
        previous_stock REAL NOT NULL DEFAULT 0,
        new_stock REAL NOT NULL DEFAULT 0,
        notes TEXT,
        date TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS packaging (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        cost REAL NOT NULL DEFAULT 0,
        weight REAL NOT NULL DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS addons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT,
        unit_cost REAL NOT NULL DEFAULT 0,
        description TEXT)`);

    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        material_id INTEGER,
        material_name TEXT,
        printer_id INTEGER,
        weight_g REAL NOT NULL DEFAULT 0,
        print_time_h REAL NOT NULL DEFAULT 0,
        print_time_label TEXT,
        difficulty REAL NOT NULL DEFAULT 1,
        cost_price REAL NOT NULL DEFAULT 0,
        cost_with_fail REAL NOT NULL DEFAULT 0,
        sale_price REAL NOT NULL DEFAULT 0,
        direct_price REAL NOT NULL DEFAULT 0,
        margin_pct REAL NOT NULL DEFAULT 0,
        stock_qty INTEGER NOT NULL DEFAULT 0,
        min_stock INTEGER NOT NULL DEFAULT 0,
        production_mode TEXT NOT NULL DEFAULT 'demand',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT,
        updated_at TEXT)`);

    db.run(`CREATE TABLE IF NOT EXISTS product_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        image_data TEXT,
        filename TEXT,
        created_at TEXT)`);

    db.run(`CREATE TABLE IF NOT EXISTS marketplace_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        fee_pct REAL NOT NULL DEFAULT 0,
        fixed_fee REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1)`);

    db.run(`CREATE TABLE IF NOT EXISTS marketplace_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        marketplace_code TEXT NOT NULL,
        listing_sku TEXT,
        listed_price REAL NOT NULL DEFAULT 0,
        target_net_price REAL NOT NULL DEFAULT 0,
        notes TEXT,
        UNIQUE(product_id, marketplace_code))`);

    ensureColumn('orders', 'product_id', 'INTEGER');
    ensureColumn('orders', 'channel', 'TEXT');
    ensureColumn('orders', 'deleted_at', 'TEXT');
    ensureColumn('orders', 'printing_started_at', 'TEXT');
    ensureColumn('orders', 'paid_amount', 'REAL');

    ensureColumn('printers', 'hours_used', 'REAL');
    ensureColumn('materials', 'energy_factor', 'REAL DEFAULT 1.0');

    db.run(`CREATE TABLE IF NOT EXISTS order_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL)`);

    db.run(`CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL DEFAULT 'Geral',
        description TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        recurrence TEXT NOT NULL DEFAULT 'once',
        date TEXT NOT NULL)`);

    db.run(`CREATE TABLE IF NOT EXISTS stock_purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        material_id INTEGER NOT NULL,
        quantity_g REAL NOT NULL,
        total_cost REAL NOT NULL,
        cost_per_kg REAL NOT NULL,
        date TEXT NOT NULL,
        notes TEXT)`);

    db.run(`CREATE TABLE IF NOT EXISTS maintenance_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        cost REAL NOT NULL DEFAULT 0,
        lifespan_hours REAL NOT NULL DEFAULT 100,
        active INTEGER NOT NULL DEFAULT 1,
        notes TEXT)`);

    db.run(`CREATE TABLE IF NOT EXISTS quotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER,
        client_name TEXT,
        item_description TEXT,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price REAL NOT NULL DEFAULT 0,
        total_price REAL NOT NULL DEFAULT 0,
        shipping_cost REAL NOT NULL DEFAULT 0,
        total_with_shipping REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'aguardando',
        whatsapp_text TEXT,
        validity_date TEXT,
        created_at TEXT NOT NULL,
        order_id INTEGER)`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_order_notes_order ON order_notes(order_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status)`);
}

// Custo de manutenção por hora calculado a partir dos itens cadastrados.
// Se não houver itens ativos, retorna o valor do setting (retrocompatibilidade).
function getMaintenancePerHour() {
    try {
        const r = db.exec(
            'SELECT SUM(cost / lifespan_hours) FROM maintenance_items WHERE active = 1 AND lifespan_hours > 0'
        );
        const sum = parseFloat(r[0]?.values[0]?.[0]);
        if (!isNaN(sum) && sum > 0) return sum;
    } catch (_) {}
    return readNumberFromSettings('maintenancePerHour', 0.50);
}

function ensureColumn(table, column, type) {
    try {
        const info = db.exec(`PRAGMA table_info(${table})`);
        const cols = info?.[0]?.values?.map(r => r[1]) || [];
        if (!cols.includes(column)) db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch (e) {
        console.warn('Falha ao verificar coluna', table, column, e);
    }
}


function initDefaultCepShippingRates() {
    try {
        const count = db.exec('SELECT COUNT(*) FROM shipping_cep_rates')?.[0]?.values?.[0]?.[0] || 0;
        if (count > 0) return;
        const defaults = [
            ['SP', 'São Paulo', 0, 300, 18, 3], ['SP', 'São Paulo', 301, 500, 24, 3], ['SP', 'São Paulo', 501, 1000, 32, 4], ['SP', 'São Paulo', 1001, null, 45, 5],
            ['RJ', 'Sudeste', 0, 300, 24, 4], ['RJ', 'Sudeste', 301, 500, 32, 4], ['RJ', 'Sudeste', 501, 1000, 45, 5], ['RJ', 'Sudeste', 1001, null, 60, 6],
            ['MG', 'Sudeste', 0, 300, 24, 4], ['MG', 'Sudeste', 301, 500, 32, 4], ['MG', 'Sudeste', 501, 1000, 45, 5], ['MG', 'Sudeste', 1001, null, 60, 6],
            ['ES', 'Sudeste', 0, 300, 26, 5], ['ES', 'Sudeste', 301, 500, 35, 5], ['ES', 'Sudeste', 501, 1000, 48, 6], ['ES', 'Sudeste', 1001, null, 65, 7],
            ['PR', 'Sul', 0, 300, 26, 5], ['SC', 'Sul', 0, 300, 28, 5], ['RS', 'Sul', 0, 300, 30, 6],
            ['PR', 'Sul', 301, 1000, 45, 6], ['SC', 'Sul', 301, 1000, 48, 6], ['RS', 'Sul', 301, 1000, 52, 7],
            ['BR', 'Demais estados', 0, 300, 35, 7], ['BR', 'Demais estados', 301, 500, 45, 8], ['BR', 'Demais estados', 501, 1000, 65, 9], ['BR', 'Demais estados', 1001, null, 85, 10]
        ];
        defaults.forEach(r => db.run('INSERT INTO shipping_cep_rates (uf, region, min_weight, max_weight, cost, delivery_days) VALUES (?,?,?,?,?,?)', r));
    } catch (e) {
        console.warn('Falha ao inicializar tabela de frete por CEP', e);
    }
}

function migrateSettings() {
    const defaults = { energyPrice:'1.00', hourlyRate:'60', profitMargin:'50', lossRate:'10', maintenancePerHour:'0.50', failRate:'5', packagingCost:'0', customFee:'0', serviceTime:'0', taxRate:'0', monthlyGoal:'0', alertDays:'7', bambuIp:'', bambuSerial:'', bambuAccessCode:'', purgeCostPerChange:'3.00', brandName:'', quoteValidityDays:'15' };
    for (const [k, v] of Object.entries(defaults)) db.run('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)', [k, v]);
    const hasPkg = db.exec('SELECT COUNT(*) FROM packaging');
    initDefaultCepShippingRates();
    if (hasPkg[0]?.values[0]?.[0] === 0) db.run(`INSERT INTO packaging (name,description,cost,weight) VALUES
        ('Sem embalagem','Entrega sem embalagem',0,0),('Saquinho PE','Saco plástico PE transparente',1.5,5),
        ('Caixinha kraft P','Caixa kraft 10×10×5cm',3.5,30),('Caixinha kraft M','Caixa kraft 15×15×8cm',5.0,50),
        ('Caixinha kraft G','Caixa kraft 20×20×12cm',8.0,80)`);
    const hasAddon = db.exec('SELECT COUNT(*) FROM addons');
    if (hasAddon[0]?.values[0]?.[0] === 0) db.run(`INSERT INTO addons (name,category,unit_cost,description) VALUES
        ('Corrente de chaveiro','Acessório',1.50,'Argola + corrente metálica'),('Imã de geladeira','Fixação',0.80,'Imã de 20mm colado na peça'),
        ('Lixamento fino','Acabamento',3.00,'Lixamento 400+800 grit'),('Pintura simples','Acabamento',5.00,'Pintura acrílica por peça'),
        ('Envernizamento','Acabamento',6.00,'Verniz fosco ou brilhante')`);
    const hasMarket = db.exec('SELECT COUNT(*) FROM marketplace_configs');
    if (hasMarket[0]?.values[0]?.[0] === 0) db.run(`INSERT INTO marketplace_configs (code,name,fee_pct,fixed_fee,active) VALUES
        ('direct','Venda direta / WhatsApp',0,0,1),
        ('shopee','Shopee',14,0,1),
        ('mercadolivre','Mercado Livre',16,0,1),
        ('elo7','Elo7',15,0,1),
        ('etsy','Etsy',15,0,1)`);
    persistDB();
}

function initDefaultData() {
    const hasPrinters = db.exec('SELECT COUNT(*) FROM printers');
    if (hasPrinters.length === 0 || hasPrinters[0].values[0][0] === 0) {
        db.run(`INSERT INTO printers (name,value,lifetime_hours,wattage,speed_gph) VALUES
            ('Bambu Lab A1 + AMS Lite',5000,5000,150,25),('Bambu Lab A1 Mini',2200,5000,120,20),
            ('Bambu Lab X1C',8000,7000,250,30),('Ender 3',1500,4000,150,8)`);
        db.run(`INSERT INTO materials (name,color,spool_weight,cost,stock,min_alert) VALUES
            ('PLA','Branco',1000,90,750,200),('PLA','Preto',1000,95,320,200),
            ('PETG','Transparente',1000,120,1000,250),('TPU','Preto',500,110,180,100),
            ('ABS','Cinza',1000,85,450,200),('PLA','Azul',1000,92,0,200)`);
        // Não chama persistDB() aqui — migrateSettings() já o faz durante a mesma inicialização.
    }
}

// ── Carregar / salvar settings ──

function setInputValue(id, value, fallback='') { const el = document.getElementById(id); if (el) el.value = value ?? fallback; }

function loadSettings() {
    const result = db.exec('SELECT key,value FROM settings');
    if (result.length > 0) result[0].values.forEach(([k, v]) => { currentSettings[k] = v; });
    setInputValue('settingEnergyPrice', currentSettings.energyPrice, '1.00');
    setInputValue('settingHourlyRate', currentSettings.hourlyRate, '60');
    setInputValue('settingProfitMargin', currentSettings.profitMargin, '50');
    setInputValue('settingLossRate', currentSettings.lossRate, '10');
    setInputValue('settingMaintenancePerHour', currentSettings.maintenancePerHour, '0.50');
    setInputValue('settingFailRate', currentSettings.failRate, '5');
    setInputValue('settingPackagingCost', currentSettings.packagingCost, '0');
    setInputValue('settingTaxRate', currentSettings.taxRate, '0');
    setInputValue('settingMonthlyGoal', currentSettings.monthlyGoal, '0');
    setInputValue('settingAlertDays', currentSettings.alertDays, '7');
    setInputValue('settingBambuIp', currentSettings.bambuIp, '');
    setInputValue('settingBambuSerial', currentSettings.bambuSerial, '');
    setInputValue('settingBambuAccessCode', currentSettings.bambuAccessCode, '');
    setInputValue('settingPurgeCostPerChange', currentSettings.purgeCostPerChange, '3.00');
    setInputValue('settingBrandName', currentSettings.brandName, '');
    setInputValue('settingQuoteValidityDays', currentSettings.quoteValidityDays, '15');
    updatePrinterHourInfo();
    loadShippingTable();
}

function saveSettings() {
    const map = { settingEnergyPrice:'energyPrice', settingHourlyRate:'hourlyRate', settingProfitMargin:'profitMargin', settingLossRate:'lossRate', settingMaintenancePerHour:'maintenancePerHour', settingFailRate:'failRate', settingPackagingCost:'packagingCost', settingTaxRate:'taxRate', settingMonthlyGoal:'monthlyGoal', settingAlertDays:'alertDays', settingBambuIp:'bambuIp', settingBambuSerial:'bambuSerial', settingBambuAccessCode:'bambuAccessCode', settingPurgeCostPerChange:'purgeCostPerChange', settingBrandName:'brandName', settingQuoteValidityDays:'quoteValidityDays' };
    for (const [id, key] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (!el) continue;
        db.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', [key, el.value ?? '']);
        currentSettings[key] = el.value ?? '';
    }
    persistDB(0);
    updatePrinterHourInfo();
    updatePriceCalculation();
}

async function saveSettingsNow() {
    saveSettings();
    const ok = await persistDBNow();
    showToast(ok ? '✅ Configurações salvas no SQLite!' : '⚠️ Salvo no navegador. Abra pelo iniciar.sh/server.py para gravar no SQLite.');
}

function getFirstPrinterForInfo() { const printerId=document.getElementById('calcPrinter')?.value; if(printerId) return printerId; const r=db?.exec('SELECT id FROM printers ORDER BY id LIMIT 1'); return r?.[0]?.values?.[0]?.[0] || null; }

function updatePrinterHourInfo() {
    const el=document.getElementById('printerHourCostInfo'); if(!el || !db) return;
    const printerId=getFirstPrinterForInfo();
    const printer=typeof getPrinterCost==='function' ? getPrinterCost(printerId) : {name:'Impressora', wattage:150, depreciationPerHour:1};
    const energyPrice=parseFloat(currentSettings.energyPrice)||1;
    const maintenance=(typeof getMaintenancePerHour==='function')?getMaintenancePerHour():(parseFloat(currentSettings.maintenancePerHour)||0);
    const energyPerHour=(printer.wattage*energyPrice)/1000; const total=printer.depreciationPerHour+maintenance+energyPerHour;
    el.innerHTML=`<strong>${h(printer.name)}</strong><br>Depreciação: R$ ${printer.depreciationPerHour.toFixed(2)}/h + manutenção: R$ ${maintenance.toFixed(4)}/h + energia: R$ ${energyPerHour.toFixed(2)}/h<br><strong>Custo/hora estimado: R$ ${total.toFixed(2)}/h</strong>`;
}

function getHistoricalFailRate() { const printed=db.exec(`SELECT COUNT(*) FROM orders WHERE status IN ('printing','post','packaging','shipped','delivered')`); const fails=db.exec(`SELECT COUNT(*) FROM failed_prints`); const n=printed[0]?.values[0]?.[0]??0; const f=fails[0]?.values[0]?.[0]??0; return n>0?f/n:0; }
