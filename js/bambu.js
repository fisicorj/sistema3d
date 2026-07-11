// ==================== BAMBU LAB — MONITOR MQTT ====================

const BAMBU_POLL_INTERVAL = 5000;  // 5 s
let _bambuPollTimer = null;
let _bambuLastStatus = null;

const BAMBU_STATES = {
    RUNNING: { label: '🖨️ Imprimindo',  color: '#38a169' },
    PAUSE:   { label: '⏸️ Pausado',     color: '#d97706' },
    FINISH:  { label: '✅ Concluído',   color: '#00AE42' },
    FAILED:  { label: '❌ Falha',       color: '#e53e3e' },
    IDLE:    { label: '💤 Aguardando',  color: '#718096' },
    PREPARE: { label: '⚙️ Preparando', color: '#3182ce' },
};

const BAMBU_SPD = { 1:'Silencioso', 2:'Normal', 3:'Sport', 4:'Ludicrous' };

// ── Iniciar polling ────────────────────────────────────────────────
function startBambuPolling() {
    if (_bambuPollTimer) clearInterval(_bambuPollTimer);
    _fetchBambuStatus();                               // primeira chamada imediata
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
        const data = await res.json();
        _bambuLastStatus = data;
        _renderBambuWidgets(data);
    } catch (_) {
        // Silencioso — servidor pode estar offline temporariamente
    }
}

// ── Widget nas Settings ────────────────────────────────────────────
function _renderBambuWidgets(s) {
    _renderSettingsDashboard(s);
    _renderOrderCards(s);
}

function _renderSettingsDashboard(s) {
    const badge = document.getElementById('bambuStatusBadge');
    const dash  = document.getElementById('bambuLiveDashboard');
    if (!badge || !dash) return;

    if (!s.configured) {
        badge.innerHTML = '⚪ Não configurado';
        badge.style.color = 'var(--text-muted)';
        dash.style.display = 'none';
        return;
    }
    if (!s.connected) {
        badge.innerHTML = `🔴 Desconectado${s.error ? ' — ' + h(s.error) : ''}`;
        badge.style.color = '#e53e3e';
        dash.style.display = 'none';
        return;
    }

    badge.innerHTML = '🟢 Conectado';
    badge.style.color = '#38a169';

    const state = BAMBU_STATES[s.gcode_state] ?? { label: s.gcode_state || '—', color: '#718096' };
    const pct   = Math.min(100, Math.max(0, parseInt(s.mc_percent) || 0));
    const remH  = Math.floor((s.mc_remaining_min || 0) / 60);
    const remM  = (s.mc_remaining_min || 0) % 60;
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

// ── Widget inline nos cards de pedido "printing" ───────────────────
function _renderOrderCards(s) {
    const containers = document.querySelectorAll('[data-bambu-widget]');
    containers.forEach(el => {
        if (!s.connected || s.gcode_state === 'IDLE' || !s.gcode_state) {
            el.innerHTML = '<span style="color:var(--text-muted);font-size:.78em;">🖨️ Bambu offline</span>';
            return;
        }
        const state    = BAMBU_STATES[s.gcode_state] ?? { label: s.gcode_state, color: '#718096' };
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

// ── Botão "Testar conexão" nas Settings ───────────────────────────
async function testBambuConnection() {
    await saveBambuSettings();           // garante que está salvo antes de testar
    const badge = document.getElementById('bambuStatusBadge');
    if (badge) badge.innerHTML = '⏳ Testando…';
    await _fetchBambuStatus();
}

// ── Salvar configurações Bambu ────────────────────────────────────
let _bambuSaveTimer = null;
function debouncedSaveBambuSettings() {
    clearTimeout(_bambuSaveTimer);
    _bambuSaveTimer = setTimeout(saveBambuSettings, 800);
}

async function saveBambuSettings() {
    const ip    = document.getElementById('settingBambuIp')?.value?.trim() || '';
    const sn    = document.getElementById('settingBambuSerial')?.value?.trim() || '';
    const code  = document.getElementById('settingBambuAccessCode')?.value?.trim() || '';

    // Persiste no banco local (sql.js)
    if (typeof db !== 'undefined' && db) {
        db.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', ['bambuIp',          ip]);
        db.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', ['bambuSerial',      sn]);
        db.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', ['bambuAccessCode',  code]);
        if (typeof currentSettings !== 'undefined') {
            currentSettings.bambuIp = ip;
            currentSettings.bambuSerial = sn;
            currentSettings.bambuAccessCode = code;
        }
        if (typeof persistDB === 'function') persistDB();
    }

    // Envia ao servidor Python para (re)iniciar o cliente MQTT
    if (ip && sn && code) {
        try {
            const res = await fetch('/api/bambu-config', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ ip, serial: sn, access_code: code }),
            });
            const data = await res.json();
            if (data.ok) showToast('✅ Configuração Bambu salva!');
        } catch (_) {
            showToast('⚠️ Servidor offline — configuração salva no banco local');
        }
    }
}

// ── Auto-inicialização ─────────────────────────────────────────────
// Inicia polling quando o módulo é carregado (só faz sentido se houver servidor)
document.addEventListener('DOMContentLoaded', () => {
    // Ativa polling quando a aba pedidos ou settings está visível
    const observer = new MutationObserver(() => {
        const ordersActive   = document.getElementById('orders')?.classList.contains('active');
        const settingsActive = document.getElementById('settings')?.classList.contains('active');
        if (ordersActive || settingsActive) {
            if (!_bambuPollTimer) startBambuPolling();
        } else {
            stopBambuPolling();
        }
    });
    observer.observe(document.body, { subtree: true, attributeFilter: ['class'] });
});
