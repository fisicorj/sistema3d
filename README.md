# Sistema 3D — Gestão de Impressão 3D

Sistema completo para gerenciamento de um negócio de impressão 3D. Roda inteiramente no navegador, sem servidor em nuvem, sem cadastro e sem mensalidade. Os dados ficam num arquivo SQLite local na sua máquina.

---

## Funcionalidades

### Pedidos
- Cadastro completo com cliente, material, tipo de trabalho, quantidade e preço
- Status com fluxo completo: Orçamento → Aprovado → Pago → Imprimindo → Pós-processo → Embalagem → Enviado → Entregue
- Soft-delete com lixeira e restauração
- Paginação (20 por página)
- Log de notas por pedido
- Controle de pagamento parcial/total com badge colorido
- Etiqueta imprimível por pedido (HTML gerado localmente)
- Timer ao vivo para pedidos em impressão
- Importação de pedidos via CSV

### Calculadora de Preço
- Cálculo detalhado: material + máquina + depreciação + energia + mão de obra + embalagem + adicionais
- Suporte a taxa de falha, urgência, desconto por lote e taxa de marketplace
- Integração com Melhor Envio para cálculo de frete por CEP
- Exportação de orçamento como PDF (impressão) ou HTML compartilhável
- Compartilhamento nativo via Web Share API (celular) com fallback para download

### Clientes
- Cadastro com endereço, telefone e e-mail
- Ficha do cliente com histórico completo de pedidos
- Link direto para WhatsApp e e-mail

### Materiais / Estoque
- Controle de estoque em gramas com alerta de estoque mínimo
- Histórico de movimentações (entradas, saídas, falhas, ajustes)
- Entrada de estoque com registro de preço pago por bobina — recalcula custo/kg automaticamente
- Histórico de compras por material

### Impressoras
- Cadastro com valor, vida útil, potência e velocidade
- Cálculo automático de custo por hora (depreciação + energia + manutenção)
- Horas acumuladas de uso com barra de progresso de vida útil

### Dashboard
- Faturamento, lucro, margem e ticket médio do mês atual
- Meta mensal de faturamento com barra de progresso
- Alertas de pedidos atrasados com acesso direto a WhatsApp e e-mail do cliente
- Resumo de estoque baixo

### Relatórios
- Evolução mensal de faturamento e lucro (gráfico de barras)
- Breakdown por tipo de trabalho, material e cliente
- Fluxo de caixa: receita vs. despesas por mês
- Exportação CSV com BOM (compatível com Excel)

### Despesas
- CRUD de despesas por categoria (Filamento, Energia, Manutenção, etc.)
- Recorrência: única, mensal ou anual
- Resumo por categoria com gráfico de barras
- Filtro por período

### Fila de Impressão
- Visão consolidada de pedidos aprovados/pagos/em impressão
- Agrupamento por impressora com carga horária total estimada

### Integração Bambu Lab (MQTT local)
- Monitoramento em tempo real via MQTT TLS direto na rede local
- Progresso (%), camadas atual/total, tempo restante, temperaturas de bico e mesa
- Widget ao vivo nos cards de pedido em impressão
- Painel de status nas configurações
- Reconexão automática

---

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | HTML + CSS + JavaScript puro (sem framework) |
| Banco de dados | [sql.js](https://github.com/sql-js/sql.js) — SQLite no navegador via WebAssembly |
| Persistência | Arquivo `.sqlite` local via servidor Python |
| Servidor | Python `http.server` (stdlib) — sem Flask, sem dependências web |
| MQTT | [paho-mqtt](https://github.com/eclipse/paho.mqtt.python) (opcional, para Bambu Lab) |
| Frete | API Melhor Envio (opcional) |

---

## Requisitos

- Python 3.8 ou superior
- Navegador moderno (Chrome, Edge, Firefox)

Para integração com Bambu Lab:
```
pip install paho-mqtt
```

---

## Instalação

```bash
git clone https://github.com/seu-usuario/sistema3d.git
cd sistema3d
python server.py
```

Acesse `http://127.0.0.1:8080` no navegador.

O banco de dados é criado automaticamente em `app_data/sistema3d.sqlite` na primeira execução. Backups automáticos são mantidos em `app_data/backups/` (máximo 30).

---

## Configuração opcional

### Melhor Envio (frete por CEP)
Em **Configurações → Melhor Envio**, informe seu token de acesso e CEP de origem.

### Bambu Lab (monitoramento em tempo real)
Em **Configurações → Bambu Lab**, informe:
- **IP da impressora** — visível em Settings → Network na tela da impressora
- **Serial Number** — visível em Settings → Device Info
- **Access Code** — visível em Settings → Network → Access Code

A impressora e o computador precisam estar na mesma rede Wi-Fi/LAN.

---

## Estrutura do projeto

```
sistema3d/
├── index.html          # Interface principal (SPA)
├── server.py           # Servidor HTTP local + integração MQTT Bambu
├── app_data/           # Dados locais (gerado automaticamente)
│   ├── sistema3d.sqlite
│   ├── backups/
│   ├── melhor_envio_config.json
│   └── bambu_config.json
└── js/
    ├── db.js           # Inicialização do banco, schema, settings
    ├── calculator.js   # Motor de cálculo de preço
    ├── orders.js       # Pedidos, fila, timer, notas, pagamentos, etiqueta
    ├── clients.js      # Clientes e ficha do cliente
    ├── materials.js    # Estoque e histórico de movimentações
    ├── printers.js     # Impressoras e horas acumuladas
    ├── dashboard.js    # Dashboard e alertas
    ├── reports.js      # Relatórios e exportação CSV
    ├── expenses.js     # Módulo de despesas
    ├── bambu.js        # Polling MQTT frontend + widgets
    ├── utils.js        # Utilitários, modal, toast, PDF, orçamento HTML
    └── ...             # shipping, packaging, addons, products, gcode
```

---

## Backup e restauração

O servidor cria um backup automático do banco a cada salvamento. Para exportar manualmente, use o botão **Backup** em Configurações — isso gera um arquivo `.sqlite` que pode ser salvo em qualquer lugar.

Para restaurar, use o botão **Restaurar** e selecione o arquivo `.sqlite`.

---

## Licença

MIT
