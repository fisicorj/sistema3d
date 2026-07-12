// ==================== BANCO DE DADOS ====================
let db = null;
let currentSettings = {};
const DB_STORAGE_KEY = '3dprint_db'; // fallback legado no navegador
const DB_STORAGE_TS_KEY = '3dprint_db_saved_at'; // horário da cópia mais recente no navegador
const DB_API_URL = '/api/db';        // persistência real em arquivo SQLite local
let sqliteServerPersistence = false;
let persistTimer = null;
let persistQueue = Promise.resolve(true);
let persistSequence = 0;
const DB_SCHEMA_VERSION = 5;
let _dbChangedDuringInit = false;
let _recoveredBrowserCopyNeedsSync = false;
let runtimePlatform = { platform: 'unknown', is_windows: false, is_linux: false };
let lastPersistedSnapshot = null;

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

    try {
        const platformResponse = await fetch('/api/platform', { cache: 'no-store' });
        if (platformResponse.ok) runtimePlatform = await platformResponse.json();
    } catch (_) {
        runtimePlatform = { platform: 'browser-only', is_windows: false, is_linux: false };
    }

    const SQL = await initSqlJs({
        locateFile: file => `js/${file}`
    });

    db = await loadSQLiteDatabase(SQL);
    createTables();
    runDatabaseMigrations();
    migrateSettings();
    initDefaultData();
    window.db = db; // expõe para módulos que usam window.db como guarda de prontidão
    if (window.RelationalSync) await window.RelationalSync.bootstrap();
            window.RelationalAPI?.installDbTracker();
    loadSettings();
    loadClients(); loadMaterials(); loadPrinters(); loadOrders();
    loadPackaging(); loadAddons();
    if (typeof loadPrinterDashboard === 'function') loadPrinterDashboard();
    if (typeof Phase2UI !== 'undefined') Phase2UI.updateBadge();
    if (typeof loadProducts === 'function') loadProducts();
    if (typeof loadMarketplaces === 'function') loadMarketplaces();
    if (typeof loadQuotes === 'function') loadQuotes();
    updateDashboard(); updateStatsBar(); updateAlertSystem();
    setupEventListeners();
    if (_dbChangedDuringInit || _recoveredBrowserCopyNeedsSync) {
        _recoveredBrowserCopyNeedsSync = false;
        await persistDBNow();
    }
}

async function loadSQLiteDatabase(SQL) {
    // No Windows, o navegador pode ser fechado antes do último POST terminar.
    // Por isso comparamos a data da cópia do navegador com a data do arquivo
    // SQLite e carregamos a versão mais recente.
    let serverBytes = null;
    let serverMtime = 0;
    let serverAvailable = false;

    try {
        const response = await fetch(DB_API_URL, { cache: 'no-store' });
        serverAvailable = response.ok || response.status === 204 || response.status === 404;
        if (response.ok) {
            const buffer = await response.arrayBuffer();
            if (buffer.byteLength > 0) {
                serverBytes = new Uint8Array(buffer);
                serverMtime = Number(response.headers.get('X-Sistema3D-MTime') || 0);
                sqliteServerPersistence = true;
            }
        } else if (response.status === 204 || response.status === 404) {
            sqliteServerPersistence = true;
        }
    } catch (e) {
        console.warn('Servidor SQLite local indisponível. Usando fallback no navegador.', e);
    }

    const saved = localStorage.getItem(DB_STORAGE_KEY);
    const browserMtime = Number(localStorage.getItem(DB_STORAGE_TS_KEY) || 0);
    let browserBytes = null;
    if (saved) {
        try {
            browserBytes = new Uint8Array(JSON.parse(saved));
        } catch (e) {
            console.warn('Banco do navegador corrompido; cópia ignorada.', e);
        }
    }

    // Se o navegador contém uma cópia mais nova, ela vence. Isso recupera
    // alterações feitas imediatamente antes de fechar a janela no Windows.
    if (browserBytes && (!serverBytes || browserMtime > serverMtime + 500)) {
        console.info('Cópia mais recente recuperada do navegador e será sincronizada com o SQLite.');
        const recovered = new SQL.Database(browserBytes);
        _recoveredBrowserCopyNeedsSync = serverAvailable;
        return recovered;
    }

    if (serverBytes) {
        console.info('Banco SQLite carregado do arquivo local.');
        return new SQL.Database(serverBytes);
    }

    if (browserBytes) {
        console.info('Banco carregado da cópia de segurança do navegador.');
        return new SQL.Database(browserBytes);
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
            headers: {
                'Content-Type': 'application/octet-stream',
                'X-Sistema3D-Save': String(++persistSequence)
            },
            body: data,
            cache: 'no-store'
        });
        let payload = null;
        try { payload = await response.json(); } catch (_) { payload = null; }
        if (response.ok && (!payload || payload.ok !== false)) {
            sqliteServerPersistence = true;
            const savedAt = Number(payload && payload.saved_at_ms ? payload.saved_at_ms : Date.now());
            localStorage.setItem(DB_STORAGE_TS_KEY, String(savedAt));
            lastPersistedSnapshot = data;
            updatePersistenceStatus('Banco local sincronizado', true);
            if (window.RelationalSync) await window.RelationalSync.syncNow();
            return true;
        }
        console.error('Erro ao salvar SQLite local:', response.status, payload || response.statusText);
    } catch (e) {
        console.warn('Servidor SQLite local indisponível; dados salvos apenas no navegador.', e);
    }
    updatePersistenceStatus('Falha ao gravar SQLite: dados preservados no navegador', false);
    return false;
}

