// Configuração Etsy Open API para a tela Insights
function loadEtsyConfig() {
    var box = document.getElementById('etsyConnectionStatus');
    var input = document.getElementById('settingEtsyApiKey');
    if (box) box.textContent = '⏳ Verificando Etsy…';

    fetch('/api/etsy-config')
        .then(function(r){ return r.json(); })
        .then(function(data){
            if (!data.ok) throw new Error(data.error || 'Falha ao carregar configuração Etsy');
            if (input) input.value = '';
            if (box) {
                if (data.has_api_key) {
                    box.innerHTML = '✅ Etsy configurado. A aba <strong>Insights</strong> usará a API oficial.' +
                        (data.source === 'env' ? '<br><small>Chave carregada da variável de ambiente ETSY_API_KEY.</small>' : '');
                } else {
                    box.innerHTML = 'ℹ️ Etsy sem API Key. Insights funcionará em modo assistido com links externos.';
                }
            }
        })
        .catch(function(err){
            if (box) box.textContent = '⚠️ Não consegui verificar o Etsy: ' + err.message;
        });
}

function saveEtsyConfig() {
    var input = document.getElementById('settingEtsyApiKey');
    var status = document.getElementById('etsyConfigStatus');
    var key = input ? input.value.trim() : '';
    if (!key) {
        if (status) status.textContent = 'Informe a API Key antes de salvar.';
        return;
    }
    if (status) status.textContent = 'Salvando…';
    fetch('/api/etsy-config', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({api_key: key})
    })
        .then(function(r){ return r.json(); })
        .then(function(data){
            if (!data.ok) throw new Error(data.error || 'Falha ao salvar');
            if (input) input.value = '';
            if (status) status.textContent = '✅ Etsy salvo.';
            loadEtsyConfig();
        })
        .catch(function(err){
            if (status) status.textContent = '⚠️ ' + err.message;
        });
}

function disconnectEtsy() {
    var status = document.getElementById('etsyConfigStatus');
    if (status) status.textContent = 'Removendo…';
    fetch('/api/etsy-config', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({disconnect: true})
    })
        .then(function(r){ return r.json(); })
        .then(function(data){
            if (!data.ok) throw new Error(data.error || 'Falha ao remover');
            if (status) status.textContent = '✅ Chave removida.';
            loadEtsyConfig();
        })
        .catch(function(err){
            if (status) status.textContent = '⚠️ ' + err.message;
        });
}
