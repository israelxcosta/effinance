# Histórico de decisões do Effinance

Memória do projeto entre sessões. Um hook (`.claude/settings.json`, `SessionStart`) injeta este
arquivo no contexto ao iniciar, retomar, limpar ou compactar a conversa.

**Como manter:** registre cada decisão nova (o quê, por quê, onde) na seção do tema e uma linha no
diário no fim. Seja curto: o arquivo inteiro entra no contexto. Detalhes ficam nos commits e em
`docs/`.

## Preferências do usuário

- Conversar **somente em pt-BR**. Código, nomes e comentários em inglês; UI em pt-BR.
- Antes de concluir qualquer trabalho: `pnpm typecheck && pnpm test`.
- Commits grandes vêm em etapas `wip(...)` (checkpoints "não verificado") seguidas de um commit
  consolidado e verificado que lista o que foi testado.

## Estado atual

- Branches: `claude/stoic-keller-ozk4zt` (onde o trabalho segue) e `claude/ecstatic-bell-m0uo3h`
  (padrão do repositório, parado em `8f74015`).
- Último marco verificado: polimento visual de 2026-11-25 (212 testes da API, 94 da web, 10 do
  shared); antes dele, `8f74015` (revisão de segurança da importação e do Open Finance).
- Ambiente de nuvem próprio **"effinance"** (env_01EvZFr3XSCbLfmo2Z858ur7): libera `uizze.sh` e tem
  script de preparo (Postgres com senha `postgres`, bancos `effinance` e `effinance_test`,
  `pnpm install`, `.env`). Ao começar: `service postgresql start`.
- **Instalador Windows:** rascunho de release "Effinance para Windows (teste)" (tag `desktop-latest`,
  só para quem tem acesso ao repo), recriado a cada push que toca o app; 1º build verde em 699b9f1.
- Relatório da auditoria visual: https://claude.ai/artifact/BP1CRYFMPbyznXLa4ySeto
- **Demo publicada** (artifact privado no claude.ai, mesmo link sempre):
  https://claude.ai/artifact/GpG6q9Df2QALZExqP9Xtqv (republicada com o polimento em 2026-11-25,
  `publish_files` em modo `replace`). Login `demo@effinance.app` / `demo12345`
  (espaço "Família Costa" compartilhado com `rafael@effinance.app`).
- Pendências: PRs do Dependabot #1 (Postgres 16→18 no compose) e #2 (Node 22→26 na imagem) estão
  abertos e **não devem ser aceitos sem testes**: o projeto e o guia AWS fixam Node 22 e PG 16
  (o banco local deve casar com o RDS).

## Decisões por tema

### Arquitetura

- Monorepo pnpm: `packages/shared` é o contrato (Zod, tipos, catálogos, utilitários) e muda
  primeiro; `apps/api` (Fastify 5 + Drizzle + PostgreSQL 16); `apps/web` (React 19 + Vite +
  Tailwind v4 + TanStack Query).
- Dinheiro em centavos inteiros; datas de calendário `YYYY-MM-DD`.
- Agentes por função em `.claude/agents/` (backend, frontend, UI) e quatro especialistas de
  segurança por linguagem/camada (Node API, React web, Postgres/SQL, infra/supply chain).

### Regras financeiras

- Recorrência e lançamentos fixos são materializados sob demanda, com escopos
  esta/próximas/todas.
- "Recorrente" sem quantidade (vazio ou 0) é uma série sem fim; a opção "Fixa mensal" saiu do
  formulário.
- Compra no cartão só fica "vencida" quando a fatura vence, não na data da compra.
- **Decisão do usuário (2026-11-26):** compras parceladas entram nos relatórios e nas categorias **mês a
  mês, pelas parcelas** (regime de caixa): 1.000 em 5x = 200/mês em Vestuário, não 1.000 na compra.
  Nada de chave "pela compra / pelas parcelas" por enquanto (foi proposta e adiada). Despesas comuns
  contam pelo **vencimento** (Dashboard, categorias, comparação); Extrato e Fluxo de caixa usam a data
  de **pagamento** ("Pago em").
- Antecipação de parcelas: as últimas parcelas pendentes passam para hoje (no cartão, entram na
  fatura aberta).
