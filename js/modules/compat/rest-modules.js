/* Sprint 9 — REST-first para os módulos operacionais.
 * O banco relacional é a fonte de verdade. O sql.js é atualizado após cada
 * leitura/escrita apenas como cache de UI e fallback offline.
 */
window.RestModules = (() => {
  const LOADERS = {
    clients: 'loadClients', products: 'loadProducts', materials: 'loadMaterials',
    orders: 'loadOrders', quotes: 'loadQuotes', expenses: 'loadExpenses',
    printers: 'loadPrinters', maintenance_items: 'loadMaintenance'
  };
  const mutations = {
    // saveClient já sincroniza cliente + consignação em ordem transacional.
    // Não o envolva novamente, pois isso gerava um segundo POST duplicado.
    deleteClient: ['clients'],
    saveProduct: ['products'], deleteProduct: ['products'],
    saveMaterial: ['materials'], saveAddStock: ['materials'], deleteMaterial: ['materials'],
    saveQuoteAsOrder: ['orders','quotes'], savePayment: ['orders'], updateOrderStatus: ['orders','materials'],
    deleteOrder: ['orders'], restoreOrder: ['orders'], hardDeleteOrder: ['orders'],
    saveFailedPrintReport: ['orders','materials','failed_prints'], importOrdersFromCSV: ['orders'],
    saveCurrentQuote: ['quotes'], setQuoteStatus: ['quotes'], deleteQuote: ['quotes'], _doConvertQuote: ['quotes','orders'],
    saveExpense: ['expenses'], deleteExpense: ['expenses'],
    savePrinter: ['printers'], deletePrinter: ['printers'],
    saveMaintenanceItem: ['maintenance_items'], toggleMaintenanceItem: ['maintenance_items'], deleteMaintenanceItem: ['maintenance_items']
  };
  const originals = {};
  let installed = false;
  let online = true;

  function localRows(resource) {
    if (!window.db) return [];
    const r = db.exec(`SELECT * FROM ${resource}`);
    if (!r.length) return [];
    const {columns, values} = r[0];
    return values.map(v => Object.fromEntries(columns.map((c,i)=>[c,v[i]])));
  }
  function primaryKey(resource, row) { return resource === 'settings' ? row.key : row.id; }
  function snapshot(resource) {
    return new Map(localRows(resource).map(row => [String(primaryKey(resource,row)), JSON.stringify(row)]));
  }
  function rowMap(resource) {
    return new Map(localRows(resource).map(row => [String(primaryKey(resource,row)), row]));
  }
  async function applyDiff(resource, before) {
    const after = rowMap(resource);
    const beforeIds = new Set(before.keys());
    for (const [id,row] of after) {
      const previous = before.get(id);
      const current = JSON.stringify(row);
      if (previous == null) await RelationalAPI.create(resource,row);
      else if (previous !== current) await RelationalAPI.update(resource,id,row);
      beforeIds.delete(id);
    }
    for (const id of beforeIds) await RelationalAPI.remove(resource,id,true);
    await RelationalAPI.refreshResource(resource);
  }
  async function refresh(resource) {
    try {
      await RelationalAPI.refreshResource(resource); online = true; return true;
    } catch (error) {
      online = false;
      console.warn(`[Sprint 9] ${resource}: usando cache local`, error);
      return false;
    }
  }
  function wrapLoader(resource, name) {
    const original = window[name]; if (typeof original !== 'function') return;
    originals[name] = original;
    window[name] = async function(...args) {
      await refresh(resource);
      return original.apply(this,args);
    };
  }
  function renderResources(resources) {
    const rendered = new Set();
    for (const resource of resources) {
      const loaderName = LOADERS[resource];
      if (!loaderName || rendered.has(loaderName)) continue;
      rendered.add(loaderName);
      // Usa a função original do loader porque applyDiff() já atualizou o
      // espelho local pela API. Assim evitamos uma segunda chamada de rede e
      // redesenhamos imediatamente a tela que o usuário está visualizando.
      const loader = originals[loaderName] || window[loaderName];
      if (typeof loader === 'function') loader.call(window);
    }

    // Atualiza também os resumos visuais que dependem dos cadastros alterados.
    if (typeof window.updateDashboard === 'function') window.updateDashboard();
    if (resources.includes('printers') && typeof window.loadPrinterDashboard === 'function') window.loadPrinterDashboard();
    if (resources.includes('products') && typeof window.loadMarketplaces === 'function') window.loadMarketplaces();
  }
  function wrapMutation(name, resources) {
    const original = window[name]; if (typeof original !== 'function') return;
    originals[name] = original;
    window[name] = async function(...args) {
      const before = Object.fromEntries(resources.map(r=>[r,snapshot(r)]));
      const result = await original.apply(this,args);
      try {
        for (const resource of resources) await applyDiff(resource,before[resource]);
        online = true;
        renderResources(resources);
      } catch (error) {
        online = false;
        resources.forEach(r=>RelationalAPI.markDirty(r));
        showToast?.(`⚠️ Não foi possível atualizar o servidor: ${error.message || error}`,'error');
      }
      return result;
    };
  }
  async function refreshOperational() {
    for (const resource of Object.keys(LOADERS)) await refresh(resource);
  }
  function install() {
    if (installed) return; installed = true;
    Object.entries(LOADERS).forEach(([resource,name])=>wrapLoader(resource,name));
    Object.entries(mutations).forEach(([name,resources])=>wrapMutation(name,resources));
    window.addEventListener('online', async()=>{ online=true; await RelationalAPI.flushDirty(); await refreshOperational(); });
    window.addEventListener('offline', ()=>{ online=false; });
    console.info('[Sprint 9] Módulos operacionais em modo REST-first.');
  }
  return {install,refresh,refreshOperational,get online(){return online;}, originals};
})();
