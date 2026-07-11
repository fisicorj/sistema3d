// Etapa 4: REST relacional como fonte operacional; sql.js permanece cache/fallback.
window.RelationalAPI = (() => {
    const RESOURCES = ['clients','materials','products','orders','quotes','expenses','printers','maintenance_items','failed_prints','notifications','audit_log','attachments','settings','roles','users'];
    const dirty = new Set();
    let installed = false;
    let flushing = false;
    let engine = 'sqlite';

    function localRows(resource) {
        if (!window.db) return [];
        const result = db.exec(`SELECT * FROM ${resource}`);
        if (!result.length) return [];
        const {columns, values}=result[0];
        return values.map(row => Object.fromEntries(columns.map((c,i)=>[c,row[i]])));
    }
    async function request(url, options={}) {
        const response = await fetch(url, {cache:'no-store', headers:{'Content-Type':'application/json', ...(options.headers||{})}, ...options});
        const data = await response.json().catch(()=>({}));
        if (!response.ok || data.ok===false) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
    }
    async function list(resource, limit=500, offset=0) { return request(`/api/relational/${resource}?limit=${limit}&offset=${offset}`); }
    async function get(resource,id) { return request(`/api/relational/${resource}/${encodeURIComponent(id)}`); }
    async function create(resource,payload) { return request(`/api/relational/${resource}`, {method:'POST', body:JSON.stringify(payload)}); }
    async function update(resource,id,payload) { return request(`/api/relational/${resource}/${encodeURIComponent(id)}`, {method:'PUT', body:JSON.stringify(payload)}); }
    async function remove(resource,id,hard=false) { return request(`/api/relational/${resource}/${encodeURIComponent(id)}?hard=${hard?1:0}`, {method:'DELETE'}); }
    function markDirty(resource) { if (RESOURCES.includes(resource)) dirty.add(resource); }

    function installDbTracker() {
        if (installed || !window.db || typeof db.run !== 'function') return;
        installed=true;
        const original=db.run.bind(db);
        db.run=function(sql, params){
            const result=original(sql, params);
            const match=String(sql||'').match(/^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["`\[]?([a-zA-Z0-9_]+)/i);
            if (match) markDirty(match[1]);
            return result;
        };
    }

    async function syncResource(resource) {
        const items=localRows(resource);
        return request(`/api/relational/${resource}/sync-resource`, {method:'POST', body:JSON.stringify({items,delete_missing:true})});
    }
    async function flushDirty() {
        if (flushing || !dirty.size) return true;
        flushing=true;
        const pending=[...dirty]; dirty.clear();
        try {
            for (const resource of pending) await syncResource(resource);
            return true;
        } catch(error) {
            pending.forEach(x=>dirty.add(x));
            console.error('[REST relacional] Falha ao persistir recursos:', error);
            return false;
        } finally { flushing=false; }
    }
    async function flushAll() { RESOURCES.forEach(markDirty); return flushDirty(); }

    async function refreshResource(resource) {
        if (!window.db) return false;
        const payload=await list(resource,500,0);
        const items=payload.items||[];
        // O bootstrap completo continua responsável por esquemas complexos; aqui atualizamos dados já existentes.
        db.run('BEGIN');
        try {
            db.run(`DELETE FROM ${resource}`);
            for (const item of items) window.RelationalSync?.insertMirrorRow?.(resource,item);
            db.run('COMMIT');
        } catch(error) { db.run('ROLLBACK'); throw error; }
        return true;
    }

    async function detectEngine() {
        try { const status=await request('/api/database/config'); engine=status.engine||status.config?.engine||'sqlite'; } catch(_) {}
        return engine;
    }
    return {list,get,create,update,remove,markDirty,installDbTracker,syncResource,flushDirty,flushAll,refreshResource,detectEngine,get engine(){return engine;}};
})();
