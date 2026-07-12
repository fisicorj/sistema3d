// Quadro visual de produção
const PRODUCTION_COLUMNS = [
  ['approved','Aprovados','📥'], ['paid','Pagos / Fila','💳'], ['printing','Imprimindo','🖨️'],
  ['post','Pós-processo','🧰'], ['packaging','Embalagem','📦'], ['shipped','Enviados','🚚']
];
function productionRows(){
  if(!db) return [];
  const r=db.exec(`SELECT o.id,o.work_type,o.material_name,o.weight,o.print_time,o.quantity,o.total_price,o.status,o.date,o.printing_started_at,COALESCE(c.name,'Sem cliente') FROM orders o LEFT JOIN clients c ON c.id=o.client_id WHERE o.deleted_at IS NULL AND o.status NOT IN ('quote','cancelled','delivered') ORDER BY o.date`);
  return r[0]?.values||[];
}
function loadProductionBoard(){
  const el=document.getElementById('productionKanban'); if(!el||!db)return;
  const rows=productionRows();
  const count=s=>rows.filter(r=>r[7]===s).length;
  const set=(id,v)=>{const x=document.getElementById(id);if(x)x.textContent=v};
  set('prodWaiting',count('approved')+count('paid'));set('prodPrinting',count('printing'));set('prodPost',count('post'));set('prodReady',count('packaging')+count('shipped'));
  el.innerHTML=PRODUCTION_COLUMNS.map(([status,label,icon])=>{
    const cards=rows.filter(r=>r[7]===status).map(r=>productionCard(r,status)).join('')||'<div class="text-center text-body-secondary small py-4">Nenhum pedido</div>';
    return `<section class="card shadow-sm kanban-column border-0"><header class="card-header bg-body d-flex justify-content-between align-items-center gap-2"><span>${icon} ${label}</span><b>${count(status)}</b></header><div class="card-body kanban-stack">${cards}</div></section>`;
  }).join('');
}
function productionCard(r,status){
 const [id,type,material,weight,time,qty,total,,date,start,client]=r;
 const next={approved:'paid',paid:'printing',printing:'post',post:'packaging',packaging:'shipped',shipped:'delivered'}[status];
 const nextLabel={paid:'Marcar pago',printing:'Iniciar impressão',post:'Finalizar impressão',packaging:'Enviar para embalagem',shipped:'Marcar enviado',delivered:'Concluir'}[next];
 const age=Math.max(0,Math.floor((Date.now()-new Date(date))/86400000));
 return `<article class="card border shadow-sm kanban-card"><div class="card-body"><div class="kanban-card-top"><strong>#${id} · ${h(client)}</strong><span>${age}d</span></div><h4>${h(getWorkTypeLabel(type))}</h4><div class="kanban-meta"><span>🧱 ${h(material||'-')} · ${Number(weight||0)}g</span><span>⏱️ ${formatHoursHuman(Number(time||0))} · ${qty} un.</span><span>💰 R$ ${Number(total||0).toFixed(2)}</span></div>${start?`<div class="progress-line"><span style="width:${Math.min(100,Math.round(((Date.now()-new Date(start))/3600000)/(Number(time)||1)*100))}%"></span></div>`:''}<div class="kanban-actions"><button class="btn btn-primary btn-sm" onclick="updateOrderStatus(${id},'${next}');setTimeout(loadProductionBoard,400)">${nextLabel}</button><button class="btn btn-outline-secondary btn-sm" onclick="showOrderNotes(${id})">📝</button></div></div></article>`;
}
