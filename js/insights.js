// Radar de Produtos v4 — interface limpa em dashboard, descoberta, pipeline e editor lateral.
let _insightsInitialized = false;
let _insightsCurrentQuery = 'modular 3d printed desk organizer';
let _editingRadarIdeaId = null;
let _radarEditorInstance = null;
let _radarDraggedId = null;

const RADAR_STATUS = {
  discovered:{label:'Descoberta',color:'#64748b',icon:'bi-lightbulb'},
  validating:{label:'Validação',color:'#0d6efd',icon:'bi-clipboard-check'},
  prototype:{label:'Protótipo',color:'#6f42c1',icon:'bi-box-seam'},
  test_sale:{label:'Venda teste',color:'#fd7e14',icon:'bi-bag-check'},
  converted:{label:'Produto',color:'#198754',icon:'bi-trophy'},
  discarded:{label:'Descartado',color:'#dc3545',icon:'bi-x-circle'}
};
const RADAR_FLOW = ['discovered','validating','prototype','test_sale','converted','discarded'];
const RADAR_PIPELINE_FLOW = ['discovered','validating','prototype','test_sale','converted']; // sem descartados
const RADAR_DEFAULT_WEIGHTS = {demand:24,novelty:20,margin:22,custom:12,saturation:12,difficulty:10};
const RADAR_SLIDERS = [
  ['scoreDemand','Demanda','demand',6,false],['scoreNovelty','Novidade no Brasil','novelty',7,false],
  ['scoreMargin','Potencial de margem','margin',6,false],['scoreCustom','Personalização','custom',5,false],
  ['scoreSaturation','Saturação','saturation',4,true],['scoreDifficulty','Dificuldade','difficulty',4,true]
];
const RADAR_EVIDENCE = [
  ['checkRecentAbroad','Novidade no exterior','recent_abroad'],['checkLowBrazil','Pouca oferta no Brasil','low_brazil'],
  ['checkModelViable','Produção viável','model_viable'],['checkPersonalizable','Personalizável','personalizable'],
  ['checkGiftable','Apelo de presente','giftable'],['checkRepeatable','Produção repetível','repeatable']
];
const RADAR_PRIORITY = {
  normal:{label:'Normal',cls:'secondary'},
  high:{label:'Alta',cls:'warning'},
  urgent:{label:'Urgente',cls:'danger'}
};

