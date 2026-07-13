# 3D Print Pro

> ERP local e multiplataforma para gestão de negócios de impressão 3D.

O **3D Print Pro** é um sistema de gestão criado para makers, prestadores de serviço, pequenos estúdios e microempreendedores que trabalham com impressão 3D. Ele reúne precificação, pedidos, produção, estoque, clientes, consignações, finanças, manutenção, integrações e pesquisa de oportunidades em uma única aplicação.

A aplicação roda localmente no computador do usuário, utiliza uma interface web responsiva e pode operar com **SQLite, PostgreSQL ou Microsoft SQL Server**. O frontend é construído com **Bootstrap 5.3**, Bootstrap Icons, JavaScript e `sql.js`; o backend utiliza Python, SQLAlchemy e uma API REST.

---

## Sumário

- [Visão geral](#visão-geral)
- [Principais recursos](#principais-recursos)
- [Capturas de tela](#capturas-de-tela)
- [Arquitetura](#arquitetura)
- [Tecnologias](#tecnologias)
- [Requisitos](#requisitos)
- [Instalação rápida](#instalação-rápida)
- [Instalação detalhada no Windows](#instalação-detalhada-no-windows)
- [Instalação detalhada no Linux](#instalação-detalhada-no-linux)
- [Primeira execução](#primeira-execução)
- [Configuração inicial recomendada](#configuração-inicial-recomendada)
- [Bancos de dados suportados](#bancos-de-dados-suportados)
- [Módulos do sistema](#módulos-do-sistema)
- [Fluxos de trabalho](#fluxos-de-trabalho)
- [Integrações](#integrações)
- [Autenticação e segurança](#autenticação-e-segurança)
- [API REST](#api-rest)
- [PWA e funcionamento offline](#pwa-e-funcionamento-offline)
- [Backups e recuperação](#backups-e-recuperação)
- [Estrutura de diretórios](#estrutura-de-diretórios)
- [Dados e arquivos sensíveis](#dados-e-arquivos-sensíveis)
- [Configuração por variáveis de ambiente](#configuração-por-variáveis-de-ambiente)
- [Solução de problemas](#solução-de-problemas)
- [Desenvolvimento](#desenvolvimento)
- [Checklist antes de publicar no GitHub](#checklist-antes-de-publicar-no-github)
- [Roadmap sugerido](#roadmap-sugerido)
- [Licença](#licença)

---

## Visão geral

O 3D Print Pro nasceu para resolver um problema recorrente de quem trabalha com impressão 3D: as informações costumam ficar espalhadas entre planilhas, aplicativos de mensagens, anotações, marketplaces e softwares de fatiamento.

O sistema centraliza o ciclo completo:

```text
Ideia de produto
    ↓
Análise de oportunidade
    ↓
Cadastro do produto
    ↓
Cálculo de preço
    ↓
Orçamento
    ↓
Pedido
    ↓
Produção
    ↓
Entrega ou consignação
    ↓
Financeiro e relatórios
```

O sistema pode ser usado totalmente em um único computador com SQLite ou conectado a PostgreSQL/SQL Server para uma estrutura relacional mais robusta.

### Objetivos do projeto

- calcular preços com base nos custos reais da impressão;
- reduzir perdas por subprecificação;
- controlar materiais, peças e produtos;
- acompanhar o andamento dos pedidos;
- organizar a produção em formato Kanban;
- monitorar impressoras compatíveis;
- acompanhar receitas, despesas, lucro e margem;
- administrar vendas em consignação;
- pesquisar e validar novos produtos;
- manter os dados sob controle do próprio usuário;
- funcionar em Windows e Linux.

---

## Principais recursos

| Área | Recursos principais |
|---|---|
| Calculadora | Material, energia, máquina, mão de obra, manutenção, falhas, embalagem, frete, marketplace e margem |
| Pedidos | Cadastro, pagamento parcial, status, impressão, falhas, notas e histórico |
| Produção | Kanban de produção, etapas, progresso e vínculo com impressoras |
| Produtos | Catálogo, SKU, preço, custo, margem, estoque e imagens |
| Clientes | Dados, CEP, endereço, histórico e configuração para consignação |
| Materiais | Filamentos/resinas, custo por grama, estoque mínimo e movimentações |
| Impressoras | Cadastro técnico, custo/hora, vida útil e telemetria Bambu Lab |
| Manutenção | Itens, custo, periodicidade e impacto no cálculo |
| Orçamentos | Criação, acompanhamento, conversão para pedido e paginação |
| Financeiro | Receita, despesas, lucro, margem, valores a receber e consignações |
| Consignações | Envio de produtos, vendas, devoluções, comissão e acerto |
| Radar | Descoberta, pontuação, pipeline, protótipo, venda teste e conversão em produto |
| Relatórios | Evolução mensal, clientes, materiais, tipos de trabalho e impressoras |
| Integrações | Bambu Lab, Melhor Envio, Etsy e Mercado Livre |
| Segurança | Login opcional, PBKDF2, sessões persistentes, CSP e proteção de Host |
| Bancos | SQLite, PostgreSQL e SQL Server via SQLAlchemy |
| Backup | Manual, diário, semanal, por salvamento e retenção configurável |
| PWA | Instalação como aplicativo e cache dos recursos estáticos |

---

## Capturas de tela



```md
![Dashboard](docs/screenshots/dashboard.png)
![Calculadora](docs/screenshots/calculadora.png)
![Produção](docs/screenshots/producao.png)
![Radar de Produtos](docs/screenshots/radardeprodutos.png)
```

---

## Arquitetura

O projeto combina uma SPA local com um backend Python e uma camada relacional.

```mermaid
flowchart LR
    U[Usuário] --> B[Browser / PWA]
    B --> UI[Bootstrap 5.3 + JavaScript]
    UI --> API[API REST Python]
    UI --> CACHE[sql.js / cache local]
    API --> ORM[SQLAlchemy]
    ORM --> S[(SQLite)]
    ORM --> P[(PostgreSQL)]
    ORM --> M[(SQL Server)]
    API --> INT[Integrações externas]
    INT --> BAMBU[Bambu Lab MQTT]
    INT --> ME[Melhor Envio]
    INT --> ETSY[Etsy]
    INT --> ML[Mercado Livre]
```

### Camadas

#### Frontend

- `index.html` contém o shell principal da aplicação;
- cada tela é carregada dinamicamente a partir de `partials/`;
- a lógica de cada módulo fica em `js/`;
- Bootstrap e Bootstrap Icons são servidos localmente em `vendor/`;
- `css/sistema3d.css` concentra os ajustes visuais específicos;
- `sql.js` fornece cache e compatibilidade local para partes legadas/transicionais.

#### Backend

- `server.py` fornece o servidor HTTP e roteamento;
- `server_core/` contém autenticação, backups, banco, API e serviços relacionais;
- `server_core/integrations/` contém integrações externas;
- SQLAlchemy abstrai SQLite, PostgreSQL e SQL Server;
- endpoints REST fornecem CRUD, relatórios e transações compostas.

#### Persistência

O banco selecionado é a fonte relacional principal. O SQLite local também é utilizado como banco padrão e pode atuar como espelho/cache durante fluxos de compatibilidade.

---

## Tecnologias

### Backend

- Python 3.11+
- `http.server` / servidor HTTP local
- SQLAlchemy 2
- SQLite
- PostgreSQL via `psycopg`
- Microsoft SQL Server via `pyodbc`
- MQTT via `paho-mqtt`

### Frontend

- HTML5
- JavaScript sem framework
- Bootstrap 5.3.6
- Bootstrap Icons 1.13.1
- `sql.js` / WebAssembly
- JSZip para leitura de arquivos compactados, como `.3mf`
- Service Worker
- Web App Manifest

### Segurança

- PBKDF2-HMAC-SHA256 para senhas;
- 260.000 iterações;
- salt individual por senha;
- sessões persistentes com tokens armazenados em hash;
- cookie `HttpOnly`;
- rate limiting de autenticação;
- Content Security Policy;
- `X-Frame-Options: DENY`;
- `X-Content-Type-Options: nosniff`;
- validação de cabeçalho `Host` contra DNS Rebinding.

---

## Requisitos

### Obrigatórios

- Python 3.11 ou superior;
- pip;
- navegador moderno, como Chrome, Edge ou Firefox;
- acesso de escrita à pasta do projeto.

### Dependências Python

O arquivo `requirements.txt` contém:

```txt
SQLAlchemy>=2.0,<3
psycopg[binary]>=3.1
pyodbc>=5.0
paho-mqtt>=2.0
```

Nem todas as dependências são obrigatórias em todos os cenários:

| Dependência | Necessária quando |
|---|---|
| SQLAlchemy | sempre |
| psycopg | PostgreSQL |
| pyodbc | SQL Server |
| paho-mqtt | integração Bambu Lab |

### Requisitos adicionais do SQL Server

Além do `pyodbc`, instale o **Microsoft ODBC Driver 18 for SQL Server** no sistema operacional.

### Requisitos adicionais no Linux

Dependendo da distribuição, o `pyodbc` pode exigir os pacotes de desenvolvimento do unixODBC.

Exemplo em Debian/Ubuntu:

```bash
sudo apt update
sudo apt install python3 python3-pip python3-venv unixodbc unixodbc-dev
```

---

## Instalação rápida

```bash
git clone https://github.com/fisicorj/sistema3d.git
cd sistema3d
python -m venv .venv
```

### Windows

```powershell
.venv\Scripts\activate
pip install -r requirements.txt
python server.py
```

### Linux

```bash
source .venv/bin/activate
pip install -r requirements.txt
python3 server.py
```

Abra:

```text
http://127.0.0.1:8080
```

---

## Instalação detalhada no Windows

### 1. Instale o Python

Instale Python 3.11 ou superior e marque a opção **Add Python to PATH**.

Verifique:

```powershell
python --version
pip --version
```

### 2. Extraia ou clone o projeto

Recomenda-se uma pasta simples e fora de áreas sincronizadas:

```text
C:\Sistema3D
```

Evite, quando possível:

- OneDrive;
- Google Drive;
- pasta temporária;
- execução direta de dentro do ZIP;
- pastas com permissões restritas.

### 3. Crie o ambiente virtual

```powershell
cd C:\Sistema3D
python -m venv .venv
.venv\Scripts\activate
```

### 4. Instale as dependências

```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 5. Inicie

Opção A:

```powershell
python server.py --host 127.0.0.1 --port 8080
```

Opção B:

```text
iniciar_windows.bat
```

### 6. Acesse

```text
http://127.0.0.1:8080
```

> Não abra o `index.html` diretamente. A aplicação depende do servidor Python para banco, autenticação, integrações e APIs.

---

## Instalação detalhada no Linux

### 1. Instale os pacotes básicos

Debian/Ubuntu:

```bash
sudo apt update
sudo apt install python3 python3-pip python3-venv
```

### 2. Clone e entre na pasta

```bash
git clone https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
cd SEU-REPOSITORIO
```

### 3. Crie o ambiente virtual

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 4. Instale as dependências

```bash
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 5. Inicie

```bash
python3 server.py --host 127.0.0.1 --port 8080
```

Ou:

```bash
chmod +x iniciar.sh
./iniciar.sh
```

> O script `iniciar.sh` atualmente inicia o servidor em `0.0.0.0`, permitindo acesso pela rede local. Use manualmente `--host 127.0.0.1` se desejar acesso somente no próprio computador.

---

## Primeira execução

Na primeira execução, o sistema cria os arquivos necessários em `app_data/`.

Arquivos típicos:

```text
app_data/
├── sistema3d.sqlite
├── auth_sessions.sqlite
├── auth_config.json
├── backup_config.json
├── backups/
└── attachments/
```

### Comportamento inicial

- SQLite é o banco padrão;
- autenticação pode permanecer desativada para uso local individual;
- os dados são armazenados localmente;
- configurações podem ser preenchidas pela interface;
- o Service Worker registra os recursos do PWA.

---

## Configuração inicial recomendada

Antes de criar pedidos, revise as seguintes áreas.

### Empresa e parâmetros gerais

Em **Configurações**, informe:

- nome da empresa ou marca;
- dados de contato;
- prazo padrão;
- parâmetros de alerta;
- moeda e preferências operacionais.

### Custos

Configure:

- energia elétrica;
- custo/hora da impressora;
- vida útil;
- depreciação;
- manutenção;
- mão de obra;
- margem desejada;
- taxa de falha;
- taxas de marketplaces.

### Impressoras

Cadastre:

- nome;
- modelo;
- valor;
- potência;
- vida útil estimada;
- velocidade média;
- integração Bambu, quando aplicável.

### Materiais

Cadastre:

- material;
- cor;
- fabricante;
- peso inicial;
- peso disponível;
- preço da bobina/resina;
- estoque mínimo.

### Embalagens e adicionais

Cadastre itens recorrentes usados na precificação:

- caixas;
- envelopes;
- etiquetas;
- ímãs;
- parafusos;
- chaveiros;
- iluminação;
- acabamento;
- outros componentes.

---

## Bancos de dados suportados

### SQLite

É o padrão e não exige servidor externo.

Arquivo:

```text
app_data/sistema3d.sqlite
```

Indicado para:

- uso individual;
- instalação local;
- pequeno volume;
- facilidade de backup;
- ambiente de testes.

### PostgreSQL

Indicado para:

- maior volume de dados;
- acesso por múltiplas estações;
- ambiente servidor;
- administração e backup centralizados.

Exemplo conceitual de conexão:

```text
postgresql+psycopg://usuario:senha@localhost:5432/sistema3d
```

Configuração disponível em:

```text
Configurações → Banco de dados
```

### Microsoft SQL Server

Indicado para ambientes corporativos que já utilizam a plataforma Microsoft.

Exemplo conceitual:

```text
mssql+pyodbc://usuario:senha@servidor:1433/sistema3d
```

Requer:

- `pyodbc`;
- Microsoft ODBC Driver 18;
- acesso de rede ao servidor;
- banco e usuário previamente configurados.

### Troca de banco

O fluxo previsto é:

```text
Configurar conexão
    ↓
Testar conexão
    ↓
Criar/evoluir tabelas
    ↓
Migrar dados existentes
    ↓
Validar integridade
    ↓
Ativar provedor
```

Faça backup antes de qualquer migração.

---

## Módulos do sistema

### Dashboard

Visão executiva com:

- faturamento;
- lucro;
- pedidos;
- produção;
- valores a receber;
- impressoras em atividade;
- alertas;
- estoque baixo;
- consignações;
- gráficos e destaques.

### Calculadora de preços

A Calculadora estima o preço de venda a partir de:

- tipo de serviço;
- projeto;
- peso;
- tempo de impressão;
- quantidade;
- impressora;
- material;
- purga e trocas de cor;
- energia;
- depreciação;
- manutenção;
- taxa de falha;
- mão de obra;
- pós-processamento;
- embalagem;
- adicionais;
- comissão de marketplace;
- frete;
- urgência;
- dificuldade;
- margem.

O painel de resultados apresenta:

- preço sugerido;
- custo total;
- lucro;
- margem;
- detalhamento de custos;
- ações para criar produto, pedido ou orçamento.

### Produtos

- nome e SKU;
- categoria;
- descrição;
- material;
- peso;
- tempo de impressão;
- custo;
- preço;
- estoque;
- estoque mínimo;
- imagens;
- modo de produção;
- exclusão lógica;
- criação de pedido a partir do produto.

### Pedidos

- cliente;
- produto;
- material;
- impressora;
- quantidade;
- peso;
- preço;
- lucro;
- frete;
- canal de venda;
- valor pago;
- status;
- notas;
- falhas de impressão;
- histórico;
- linha do tempo;
- pagamento parcial;
- vínculo com produção.

### Produção

Kanban com etapas como:

```text
Aprovado
Pago
Imprimindo
Pós-processamento
Embalagem
Enviado
Entregue
```

Os cards podem apresentar:

- cliente;
- produto;
- material;
- peso;
- quantidade;
- tempo;
- impressora;
- prioridade;
- progresso.

### Orçamentos

- cliente;
- descrição;
- quantidade;
- preço unitário;
- total;
- frete;
- validade;
- status;
- mensagem de WhatsApp;
- conversão para pedido;
- histórico paginado.

### Clientes

Aba **Dados do cliente**:

- nome;
- telefone;
- e-mail;
- CPF/CNPJ;
- CEP;
- logradouro;
- número;
- complemento;
- cidade;
- estado.

Aba **Consignação**:

- ativação como consignatário;
- nome do local;
- comissão padrão;
- contato;
- telefone;
- endereço;
- prazo padrão.

A busca de CEP pode preencher automaticamente os dados de endereço.

### Materiais

- tipo e nome;
- fabricante;
- cor;
- preço;
- quantidade;
- custo por grama;
- estoque mínimo;
- consumo;
- movimentações;
- alertas.

### Impressoras

- nome e modelo;
- preço de aquisição;
- potência;
- vida útil;
- horas utilizadas;
- velocidade média;
- custo/hora;
- vínculo com pedidos;
- integração Bambu Lab;
- status livre/ocupada/pausada/offline;
- progresso;
- camada;
- tempo restante;
- temperaturas.

### Manutenção

- item;
- descrição;
- custo;
- vida útil;
- custo por hora;
- ativo/inativo;
- impacto automático na Calculadora.

### Embalagens

- nome;
- descrição;
- custo;
- peso;
- uso na precificação e frete.

### Adicionais

- nome;
- categoria;
- custo unitário;
- descrição;
- ativação por switch na Calculadora;
- quantidade por adicional.

### Consignações

O fluxo de consignação exige:

1. cliente configurado como consignatário;
2. local vinculado ao cliente;
3. produto cadastrado;
4. quantidade disponível;
5. comissão e prazo;
6. registro de vendas/devoluções;
7. acerto financeiro.

O módulo controla:

- produto enviado;
- quantidade enviada;
- quantidade vendida;
- quantidade devolvida;
- quantidade restante no local;
- comissão;
- valor bruto;
- valor do local;
- valor líquido do proprietário;
- custo e lucro;
- prazo e vencimento.

### Financeiro

- receita de pedidos;
- receita líquida de consignações;
- despesas;
- resultado líquido;
- lucro bruto;
- margem;
- ticket médio;
- contas a receber;
- pagamentos parciais;
- comissão de consignatários;
- visão mensal.

### Despesas

- categoria;
- descrição;
- valor;
- data;
- recorrência mensal/anual;
- geração de ocorrências futuras;
- integração ao fluxo financeiro.

### Relatórios

- evolução mensal;
- receita;
- lucro;
- despesas;
- resultado;
- top clientes;
- materiais mais usados;
- pedidos por tipo;
- utilização das impressoras;
- exportação.

### Marketplaces

Área para configurações e produtos vinculados a canais de venda.

### Radar de Produtos

O Radar funciona como um CRM de oportunidades.

Abas:

- Visão geral;
- Descobrir;
- Pipeline;
- Histórico;
- Critérios.

Fluxo:

```text
Descoberta
    ↓
Validação
    ↓
Protótipo
    ↓
Venda teste
    ↓
Produto
```

A oportunidade pode registrar:

- nome;
- termo de pesquisa;
- nicho;
- mercado;
- tags;
- preço observado;
- preço desejado;
- custos;
- taxas;
- lucro;
- margem;
- demanda;
- novidade;
- personalização;
- saturação;
- dificuldade;
- evidências;
- observações;
- anexos;
- etapa.

Fontes de pesquisa assistida podem incluir:

- Etsy;
- Amazon;
- Pinterest;
- Google Trends;
- MakerWorld;
- Printables;
- Thingiverse;
- Shopee;
- Mercado Livre;
- Google Shopping.

---

## Fluxos de trabalho

### Do cálculo ao pedido

```text
Preencher Calculadora
    ↓
Revisar preço e margem
    ↓
Salvar como orçamento ou pedido
    ↓
Aprovação/pagamento
    ↓
Enviar para Produção
```

### Do orçamento ao pedido

```text
Criar orçamento
    ↓
Enviar ao cliente
    ↓
Marcar como aceito
    ↓
Converter para pedido
    ↓
Produção
```

### Venda consignada

```text
Configurar consignação no cliente
    ↓
Criar consignação
    ↓
Selecionar produto e quantidade
    ↓
Baixar estoque
    ↓
Registrar vendas/devoluções
    ↓
Calcular comissão
    ↓
Integrar ao Financeiro
    ↓
Finalizar acerto
```

### Da oportunidade ao catálogo

```text
Pesquisar oportunidade
    ↓
Criar registro no Radar
    ↓
Pontuar e validar
    ↓
Criar protótipo
    ↓
Realizar venda teste
    ↓
Converter em produto
```

---

## Integrações

Todas as integrações são opcionais.

### Bambu Lab

A integração utiliza MQTT local e exige que a impressora esteja acessível na mesma rede.

Dados necessários:

- IP;
- serial;
- access code.

Informações exibidas quando disponíveis:

- conexão;
- estado;
- nome do trabalho;
- progresso;
- camada;
- tempo restante;
- temperatura do bico;
- temperatura da mesa.

A configuração principal é persistida na tabela de impressoras. Arquivos JSON antigos podem existir apenas por compatibilidade/migração.

### Melhor Envio

Configuração em:

```text
Configurações → Frete
```

Campos típicos:

- ambiente sandbox/produção;
- token;
- CEP de origem;
- serviços;
- User-Agent.

Recursos:

- cotação de frete;
- uso dos dados do pacote;
- fallback para regras locais quando necessário.

### Etsy

A integração oficial exige uma API key aprovada pelo Etsy.

Enquanto a chave estiver pendente, o Radar pode operar em modo de pesquisa assistida, abrindo links externos.

### Mercado Livre

A integração utiliza OAuth.

Campos típicos:

- App ID;
- Client Secret;
- URL pública/callback;
- tokens gerenciados pelo backend.

Ambientes estritamente locais podem ter limitações para callback OAuth. Nesses casos, utilize uma URL HTTPS pública/túnel compatível com as exigências do Mercado Livre.

---

## Autenticação e segurança

### Autenticação opcional

A autenticação pode ficar desativada em instalações individuais.

Quando ativada:

- usuários possuem e-mail, nome, perfil e situação;
- senhas são armazenadas como hash PBKDF2;
- sessões persistem em banco separado;
- APIs sensíveis exigem sessão válida;
- rate limiting reduz tentativas de força bruta.

Arquivo de configuração:

```text
app_data/auth_config.json
```

Banco de sessões:

```text
app_data/auth_sessions.sqlite
```

### Headers de segurança

O servidor inclui proteções como:

- Content Security Policy;
- bloqueio de iframe;
- `nosniff`;
- política de referência;
- restrição de recursos sensíveis;
- validação de origem/Host.

### Proteção de Host

O servidor valida o cabeçalho `Host` para reduzir risco de DNS Rebinding.

São aceitos normalmente:

- localhost;
- 127.0.0.1;
- ::1;
- IPs privados autorizados.

Para permitir nomes adicionais:

```bash
S3D_ALLOWED_HOSTS=sistema3d.local,meu-servidor.local python server.py --host 0.0.0.0
```

### Recomendações para acesso em rede

- ative autenticação;
- use firewall;
- não exponha a porta 8080 diretamente na internet;
- para acesso externo, utilize HTTPS e proxy reverso;
- mantenha tokens fora do repositório;
- faça backups regulares.

---

## API REST

A API oferece endpoints de autenticação, banco, backup, integrações e recursos relacionais.

### Autenticação

```text
GET  /api/auth/status
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/setup
```

### Banco e plataforma

```text
GET  /api/platform
GET  /api/db/status
GET  /api/db
POST /api/db
GET  /api/database/config
POST /api/database/config
POST /api/database/test
```

### Backups

```text
GET  /api/backup/config
POST /api/backup/config
GET  /api/backup/list
POST /api/backup/run
```

### Integrações

```text
GET/POST /api/bambu-config
GET      /api/bambu-status
GET/POST /api/etsy-config
GET      /api/etsy-search
GET/POST /api/ml-config
GET      /api/ml-oauth-start
GET      /api/ml-oauth-callback
GET/POST /api/melhor-envio/config
POST     /api/melhor-envio/calculate
```

### Anexos

```text
POST /api/attachments/upload
GET  /api/attachments/download
POST /api/attachments/delete
```

### API relacional

Padrão CRUD:

```text
GET    /api/relational/{recurso}
GET    /api/relational/{recurso}/{id}
POST   /api/relational/{recurso}
PUT    /api/relational/{recurso}/{id}
DELETE /api/relational/{recurso}/{id}
```

Recursos incluem, entre outros:

- clients;
- products;
- materials;
- orders;
- quotes;
- expenses;
- printers;
- maintenance_items;
- failed_prints;
- notifications;
- attachments;
- audit_log;
- users;
- roles;
- consignments.

### Relatórios e resumos

```text
GET /api/relational/finance
GET /api/relational/reports
GET /api/relational/integrity
GET /api/relational/consignments-summary
GET /api/v1/summary
```

### Transações compostas

```text
POST /api/relational/transactions/order
POST /api/relational/transactions/payment
POST /api/relational/transactions/consignment-create
POST /api/relational/transactions/consignment-return
POST /api/relational/transactions/consignment-settlement
```

Essas operações garantem que alterações relacionadas sejam confirmadas ou revertidas em conjunto.

---

## PWA e funcionamento offline

O projeto inclui:

- `manifest.webmanifest`;
- `service-worker.js`;
- ícones de 192 e 512 pixels;
- cache de Bootstrap, ícones, JavaScript, CSS e partials.

### Instalação

Em Chrome/Edge, procure o botão de instalação na barra superior ou na barra de endereço.

### Limitações offline

A interface pode abrir com recursos em cache, porém funcionalidades que dependem do backend Python, banco remoto ou integrações não funcionam sem o servidor.

O modo offline deve ser entendido principalmente como:

- disponibilidade da interface;
- cache local;
- continuidade temporária;
- não como substituição integral do backend.

### Atualização de cache

Após atualizar arquivos visuais ou scripts:

1. reinicie o servidor;
2. use `Ctrl + Shift + R`;
3. se necessário, limpe os dados do site;
4. remova Service Workers antigos no DevTools.

---

## Backups e recuperação

O serviço de backup pode operar:

- manualmente;
- diariamente;
- semanalmente;
- a cada salvamento;
- com retenção máxima configurável.

Diretório:

```text
app_data/backups/
```

### Boas práticas

- mantenha cópias fora da pasta do sistema;
- copie backups para outro disco;
- teste a restauração periodicamente;
- faça backup antes de migrar de banco;
- não confie apenas em sincronização de nuvem;
- pare o servidor antes de copiar manualmente o banco, quando possível.

---

## Estrutura de diretórios

```text
3dsistem/
├── index.html
├── server.py
├── platform_utils.py
├── requirements.txt
├── iniciar.sh
├── iniciar_windows.bat
├── manifest.webmanifest
├── service-worker.js
│
├── server_core/
│   ├── api_service.py
│   ├── auth_service.py
│   ├── backup_service.py
│   ├── config_store.py
│   ├── database_backend_service.py
│   ├── database_service.py
│   ├── relational_service.py
│   ├── validators.py
│   └── integrations/
│       ├── attachments_service.py
│       ├── bambu_service.py
│       ├── etsy_service.py
│       ├── melhor_envio_service.py
│       └── mercado_livre_service.py
│
├── partials/
│   ├── dashboard.html
│   ├── calculator.html
│   ├── products.html
│   ├── orders.html
│   ├── production.html
│   ├── quotes.html
│   ├── clients.html
│   ├── inventory.html
│   ├── printers.html
│   ├── maintenance.html
│   ├── packaging.html
│   ├── addons.html
│   ├── consignments.html
│   ├── finance.html
│   ├── expenses.html
│   ├── reports.html
│   ├── marketplaces.html
│   ├── insights.html
│   └── settings.html
│
├── js/
│   ├── db.js
│   ├── relational-api.js
│   ├── relational-sync.js
│   ├── rest-modules.js
│   ├── calculator.js
│   ├── products.js
│   ├── orders.js
│   ├── production.js
│   ├── quotes.js
│   ├── clients.js
│   ├── materials.js
│   ├── printers.js
│   ├── maintenance.js
│   ├── packaging.js
│   ├── addons.js
│   ├── consignments.js
│   ├── finance.js
│   ├── expenses.js
│   ├── reports.js
│   ├── insights.js
│   ├── bambu.js
│   ├── shipping.js
│   ├── settings-ui.js
│   ├── security-ui.js
│   ├── sql-wasm.js
│   └── sql-wasm.wasm
│
├── css/
│   ├── sistema3d.css
│   └── arquivos legados não carregados
│
├── assets/
│   ├── icon-192.png
│   └── icon-512.png
│
├── vendor/
│   ├── bootstrap.min.css
│   ├── bootstrap.bundle.min.js
│   └── bootstrap-icons/
│       ├── bootstrap-icons.min.css
│       └── fonts/
│           ├── bootstrap-icons.woff
│           └── bootstrap-icons.woff2
│
└── app_data/
    ├── .gitkeep
    ├── sistema3d.sqlite
    ├── auth_sessions.sqlite
    ├── auth_config.json
    ├── backup_config.json
    ├── backups/
    └── attachments/
```

### Hosts adicionais

```bash
S3D_ALLOWED_HOSTS=sistema3d.local,servidor.interno
```

### Exemplo de inicialização em rede local

```bash
S3D_ALLOWED_HOSTS=sistema3d.local python server.py --host 0.0.0.0 --port 8080
```

Use autenticação e firewall ao disponibilizar o sistema na rede.

---

## Solução de problemas

### A interface abre sem estilo ou sem ícones

Verifique:

```text
/vendor/bootstrap.min.css
/vendor/bootstrap-icons/bootstrap-icons.min.css
/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2
```

Todos devem responder HTTP 200.

Depois:

- use `Ctrl + Shift + R`;
- limpe o cache do site;
- remova o Service Worker antigo.

### `bi-pencil` ou outros ícones não aparecem

Confirme que o `index.html` carrega o arquivo oficial:

```html
<link rel="stylesheet" href="vendor/bootstrap-icons/bootstrap-icons.min.css">
```

E não o fallback simplificado antigo.

### Erro ao carregar `sql-wasm.wasm`

Confirme:

```text
/js/sql-wasm.wasm
```

O servidor precisa enviar a CSP com suporte a WebAssembly (`wasm-unsafe-eval`).

### Erro 421 Misdirected Request

O hostname usado não foi autorizado.

Acesse por:

```text
http://127.0.0.1:8080
```

Ou defina:

```bash
S3D_ALLOWED_HOSTS=nome-do-host
```

### Erro 503 ao salvar SQLite

Possíveis causas:

- arquivo bloqueado no Windows;
- antivírus;
- pasta sincronizada;
- duas instâncias do servidor;
- schema incompatível;
- falta de permissão.

Ações:

1. encerre todas as instâncias;
2. mova o projeto para uma pasta local simples;
3. verifique permissões;
4. reinicie o servidor;
5. revise o log completo;
6. restaure um backup se necessário.

### Dados desaparecem ao fechar

- sempre abra pelo servidor;
- não abra `index.html` diretamente;
- aguarde a confirmação de salvamento;
- verifique `app_data/sistema3d.sqlite`;
- não execute duas cópias do sistema apontando para a mesma pasta;
- confirme que o navegador não está em modo privado.

### Login entra em loop

- confirme que cookies estão habilitados;
- verifique `app_data/auth_sessions.sqlite`;
- limpe cookies antigos;
- reinicie o servidor;
- mantenha data/hora do computador corretas;
- verifique o endpoint `/api/auth/status`.

### Bambu aparece duplicada

Verifique:

- registros duplicados por serial na tabela de impressoras;
- arquivos JSON antigos;
- mesmo serial vinculado a IDs diferentes.

A configuração deve ser deduplicada pelo serial e, na ausência dele, pelo IP.

### Impressora aparece livre durante impressão

- confirme a conexão MQTT;
- confirme IP, serial e access code;
- veja os logs `[Bambu]`;
- valide `/api/bambu-status`;
- confirme que não há script antigo sobrescrevendo o card;
- faça atualização forçada do frontend.

### PostgreSQL não conecta

```bash
pip install "psycopg[binary]"
```

Verifique host, porta, usuário, senha, banco, firewall e SSL.

### SQL Server não conecta

```bash
pip install pyodbc
```

Verifique:

- ODBC Driver 18;
- porta 1433;
- TCP/IP no SQL Server;
- firewall;
- certificado;
- usuário e permissões.

### Melhor Envio retorna erro

- confirme token e ambiente;
- confirme CEP de origem;
- revise peso e dimensões;
- veja a resposta completa do endpoint;
- valide se o token pertence ao ambiente correto.

### Etsy retorna 403

A API key pode estar pendente ou o Etsy pode bloquear consultas públicas. Use a API oficial aprovada ou o modo assistido do Radar.

### Mercado Livre OAuth não conclui

A URL de callback precisa atender às exigências da plataforma. Um IP local pode não ser aceito. Utilize HTTPS público/túnel quando necessário.

---

## Desenvolvimento

### Iniciar em modo local

```bash
python server.py --host 127.0.0.1 --port 8080
```

### Iniciar para a rede local

```bash
python server.py --host 0.0.0.0 --port 8080
```

Use com autenticação e firewall.

### Verificar sintaxe Python

```bash
python -m compileall server.py server_core platform_utils.py
```

### Verificar integridade do SQLite

```bash
python - <<'PY'
import sqlite3
con = sqlite3.connect('app_data/sistema3d.sqlite')
print(con.execute('PRAGMA quick_check').fetchone()[0])
con.close()
PY
```

Resultado esperado:

```text
ok
```

---

## Roadmap sugerido

O projeto já possui uma base funcional extensa. Evoluções futuras podem incluir:

- testes automatizados de backend e frontend;
- migrações formais com Alembic;
- Docker e Docker Compose;
- proxy reverso HTTPS;
- logs estruturados;
- importação/exportação completa;
- internacionalização;
- melhor acessibilidade;
- documentação OpenAPI;
- fila assíncrona para tarefas demoradas;
- sincronização multiestação;
- painel de permissões mais granular;
- métricas e observabilidade;
- integração com outros fabricantes de impressoras;
- integração com outros marketplaces.

---

## Limitações conhecidas

- o frontend ainda mantém componentes de compatibilidade com `sql.js`;
- PWA offline não substitui o backend;
- OAuth do Mercado Livre pode exigir URL pública HTTPS;
- API Etsy depende de aprovação da chave;
- telemetria Bambu depende da rede local e do protocolo disponibilizado;
- instalação SQL Server exige driver de sistema;
- acesso multiusuário exige banco e rede corretamente configurados;
- não é recomendado expor o servidor Python diretamente à internet.

---

## Contribuição

Sugestão de fluxo:

```bash
git checkout -b feature/minha-funcionalidade
# faça as alterações
git add .
git commit -m "feat: descreve a funcionalidade"
git push origin feature/minha-funcionalidade
```

Antes do pull request:

- valide sintaxe Python;
- valide JavaScript no navegador;
- teste o banco;
- confirme que não há segredos;
- atualize documentação;
- descreva impacto em SQLite/PostgreSQL/SQL Server.

---

## Autor

**Manoel Guilherme de Faria Moraes**

Projeto desenvolvido para apoiar a gestão prática de operações de impressão 3D, reunindo tecnologia, automação, controle financeiro e inteligência de mercado.

---

## Aviso

Este software deve ser avaliado e testado antes do uso em produção. O responsável pela instalação deve definir políticas de backup, segurança, acesso, privacidade e conformidade adequadas ao seu ambiente.