- Divisão de um lançamento em 2 a 10 categorias: uma transação por parte, ligadas por
  `split_group_id`.
- Mês ativo global (guardado por aba): vale para contas a pagar e receber, extrato,
  transferências, faturas e relatórios. Visões de vários meses ficam locais à tela.

### Visual (UI)

- Estilo Graniq em azul-marinho, fonte Plus Jakarta Sans e logo em minúsculas ("effinance").
- Modo escuro neutro (preto, grafite e off-white), sem o azul da marca.
- Despesas em tons de vermelho.
- Topbar sem busca nem selo PRO; o sino fica na barra flutuante de ações.
- **Pedido do usuário:** barra flutuante **só com ícones** (web e desktop), com dica e nome acessível
  em cada um; despesa = menos (vermelho), receita = mais (verde), para não depender só da cor.
- Select customizado (Radix) com a API do select nativo, para funcionar com o react-hook-form.
- **Pedido do usuário (2026-11-26):** calendário de datas com cantos arredondados. O seletor nativo do
  navegador não aceita estilo, então todo `type="date"` virou `<DateInput>` (`components/ui/date-input.tsx`):
  campo dd/mm/aaaa que aceita digitação + popover arredondado (raio 2xl, dias em círculo, escolha de mês
  e ano, Limpar/Hoje, teclado como o nativo, `min`/`max`). Mesma API do input nativo (valor ISO,
  `register` do react-hook-form), como o Select. Lógica pura em `lib/calendar.ts` com testes.
- **Pedido do usuário (2026-11-26):** "Nova categoria" (no lançamento e na página de categorias) tem o
  campo **Categoria pai**: "Nenhuma" cria categoria principal; escolher uma cria subcategoria (herda tipo,
  ícone e cor do pai, editáveis). O texto buscado no seletor vira o nome sugerido. A API já validava.
- **Pedido do usuário (2026-11-26):** no dashboard, o card **Eficiência** deu lugar a **Contas atrasadas**,
  card vermelho sólido (`KpiCard tone="danger"`) com o total e a quantidade de despesas pendentes já
  vencidas (qualquer mês), levando a `/contas-a-pagar?status=overdue`. Contas vencidas **saíram dos
  insights** (`reports/insights.ts`). Textos dos insights encurtados (título ≤ 40, descrição ≤ 90
  caracteres, testado) e o InsightCard mantém altura fixa ao trocar com as setas.
- **Pedido do usuário (2026-11-26), aprovado "do jeito que está":** aba **Evolução** em Relatórios
  (`GET /reports/evolution`, `evolution-tab.tsx`): categorias × meses/trimestres/anos (6–36 meses até o
  mês ativo), receitas e despesas com subcategorias, % da receita, mapa de calor, Média/Total fixos à
  direita, Resultado com "% guardado", exportação CSV (pt-BR, `;`, BOM, proteção contra fórmulas) e
  clique no valor abrindo contas a pagar/receber filtradas. Valores neutros e **com centavos**.
  Médias dividem só pelos períodos com movimento (meses antes do primeiro lançamento não diluem).
- **Pedido do usuário (2026-11-26):** nada de barra de rolagem horizontal. Evolução sem minigráficos
  (pedido) e sempre cabendo no card (`lib/evolution-layout.ts`: tira centavos, depois mostra só os
  períodos mais recentes que cabem, com aviso; exportação mantém tudo). Abas de Relatórios,
  Configurações, Transferências e Comparação viram Select em tela estreita
  (`ResponsiveSegmentedControl`); tabelas escondem colunas secundárias no celular/tablet. Varredura
  em 1440/1280/1024/768/390 px sem rolagem horizontal.
- **Pedido do usuário (2026-11-26):** no seletor de categoria, digitar com o campo focado abre a lista
  com o texto na busca; ao abrir por clique, o foco vai para a busca.