// ── ML config ─────────────────────────────────────────────────────────────────
async function loadMlConfig(){const s=document.getElementById('mlConnectionStatus');try{const r=await fetch('/api/ml-config',{cache:'no-store'}),c=await r.json();if(!r.ok||c.ok===false)throw new Error(c.error||'Falha ao carregar');const map={settingMlAppId:c.app_id||'',settingMlSecret:c.has_secret?'********':'',settingMlBaseUrl:c.base_url||location.origin};Object.entries(map).forEach(([id,v])=>{const e=document.getElementById(id);if(e)e.value=v});if(s)s.textContent=c.connected?'✅ Conectado':(c.has_refresh?'⚠️ Reconexão necessária':'Não conectado')}catch(e){if(s)s.textContent='❌ '+e.message}}
async function saveMlConfig(){const p={app_id:document.getElementById('settingMlAppId')?.value.trim()||'',secret:document.getElementById('settingMlSecret')?.value.trim()||'',base_url:document.getElementById('settingMlBaseUrl')?.value.trim()||location.origin};try{const r=await fetch('/api/ml-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}),d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.error||'Falha ao salvar');showToast('✅ Configuração salva');loadMlConfig()}catch(e){showToast('❌ '+e.message)}}
async function connectMl(){await saveMlConfig();try{const r=await fetch('/api/ml-oauth-start',{cache:'no-store'}),d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.error||'Falha OAuth');window.open(d.url,'_blank','noopener')}catch(e){showToast('❌ '+e.message)}}
async function disconnectMl(){if(!confirm('Desconectar o Mercado Livre?'))return;try{const r=await fetch('/api/ml-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({disconnect:true})});const d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.error||'Falha ao desconectar');showToast('✅ Mercado Livre desconectado');}catch(e){showToast('❌ '+e.message);}loadMlConfig();}

// ── Utilitários internos ────────────────────────────────────────────────────
function _rh(v){if(typeof h==='function')return h(v);return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function _radarExec(sql,params=[]){if(!db)return[];try{return db.exec(sql,params)}catch(e){console.warn('Radar SQL:',e);return[]}}
function _radarColumnExists(name){const r=_radarExec('PRAGMA table_info(product_ideas)');return !!(r.length&&r[0].values.some(row=>row[1]===name))}
function _moneyRadar(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
function _num(id,f=0){return Number(document.getElementById(id)?.value??f)||0}
function _checked(id){return !!document.getElementById(id)?.checked}
function _dateLabel(v){if(!v)return'—';try{return new Date(v).toLocaleDateString('pt-BR')}catch(_){return v}}

// ── Tabelas e config persistida no SQLite ──────────────────────────────────
function _ensureIdeasTable(){
  if(!db)return false;
  try{
    db.run(`CREATE TABLE IF NOT EXISTS product_ideas(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,query TEXT,niche TEXT,score INTEGER,foreign_price REAL,brazil_price REAL,notes TEXT,links_json TEXT,created_at TEXT,converted_at TEXT)`);
    const m={status:"TEXT DEFAULT 'discovered'",tags:"TEXT DEFAULT ''",market:"TEXT DEFAULT 'US'",material_cost:'REAL DEFAULT 0',print_hours:'REAL DEFAULT 0',other_cost:'REAL DEFAULT 0',fee_percent:'REAL DEFAULT 0',estimated_cost:'REAL DEFAULT 0',estimated_profit:'REAL DEFAULT 0',estimated_margin:'REAL DEFAULT 0',score_json:"TEXT DEFAULT '{}'",evidence_json:"TEXT DEFAULT '{}'",updated_at:'TEXT',priority:"TEXT DEFAULT 'normal'"};
    Object.entries(m).forEach(([c,d])=>{if(!_radarColumnExists(c))db.run(`ALTER TABLE product_ideas ADD COLUMN ${c} ${d}`)});
    db.run(`CREATE TABLE IF NOT EXISTS radar_config(key TEXT PRIMARY KEY, value TEXT)`);
    return true;
  }catch(e){console.warn(e);return false}
}

/** Lê um valor da tabela radar_config. */
function _radarGetConfig(key, def=null){
  if(!db)return def;
  try{const r=db.exec('SELECT value FROM radar_config WHERE key=?',[key]);return r[0]?.values?.[0]?.[0]??def}catch(_){return def}
}
/** Grava um valor na tabela radar_config e persiste o banco. */
function _radarSetConfig(key, val){
  if(!db)return;
  try{db.run('INSERT OR REPLACE INTO radar_config(key,value) VALUES(?,?)',[key,typeof val==='string'?val:JSON.stringify(val)]);persistDB?.()}catch(_){}
}

// ── Pesos da pontuação — persistidos exclusivamente no banco ───────────────
function _weights(){
  try{const s=_radarGetConfig('score_weights');if(s)return{...RADAR_DEFAULT_WEIGHTS,...JSON.parse(s)}}catch(_){}
  return {...RADAR_DEFAULT_WEIGHTS}
}

// ── Bootstrap da tela ───────────────────────────────────────────────────────
function _initRadarTabs(){
  const tabs=document.getElementById('radarMainTabs');
  if(!tabs||tabs.dataset.ready==='1')return;
  tabs.dataset.ready='1';
  tabs.querySelectorAll('[data-bs-toggle="pill"]').forEach(btn=>{
    btn.addEventListener('shown.bs.tab',event=>{
      const target=event.target.getAttribute('data-bs-target');
      if(target)localStorage.setItem('s3dRadarActiveTab',target);
    });
  });
  const saved=localStorage.getItem('s3dRadarActiveTab');
  if(saved&&document.querySelector(`[data-bs-target="${saved}"]`)){
    setTimeout(()=>radarShowTab(saved),0);
  }
}
function loadInsights(force=false){if(!_ensureIdeasTable())return;if(!_insightsInitialized||force){_insightsInitialized=true;buildRadarEditorControls();buildRadarWeightSettings();resetRadarForm();searchMarket(_insightsCurrentQuery)}_initRadarTabs();renderRadarAll()}
function renderRadarAll(){updateRadarKpis();renderRadarOverview();renderRadarPipeline();renderRadarHistory()}
function radarShowTab(target){const trigger=document.querySelector(`[data-bs-target="${target}"]`);if(trigger&&window.bootstrap?.Tab)bootstrap.Tab.getOrCreateInstance(trigger).show()}
function radarOpenDiscover(){radarShowTab('#radarDiscoverPane');setTimeout(()=>document.getElementById('insightsQuery')?.focus(),150)}
function _editor(){const el=document.getElementById('radarEditor');if(!el)return null;return _radarEditorInstance||=bootstrap.Offcanvas.getOrCreateInstance(el)}
function radarOpenEditor(id=null){if(id)reloadRadarIdea(id);else resetRadarForm();document.getElementById('radarEditorTitle').textContent=id?'Editar oportunidade':'Nova oportunidade';document.getElementById('radarDeleteBtn')?.classList.toggle('d-none',!id);_editor()?.show()}
function radarOpenEditorFromSearch(){resetRadarForm();const q=document.getElementById('insightsQuery')?.value.trim()||_insightsCurrentQuery;document.getElementById('ideaQuery').value=q;document.getElementById('ideaName').value=_titleFromQuery(q);radarOpenEditor()}

function _titleFromQuery(q){return String(q||'').replace(/\b3d printed\b|\b3d print\b/ig,'').trim().replace(/\w\S*/g,t=>t[0].toUpperCase()+t.slice(1).toLowerCase())||'Nova oportunidade 3D'}

// ── Fontes de pesquisa ──────────────────────────────────────────────────────
function _sourceLinks(query){const q=encodeURIComponent(query),br=encodeURIComponent(query.replace(/3d printed|3d print/ig,'impresso 3d').trim());return [
  {name:'Etsy',icon:'bi-shop',group:'Exterior',url:`https://www.etsy.com/search?q=${q}&order=most_relevant`,hint:'Preço, avaliações e relevância'},
  {name:'Etsy Novidades',icon:'bi-stars',group:'Exterior',url:`https://www.etsy.com/search?q=${q}&order=date_desc`,hint:'Itens recentes e sinais iniciais'},
  {name:'Amazon EUA',icon:'bi-box-seam',group:'Exterior',url:`https://www.amazon.com/s?k=${q}`,hint:'Produtos comerciais validados'},
  {name:'Pinterest',icon:'bi-pin-angle',group:'Tendência',url:`https://www.pinterest.com/search/pins/?q=${q}`,hint:'Estética e ideias emergentes'},
  {name:'Google Trends',icon:'bi-graph-up-arrow',group:'Tendência',url:`https://trends.google.com/trends/explore?q=${q}`,hint:'Crescimento do interesse'},
  {name:'MakerWorld',icon:'bi-printer',group:'Modelos 3D',url:`https://makerworld.com/en/search/models?keyword=${q}`,hint:'Downloads, boosts e viabilidade'},
  {name:'Printables',icon:'bi-badge-3d',group:'Modelos 3D',url:`https://www.printables.com/search/models?q=${q}`,hint:'Likes, downloads e remixes'},
  {name:'Thingiverse',icon:'bi-box',group:'Modelos 3D',url:`https://www.thingiverse.com/search?q=${q}&type=things&sort=relevant`,hint:'Saturação histórica'},
  {name:'Shopee Brasil',icon:'bi-bag',group:'Brasil',url:`https://shopee.com.br/search?keyword=${br}`,hint:'Preço e concorrência local'},
  {name:'Mercado Livre',icon:'bi-shop-window',group:'Brasil',url:`https://lista.mercadolivre.com.br/${br}`,hint:'Oferta, reputação e prazo'},
  {name:'Google Shopping',icon:'bi-cart3',group:'Brasil',url:`https://www.google.com/search?tbm=shop&q=${br}`,hint:'Faixa de preço brasileira'},
  {name:'Google Brasil',icon:'bi-google',group:'Brasil',url:`https://www.google.com/search?q=${br}`,hint:'Disponibilidade ampla'}
]}

// ── Pesquisas recentes ──────────────────────────────────────────────────────
function _saveRecentSearch(query){
  if(!query||!db)return;
  try{
    let recent=[];
    try{recent=JSON.parse(_radarGetConfig('recent_searches','[]'))||[]}catch(_){}
    recent=recent.filter(q=>q!==query);
    recent.unshift(query);
    _radarSetConfig('recent_searches',JSON.stringify(recent.slice(0,5)));
  }catch(_){}
}

function renderRecentSearches(){
  const el=document.getElementById('radarRecentSearches');
  if(!el)return;
  let recent=[];
  try{recent=JSON.parse(_radarGetConfig('recent_searches','[]'))||[]}catch(_){}
  if(!recent.length){el.classList.add('d-none');return}
  el.classList.remove('d-none');
  el.innerHTML=`<div class="d-flex flex-wrap justify-content-center gap-2"><small class="text-body-secondary w-100 text-center mb-1">Pesquisas recentes</small>${recent.map(q=>`<button class="btn btn-sm btn-outline-secondary rounded-pill" onclick="searchMarket(${JSON.stringify(q)})">${_rh(q)}</button>`).join('')}</div>`;
}

function searchMarket(query){
  const i=document.getElementById('insightsQuery');
  if(query!==undefined&&i)i.value=query;
  query=(i?.value||query||_insightsCurrentQuery).trim()||_insightsCurrentQuery;
  _insightsCurrentQuery=query;
  if(i)i.value=query;
  _saveRecentSearch(query);
  renderRadarLinks(query);
  renderRadarSummary(query);
  renderRecentSearches();
  document.getElementById('radarCreateFromSearch')?.classList.remove('d-none');
}

function renderRadarLinks(query){const el=document.getElementById('radarExternalLinks');if(!el)return;el.innerHTML=_sourceLinks(query).map(s=>`<div class="col-md-6 col-xl-4"><a class="radar-source-card" href="${s.url}" target="_blank" rel="noopener"><span class="radar-source-icon"><i class="bi ${s.icon}"></i></span><span><span class="radar-source-group">${s.group}</span><strong class="d-block">${_rh(s.name)}</strong><small>${_rh(s.hint)}</small></span></a></div>`).join('')}
function renderRadarSummary(query){const el=document.getElementById('radarSummary');if(!el)return;el.classList.remove('d-none');el.innerHTML=`<i class="bi bi-info-circle me-2"></i>Pesquise <strong>${_rh(query)}</strong> nas fontes abaixo. Compare preço, avaliações, data de publicação e disponibilidade no Brasil antes de criar a oportunidade.`}

// ── Estimativa financeira e pontuação ──────────────────────────────────────
function _financeEstimate(){const price=_num('ideaBrazilPrice'),material=_num('ideaMaterialCost'),hours=_num('ideaPrintHours'),other=_num('ideaOtherCost'),fee=_num('ideaFeePercent');const machineHour=Number(window.currentSettings?.machineCostPerHour||window.currentSettings?.machineHourlyRate||1.5);const cost=material+(hours*machineHour)+other+(price*fee/100);const profit=price-cost;const margin=price>0?profit/price*100:0;return{price,cost,profit,margin,payback:profit>0?Math.max(1,Math.ceil(cost/profit)):0}}

function updateOpportunityScore(){
  const f=_financeEstimate();
  [['radarEstimatedCost',_moneyRadar(f.cost)],['radarEstimatedProfit',_moneyRadar(f.profit)],['radarEstimatedMargin',f.margin.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'],['radarPayback',f.payback?f.payback+' venda(s)':'—']].forEach(([id,v])=>{const e=document.getElementById(id);if(e)e.textContent=v});
  const weights=_weights();
  const vals={demand:_num('scoreDemand',6),novelty:_num('scoreNovelty',7),margin:_num('scoreMargin',6),custom:_num('scoreCustom',5),saturation:10-_num('scoreSaturation',4),difficulty:10-_num('scoreDifficulty',4)};
  if(f.margin>=60)vals.margin=Math.max(vals.margin,9);else if(f.margin>=40)vals.margin=Math.max(vals.margin,7);else if(f.margin>0&&f.margin<20)vals.margin=Math.min(vals.margin,3);
  const totalW=Object.values(weights).reduce((a,b)=>a+Number(b||0),0)||100;
  let score=Object.entries(vals).reduce((a,[k,v])=>a+v*(weights[k]||0),0)/(10*totalW)*100;
  score+=RADAR_EVIDENCE.filter(([id])=>_checked(id)).length*1.5;
  score=Math.max(0,Math.min(100,Math.round(score)));
  const color=score>=80?'#198754':score>=65?'#fd7e14':score>=45?'#0dcaf0':'#dc3545';
  const ring=document.getElementById('opportunityScore');
  if(ring){ring.style.setProperty('--score',score);ring.style.setProperty('--score-color',color);ring.querySelector('strong').textContent=score}
  const label=score>=80?'Alta oportunidade':score>=65?'Promissora':score>=45?'Precisa validação':'Baixa prioridade';
  const l=document.getElementById('opportunityLabel');if(l)l.textContent=label;
  const rec=document.getElementById('radarRecommendation');if(rec)rec.textContent=score>=80?'Priorize um protótipo e um teste de venda.':score>=65?'Valide concorrência e preço antes do protótipo.':score>=45?'Busque mais evidências ou melhore a margem.':'Reavalie proposta, custo ou saturação.';
  const bd=document.getElementById('radarScoreBreakdown');if(bd)bd.innerHTML=Object.entries(vals).map(([k,v])=>`<div class="radar-breakdown-row"><span>${({demand:'Demanda',novelty:'Novidade',margin:'Margem',custom:'Personalização',saturation:'Baixa saturação',difficulty:'Facilidade'})[k]}</span><strong>${v.toFixed(1)}/10</strong></div>`).join('');
  return{score,vals,finance:f}
}

function _collectEvidence(){const o={};RADAR_EVIDENCE.forEach(([id,,key])=>o[key]=_checked(id));return o}

// ── Controles do editor lateral ─────────────────────────────────────────────
function buildRadarEditorControls(){
  const s=document.getElementById('radarSliders');
  if(s){
    s.innerHTML=RADAR_SLIDERS.map(([id,label,,value,negative])=>`<div class="radar-slider-row"><label>${label}<b id="${id}Val">${value}</b></label><input class="form-range" id="${id}" type="range" min="0" max="10" value="${value}" style="accent-color:${negative?'#fd7e14':'var(--bs-primary)'}"></div>`).join('');
    RADAR_SLIDERS.forEach(([id])=>{
      const input=document.getElementById(id),valueEl=document.getElementById(id+'Val');
      if(!input)return;
      input.addEventListener('input',()=>{
        if(valueEl)valueEl.textContent=input.value;
        updateOpportunityScore();
      });
    });
  }
  const e=document.getElementById('radarEvidenceChecks');
  if(e){
    // Montagem via DOM evita interferência do sanitizador global de innerHTML
    // e garante que label, checkbox e eventos continuem funcionais.
    e.replaceChildren();
    RADAR_EVIDENCE.forEach(([id,label])=>{
      const col=document.createElement('div');
      col.className='col-12 col-sm-6';

      const card=document.createElement('div');
      card.className='radar-evidence';

      const input=document.createElement('input');
      input.className='form-check-input';
      input.id=id;
      input.type='checkbox';
      input.setAttribute('aria-label',label);

      const text=document.createElement('label');
      text.className='radar-evidence-label';
      text.htmlFor=id;
      text.textContent=label;

      input.addEventListener('change',()=>{
        card.classList.toggle('is-checked',input.checked);
        updateOpportunityScore();
      });

      // Permite clicar em qualquer parte do cartão, sem alternar duas vezes
      // quando o clique já ocorreu diretamente no checkbox ou no label.
      card.addEventListener('click',(event)=>{
        if(event.target===input || event.target===text)return;
        input.checked=!input.checked;
        input.dispatchEvent(new Event('change',{bubbles:true}));
        input.focus();
      });

      card.append(input,text);
      col.appendChild(card);
      e.appendChild(col);
    });
  }
}

function _updateRadarWeightTotal(){
  const total=Object.keys(RADAR_DEFAULT_WEIGHTS).reduce((sum,key)=>sum+Number(document.getElementById('radarWeight_'+key)?.value||0),0);
  const totalEl=document.getElementById('radarWeightTotal');
  if(totalEl){
    totalEl.textContent=total+'%';
    totalEl.className='badge '+(total===100?'text-bg-success':total<100?'text-bg-warning':'text-bg-danger');
  }
}

function buildRadarWeightSettings(){
  const el=document.getElementById('radarWeightSettings'),w=_weights();
  if(!el)return;
  const labels={demand:'Demanda',novelty:'Novidade BR',margin:'Margem',custom:'Personalização',saturation:'Saturação',difficulty:'Dificuldade'};
  el.innerHTML=Object.entries(labels).map(([k,l])=>`<div class="radar-weight-row"><label for="radarWeight_${k}">${l}</label><input class="form-range" id="radarWeight_${k}" type="range" min="0" max="40" value="${Number(w[k]??RADAR_DEFAULT_WEIGHTS[k])}"><strong id="radarWeightValue_${k}">${Number(w[k]??RADAR_DEFAULT_WEIGHTS[k])}%</strong></div>`).join('')+`<div class="d-flex justify-content-between align-items-center border-top pt-3 mt-2"><span class="text-body-secondary small">Total dos pesos</span><span id="radarWeightTotal" class="badge text-bg-success">100%</span></div>`;
  Object.keys(labels).forEach(k=>{
    const input=document.getElementById('radarWeight_'+k),valueEl=document.getElementById('radarWeightValue_'+k);
    if(!input)return;
    input.addEventListener('input',()=>{
      if(valueEl)valueEl.textContent=input.value+'%';
      _updateRadarWeightTotal();
    });
  });
  _updateRadarWeightTotal();
}

function saveRadarSettings(){
  const w={};
  Object.keys(RADAR_DEFAULT_WEIGHTS).forEach(k=>w[k]=Number(document.getElementById('radarWeight_'+k)?.value||RADAR_DEFAULT_WEIGHTS[k]));
  _radarSetConfig('score_weights',JSON.stringify(w));          // persiste no banco (backup-safe)
  showToast('✅ Critérios do Radar salvos');
  updateOpportunityScore();
}

// ── Salvar / carregar oportunidade ──────────────────────────────────────────
function saveRadarIdea(){
  if(!_ensureIdeasTable())return;
  const name=document.getElementById('ideaName')?.value.trim(),query=document.getElementById('ideaQuery')?.value.trim()||_insightsCurrentQuery;
  if(!name){showToast('Informe o nome da oportunidade.');return}
  const r=updateOpportunityScore(),now=new Date().toISOString();
  const priority=document.getElementById('ideaPriority')?.value||'normal';
  // args[0..19] = campos, args[20] = updated_at
  const args=[
    name,query,
    document.getElementById('insightsNiche')?.value||'global',
    document.getElementById('radarMarket')?.value||'US',
    r.score,
    _num('ideaForeignPrice'),_num('ideaBrazilPrice'),
    _num('ideaMaterialCost'),_num('ideaPrintHours'),_num('ideaOtherCost'),_num('ideaFeePercent'),
    document.getElementById('ideaNotes')?.value.trim()||'',
    document.getElementById('ideaTags')?.value.trim()||'',
    JSON.stringify(_sourceLinks(query)),
    JSON.stringify(r.vals),
    JSON.stringify(_collectEvidence()),
    r.finance.cost,r.finance.profit,r.finance.margin,
    priority,
    now  // updated_at — índice 20
  ];
  if(_editingRadarIdeaId){
    db.run(`UPDATE product_ideas SET name=?,query=?,niche=?,market=?,score=?,foreign_price=?,brazil_price=?,material_cost=?,print_hours=?,other_cost=?,fee_percent=?,notes=?,tags=?,links_json=?,score_json=?,evidence_json=?,estimated_cost=?,estimated_profit=?,estimated_margin=?,priority=?,updated_at=? WHERE id=?`,[...args,_editingRadarIdeaId]);
  }else{
    db.run(`INSERT INTO product_ideas(name,query,niche,market,score,foreign_price,brazil_price,material_cost,print_hours,other_cost,fee_percent,notes,tags,links_json,score_json,evidence_json,estimated_cost,estimated_profit,estimated_margin,priority,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'discovered',?,?)`,[...args.slice(0,-1),now,now]);
  }
  if(typeof persistDB==='function')persistDB();
  _editor()?.hide();
  showToast(_editingRadarIdeaId?'✅ Oportunidade atualizada':'✅ Oportunidade criada');
  resetRadarForm();
  renderRadarAll();
}

function _ideaRows(){
  const r=_radarExec(`SELECT id,name,query,niche,score,foreign_price,brazil_price,notes,created_at,converted_at,status,tags,market,material_cost,print_hours,other_cost,fee_percent,estimated_cost,estimated_profit,estimated_margin,evidence_json,updated_at,priority FROM product_ideas ORDER BY COALESCE(updated_at,created_at) DESC,id DESC`);
  if(!r.length)return[];
  return r[0].values.map(v=>({
    id:v[0],name:v[1],query:v[2],niche:v[3],score:Number(v[4]||0),
    foreign_price:Number(v[5]||0),brazil_price:Number(v[6]||0),notes:v[7]||'',
    created_at:v[8],converted_at:v[9],status:v[10]||'discovered',tags:v[11]||'',
    market:v[12]||'US',material_cost:Number(v[13]||0),print_hours:Number(v[14]||0),
    other_cost:Number(v[15]||0),fee_percent:Number(v[16]||0),
    estimated_cost:Number(v[17]||0),estimated_profit:Number(v[18]||0),estimated_margin:Number(v[19]||0),
    evidence_json:v[20]||'{}',updated_at:v[21],priority:v[22]||'normal'
  }))
}

function _getIdea(id){return _ideaRows().find(i=>Number(i.id)===Number(id))||null}

function reloadRadarIdea(id){
  const i=_getIdea(id);if(!i)return;
  _editingRadarIdeaId=id;
  const vals={ideaName:i.name,ideaQuery:i.query,ideaForeignPrice:i.foreign_price||'',ideaBrazilPrice:i.brazil_price||'',ideaMaterialCost:i.material_cost||'',ideaPrintHours:i.print_hours||'',ideaOtherCost:i.other_cost||'',ideaFeePercent:i.fee_percent||18,ideaTags:i.tags,ideaNotes:i.notes};
  Object.entries(vals).forEach(([id,v])=>{const e=document.getElementById(id);if(e)e.value=v});
  document.getElementById('insightsNiche').value=i.niche||'global';
  document.getElementById('radarMarket').value=i.market||'US';
  const prioEl=document.getElementById('ideaPriority');if(prioEl)prioEl.value=i.priority||'normal';
  let ev={};try{ev=JSON.parse(i.evidence_json||'{}')}catch(_){}
  RADAR_EVIDENCE.forEach(([id,,key])=>{const e=document.getElementById(id);if(e)e.checked=!!ev[key]});
  let scores={};
  try{scores=JSON.parse(_radarExec('SELECT score_json FROM product_ideas WHERE id=?',[id])[0]?.values?.[0]?.[0]||'{}')}catch(_){}
  // FIX: métricas invertidas (saturation, difficulty) são salvas como 10-valor;
  // ao recarregar, des-invertemos para restaurar o slider ao valor original.
  RADAR_SLIDERS.forEach(([sid,,,def,negative])=>{
    const key=sid.replace(/^score/,'').toLowerCase();
    const stored=scores[key];
    const sliderVal=stored!=null?(negative?10-stored:stored):def;
    const e=document.getElementById(sid);if(e)e.value=sliderVal;
    const v=document.getElementById(sid+'Val');if(v)v.textContent=sliderVal;
  });
  updateOpportunityScore();
}

function resetRadarForm(){
  _editingRadarIdeaId=null;
  ['ideaName','ideaQuery','ideaForeignPrice','ideaBrazilPrice','ideaMaterialCost','ideaPrintHours','ideaOtherCost','ideaTags','ideaNotes'].forEach(id=>{const e=document.getElementById(id);if(e)e.value=''});
  const fee=document.getElementById('ideaFeePercent');if(fee)fee.value=18;
  const prio=document.getElementById('ideaPriority');if(prio)prio.value='normal';
  RADAR_EVIDENCE.forEach(([id])=>{const e=document.getElementById(id);if(e)e.checked=false});
  RADAR_SLIDERS.forEach(([id,,,v])=>{const e=document.getElementById(id);if(e)e.value=v;const l=document.getElementById(id+'Val');if(l)l.textContent=v});
  updateOpportunityScore();
}

// ── Ações sobre ideias ──────────────────────────────────────────────────────
function radarDeleteCurrent(){if(_editingRadarIdeaId)deleteRadarIdea(_editingRadarIdeaId)}
function deleteRadarIdea(id){if(!confirm('Excluir permanentemente esta oportunidade?'))return;db.run('DELETE FROM product_ideas WHERE id=?',[id]);if(typeof persistDB==='function')persistDB();_editor()?.hide();renderRadarAll()}

function radarSetStatus(id,status){
  if(!RADAR_STATUS[status])return;
  const now=new Date().toISOString();
  // FIX: usa aspas simples para literal de string SQL (sem ambiguidade com identificadores)
  db.run(`UPDATE product_ideas SET status=?,converted_at=CASE WHEN ?='converted' THEN COALESCE(converted_at,?) ELSE converted_at END,updated_at=? WHERE id=?`,[status,status,now,now,id]);
  if(typeof persistDB==='function')persistDB();
  renderRadarAll();
}

function advanceRadarIdea(id){const i=_getIdea(id);if(!i)return;const idx=RADAR_FLOW.indexOf(i.status);radarSetStatus(id,RADAR_FLOW[Math.min(Math.max(idx+1,1),4)])}

function convertIdeaToProduct(id){
  const i=_getIdea(id);if(!i)return;
  if(typeof showProductModal!=='function'){
    showToast?.('Abra a aba Produtos para usar esta função','error');
    return;
  }
  showProductModal({sku:typeof generateSku==='function'?generateSku(i.name):'RADAR-'+Date.now().toString().slice(-5),name:i.name,description:`Oportunidade do Radar.\nBusca: ${i.query}\nNota: ${i.score}/100\nMargem estimada: ${i.estimated_margin.toFixed(1)}%\n\n${i.notes}`,category:'Radar / Produto em validação',print_time_h:i.print_hours||0,cost_price:i.estimated_cost||0,cost_with_fail:i.estimated_cost||0,sale_price:i.brazil_price||0,direct_price:i.brazil_price||0,stock_qty:0,min_stock:0,production_mode:'demand',active:1});
  radarSetStatus(id,'converted');
}

// ── KPIs ───────────────────────────────────────────────────────────────────
function updateRadarKpis(){
  const rows=_ideaRows();
  const set={radarKpiTotal:rows.length,radarKpiHot:rows.filter(i=>i.score>=80).length,radarKpiTesting:rows.filter(i=>i.status==='validating').length,radarKpiPrototype:rows.filter(i=>i.status==='prototype').length,radarKpiConverted:rows.filter(i=>i.status==='converted').length};
  Object.entries(set).forEach(([id,v])=>{const e=document.getElementById(id);if(e)e.textContent=v})
}

// ── Visão geral ─────────────────────────────────────────────────────────────
function renderRadarOverview(){
  const rows=_ideaRows();
  const top=[...rows].filter(i=>i.status!=='discarded').sort((a,b)=>b.score-a.score).slice(0,5);
  const el=document.getElementById('radarTopIdeas');
  if(el)el.innerHTML=top.length?top.map((i,n)=>{
    const canAdvance=!['converted','discarded'].includes(i.status);
    const nextLabel={discovered:'Validar',validating:'Prototipar',prototype:'Testar',test_sale:'Converter'}[i.status]||'';
    return `<div class="radar-top-card card border-0 bg-body-tertiary">
      <span class="radar-rank">${n+1}</span>
      <div class="flex-grow-1">
        <strong>${_rh(i.name)}</strong>
        <div class="small text-body-secondary">${_rh((RADAR_STATUS[i.status]||RADAR_STATUS.discovered).label)} · ${_moneyRadar(i.brazil_price)} · margem ${i.estimated_margin.toFixed(0)}%</div>
      </div>
      <div class="d-flex gap-2">
        ${canAdvance?`<button class="btn btn-sm btn-outline-success text-nowrap" onclick="advanceRadarIdea(${i.id})">${nextLabel} →</button>`:''}
        <button class="btn btn-sm btn-outline-secondary" onclick="radarOpenEditor(${i.id})">Analisar</button>
      </div>
    </div>`;
  }).join(''):'<div class="radar-empty-state"><i class="bi bi-lightbulb fs-2"></i><p class="mt-2">Nenhuma oportunidade cadastrada.</p></div>';

  const actions=document.getElementById('radarNextActions');
  if(actions){
    const due=rows.filter(i=>['discovered','validating','prototype'].includes(i.status)).slice(0,4);
    const actionLabel={discovered:'Validar concorrência',validating:'Preparar protótipo',prototype:'Planejar venda teste'};
    actions.innerHTML=due.length?due.map(i=>`
      <div class="radar-action-item border rounded-3 p-3">
        <i class="bi ${(RADAR_STATUS[i.status]||RADAR_STATUS.discovered).icon}"></i>
        <span class="flex-grow-1" style="cursor:pointer" onclick="radarOpenEditor(${i.id})">
          <strong class="d-block">${_rh(i.name)}</strong>
          <small class="text-body-secondary">${actionLabel[i.status]||''}</small>
        </span>
        <button class="btn btn-sm btn-outline-success" onclick="advanceRadarIdea(${i.id})" title="Avançar estágio">→</button>
      </div>`).join(''):'<div class="text-body-secondary small">Nenhuma ação pendente.</div>';
  }
}

// ── Pipeline Kanban ─────────────────────────────────────────────────────────
function renderRadarPipeline(){
  const el=document.getElementById('radarKanban');if(!el)return;
  const q=(document.getElementById('radarIdeasSearch')?.value||'').toLowerCase();
  const statusFilter=document.getElementById('radarStageFilter')?.value||'';
  const rows=_ideaRows();
  const discarded=rows.filter(i=>i.status==='discarded');
  const pipeline=rows.filter(i=>i.status!=='discarded'&&(!q||`${i.name} ${i.query} ${i.tags}`.toLowerCase().includes(q)));
  const columns=statusFilter?RADAR_PIPELINE_FLOW.filter(s=>s===statusFilter):RADAR_PIPELINE_FLOW;
  // Ajusta grid para 1 coluna quando filtrando, ou 5 colunas padrão
  el.style.gridTemplateColumns=statusFilter?'1fr':'';
  el.innerHTML=columns.map(status=>{
    const st=RADAR_STATUS[status],items=pipeline.filter(i=>i.status===status);
    return `<section class="radar-column card" data-status="${status}" ondragover="radarDragOver(event)" ondragleave="this.classList.remove('drag-over')" ondrop="radarDrop(event,'${status}')">
      <div class="radar-column-header card-header bg-transparent"><span class="radar-column-title"><i class="radar-column-dot" style="--status-color:${st.color}"></i>${st.label}</span><span class="radar-column-count">${items.length}</span></div>
      <div class="radar-kanban-list">${items.map(radarKanbanCard).join('')||'<div class="text-center text-body-secondary small py-4">Solte uma ideia aqui</div>'}</div>
    </section>`;
  }).join('');
  // Rodapé com total de descartados
  const footer=document.getElementById('radarPipelineFooter');
  if(footer)footer.innerHTML=discarded.length?`<button class="btn btn-sm btn-link text-body-secondary" onclick="radarShowTab('#radarHistoryPane')"><i class="bi bi-archive me-1"></i>${discarded.length} descartada${discarded.length>1?'s':''} — ver no Histórico</button>`:'';
}

function radarKanbanCard(i){
  const color=i.score>=80?'success':i.score>=65?'warning':i.score>=45?'info':'danger';
  const prio=RADAR_PRIORITY[i.priority]||RADAR_PRIORITY.normal;
  const priorityBadge=i.priority&&i.priority!=='normal'?`<span class="badge text-bg-${prio.cls} radar-priority-badge ms-1">${prio.label}</span>`:'';
  // FIX: usar JSON.stringify para o nome no onclick — evita quebra com apóstrofos e XSS
  return `<article class="radar-kanban-card card" draggable="true" ondragstart="radarDragStart(event,${i.id})" ondragend="radarDragEnd(event)">
    <div class="d-flex justify-content-between align-items-start">
      <div><span class="badge text-bg-${color}">${i.score}/100</span>${priorityBadge}</div>
      <div class="dropdown"><button class="btn btn-sm btn-link text-body-secondary p-0" data-bs-toggle="dropdown"><i class="bi bi-three-dots"></i></button>
      <ul class="dropdown-menu dropdown-menu-end">
        <li><button class="dropdown-item" onclick="radarOpenEditor(${i.id})">Editar</button></li>
        <li><button class="dropdown-item" onclick="convertIdeaToProduct(${i.id})">Converter em produto</button></li>
        <li><button class="dropdown-item" onclick="openAttachments('radar',${i.id},${JSON.stringify(i.name)})">Anexos</button></li>
        <li><hr class="dropdown-divider"></li>
        <li><button class="dropdown-item text-warning" onclick="radarSetStatus(${i.id},'discarded')">Descartar</button></li>
        <li><button class="dropdown-item text-danger" onclick="deleteRadarIdea(${i.id})">Excluir</button></li>
      </ul></div>
    </div>
    <h6>${_rh(i.name)}</h6>
    <div class="radar-card-meta">${_rh(i.query||'Sem termo de pesquisa')}</div>
    <div class="radar-card-metrics">
      <div><small>Margem</small><strong>${i.estimated_margin.toFixed(0)}%</strong></div>
      <div><small>Lucro</small><strong>${_moneyRadar(i.estimated_profit)}</strong></div>
    </div>
    <div class="radar-card-actions">
      <small class="text-body-secondary"><i class="bi bi-clock me-1"></i>${i.print_hours?i.print_hours+'h':'—'}</small>
      <button class="btn btn-sm btn-outline-primary" onclick="radarOpenEditor(${i.id})">Abrir</button>
    </div>
  </article>`;
}

function radarDragStart(e,id){_radarDraggedId=id;e.dataTransfer.effectAllowed='move';e.currentTarget.classList.add('opacity-50')}
function radarDragOver(e){e.preventDefault();e.currentTarget.classList.add('drag-over')}
function radarDragEnd(e){e.currentTarget.classList.remove('opacity-50');document.querySelectorAll('.radar-column').forEach(c=>c.classList.remove('drag-over'))}
function radarDrop(e,status){e.preventDefault();e.currentTarget.classList.remove('drag-over');if(_radarDraggedId)radarSetStatus(_radarDraggedId,status);_radarDraggedId=null}

// ── Histórico ───────────────────────────────────────────────────────────────
function renderRadarHistory(){
  const body=document.getElementById('radarHistoryBody');if(!body)return;
  const q=(document.getElementById('radarHistorySearch')?.value||'').toLowerCase();
  const rows=_ideaRows().filter(i=>!q||`${i.name} ${i.query} ${i.tags}`.toLowerCase().includes(q));
  body.innerHTML=rows.length?rows.map(i=>{
    const st=RADAR_STATUS[i.status]||RADAR_STATUS.discovered;
    const p=RADAR_PRIORITY[i.priority]||RADAR_PRIORITY.normal;
    return `<tr>
      <td><strong>${_rh(i.name)}</strong><div class="small text-body-secondary">${_rh(i.query||'')}</div></td>
      <td><span class="badge rounded-pill" style="background:${st.color}20;color:${st.color}">${st.label}</span></td>
      <td><strong>${i.score}</strong>/100</td>
      <td>${i.estimated_margin.toFixed(1)}%</td>
      <td>${i.priority!=='normal'?`<span class="badge text-bg-${p.cls}">${p.label}</span>`:'—'}</td>
      <td>${_dateLabel(i.updated_at||i.created_at)}</td>
      <td class="text-end"><button class="btn btn-sm btn-outline-secondary" onclick="radarOpenEditor(${i.id})">Abrir</button></td>
    </tr>`;
  }).join(''):'<tr><td colspan="7" class="text-center text-body-secondary py-5">Nenhuma oportunidade encontrada.</td></tr>'
}

// ── Compatibilidade com chamadas antigas ────────────────────────────────────
function renderSavedIdeas(){renderRadarPipeline();renderRadarHistory();renderRadarOverview()}
function compareSelectedIdeas(){radarShowTab('#radarPipelinePane')}
