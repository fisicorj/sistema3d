(function(){
  'use strict';
  const SIDEBAR_KEY='sistema3d_sidebar_collapsed';
  let tableObserver;

  function toggleSidebar(){
    if(innerWidth<=900){document.querySelector('.app')?.classList.toggle('mobile-menu-open');return;}
    document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem(SIDEBAR_KEY,document.body.classList.contains('sidebar-collapsed')?'1':'0');
  }
  function cellValue(cell){return (cell?.dataset.sortValue||cell?.textContent||'').trim();}
  function comparable(v){
    const normalized=v.replace(/R\$\s?/g,'').replace(/\./g,'').replace(',','.').replace(/%/g,'').trim();
    if(normalized!==''&&!Number.isNaN(Number(normalized)))return {type:'n',value:Number(normalized)};
    const d=Date.parse(v.split('/').reverse().join('-'));if(!Number.isNaN(d)&&/[\/\-]/.test(v))return {type:'n',value:d};
    return {type:'s',value:v.toLocaleLowerCase('pt-BR')};
  }
  function sortTable(table,index,th){
    const tbody=table.tBodies[0];if(!tbody)return;const rows=[...tbody.rows];const asc=!th.classList.contains('sort-asc');
    table.querySelectorAll('th').forEach(x=>x.classList.remove('sort-asc','sort-desc'));th.classList.add(asc?'sort-asc':'sort-desc');
    rows.sort((a,b)=>{const av=comparable(cellValue(a.cells[index])),bv=comparable(cellValue(b.cells[index]));return (av.value>bv.value?1:av.value<bv.value?-1:0)*(asc?1:-1)}).forEach(r=>tbody.appendChild(r));
  }
  function enhanceTable(table){
    if(table.dataset.phase1Enhanced==='1'||!table.tHead||!table.tBodies.length)return;table.dataset.phase1Enhanced='1';
    table.classList.add('table','align-middle');
    [...table.tHead.rows[0]?.cells||[]].forEach((th,i)=>{if(!th.textContent.trim()||/aç(ão|ões)|foto|status/i.test(th.textContent))return;th.dataset.sortable='true';th.tabIndex=0;th.addEventListener('click',()=>sortTable(table,i,th));th.addEventListener('keydown',e=>{if(e.key==='Enter')sortTable(table,i,th)});});
    const container=table.closest('.table-container')||table.closest('.table-responsive')||table.parentElement;if(!container||container.querySelector(':scope > .table-tools'))return;
    const tools=document.createElement('div');tools.className='table-tools';tools.innerHTML=`<div class="table-search-wrap"><i class="bi bi-search"></i><input class="table-search form-control" type="search" placeholder="Pesquisar nesta tabela..." aria-label="Pesquisar tabela"></div><span class="table-count"></span>`;container.insertBefore(tools,table);
    const input=tools.querySelector('input'),count=tools.querySelector('.table-count');
    const filter=()=>{const q=input.value.toLocaleLowerCase('pt-BR').trim();let visible=0;[...table.tBodies[0].rows].forEach(r=>{const show=!q||r.textContent.toLocaleLowerCase('pt-BR').includes(q);r.style.display=show?'':'none';if(show)visible++});count.textContent=`${visible} registro${visible===1?'':'s'}`;};
    input.addEventListener('input',filter);filter();
    new MutationObserver(filter).observe(table.tBodies[0],{childList:true,subtree:true,characterData:true});
  }
  function enhanceAllTables(root=document){root.querySelectorAll('table').forEach(enhanceTable);}
  function bindTopbar(){
    document.getElementById('sidebarToggle')?.addEventListener('click',toggleSidebar);
  }
  function init(){
    if(localStorage.getItem(SIDEBAR_KEY)==='1'&&innerWidth>900)document.body.classList.add('sidebar-collapsed');
    bindTopbar();enhanceAllTables();
    tableObserver=new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1){if(n.matches?.('table'))enhanceTable(n);enhanceAllTables(n)}})));
    tableObserver.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('click',e=>{if(innerWidth<=900&&document.querySelector('.app')?.classList.contains('mobile-menu-open')&&!e.target.closest('.sidebar')&&!e.target.closest('#sidebarToggle'))document.querySelector('.app').classList.remove('mobile-menu-open')});
  }
  window.Phase1UI={toggleSidebar,enhanceAllTables};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
