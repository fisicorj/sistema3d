(function installBootstrapPureUI() {
  'use strict';
  if (window.__S3D_BOOTSTRAP_PURE_V2__) return;
  window.__S3D_BOOTSTRAP_PURE_V2__ = true;

  const THEME_KEY = 'sistema3d_theme';

  function add(el, ...classes) {
    if (!el?.classList) return;
    classes.flat().filter(Boolean).forEach(c => el.classList.add(c));
  }
  function remove(el, ...classes) {
    if (!el?.classList) return;
    classes.flat().forEach(c => el.classList.remove(c));
  }
  function children(el) {
    return [...(el?.children || [])].filter(n => n.nodeType === 1);
  }
  function resolvedTheme(mode) {
    return mode === 'auto'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
  }
  function applyTheme(mode, save = true) {
    mode = ['light', 'dark', 'auto'].includes(mode) ? mode : 'auto';
    document.documentElement.setAttribute('data-bs-theme', resolvedTheme(mode));
    if (save) localStorage.setItem(THEME_KEY, mode);
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.classList.toggle('active', button.dataset.themeChoice === mode);
    });
  }

  function formControl(el) {
    if (el.matches('input[type="checkbox"], input[type="radio"]')) {
      add(el, 'form-check-input');
      const label = el.closest('label');
      if (label) {
        if (label.classList.contains('switch-control') || el.getAttribute('role') === 'switch') {
          remove(label, 'switch-control');
          add(label, 'form-check', 'form-switch', 'd-flex', 'align-items-center', 'gap-2');
        } else {
          add(label, 'form-check', 'd-flex', 'align-items-center', 'gap-2');
        }
      }
      return;
    }
    if (el.matches('input[type="range"]')) return add(el, 'form-range');
    if (el.matches('select')) return add(el, 'form-select');
    if (el.matches('textarea,input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"])')) add(el, 'form-control');
  }

  function button(el) {
    if (!el.matches('button,a')) return;
    if (el.classList.contains('tab-btn') || el.classList.contains('nav-item')) return add(el, 'nav-link');
    if (el.classList.contains('settings-nav-item') || el.classList.contains('calc-tab-btn') || el.classList.contains('radar-main-tab') || el.classList.contains('radar-editor-tab')) {
      add(el, 'nav-link');
      return;
    }
    const map = [
      ['btn-primary', 'btn-primary'], ['btn-secondary', 'btn-outline-secondary'],
      ['btn-warning', 'btn-warning'], ['btn-danger', 'btn-danger'],
      ['btn-danger-soft', 'btn-outline-danger'], ['btn-success', 'btn-success'],
      ['btn-info', 'btn-info'], ['btn-ghost', 'btn-outline-secondary']
    ];
    for (const [hook, variant] of map) if (el.classList.contains(hook)) add(el, 'btn', variant);
    if (el.tagName === 'BUTTON' && !el.classList.contains('btn') && !el.classList.contains('btn-close')) add(el, 'btn', 'btn-outline-secondary');
  }

  function inputGroup(el) {
    if (!el.matches('.input-prefix,.input-suffix,.input-with-suffix')) return;
    remove(el, 'input-group-text');
    add(el, 'input-group');
    children(el).forEach(child => {
      if (child.matches('span,em')) add(child, 'input-group-text');
    });
  }

  function table(el) {
    if (!el.matches('table')) return;
    add(el, 'table', 'table-hover', 'align-middle', 'mb-0');
    el.querySelector('thead')?.classList.add('table-light');
    if (!el.parentElement?.classList.contains('table-responsive')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'table-responsive rounded border';
      el.parentElement?.insertBefore(wrapper, el);
      wrapper.appendChild(el);
    }
  }

  function card(el) {
    const cardHooks = ['panel-body','form-card','modern-card','settings-card','toolbar-card','integration-card','kpi-card','executive-card','radar-stat-card','printer-live-card','cons-card','opportunity-card','kanban-card','dashboard-printer-card','radar-kanban-card','stat-card','order-item'];
    if (cardHooks.some(c => el.classList.contains(c))) add(el, 'card', 'app-section-card', 'p-3'); remove(el, 'border-0');
    if (['panel-body','form-card','modern-card','settings-card'].some(c => el.classList.contains(c))) add(el, 'p-lg-4', 'mb-4');
    if (['kpi-card','executive-card','radar-stat-card','printer-live-card','cons-card','opportunity-card','dashboard-printer-card','radar-kanban-card','stat-card','order-item'].some(c => el.classList.contains(c))) add(el, 'h-100');
  }

  function grid(el) {
    const four = ['kpi-grid','dashboard-grid','executive-strip','printer-dashboard-grid','cons-grid','opportunities-grid'];
    const three = ['three-columns'];
    const two = ['two-columns','form-grid','field-grid','settings-card-grid'];
    if (![...four,...three,...two].some(c => el.classList.contains(c))) return;
    add(el, 'row', 'g-3');
    let cols = ['col-12','col-md-6'];
    if (four.some(c => el.classList.contains(c))) cols = ['col-12','col-md-6','col-xl-3'];
    if (three.some(c => el.classList.contains(c))) cols = ['col-12','col-md-6','col-xl-4'];
    children(el).forEach(child => add(child, cols));
  }

  function specialLayouts(el) {
    if (el.classList.contains('calc-split')) add(el, 'd-grid', 'gap-4');
    if (el.classList.contains('calc-left')) remove(el, 'col-12', 'col-md-7', 'col-lg-7', 'col-xl-8');
    if (el.classList.contains('calc-right')) remove(el, 'col-12', 'col-md-5', 'col-lg-5', 'col-xl-4');
    if (el.classList.contains('calc-tabs')) add(el, 'nav', 'nav-tabs', 'mb-3', 'flex-nowrap', 'overflow-x-auto');
    if (el.classList.contains('calc-tab-btn')) add(el, 'nav-link', 'text-nowrap');

    if (el.classList.contains('settings-layout')) add(el, 'row', 'g-4');
    if (el.classList.contains('settings-nav')) add(el, 'col-12', 'col-lg-3', 'nav', 'nav-pills', 'flex-lg-column', 'gap-2', 'overflow-x-auto', 'flex-nowrap');
    if (el.classList.contains('settings-content')) add(el, 'col-12', 'col-lg-9');
    if (el.classList.contains('settings-nav-item')) add(el, 'nav-link', 'd-flex', 'align-items-center', 'gap-3', 'text-start', 'text-nowrap');

    if (el.classList.contains('kanban-board')) add(el, 'd-flex', 'gap-3', 'overflow-x-auto', 'pb-3', 'align-items-stretch');
    if (el.classList.contains('kanban-column')) {
      add(el, 'card', 'border-0', 'bg-body-tertiary', 'p-2', 'flex-shrink-0');
      el.style.minWidth = '290px';
      el.style.maxWidth = '340px';
    }

    if (el.classList.contains('radar-main-tabs')) add(el, 'nav', 'nav-pills', 'gap-2', 'flex-nowrap', 'overflow-x-auto');
    if (el.classList.contains('radar-main-tab')) { remove(el, 'btn', 'btn-outline-secondary'); add(el, 'nav-link', 'text-nowrap', 'd-flex', 'align-items-center', 'gap-2'); }
    if (el.classList.contains('radar-editor-tabs')) add(el, 'nav', 'nav-tabs', 'mb-3', 'flex-nowrap', 'overflow-x-auto');
    if (el.classList.contains('radar-editor-tab')) add(el, 'nav-link', 'text-nowrap');
    if (el.classList.contains('radar-evidence')) add(el, 'form-check', 'border', 'rounded', 'p-3', 'd-flex', 'align-items-center', 'gap-2', 'h-100');

    if (el.classList.contains('page-header') || el.classList.contains('page-header-hero')) add(el, 'd-flex', 'flex-wrap', 'justify-content-between', 'align-items-center', 'gap-3', 'mb-4');
    if (el.classList.contains('hero-actions') || el.classList.contains('toolbar-actions') || el.classList.contains('card-actions')) add(el, 'd-flex', 'flex-wrap', 'gap-2');
    if (el.classList.contains('table-container')) add(el, 'table-responsive', 'rounded', 'border');
    if (el.classList.contains('empty-state') || el.classList.contains('notice-empty')) add(el, 'text-center', 'text-body-secondary', 'py-5');
    if (el.classList.contains('progress-track') || el.classList.contains('printer-progress')) add(el, 'progress');
    if (el.classList.contains('dashboard-printer-card') || el.classList.contains('radar-kanban-card') || el.classList.contains('stat-card') || el.classList.contains('order-item')) add(el, 'card');
    if (el.classList.contains('radar-kanban-column')) add(el, 'card', 'bg-body-tertiary', 'border-0', 'p-2');
    if (el.classList.contains('radar-kanban-list') || el.classList.contains('kanban-stack')) add(el, 'd-grid', 'gap-2');
    if (el.classList.contains('kanban-actions') || el.classList.contains('order-actions')) add(el, 'd-flex', 'flex-wrap', 'gap-2');
  }

  function normalizeActionGroups(root) {
    root.querySelectorAll?.('td .btn-group, td .btn-toolbar, .s3d-action-group').forEach(group => {
      remove(group, 'btn-group', 'btn-group-sm', 'btn-toolbar');
      add(group, 's3d-actions', 'd-inline-flex', 'flex-row', 'flex-nowrap', 'align-items-center', 'gap-1');
      group.querySelectorAll(':scope > .btn').forEach(btn => {
        remove(btn, 'w-100', 'd-block');
        add(btn, 'btn-sm', 'flex-shrink-0');
        btn.style.width = 'auto';
      });
    });
  }

  function normalizeDynamicCards(root) {
    root.querySelectorAll?.('.printer-dashboard-grid,.kpi-grid,.dashboard-grid,.cons-grid,.opportunities-grid').forEach(grid);
    root.querySelectorAll?.('.printer-live-card,.kpi-card,.executive-card,.cons-card,.opportunity-card').forEach(card);
  }

  function decorate(root = document) {
    const nodes = root.nodeType === 1 ? [root, ...root.querySelectorAll('*')] : [...document.querySelectorAll('*')];
    for (const el of nodes) {
      if (el.matches?.('input,textarea,select')) formControl(el);
      if (el.matches?.('button,a')) button(el);
      if (el.matches?.('table')) table(el);
      inputGroup(el);
      card(el);
      grid(el);
      specialLayouts(el);
      if (el.matches?.('label') && !el.classList.contains('form-check') && !el.querySelector('input[type="checkbox"],input[type="radio"]')) add(el, 'form-label');
      if (el.matches?.('h1')) add(el, 'h3', 'mb-1');
      if (el.matches?.('h2')) add(el, 'h4', 'mb-2');
      if (el.matches?.('.section-title')) add(el, 'h5', 'mb-3');
      if (el.matches?.('.mini-badge,.status-badge,.printer-state,.radar-score-badge,.radar-stage-badge')) add(el, 'badge');
    }
    normalizeDynamicCards(root.nodeType === 1 ? root : document);
    normalizeActionGroups(root.nodeType === 1 ? root : document);
  }

  function init() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'auto', false);
    document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => applyTheme(button.dataset.themeChoice)));
    const sidebar = document.getElementById('appSidebar');
    if (sidebar) {
      sidebar.style.setProperty('--bs-offcanvas-width', '280px');
      sidebar.style.width = '280px';
      add(sidebar, 'flex-shrink-0');
    }
    decorate(document);
    let queued = false;
    const observer = new MutationObserver(mutations => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        mutations.forEach(mutation => mutation.addedNodes.forEach(node => { if (node.nodeType === 1) decorate(node); }));
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if ((localStorage.getItem(THEME_KEY) || 'auto') === 'auto') applyTheme('auto', false);
    });
  }

  window.BootstrapPureUI = { decorate, applyTheme };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