- **Pedido do usuário (2026-11-26):** botão direito (ou toque longo) no 👎 e o menu "…" da linha têm
  **"Pagar/Receber outro valor…"**. Valor menor: o lançamento passa a ser o valor pago (só esta
  ocorrência; a série segue com o previsto). Valor maior: o lançamento mantém o previsto e a diferença
  vira um lançamento **já pago**, na data do pagamento, "Juros e multa — <descrição>", na subcategoria
  **Juros e multas** (em Impostos e taxas; criada automaticamente em espaços antigos) ou na categoria
  escolhida. Em receitas, a diferença vai para a categoria do próprio lançamento por padrão.
  **Ajuste do usuário (2026-11-26):** juros e multa só quando **pago depois do vencimento**, com chave
  "Lançar como juros e multa" (ligada por padrão, pode desligar). Em dia, ou com a chave desligada, o valor
  maior **corrige o próprio lançamento** (correção de valor, consumo maior em contas fixas). API:
  `differenceAs` ('fees' | 'amount'); 'fees' em dia é recusado.
- **Pedido do usuário (2026-11-26):** página **Investimentos** (`/investimentos`, menu lateral), só com o
  **cadastro das compras** por enquanto: ativo/ticker (maiúsculas), tipo (ação, FII, ETF, BDR, renda fixa,
  cripto, outro), nome, corretora (conta do tipo Investimento, opcional), data, quantidade (até 8 casas;
  "1.500" = mil e quinhentos), preço por unidade e taxas. Posição por ticker com quantidade, total
  investido e **preço médio com taxas** (`packages/shared/utils/portfolio.ts`); o formulário mostra o
  preço médio antes/depois de "Comprar mais". Tabela `investment_purchases` (migração 0007, RLS como as
  demais, exportação LGPD). As compras **não** mexem em saldos nem lançamentos. Sem cotação por enquanto
  (proposta brapi.dev adiada pelo usuário); vendas e dividendos ficam para depois.
- **Pedido do usuário (2026-11-26):** espaçamentos do Dashboard inteligente: Saúde financeira ocupa a
  altura do card de Insights (medidor centralizado); insight ímpar ocupa a linha toda; "Fixas x variáveis"
  cresce com a linha; legenda dos donuts com largura máxima e centralizada em cards largos.
- **Polimento de 2026-11-25 (skill `ui-taste` do uizze.sh, em `.claude/skills/ui-taste`):** escala de
  tipos fechada em 8 tokens (`text-2xs` 11, `xs` 12, `label` 13, `sm` 14, `title` 15, `lg` 18,
  `heading` 22, `display` 26), sem `text-[Npx]`; `cn()` registra a escala no tailwind-merge (senão
  `text-title` apaga `text-danger`, com teste em `lib/utils.test.ts`). Cores de texto escurecidas para
  AA no tema claro (success `#0D7A3D`, danger `#C92F35`, warning `#8F5C12`, muted `#5F636A`, subtle
  `#73777E`); gráficos usam `chart-positive/negative`. Alturas: barra de filtros 40, formulário 44,
  compacto 32. Raios só da escala (aninhado = externo − padding).
- **Pedido do usuário:** valores dos cards de total (KpiCard, MiniStat, saldos do extrato) **alinhados
  à direita**.
- Linha de lançamento no celular (< 448px de container): sem ícone de categoria, valor na linha do
  nome, categoria e prazo numa linha só.
- Regra de cor de valor: receita `success`, despesa/vencido `danger`, `warning` só para "a pagar/vence
  em breve", investimento `brand-text`, resto neutro. Texto sobre preenchimento success/danger usa
  `text-on-semantic` (branco no claro, `#1E1E1E` no escuro).
- Estilos de html/body fora de `@layer`, para que o esqueleto do artifact do claude.ai não os
  sobrescreva.

### Demo sem servidor

- `vite build --mode demo` gera `apps/web/dist-demo`: as rotas reais da API rodam no navegador
  sobre o PGlite, com IndexedDB por navegador, seed na primeira carga e roteamento por hash.
- O bundle de arquivos do PGlite vai como `assets/pglite-fs.txt` (gzip+base64), porque há hosts
  que recusam `.data`. Por isso, ao publicar, **não envie `assets/pglite-*.data`**.
- A demo não tem CSP `<meta>`: o host a embute no próprio HTML. A chave mestra da demo é pública
  e fixa.
- Para forçar o re-seed nos navegadores que já têm dados antigos, suba `SEED_VERSION` em
  `apps/web/src/demo/server.ts`.
- **Publicar ou atualizar:** `pnpm --filter @effinance/web build:demo` e republicar
  `dist-demo/index.html` com os `assets/` no **mesmo artifact** (URL acima), sem o `.data`.

