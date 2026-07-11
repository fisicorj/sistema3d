// Auditoria centralizada do Sistema3D
function auditLog(tableName, recordId, action, oldData = null, newData = null) {
    if (!window.db) return;
    try {
        db.run(`INSERT INTO audit_log
            (table_name, record_id, action, old_data, new_data, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`, [
            String(tableName || ''), recordId == null ? null : String(recordId), String(action || ''),
            oldData == null ? null : JSON.stringify(oldData),
            newData == null ? null : JSON.stringify(newData), new Date().toISOString()
        ]);
    } catch (error) { console.warn('Falha ao registrar auditoria:', error); }
}
function dbRowObject(sql, params = []) {
    const r = db.exec(sql, params);
    if (!r?.[0]?.values?.length) return null;
    return Object.fromEntries(r[0].columns.map((c,i)=>[c,r[0].values[0][i]]));
}
function loadAuditLog() {
    const body=document.getElementById('auditLogBody'); if(!body||!window.db)return;
    const r=db.exec(`SELECT id,table_name,record_id,action,created_at FROM audit_log ORDER BY id DESC LIMIT 100`);
    const rows=r?.[0]?.values||[];
    body.innerHTML=rows.length?rows.map(([id,t,rid,a,dt])=>`<tr><td>${id}</td><td>${h(t)}</td><td>${h(rid||'—')}</td><td>${h(a)}</td><td>${new Date(dt).toLocaleString('pt-BR')}</td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Nenhuma alteração registrada.</td></tr>';
}
function exportAuditLog(){
    const r=db.exec(`SELECT id,table_name,record_id,action,old_data,new_data,created_at FROM audit_log ORDER BY id`);
    const rows=r?.[0]?.values||[]; const cols=r?.[0]?.columns||[];
    const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;
    const csv=[cols.map(esc).join(','),...rows.map(row=>row.map(esc).join(','))].join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'}));a.download='auditoria_sistema3d.csv';a.click();URL.revokeObjectURL(a.href);
}

function loadTrash() {
    const body=document.getElementById('trashBody'); if(!body||!window.db)return;
    const items=[];
    const specs=[['clients','name'],['products','name'],['orders',"'#' || id"],['quotes',"'#' || id || ' · ' || COALESCE(client_name,'')"]];
    for(const [table,label] of specs){
        try{const r=db.exec(`SELECT id, ${label}, deleted_at FROM ${table} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 50`);(r?.[0]?.values||[]).forEach(([id,name,dt])=>items.push({table,id,name,dt}));}catch(_){ }
    }
    items.sort((a,b)=>String(b.dt).localeCompare(String(a.dt)));
    body.innerHTML=items.length?items.slice(0,100).map(x=>`<tr><td>${h(x.table)}</td><td>${h(x.name||x.id)}</td><td>${new Date(x.dt).toLocaleString('pt-BR')}</td><td><button class="btn-secondary btn-sm" onclick="restoreDeletedRecord('${x.table}',${Number(x.id)})">Restaurar</button></td></tr>`).join(''):'<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">A lixeira está vazia.</td></tr>';
}
function restoreDeletedRecord(tableName,id){
    const allowed=new Set(['clients','products','orders','quotes']); if(!allowed.has(tableName))return;
    const old=dbRowObject(`SELECT * FROM ${tableName} WHERE id=?`,[id]);
    db.run(`UPDATE ${tableName} SET deleted_at=NULL WHERE id=?`,[id]);
    if(tableName==='products') db.run('UPDATE products SET active=1 WHERE id=?',[id]);
    auditLog(tableName,id,'restore',old,dbRowObject(`SELECT * FROM ${tableName} WHERE id=?`,[id]));
    persistDB(); loadTrash(); loadAuditLog();
    if(typeof loadClients==='function')loadClients(); if(typeof loadProducts==='function')loadProducts(); if(typeof loadOrders==='function')loadOrders(); if(typeof loadQuotes==='function')loadQuotes();
    showToast('Registro restaurado.');
}
