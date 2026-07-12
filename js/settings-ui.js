function activateSettingsSection(sectionId, trigger) {
    document.querySelectorAll('#settings .settings-section').forEach(section => {
        const selected = section.id === sectionId;
        section.classList.toggle('active', selected);
        section.classList.toggle('d-none', !selected);
        section.classList.toggle('d-block', selected);
    });
    document.querySelectorAll('#settings .settings-nav-item').forEach(item => item.classList.remove('active'));
    if (trigger) trigger.classList.add('active');
    if (sectionId === 'settings-printer' && typeof loadBambuSettingsSummary === 'function') loadBambuSettingsSummary();
    const content = document.querySelector('#settings .settings-content');
    if (content && window.innerWidth < 900) content.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleSecretField(inputId, button) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    if (button) {
        button.textContent = reveal ? '🙈' : '👁';
        button.setAttribute('aria-label', reveal ? 'Ocultar valor' : 'Mostrar valor');
    }
}

async function loadBambuSettingsSummary() {
    const host = document.getElementById('bambuSettingsSummary');
    if (!host) return;
    host.innerHTML = '<div class="d-flex align-items-center gap-2 text-body-secondary"><span class="spinner-border spinner-border-sm"></span><span>Consultando configurações…</span></div>';
    try {
        const response = await fetch('/api/bambu-config', { cache: 'no-store' });
        const configs = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(configs.error || `HTTP ${response.status}`);
        const items = Object.values(configs || {});
        if (!items.length) {
            host.innerHTML = '<div class="alert alert-info mb-0">Nenhuma impressora Bambu configurada. Abra a tela <strong>Impressoras</strong> e edite uma impressora.</div>';
            return;
        }
        host.innerHTML = `<div class="list-group">${items.map(cfg => {
            const badge = cfg.connected
                ? (cfg.busy ? 'text-bg-danger' : 'text-bg-success')
                : 'text-bg-secondary';
            const state = cfg.connected ? (cfg.busy ? 'Ocupada' : 'Livre') : 'Offline';
            return `<div class="list-group-item d-flex justify-content-between align-items-start gap-3">
                <div>
                    <strong>${h(cfg.name || `Impressora #${cfg.printer_id}`)}</strong>
                    <div class="small text-body-secondary mt-1">IP: ${h(cfg.ip || '—')} · Serial: ${h(cfg.serial || '—')}</div>
                    <div class="small mt-1 ${cfg.has_code ? 'text-success' : 'text-warning'}">${cfg.has_code ? 'Access code configurado' : 'Access code não configurado'}</div>
                    ${cfg.error ? `<div class="small text-danger mt-1">${h(cfg.error)}</div>` : ''}
                </div>
                <span class="badge ${badge}">${state}</span>
            </div>`;
        }).join('')}</div>`;
    } catch (error) {
        host.innerHTML = `<div class="alert alert-danger mb-0">Não foi possível carregar: ${h(error.message || error)}</div>`;
    }
}
