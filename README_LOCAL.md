# Sistema 3D — versão local corrigida

Esta versão foi ajustada para uso local em `127.0.0.1`, sem login e sem necessidade de internet.

## Como iniciar

Linux/macOS:

```bash
python3 server.py
```

Windows:

```bat
python server.py
```

Depois acesse:

```text
http://127.0.0.1:8080
```

## O que foi melhorado

- Servidor local validando o SQLite antes de salvar.
- Limite de tamanho do banco para evitar sobrescrita acidental gigante.
- Backup automático antes de cada substituição do banco.
- Manutenção automática dos últimos 30 backups em `app_data/backups`.
- Status do banco inclui quantidade de backups.
- Aviso no terminal caso o sistema seja iniciado em host diferente de `127.0.0.1`.
- Ajustes de renderização para evitar que textos cadastrados quebrem a tela com HTML.
- Selects de clientes, materiais e impressoras agora usam `textContent` em vez de montar HTML direto.
- Tabela de movimentações de estoque criada: `stock_movements`.
- Estoque passa a registrar saídas, entradas manuais e estornos de pedido.
- Quando um pedido sai de produção/cancelado, o estoque pode ser estornado automaticamente.

## Onde ficam os dados

Banco principal:

```text
app_data/sistema3d.sqlite
```

Backups automáticos:

```text
app_data/backups/
```

## Observação importante

Para uso local, mantenha o servidor rodando em `127.0.0.1`. Evite usar `--host 0.0.0.0`, pois isso expõe o sistema para outros computadores da rede.