function enqueueSQLiteSave(data) {
    // Serializa as gravações. No Windows, duas requisições POST simultâneas
    // podem manter o arquivo aberto e impedir a substituição do SQLite.
    persistQueue = persistQueue
        .catch(() => false)
        .then(() => writeDBToSQLiteFile(data));
    return persistQueue;
}

function persistBrowserFallback(data, savedAt = Date.now()) {
    try {
        localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(Array.from(data)));
        localStorage.setItem(DB_STORAGE_TS_KEY, String(savedAt));
        lastPersistedSnapshot = data;
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
        await enqueueSQLiteSave(data);
    }, delay);
}

async function persistDBNow() {
    if (!db) return false;
    clearTimeout(persistTimer);
    const data = db.export();
    persistBrowserFallback(data);
    return await enqueueSQLiteSave(data);
}

// Persistência multiplataforma no ciclo de vida da página.
// localStorage é síncrono e garante a recuperação; visibilitychange antecipa o POST
// normal antes que Windows/Linux encerrem a aba. Não dependemos de sendBeacon.
function snapshotBrowserDatabase() {
    if (!db) return;
    try {
        persistBrowserFallback(db.export());
    } catch (e) {
        console.warn('Falha ao criar cópia de segurança no navegador:', e);
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && db) {
        snapshotBrowserDatabase();
        // A requisição pode concluir se o navegador mantiver a página viva; se não,
        // a cópia do navegador será reconciliada na próxima abertura.
        persistDBNow().catch(() => false);
    }
});

