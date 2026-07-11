# 3D Print Pro

ERP local para makers e microempreendedores de impressão 3D. Roda inteiramente no seu computador — sem nuvem, sem mensalidade, sem dependência de internet.

---

## O que é

Um sistema de gestão completo voltado para quem vende peças impressas em 3D. Cobre desde o cálculo de custo do pedido até o controle de estoque de filamentos, gestão de clientes, kanban de produção, relatórios financeiros e pesquisa de novos produtos para vender.

A interface roda no browser mas os dados ficam 100% locais em SQLite. O servidor Python é leve — serve os arquivos e expõe uma API REST mínima para backup, autenticação e integrações.

---

## Funcionalidades

**Calculadora de precificação**
Calcula custo real por peça considerando material, energia, hora-máquina, falhas históricas, purga de troca de cor e taxas de marketplace. Gera orçamento exportável em PDF, compartilhável por link ou via Web Share.

**Pedidos e produção**
Kanban visual com os estágios aprovado → pago → imprimindo → pós-processo → embalagem → enviado. Timer de impressão ao vivo integrado com a calculadora. Histórico de notas por pedido e etiqueta imprimível.

**Clientes**
Cadastro com busca automática de endereço por CEP. Ficha individual com histórico completo de pedidos e total gasto.

**Produtos**
Catálogo com modo de produção (sob demanda / estoque / consignação). Geração automática de SKU.

**Orçamentos**
Pipeline de orçamentos com paginação. Conversão direta para pedido preservando tipo de serviço.

**Materiais e estoque**
Controle de bobinas com custo real por grama. Alertas de estoque mínimo. Histórico de movimentações. Dedução automática de material perdido ao registrar falha de impressão.

**Impressoras**
Registro de impressoras com horas acumuladas. Agenda de manutenção preventiva com custo por hora calculado automaticamente.

**Finanças**
Módulo de despesas + fluxo de caixa. Controle de pagamentos parciais por pedido. Relatórios mensais de receita, lucro e margem com gráficos.

**Consignações**
Gestão de produtos em consignação com acerto por período.

**Frete**
Integração com Melhor Envio para cálculo de frete na calculadora e geração de etiquetas.

**Radar de Produtos**
Pesquisa de oportunidades de mercado (Etsy, Amazon, MakerWorld, Mercado Livre, etc.). Pipeline Kanban de ideias com pontuação automatizada por critérios configuráveis (demanda, margem, saturação, etc.). Converte ideia diretamente em produto no catálogo.

**Integração Mercado Livre**
Conexão via OAuth para listar produtos diretamente do ML no módulo de Insights.

**Integração Bambu Lab**
Monitoramento via MQTT da impressora Bambu Lab com status ao vivo nos cards de pedido.

**Backup automático**
Cópias diárias do banco SQLite com retenção configurável. Restauração com um clique.

**Autenticação (opcional)**
Login com senha (PBKDF2-SHA256, 260 mil iterações). Rate limiting por IP. Sessões com TTL configurável. Pode ser ativado ou deixado desligado para uso local solo.

**Backend relacional (opcional)**
Suporte a PostgreSQL e SQL Server via SQLAlchemy para equipes que precisam de acesso multi-usuário.

---

## Requisitos

- Python 3.11 ou superior
- pip

Dependências Python (instaladas via requirements.txt):

```
SQLAlchemy >= 2.0
psycopg (binary) >= 3.1   # apenas se usar PostgreSQL
pyodbc >= 5.0              # apenas se usar SQL Server
paho-mqtt >= 2.0           # apenas se usar Bambu Lab
```

O frontend usa Bootstrap 5, Bootstrap Icons e sql.js — todos incluídos localmente em `vendor/` e `js/`. Nenhuma CDN necessária para o app funcionar (exceto fontes externas opcionais).

---

## Instalação

### Windows

```bat
pip install -r requirements.txt
iniciar_windows.bat
```

### Linux / macOS

```bash
pip3 install -r requirements.txt
chmod +x iniciar.sh
./iniciar.sh
```

O servidor abre em `http://127.0.0.1:8080` e o browser abre automaticamente.

---

## Primeira execução

No primeiro acesso o banco SQLite é criado automaticamente em `app_data/sistema3d.sqlite`. Vá em **Configurações** para preencher o nome da empresa, custo de energia, hora-máquina e demais parâmetros antes de começar a calcular.

---

## Estrutura do projeto

```
sistema3d/
├── server.py                # Servidor HTTP + API REST
├── server_core/             # Módulos Python (auth, backup, relational, etc.)
├── platform_utils.py        # Utilitários de plataforma
├── requirements.txt
├── iniciar.sh               # Atalho Linux/macOS
├── iniciar_windows.bat      # Atalho Windows
│
├── index.html               # SPA principal
├── partials/                # Abas carregadas dinamicamente
├── js/                      # Lógica de cada módulo
├── css/                     # Estilos
├── assets/                  # Ícones PWA
├── vendor/                  # Bootstrap e Bootstrap Icons (offline)
│
├── manifest.webmanifest     # PWA installable
├── service-worker.js        # Cache offline
│
└── app_data/                # Criado automaticamente — NÃO versionado
    ├── sistema3d.sqlite     # Banco de dados local
    ├── backups/             # Backups automáticos
    ├── backup_config.json   # Configuração de backup
    └── melhor_envio_config.json  # Token Melhor Envio (privado)
```

> **`app_data/` está no `.gitignore` e nunca deve ser commitado.** Contém seu banco de dados e tokens de integração.

---

## Integrações opcionais

### Melhor Envio
Gere um token em [melhorenvio.com.br](https://melhorenvio.com.br) e configure em **Configurações → Frete**.

### Mercado Livre
Crie um app em [developers.mercadolivre.com.br](https://developers.mercadolivre.com.br), configure o App ID e Secret em **Configurações → Marketplace** e clique em "Conectar".

### Bambu Lab
Informe o IP, serial e access code da impressora em **Configurações → Bambu Lab**. A conexão usa MQTT local (mesma rede).

### PostgreSQL / SQL Server
Configure em **Configurações → Banco de Dados**. O sistema migra os dados do SQLite local para o banco remoto com um clique.

---

## PWA

O sistema pode ser instalado como aplicativo no Windows, macOS e Android via browser (botão de instalar na barra do topbar ou opção do Chrome/Edge). Funciona offline após a primeira carga.

---

## Licença

MIT — use, modifique e distribua livremente.