### Effinance para Windows (desktop)

- `apps/desktop` (Electron 45 + electron-builder NSIS) carrega o build `vite build --mode desktop`
  (`dist-desktop`) pelo protocolo `app://effinance/`. Flags em `lib/demo.ts`: `IS_LOCAL_API` (API no
  navegador, rotas por hash), `IS_DESKTOP`, `IS_DEMO = local && !desktop`.
- Banco PGlite em `idb://effinance`, **sem relaxedDurability**, sem seed; chave mestra aleatória do
  Electron (DPAPI/safeStorage); "licença local" (trigger em `subscriptions` → sempre ativa,
  `business_monthly`); Open Finance desligado; aba Assinatura vira **Backup**; sem "Esqueci a senha".
- **Pedido do usuário:** no desktop **não há espaços (Família/Empresa) nem membros**: some a seção
  "Espaços"/"Novo espaço" do menu da conta e do menu "Mais", e a aba Membros. A web (SaaS) mantém.
- **Pedido do usuário:** backup **automático ao fechar**, em **texto (.txt)**, guardando os **últimos
  30 dias** (um arquivo por dia: `effinance-backup-AAAA-MM-DD.txt`), no computador
  (`Documentos\Effinance\Backups`) e no Google Drive (pasta "Effinance Backups").
- Formato: `EFFINANCE-BACKUP 1` + cabeçalho JSON + base64 de AES-256-GCM(gzip(JSON {masterKey,
  snapshot})); senha do backup → PBKDF2-SHA256 600k; cabeçalho autenticado (AAD). O snapshot é JSON
  de todas as tabelas (`json_agg`), restaurado com `json_populate_recordset` numa transação com
  `session_replication_role = replica` (`apps/web/src/desktop/snapshot.ts`).
- **Decisão do usuário: backup na nuvem automático, sem instalar nada e sem sincronizar pasta**
  (Google Drive para computador e OneDrive foram descartados). Caminho: **Entrar com Google** dentro
  do app → upload direto pela API do Drive a cada fechamento (pasta "Effinance Backups", 30 dias).
  O registro OAuth ("App para computador") é feito **uma vez por quem publica** e embutido no
  instalador pelos secrets do GitHub; sem ele, o botão fica desativado e as credenciais podem ser
  coladas em "Avançado".
- OAuth de app instalado (navegador do sistema, loopback 127.0.0.1,
  PKCE), escopo **só `drive.file`**. Credenciais do Google Cloud digitadas no app ou embutidas no build pelos secrets
  `GOOGLE_OAUTH_CLIENT_ID/SECRET`. Publicar o app OAuth "Em produção" (no modo Teste o token expira em
  7 dias).
- Instalador: workflow `.github/workflows/desktop.yml` (windows-latest) → rascunho de release
  `desktop-latest` (via `gh`, sem action de terceiros). No Linux o NSIS exige Wine 32 bits.
- Teste ponta a ponta com o Electron real (Xvfb + CDP): criar conta, lançar despesa, senha, fechar →
  backup de ~6 KB; perfil novo restaura e mostra a despesa. Fechar por `window.close()` ou SIGTERM
  não dispara o evento `close`; usar `BrowserWindow.close()` (inspetor do main).

### SaaS e segurança

- Workspaces (pessoal, família ou empresa) com papéis owner, editor e viewer, e convites por link.
- PostgreSQL compartilhado com **RLS forçada**: cada requisição roda em transação com o papel
  `effinance_app` e `app.workspace_id` fixado. Os testes usam papel de privilégio mínimo.
- Criptografia de envelope por workspace (local ou AWS KMS), AES-256-GCM com AAD e índice cego
  HMAC para CPF/CNPJ. Excluir o workspace destrói a chave.
- Sessões: access token de 15 min e refresh rotativo com detecção de reuso; 2FA TOTP com códigos
  de recuperação; sessão de no máximo 90 dias.
- Cobrança via Mercado Pago, com webhook HMAC e status sempre reconsultado; provedor `fake` em
  dev e na demo. Sem assinatura válida, o espaço fica somente leitura (402).
- Auditoria de segurança consolidada em `9614352`: 29 achados na API, 11 no SQL, 11 na web e 19
  na infra.
