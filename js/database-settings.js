(function () {
    const $ = id => document.getElementById(id);

    function payload() {
        return {
            engine: $('dbEngine')?.value || 'sqlite',
            host: $('dbHost')?.value.trim() || 'localhost',
            port: Number($('dbPort')?.value || 0),
            database: $('dbName')?.value.trim() || 'sistema3d',
            username: $('dbUser')?.value.trim() || '',
            password: $('dbPassword')?.value || '',
            sslmode: $('dbSslMode')?.value || 'prefer',
            odbc_driver: $('dbOdbcDriver')?.value.trim() || 'ODBC Driver 18 for SQL Server',
            trust_server_certificate: Boolean($('dbTrustCertificate')?.checked)
        };
    }

    window.updateDatabaseFields = function () {
        const engine = $('dbEngine')?.value || 'sqlite';
        const fields = $('dbConnectionFields');
        if (fields) fields.classList.toggle('d-none', engine === 'sqlite');
        document.querySelectorAll('.db-postgres-only').forEach(el => el.classList.toggle('d-none', engine !== 'postgresql'));
        document.querySelectorAll('.db-sqlserver-only').forEach(el => el.classList.toggle('d-none', engine !== 'sqlserver'));
        if ($('dbPort') && !$('dbPort').value) $('dbPort').value = engine === 'sqlserver' ? 1433 : engine === 'postgresql' ? 5432 : '';
    };

    function renderStatus(data) {
        const status = $('dbBackendStatus');
        const badge = $('dbBackendBadge');
        const globalBadge = $('databaseStatusBadge');
        const engine = data?.engine || data?.config?.engine || 'sqlite';
        const names = { sqlite: 'SQLite local', postgresql: 'PostgreSQL', sqlserver: 'SQL Server' };
        if (badge) badge.textContent = names[engine] || engine;
        if (globalBadge) globalBadge.textContent = names[engine] || engine;
        if (!status) return;
        const ok = data?.local_valid !== false && !data?.last_error;
        status.innerHTML = `
            <div class="provider-state ${ok ? 'ok' : 'warning'}"><i class="bi ${ok ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'}"></i><div><strong>${names[engine] || engine}</strong><small>${ok ? 'Conexão relacional ativa' : 'Conexão indisponível'}</small></div></div>
            <dl><dt>Quick check</dt><dd>${escapeHtml(String(data?.quick_check || 'não informado'))}</dd><dt>Última sincronização</dt><dd>${escapeHtml(String(data?.last_sync_at || 'ainda não sincronizado'))}</dd>${data?.last_error ? `<dt>Último erro</dt><dd class="text-danger">${escapeHtml(data.last_error)}</dd>` : ''}</dl>`;
    }

    window.loadDatabaseSettings = async function () {
        try {
            const res = await fetch('/api/database/config', { cache: 'no-store' });
            const data = await res.json();
            const cfg = data.config || {};
            if ($('dbEngine')) $('dbEngine').value = cfg.engine || 'sqlite';
            if ($('dbHost')) $('dbHost').value = cfg.host || 'localhost';
            if ($('dbPort')) $('dbPort').value = cfg.port || (cfg.engine === 'sqlserver' ? 1433 : 5432);
            if ($('dbName')) $('dbName').value = cfg.database || 'sistema3d';
            if ($('dbUser')) $('dbUser').value = cfg.username || '';
            if ($('dbPassword')) $('dbPassword').value = '';
            if ($('dbSslMode')) $('dbSslMode').value = cfg.sslmode || 'prefer';
            if ($('dbOdbcDriver')) $('dbOdbcDriver').value = cfg.odbc_driver || 'ODBC Driver 18 for SQL Server';
            if ($('dbTrustCertificate')) $('dbTrustCertificate').checked = cfg.trust_server_certificate !== false;
            updateDatabaseFields();
            renderStatus(data);
        } catch (err) {
            showToast?.(`Falha ao carregar banco: ${err.message}`, 'error');
        }
    };

    window.testDatabaseConnection = async function () {
        const status = $('dbBackendStatus');
        if (status) status.innerHTML = '<div class="d-flex align-items-center gap-2"><div class="spinner-border spinner-border-sm"></div><span>Testando conexão...</span></div>';
        try {
            const res = await fetch('/api/database/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'Falha na conexão');
            showToast?.(data.message || 'Conexão realizada', 'success');
            await loadDatabaseSettings();
        } catch (err) {
            if (status) status.innerHTML = `<div class="provider-state warning"><i class="bi bi-x-circle-fill"></i><div><strong>Conexão não realizada</strong><small>${escapeHtml(err.message)}</small></div></div>`;
            showToast?.(err.message, 'error');
        }
    };

    window.saveDatabaseSettings = async function () {
        if (!confirm('O banco atual será enviado ao novo provedor e ele passará a ser a persistência principal. Continuar?')) return;
        try {
            const res = await fetch('/api/database/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'Não foi possível ativar o banco');
            showToast?.('Banco migrado e ativado com sucesso.', 'success');
            await loadDatabaseSettings();
        } catch (err) {
            showToast?.(err.message, 'error');
        }
    };
    window.checkDatabaseIntegrity = async function () {
        const box = $('dbIntegrityResult');
        if (box) { box.classList.remove('d-none'); box.innerHTML = '<div class="d-flex align-items-center gap-2"><div class="spinner-border spinner-border-sm"></div><span>Verificando integridade...</span></div>'; }
        try {
            const res = await fetch('/api/relational/integrity', {cache:'no-store'});
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Falha na verificação');
            const orphans = Object.values(data.orphan_records || {}).reduce((a,b)=>a+Number(b||0),0);
            if (box) box.innerHTML = `<div class="provider-state ${data.ok ? 'ok' : 'warning'}"><i class="bi ${data.ok ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'}"></i><div><strong>${data.ok ? 'Banco íntegro' : 'Atenção necessária'}</strong><small>${data.missing_tables?.length || 0} tabelas ausentes · ${orphans} registros órfãos</small></div></div>`;
            showToast?.(data.ok ? 'Integridade relacional confirmada.' : 'Foram encontradas inconsistências.', data.ok ? 'success' : 'error');
        } catch (err) {
            if (box) box.innerHTML = `<div class="provider-state warning"><i class="bi bi-x-circle-fill"></i><div><strong>Não foi possível verificar</strong><small>${escapeHtml(err.message)}</small></div></div>`;
        }
    };

})();
