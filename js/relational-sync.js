// Sincronização de transição entre o sql.js no navegador e o banco relacional.
// As tabelas abaixo já são persistidas nativamente por SQLAlchemy em
// SQLite, PostgreSQL ou SQL Server. O espelho local permanece temporariamente
// para os módulos ainda não migrados e para manter o uso offline/local.
window.RelationalSync = (() => {
    const TABLES = ['clients','materials','products','orders','quotes','expenses','printers','maintenance_items','failed_prints','notifications','audit_log','attachments','settings','roles','users'];
    let enabled = true;
    let engine = 'sqlite';
    let syncing = false;

    function rows(sql) {
        if (typeof db === 'undefined' || !db) return [];
        const result = db.exec(sql);
        if (!result.length) return [];
        const { columns, values } = result[0];
        return values.map(v => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
    }

    async function bootstrap() {
        try {
            const response = await fetch('/api/relational/bootstrap', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            if (!payload.ok || !payload.data) return false;
            engine = payload.engine || 'sqlite';
            if (engine === 'sqlite') return true;

            db.run('BEGIN');
            try {
                // A ordem preserva as referências lógicas entre clientes e operações.
                for (const table of TABLES) {
                    const items = payload.data[table] || [];
                    db.run(`DELETE FROM ${table}`);
                    for (const item of items) insertMirrorRow(table, item);
                }
                db.run('COMMIT');
            } catch (error) {
                db.run('ROLLBACK');
                throw error;
            }
            console.info(`[Relational] Espelho operacional hidratado a partir de ${engine}.`);
            return true;
        } catch (error) {
            console.warn('[Relational] Não foi possível hidratar o espelho:', error);
            return false;
        }
    }

    function insertMirrorRow(table, item) {
        const allowed = {
            clients: ['id','name','email','phone','address','city','state','total_spent','last_order','document','postal_code','address_number','address_complement','deleted_at'],
            materials: ['id','name','color','spool_weight','cost','stock','min_alert','energy_factor'],
            products: ['id','sku','name','description','category','material_id','material_name','printer_id','weight_g','print_time_h','print_time_label','difficulty','cost_price','cost_with_fail','sale_price','direct_price','margin_pct','stock_qty','min_stock','production_mode','active','created_at','updated_at','deleted_at'],
            orders: ['id','client_id','work_type','printer_id','material_id','material_name','weight','print_time','difficulty','quantity','unit_price','total_price','profit','status','shipping_cost','date','notes','product_id','channel','deleted_at','printing_started_at','paid_amount'],
            quotes: ['id','client_id','client_name','item_description','quantity','unit_price','total_price','shipping_cost','total_with_shipping','status','whatsapp_text','validity_date','created_at','order_id','deleted_at'],
            expenses: ['id','category','description','amount','recurrence','date','recurrence_parent_id','recurrence_key'],
            printers: ['id','name','value','lifetime_hours','wattage','speed_gph','hours_used','bambu_ip','bambu_serial'],
            maintenance_items: ['id','name','cost','lifespan_hours','active','notes'],
            failed_prints: ['id','order_id','fail_reason','material_lost','date'],
            notifications: ['id','notification_key','type','priority','title','message','target_tab','is_read','active','created_at','updated_at'],
            audit_log: ['id','table_name','record_id','action','old_data','new_data','created_at'],
            attachments: ['id','entity_type','entity_id','filename','stored_path','mime_type','size_bytes','created_at'],
            settings: ['key','value'],
            roles: ['id','name','description','permissions','created_at'],
            users: ['id','name','email','role_id','active','created_at','last_login']
        }[table] || [];
        const cols = allowed.filter(c => Object.prototype.hasOwnProperty.call(item, c));
        if (!cols.length) return;
        const placeholders = cols.map(() => '?').join(',');
        db.run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`, cols.map(c => item[c]));
    }

    async function syncNow() {
        if (window.RelationalAPI) return window.RelationalAPI.flushDirty();
        if (!enabled || syncing || (typeof db === 'undefined' || !db)) return true;
        syncing = true;
        // Columns explícitas por tabela para evitar enviar colunas sensíveis (ex: password_hash).
        const SAFE_SELECT = {
            users: 'SELECT id,name,email,role_id,active,created_at,last_login FROM users'
        };
        try {
            const payload = Object.fromEntries(TABLES.map(table => [table, rows(SAFE_SELECT[table] || `SELECT * FROM ${table}`)]));
            const response = await fetch('/api/relational/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                cache: 'no-store'
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
            engine = data.engine || engine;
            return true;
        } catch (error) {
            console.error('[Relational] Falha na sincronização:', error);
            return false;
        } finally {
            syncing = false;
        }
    }

    async function reports(months = 12) {
        const response = await fetch(`/api/relational/reports?months=${encodeURIComponent(months)}`, { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
    }

    async function finance(month) {
        const response = await fetch(`/api/relational/finance?month=${encodeURIComponent(month || '')}`, { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
        engine = data.engine || engine;
        return data;
    }

    return { bootstrap, syncNow, finance, reports, insertMirrorRow, get engine() { return engine; } };
})();