- Supply chain: pnpm fixado por hash, `minimumReleaseAge` de 24 h, `strictDepBuilds`, imagens
  por digest e CI com gitleaks.

### Importação e Open Finance

- Importação de OFX/CSV (Nubank, Inter, Itaú, Bradesco, C6 e genérico), com prévia de
  duplicados, idempotência por `externalId` e lotes que podem ser desfeitos.
- Open Finance via agregador **Pluggy**, somente leitura (provedor simulado em dev, testes e
  demo). Tombstones evitam recriar o que o usuário apagou.
- Limites contra ReDoS e travamento: até 201 colunas, 20 mil linhas e 3000 transações OFX.
- Só quem conectou o banco, ou o proprietário, pode revogar ou renovar a conexão.

## Diário

- 2026-10-20: base do monorepo, API, web, demo PGlite, SaaS multi-tenant e auditoria de
  segurança.
- 2026-10-21: importação OFX/CSV, Open Finance e revisão de segurança (`8f74015`). Demo publicada
  no artifact.
- 2026-10-21: a conversa anterior foi apagada por engano; o código estava salvo no GitHub. Na
  nova sessão, o ambiente foi conferido (typecheck e testes verdes) e o build da demo era idêntico
  ao publicado. Criados este histórico, o hook de leitura automática e a regra de conversar só em
  pt-BR.
- 2026-11-25: instalada a skill `ui-taste` (uizze.sh); auditoria visual publicada e polimento aplicado
  (tipos, cores AA, alturas, raios, totais à direita, linha de lançamento no celular).
- 2026-11-25: app para Windows (Electron) com banco local e backup cifrado ao fechar (30 dias, local +
  Google Drive); instalador gerado pelo GitHub Actions.
- 2026-11-25: barra flutuante só com ícones; desktop sem espaços compartilhados nem aba Membros.
- 2026-11-25: pasta sincronizada removida; o backup na nuvem é só "Entrar com Google" (API do Drive),
  com o registro OAuth embutido no instalador.
- 2026-11-25: registro OAuth do Google criado pelo usuário (projeto "My First Project" da organização
  efficio.com.br, Externo, Em produção, escopo só `drive.file`, domínio autorizado efficio.com.br) e
  secrets `GOOGLE_OAUTH_CLIENT_ID/SECRET` no GitHub; o instalador passa a sair com "Entrar com Google"
  pronto. Ícone do app estava ignorado pelo `.gitignore` (`build/`): liberado `apps/desktop/build/`.
  Pendência: página de Política de Privacidade real em efficio.com.br (hoje aponta para a home).
- 2026-11-26: SmartScreen ("O Windows protegeu o computador") é esperado sem assinatura de código;
  assinar (Azure Trusted Signing ou certificado OV) fica para quando outras pessoas instalarem.
- 2026-11-26: calendário próprio `<DateInput>` no lugar do seletor de data nativo em todas as telas.
- 2026-11-26: criar subcategoria direto do lançamento (campo "Categoria pai" em Nova categoria).
- 2026-11-26: dashboard com card vermelho de contas atrasadas (no lugar de Eficiência); insights mais curtos e sem vencidas.
- 2026-11-26: parceladas seguem mês a mês pelas parcelas; chave de regime adiada pelo usuário.
- 2026-11-26: relatório **Evolução por categoria** (aba Evolução) implementado como o protótipo aprovado.
- 2026-11-26: telas sem rolagem horizontal (Evolução se ajusta à largura, abas viram Select); busca do seletor de categoria ao digitar.
- 2026-11-26: pagar outro valor (menor ajusta; maior lança juros e multa em categoria própria).
- 2026-11-26: linha de lançamento: coluna Conta/Cartão só em linhas largas (@4xl, 160→224 px); no card Próximos vencimentos a descrição aparece inteira.
- 2026-11-26: módulo **Investimentos** (compras e preço médio) e espaçamentos do Dashboard inteligente.
- 2026-11-26: juros e multa só com pagamento atrasado e chave para desligar.
- 2026-11-26: dashboard com o navegador ‹ mês › do extrato; clicar no nome abre grade de mês/ano (dia/semana: calendário; ano: lista de anos) em todas as telas com o navegador.
