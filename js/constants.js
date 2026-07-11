// ==================== CONSTANTES E FORMATADORES GLOBAIS ====================
// Fonte única para nomes, formatos e valores padrão compartilhados.

const STATUS_NAMES = Object.freeze({
    quote: 'Orçamento',
    approved: 'Aprovado',
    paid: 'Pago',
    printing: 'Imprimindo',
    post: 'Pós-processamento',
    packaging: 'Embalagem',
    shipped: 'Enviado',
    delivered: 'Entregue',
    cancelled: 'Cancelado'
});

const WORK_TYPE_NAMES = Object.freeze({
    simple: 'Brinde Simples',
    personalized: 'Personalizado',
    technical: 'Peça Técnica',
    custom: 'Sob Medida',
    product: 'Produto'
});

const DEFAULT_CEP_SHIPPING = Object.freeze([
    ['SP','São Paulo',0,300,18,3], ['SP','São Paulo',301,500,24,3], ['SP','São Paulo',501,1000,32,4], ['SP','São Paulo',1001,null,45,5],
    ['RJ','Sudeste',0,300,24,4], ['RJ','Sudeste',301,500,32,4], ['RJ','Sudeste',501,1000,45,5], ['RJ','Sudeste',1001,null,60,6],
    ['MG','Sudeste',0,300,24,4], ['MG','Sudeste',301,500,32,4], ['MG','Sudeste',501,1000,45,5], ['MG','Sudeste',1001,null,60,6],
    ['ES','Sudeste',0,300,26,5], ['ES','Sudeste',301,500,35,5], ['ES','Sudeste',501,1000,48,6], ['ES','Sudeste',1001,null,65,7],
    ['PR','Sul',0,300,26,5], ['SC','Sul',0,300,28,5], ['RS','Sul',0,300,30,6],
    ['PR','Sul',301,1000,45,6], ['SC','Sul',301,1000,48,6], ['RS','Sul',301,1000,52,7],
    ['BR','Demais estados',0,300,35,7], ['BR','Demais estados',301,500,45,8], ['BR','Demais estados',501,1000,65,9], ['BR','Demais estados',1001,null,85,10]
]);

function money(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency', currency: 'BRL'
    }).format(Number(value) || 0);
}

function formatDecimal(value, digits = 2) {
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
    }).format(Number(value) || 0);
}

function pct(value, digits = 1) {
    return `${formatDecimal((Number(value) || 0) * 100, digits)}%`;
}
