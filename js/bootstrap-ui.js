(function(){
  'use strict';
  const THEME_KEY='sistema3d_theme';
  function resolved(mode){return mode==='auto'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):mode;}
  function apply(mode,save=true){
    mode=['light','dark','auto'].includes(mode)?mode:'auto';
    const theme=resolved(mode);
    document.documentElement.setAttribute('data-bs-theme',theme);
    document.documentElement.dataset.theme=theme;
    document.documentElement.dataset.themeMode=mode;
    if(save)localStorage.setItem(THEME_KEY,mode);
    document.querySelectorAll('[data-theme-choice]').forEach(b=>b.classList.toggle('active',b.dataset.themeChoice===mode));
    const meta=document.querySelector('meta[name="theme-color"]'); if(meta)meta.content=theme==='dark'?'#0d111b':'#f5f7fb';
  }
  function decorateChecks(root=document){
    root.querySelectorAll('input[type="checkbox"],input[type="radio"]').forEach(input=>{
      input.classList.add('form-check-input');
      const label=input.closest('label');
      if(!label) return;
      if(label.classList.contains('switch-control')){
        label.classList.remove('switch-control');
        label.classList.add('form-check','form-switch','d-inline-flex','align-items-center','gap-2');
        label.querySelector(':scope > span:not(.form-check-label)')?.remove();
        const em=label.querySelector(':scope > em');
        if(em){
          const span=document.createElement('span');
          span.className='form-check-label';
          span.textContent=em.textContent;
          em.replaceWith(span);
        }
      }else if(!label.classList.contains('radar-evidence')){
        label.classList.add('form-check','d-inline-flex','align-items-center','gap-2');
      }
    });
  }
  function decorate(root=document){
    root.querySelectorAll('button.btn-primary,button.btn-secondary,button.btn-info,button.btn-warning,button.btn-danger,button.btn-danger-soft,button.btn-success,a.btn-primary,a.btn-secondary').forEach(el=>el.classList.add('btn'));
    root.querySelectorAll('table').forEach(t=>t.classList.add('table','align-middle'));
    root.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),textarea').forEach(el=>el.classList.add('form-control'));
    root.querySelectorAll('select').forEach(el=>el.classList.add('form-select'));
    decorateChecks(root);
  }
  function bind(){
    document.getElementById('sidebarToggle')?.addEventListener('click',()=>window.Phase1UI?.toggleSidebar());
    document.querySelectorAll('[data-theme-choice]').forEach(b=>b.addEventListener('click',()=>apply(b.dataset.themeChoice)));
    apply(localStorage.getItem(THEME_KEY)||'auto',false);
    decorate();
    new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1)decorate(n)}))).observe(document.body,{childList:true,subtree:true});
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if((localStorage.getItem(THEME_KEY)||'auto')==='auto')apply('auto',false)});
  }
  window.BootstrapUI={applyTheme:apply,decorate};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