window.addEventListener('pagehide', snapshotBrowserDatabase);
window.addEventListener('beforeunload', snapshotBrowserDatabase);

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
    ensureColumn('printers', 'bambu_ip', 'TEXT');
    ensureColumn('printers', 'bambu_serial', 'TEXT');
    ensureColumn('printers', 'bambu_access_code', 'TEXT');
    ensureColumn('materials', 'energy_factor', 'REAL DEFAULT 1.0');
    ensureColumn('clients', 'document', 'TEXT');
    ensureColumn('clients', 'postal_code', 'TEXT');
    ensureColumn('clients', 'address_number', 'TEXT');
    ensureColumn('clients', 'address_complement', 'TEXT');
    ensureColumn('clients', 'deleted_at', 'TEXT');
    ensureColumn('products', 'deleted_at', 'TEXT');

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
        date TEXT NOT NULL,
        recurrence_parent_id INTEGER,
        recurrence_key TEXT)`);
    ensureColumn('expenses', 'recurrence_parent_id', 'INTEGER');
    ensureColumn('expenses', 'recurrence_key', 'TEXT');

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
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_recurrence_key ON expenses(recurrence_key) WHERE recurrence_key IS NOT NULL`);
    ensureColumn('quotes', 'deleted_at', 'TEXT');
    db.run(`CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, record_id TEXT,
        action TEXT NOT NULL, old_data TEXT, new_data TEXT, created_at TEXT NOT NULL)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)`);
    db.run(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT, notification_key TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'medium', title TEXT NOT NULL,
        message TEXT, target_tab TEXT, is_read INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_active ON notifications(active,is_read,priority)`);
    db.run(`CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
        filename TEXT NOT NULL, stored_path TEXT NOT NULL, mime_type TEXT, size_bytes INTEGER DEFAULT 0,
        created_at TEXT NOT NULL)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type,entity_id)`);
    db.run(`CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, description TEXT, permissions TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT, role_id INTEGER, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_login TEXT, FOREIGN KEY(role_id) REFERENCES roles(id))`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_users_active ON users(active,email)`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status)`);
}


function markDBChanged() {
    _dbChangedDuringInit = true;
}

function runDatabaseMigrations() {
    try {
        db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            version INTEGER NOT NULL DEFAULT 0,
            applied_at TEXT NOT NULL
        )`);
        const current = db.exec('SELECT version FROM schema_migrations WHERE id = 1')?.[0]?.values?.[0]?.[0] || 0;

        const migrations = [
            { version: 1, run() { /* schema-base criado de forma idempotente por createTables() */ } },
            { version: 2, run() { /* normalização de clientes, pedidos e integrações */ } },
            { version: 3, run() {
                ensureColumn('expenses', 'recurrence_parent_id', 'INTEGER');
                ensureColumn('expenses', 'recurrence_key', 'TEXT');
                db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_recurrence_key
                        ON expenses(recurrence_key) WHERE recurrence_key IS NOT NULL`);
            } },
            { version: 4, run() {
                ensureColumn('clients', 'deleted_at', 'TEXT');
                ensureColumn('products', 'deleted_at', 'TEXT');
                ensureColumn('quotes', 'deleted_at', 'TEXT');
                db.run(`CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, record_id TEXT,
                    action TEXT NOT NULL, old_data TEXT, new_data TEXT, created_at TEXT NOT NULL)`);
                db.run('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)');
            } },
            { version: 5, run() {
                db.run(`CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, notification_key TEXT UNIQUE NOT NULL, type TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'medium', title TEXT NOT NULL, message TEXT, target_tab TEXT, is_read INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
                db.run('CREATE INDEX IF NOT EXISTS idx_notifications_active ON notifications(active,is_read,priority)');
                db.run(`CREATE TABLE IF NOT EXISTS attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, filename TEXT NOT NULL, stored_path TEXT NOT NULL, mime_type TEXT, size_bytes INTEGER DEFAULT 0, created_at TEXT NOT NULL)`);
                db.run('CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type,entity_id)');
            } },
            { version: 6, run() {
                db.run(`CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, description TEXT, permissions TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)`);
                db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT, role_id INTEGER, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_login TEXT, FOREIGN KEY(role_id) REFERENCES roles(id))`);
                db.run('CREATE INDEX IF NOT EXISTS idx_users_active ON users(active,email)');
                const now = new Date().toISOString();
                db.run(`INSERT OR IGNORE INTO roles(name,description,permissions,created_at) VALUES ('Administrador','Acesso total','{"all":true}',?)`, [now]);
                db.run(`INSERT OR IGNORE INTO roles(name,description,permissions,created_at) VALUES ('Operador','Pedidos, produção e estoque','{"orders":true,"production":true,"inventory":true}',?)`, [now]);
            } },
            { version: 7, run() {
                db.run(`UPDATE roles SET permissions='{"all":true}' WHERE name='Administrador'`);
                db.run(`UPDATE roles SET permissions='{"api":true,"orders":true,"production":true,"inventory":true,"attachments":true}' WHERE name='Operador'`);
                db.run(`INSERT OR IGNORE INTO roles(name,description,permissions,created_at) VALUES ('Comercial','Clientes, produtos, orçamentos e Radar','{"api":true,"orders":true,"radar":true}',?)`, [new Date().toISOString()]);
                db.run(`CREATE TABLE IF NOT EXISTS api_sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, direction TEXT NOT NULL, resource TEXT NOT NULL, status TEXT NOT NULL, details TEXT, created_at TEXT NOT NULL)`);
            } }
        ];
        let applied = Number(current) || 0;
        for (const migration of migrations) {
            if (migration.version <= applied) continue;
            db.run('BEGIN');
            try {
                migration.run();
                db.run('INSERT OR REPLACE INTO schema_migrations (id, version, applied_at) VALUES (1, ?, ?)',
                    [migration.version, new Date().toISOString()]);
                db.run('COMMIT');
                applied = migration.version;
                markDBChanged();
            } catch (migrationError) {
                try { db.run('ROLLBACK'); } catch (_) {}
                throw new Error(`Migração v${migration.version} falhou: ${migrationError.message}`);
            }
        }
    } catch (e) {
        console.warn('Falha ao registrar migração do banco', e);
    }
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
        if (!cols.includes(column)) { db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); markDBChanged(); }
    } catch (e) {
        console.warn('Falha ao verificar coluna', table, column, e);
    }
}


function initDefaultCepShippingRates() {
    try {
        const count = db.exec('SELECT COUNT(*) FROM shipping_cep_rates')?.[0]?.values?.[0]?.[0] || 0;
        if (count > 0) return;
        DEFAULT_CEP_SHIPPING.forEach(r => db.run('INSERT INTO shipping_cep_rates (uf, region, min_weight, max_weight, cost, delivery_days) VALUES (?,?,?,?,?,?)', r));
    } catch (e) {
        console.warn('Falha ao inicializar tabela de frete por CEP', e);
    }
}

function migrateSettings() {
    const defaults = { energyPrice:'1.00', hourlyRate:'60', profitMargin:'50', lossRate:'10', maintenancePerHour:'0.50', failRate:'5', packagingCost:'0', customFee:'0', serviceTime:'0', taxRate:'0', monthlyGoal:'0', alertDays:'7', purgeCostPerChange:'3.00', brandName:'', quoteValidityDays:'15' };
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
    const hint = document.getElementById('historicalFailRateHint');
    if (hint) {
        const rate = getHistoricalFailRate();
        hint.textContent = rate > 0 ? `(histórico real: ${(rate * 100).toFixed(1)}%)` : '';
    }
    setInputValue('settingPackagingCost', currentSettings.packagingCost, '0');
    setInputValue('settingTaxRate', currentSettings.taxRate, '0');
    setInputValue('settingMonthlyGoal', currentSettings.monthlyGoal, '0');
    setInputValue('settingAlertDays', currentSettings.alertDays, '7');
    setInputValue('settingPurgeCostPerChange', currentSettings.purgeCostPerChange, '3.00');
    setInputValue('settingBrandName', currentSettings.brandName, '');
    setInputValue('settingQuoteValidityDays', currentSettings.quoteValidityDays, '15');
    updatePrinterHourInfo();
    loadShippingTable();
    if (typeof loadMlConfig === 'function') loadMlConfig();
}

function saveSettings() {
    const map = { settingEnergyPrice:'energyPrice', settingHourlyRate:'hourlyRate', settingProfitMargin:'profitMargin', settingLossRate:'lossRate', settingMaintenancePerHour:'maintenancePerHour', settingFailRate:'failRate', settingPackagingCost:'packagingCost', settingTaxRate:'taxRate', settingMonthlyGoal:'monthlyGoal', settingAlertDays:'alertDays', settingPurgeCostPerChange:'purgeCostPerChange', settingBrandName:'brandName', settingQuoteValidityDays:'quoteValidityDays' };
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
