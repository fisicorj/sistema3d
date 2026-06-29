# Sistema 3D — Gestão de Impressão 3D

Sistema completo para gerenciamento de um negócio de impressão 3D. Roda inteiramente no navegador, sem servidor em nuvem, sem cadastro e sem mensalidade. Os dados ficam num arquivo SQLite local na sua máquina.

---

## Funcionalidades

### Calculadora de Preço
- Cálculo detalhado: material + máquina + depreciação + energia + mão de obra + embalagem + adicionais
- Fator de energia por tipo de filamento (PLA ×1.00 / PETG ×1.10 / ABS ×1.30 / Nylon ×1.40) detectado automaticamente pelo nome do material, ajustável manualmente
- Custo de purga por troca de cor — detectado automaticamente do G-code ou inserido manualmente
- Suporte a taxa de falha, urgência, desconto por lote e taxa de marketplace
- Campo de descrição do item (aparece no orçamento enviado ao cliente)
- Integração com Melhor Envio para cálculo de frete por CEP

### Orçamentos
- Salvar orçamentos calculados com status rastreável: ⏳ Aguardando / ✅ Aceito / ❌ Recusado
- Converter orçamento aceito em pedido com um clique
- Exportar orçamento para o cliente como HTML (sem expor custos internos)
- Copiar mensagem formatada para WhatsApp com um clique
- Validade configurável (padrão 15 dias)

### Leitura de G-code / .3mf
- Importação de arquivos `.gcode` e `.3mf` (Bambu Studio, OrcaSlicer, PrusaSlicer, Cura)
- Preenche automaticamente: peso da peça, tempo de impressão, filamentos AMS
- Detecção automática de trocas de cor (`M621` Bambu, `M600` Prusa/Cura)

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

### Clientes
- Cadastro com endereço, telefone e e-mail
- Ficha do cliente com histórico completo de pedidos
- Link direto para WhatsApp e e-mail

### Materiais / Estoque
- Controle de estoque em gramas com alerta de estoque mínimo
- Histórico de movimentações (entradas, saídas, falhas, ajustes)
- Entrada de estoque com registro de preço pago por bobina — recalcula custo/kg automaticamente
- Fator de energia por material configurável individualmente

### Impressoras
- Cadastro com valor, vida útil, potência e velocidade
- Cálculo automático de custo por hora (depreciação + energia + manutenção)
- Horas acumuladas de uso com barra de progresso de vida útil

### Manutenção
- Cadastro de itens de manutenção com custo e vida útil em horas (correias, bicos, rolos)
- Custo de manutenção por hora calculado automaticamente e incorporado na calculadora

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

### Fila de Impressão
- Visão consolidada de pedidos aprovados/pagos/em impressão
- Agrupamento por impressora com carga horária total estimada

### Integração Bambu Lab (MQTT local)
- Monitoramento em tempo real via MQTT TLS direto na rede local
- Progresso (%), camadas atual/total, tempo restante, temperaturas de bico e mesa
- Widget ao vivo nos cards de pedido em impressão
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

### Nome da empresa
Em **Configurações → Identidade do Negócio**, defina o nome que aparece nos orçamentos enviados ao cliente e a validade padrão dos orçamentos.

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
├── index.html              # Shell da SPA (nav + scripts)
├── server.py               # Servidor HTTP local + integração MQTT Bambu
├── partials/               # Conteúdo HTML de cada aba (carregado sob demanda)
│   ├── dashboard.html
│   ├── calculator.html
│   ├── orders.html
│   ├── quotes.html
│   ├── settings.html
│   └── ...                 # uma aba por arquivo
├── app_data/               # Dados locais (gerado automaticamente)
│   ├── sistema3d.sqlite
│   ├── backups/
│   ├── melhor_envio_config.json
│   └── bambu_config.json
├── css/
│   └── styles.css
└── js/
    ├── db.js               # Schema, migrations, settings, carregamento de partials
    ├── calculator.js       # Motor de cálculo de preço + fator de energia
    ├── gcode.js            # Parser de G-code e .3mf
    ├── orders.js           # Pedidos, fila, timer, notas, pagamentos, etiqueta
    ├── quotes.js           # Orçamentos com rastreamento de status
    ├── clients.js          # Clientes e ficha do cliente
    ├── materials.js        # Estoque e histórico de movimentações
    ├── printers.js         # Impressoras e horas acumuladas
    ├── maintenance.js      # Itens de manutenção e custo/hora
    ├── dashboard.js        # Dashboard e alertas
    ├── reports.js          # Relatórios e exportação CSV
    ├── expenses.js         # Módulo de despesas
    ├── bambu.js            # Polling MQTT frontend + widgets
    ├── utils.js            # switchTab, modal, toast, PDF, orçamento HTML/WhatsApp
    └── ...                 # shipping, packaging, addons, products
```

---

## Backup e restauração

O servidor cria um backup automático do banco a cada salvamento. Para exportar manualmente, use o botão **Backup** em Configurações — isso gera um arquivo `.sqlite` que pode ser salvo em qualquer lugar.

Para restaurar, use o botão **Restaurar** e selecione o arquivo `.sqlite`.

---

## Licença

MIT
