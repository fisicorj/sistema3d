// ==================== BAMBU LAB — MONITOR MQTT ====================

const BAMBU_POLL_INTERVAL = 5000;  // 5 s
let _bambuPollTimer = null;
let _bambuLastStatuses = {};  // {printer_id_str: status}

const BAMBU_STATES = {
    RUNNING: { label: '🖨️ Imprimindo',  color: '#38a169' },
    PAUSE:   { label: '⏸️ Pausado',     color: '#d97706' },
    FINISH:  { label: '✅ Concluído',   color: '#00AE42' },
    FAILED:  { label: '❌ Falha',       color: '#e53e3e' },
    IDLE:    { label: '💤 Aguardando',  color: '#718096' },
    PREPARE: { label: '⚙️ Preparando', color: '#3182ce' },
};

const BAMBU_SPD = { 1:'Silencioso', 2:'Normal', 3:'Sport', 4:'Ludicrous' };

function normalizeBambuState(rawState) {
    const raw = String(rawState || '').trim().toUpperCase();
    const aliases = {
        PRINTING: 'RUNNING', PRINT: 'RUNNING', RUN: 'RUNNING',
        PAUSED: 'PAUSE', PAUSING: 'PAUSE',
        PREPARING: 'PREPARE', SLICING: 'PREPARE',
        FINISHED: 'FINISH', COMPLETE: 'FINISH', COMPLETED: 'FINISH',
        ERROR: 'FAILED', FAILURE: 'FAILED',
        READY: 'IDLE', WAITING: 'IDLE', OFFLINE: 'IDLE'
    };
    return aliases[raw] || raw;
}

function isBambuBusy(status) {
    if (!status || !status.connected) return false;
    if (typeof status.busy === 'boolean') return status.busy;
    const state = normalizeBambuState(status.gcode_state);
    if (['RUNNING', 'PAUSE', 'PREPARE'].includes(state)) return true;

    // Algumas mensagens MQTT chegam de forma incremental e podem trazer
    // progresso/tempo antes do gcode_state. Este fallback evita exibir Livre
    // durante uma impressão ativa, sem considerar estados concluídos como ocupados.
    const pct = Number(status.mc_percent);
    const remaining = Number(status.mc_remaining_min);
    const layers = Number(status.total_layer_num);
    return !['IDLE', 'FINISH', 'FAILED'].includes(state) &&
           ((Number.isFinite(remaining) && remaining > 0) ||
            (Number.isFinite(pct) && pct > 0 && pct < 100 && layers > 0));
}

// ── Iniciar polling ────────────────────────────────────────────────
function startBambuPolling() {
    if (_bambuPollTimer) clearInterval(_bambuPollTimer);
    _fetchBambuStatus();
    _bambuPollTimer = setInterval(_fetchBambuStatus, BAMBU_POLL_INTERVAL);
}

function stopBambuPolling() {
    if (_bambuPollTimer) clearInterval(_bambuPollTimer);
    _bambuPollTimer = null;
}

async function _fetchBambuStatus() {
    try {
        const res = await fetch('/api/bambu-status', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();  // {printer_id_str: status_dict, ...}
        _bambuLastStatuses = data;
        _renderOrderCards(data);
        _renderPrinterDashboard(data);
        if (typeof renderDashboardPrintingPrinters === 'function') renderDashboardPrintingPrinters(data);
    } catch (_) {
        // Silencioso — servidor pode estar offline temporariamente
    }
}

// ── Cards de impressora na aba Impressoras ─────────────────────────
function _renderPrinterDashboard(statuses) {
    if (typeof updatePrinterKpis === 'function') updatePrinterKpis(statuses);
    document.querySelectorAll('[id^="printerStatusBadge-"]').forEach(badge => {
        const pid = badge.id.replace('printerStatusBadge-', '');
        const panel = document.getElementById(`printerBambuPanel-${pid}`);
        const s = statuses[String(pid)];
        const configured = badge.dataset.bambuConfigured === '1' || s?.configured;
        badge.className = 'badge rounded-pill';
        if (!configured) {
            badge.classList.add('text-bg-secondary'); badge.textContent='Sem integração';
            if(panel) panel.innerHTML='<div class="small text-body-secondary">Sem monitoramento em tempo real.</div>';
            return;
        }
        if (!s?.connected) {
            badge.classList.add('text-bg-danger'); badge.textContent='Offline';
            if(panel) panel.innerHTML=`<div class="small"><strong class="text-danger d-block mb-1"><i class="bi bi-wifi-off me-1"></i>Sem conexão</strong><span class="text-body-secondary d-block">IP ${h(s?.ip||'—')}</span><span class="text-body-secondary d-block text-truncate">Serial ${h(s?.serial||'—')}</span>${s?.error?`<span class="text-danger d-block mt-2">${h(s.error)}</span>`:''}</div>`;
            return;
        }
        const stateKey=normalizeBambuState(s.gcode_state), busy=isBambuBusy(s), state=BAMBU_STATES[stateKey]||{label:stateKey||'Conectada'};
        badge.classList.add(busy?'text-bg-danger':'text-bg-success'); badge.textContent=busy?'Ocupada':'Livre';
        if(!panel)return;
        if(!busy){panel.innerHTML='<div class="d-flex align-items-center gap-2 text-success"><i class="bi bi-check-circle fs-5"></i><div><strong class="d-block">Disponível</strong><small class="text-body-secondary">Aguardando novo trabalho</small></div></div>';return;}
        const pct=Math.min(100,Math.max(0,Number(s.mc_percent)||0)), mins=Number(s.mc_remaining_min)||0, rh=Math.floor(mins/60), rm=mins%60;
        panel.innerHTML=`<div class="s3d-live-print"><div class="d-flex justify-content-between gap-2 mb-2"><div class="min-w-0"><strong class="d-block text-truncate">${h(s.subtask_name||s.gcode_file||state.label||'Impressão ativa')}</strong><small class="text-body-secondary">${h(state.label||'Imprimindo')}</small></div><strong class="text-nowrap">${pct}%</strong></div><div class="progress mb-3" style="height:.55rem"><div class="progress-bar" style="width:${pct}%"></div></div><div class="row g-2 text-center"><div class="col-4"><div class="s3d-live-metric"><small>Restante</small><strong>${rh?rh+'h ':''}${rm}min</strong></div></div><div class="col-4"><div class="s3d-live-metric"><small>Camada</small><strong>${s.layer_num||0}/${s.total_layer_num||0}</strong></div></div><div class="col-4"><div class="s3d-live-metric"><small>Temperatura</small><strong>${Number(s.nozzle_temp||0).toFixed(0)}°</strong></div></div></div></div>`;
    });
}

// ── Widget inline nos cards de pedido "printing" ───────────────────
// Cada widget deve ter data-bambu-widget data-printer-id="<id>".
// Se não tiver data-printer-id, mostra o primeiro status disponível (retrocompatível).
function _renderOrderCards(statuses) {
    const containers = document.querySelectorAll('[data-bambu-widget]');
    containers.forEach(el => {
        const pid = el.dataset.printerId;
        // Busca status: por printer_id se disponível, senão primeiro conectado
        let s = pid ? statuses[String(pid)] : null;
        if (!s) {
            // Retrocompatibilidade: usa qualquer impressora conectada
            s = Object.values(statuses).find(x => x.connected) || null;
        }

        if (!s || !s.connected) {
            el.innerHTML = '<span style="color:var(--text-muted);font-size:.78em;">🖨️ Bambu offline</span>';
            return;
        }
        if (!isBambuBusy(s)) {
            el.innerHTML = '<span style="color:var(--text-muted);font-size:.78em;">💤 Impressora aguardando</span>';
            return;
        }
        const normalizedState = normalizeBambuState(s.gcode_state);
        const state    = BAMBU_STATES[normalizedState] ?? { label: normalizedState || 'Conectada', color: '#718096' };
        const pct      = Math.min(100, Math.max(0, parseInt(s.mc_percent) || 0));
        const remH     = Math.floor((s.mc_remaining_min || 0) / 60);
        const remM     = (s.mc_remaining_min || 0) % 60;
        const barColor = pct >= 100 ? '#00AE42' : pct >= 75 ? '#d97706' : 'var(--primary)';

        el.innerHTML = `
        <div style="margin-top:6px;background:rgba(0,0,0,.08);border-radius:8px;padding:8px;font-size:.8em;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                <span style="color:${state.color};font-weight:700;">${state.label}</span>
                <span style="color:var(--text-muted);">⏱ ${remH > 0 ? remH + 'h ' : ''}${remM}min restantes</span>
            </div>
            <div style="background:rgba(0,0,0,.15);border-radius:4px;height:8px;overflow:hidden;margin-bottom:4px;">
                <div style="height:100%;width:${pct}%;background:${barColor};border-radius:4px;transition:width .5s;"></div>
            </div>
            <div style="display:flex;justify-content:space-between;color:var(--text-muted);">
                <span>${pct}% · Camada ${s.layer_num||0}/${s.total_layer_num||0}</span>
                <span>🌡️ ${Number(s.nozzle_temp||0).toFixed(0)}° / 🛏️ ${Number(s.bed_temp||0).toFixed(0)}°C</span>
            </div>
        </div>`;
    });
}

// ── Painel de status de uma impressora (usado em printers.js) ──────
function renderBambuStatusForPrinter(printerId) {
    const badge = document.getElementById(`bambuStatusBadge-${printerId}`);
    const dash  = document.getElementById(`bambuLiveDashboard-${printerId}`);
    if (!badge) return;

    const s = _bambuLastStatuses[String(printerId)];
    if (!s || !s.configured) {
        badge.innerHTML = '⚪ Não configurado';
        badge.style.color = 'var(--text-muted)';
        if (dash) dash.style.display = 'none';
        return;
    }
    if (!s.connected) {
        badge.innerHTML = `🔴 Desconectado${s.error ? ' — ' + h(s.error) : ''}`;
        badge.style.color = '#e53e3e';
        if (dash) dash.style.display = 'none';
        return;
    }

    badge.innerHTML = '🟢 Conectado';
    badge.style.color = '#38a169';
    if (!dash) return;

    const normalizedState = normalizeBambuState(s.gcode_state);
    const state   = BAMBU_STATES[normalizedState] ?? { label: normalizedState || '—', color: '#718096' };
    const pct     = Math.min(100, Math.max(0, parseInt(s.mc_percent) || 0));
    const remH    = Math.floor((s.mc_remaining_min || 0) / 60);
    const remM    = (s.mc_remaining_min || 0) % 60;
    const barColor = pct >= 100 ? '#00AE42' : pct >= 80 ? '#d97706' : 'var(--primary)';

    dash.style.display = '';
    dash.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="stat-card" style="padding:10px;text-align:center;">
            <div style="font-size:.75em;color:var(--text-muted);margin-bottom:4px;">Estado</div>
            <div style="font-size:1em;font-weight:700;color:${state.color};">${state.label}</div>
        </div>
        <div class="stat-card" style="padding:10px;text-align:center;">
            <div style="font-size:.75em;color:var(--text-muted);margin-bottom:4px;">Restante</div>
            <div style="font-size:1em;font-weight:700;">${remH > 0 ? remH + 'h ' : ''}${remM}min</div>
        </div>
    </div>
    <div style="margin-top:10px;">
        <div style="display:flex;justify-content:space-between;font-size:.82em;margin-bottom:4px;">
            <span>Progresso</span>
            <strong>${pct}%</strong>
        </div>
        <div style="background:rgba(0,0,0,.15);border-radius:6px;height:12px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:6px;transition:width .5s;"></div>
        </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px;font-size:.82em;">
        <div class="stat-card" style="padding:8px;text-align:center;">
            <div style="color:var(--text-muted);font-size:.75em;">Camada</div>
            <div style="font-weight:700;">${s.layer_num || 0} / ${s.total_layer_num || 0}</div>
        </div>
        <div class="stat-card" style="padding:8px;text-align:center;">
            <div style="color:var(--text-muted);font-size:.75em;">🌡️ Bico</div>
            <div style="font-weight:700;">${Number(s.nozzle_temp||0).toFixed(0)}°C</div>
        </div>
        <div class="stat-card" style="padding:8px;text-align:center;">
            <div style="color:var(--text-muted);font-size:.75em;">🛏️ Mesa</div>
            <div style="font-weight:700;">${Number(s.bed_temp||0).toFixed(0)}°C</div>
        </div>
    </div>
    <div style="font-size:.76em;color:var(--text-muted);margin-top:8px;text-align:right;">
        Velocidade: ${BAMBU_SPD[s.spd_lvl] || 'Normal'} · Atualizado em ${new Date().toLocaleTimeString('pt-BR')}
    </div>`;
}

// ── Auto-inicialização ─────────────────────────────────────────────
function _bambuCheckTabs() {
    const ordersActive   = document.getElementById('orders')?.classList.contains('active');
    const settingsActive = document.getElementById('settings')?.classList.contains('active');
    const printersActive = document.getElementById('printers')?.classList.contains('active');
    if (ordersActive || settingsActive || printersActive) {
        if (!_bambuPollTimer) startBambuPolling();
    } else {
        stopBambuPolling();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Verifica imediatamente (aba pode já estar ativa no carregamento)
    _bambuCheckTabs();
    // Observa mudanças de classe para detectar troca de aba
    const observer = new MutationObserver(_bambuCheckTabs);
    observer.observe(document.body, { subtree: true, attributeFilter: ['class'] });
});
