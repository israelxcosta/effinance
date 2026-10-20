# Effinance — Design System

> Mantido pelo agente `ui-saas-designer`. Referência: Graniq (graniq.com.br), com a cor de marca
> trocada de verde para **azul-marinho**. Os tokens abaixo existem como CSS variables em
> `apps/web/src/styles/index.css` e são expostos como utilitários do Tailwind v4 (`bg-surface`,
> `text-muted`, `border-border`, `bg-brand-800`...).

## 1. Tokens

### Cor de marca (azul-marinho)

| Token       | Hex       | Uso                                                      |
| ----------- | --------- | -------------------------------------------------------- |
| `brand-50`  | `#F1F5FD` | fundos muito suaves, hover de itens                      |
| `brand-100` | `#E3EAF8` | botão "soft" (ex.: Consultor), chips, item ativo sidebar |
| `brand-200` | `#C6D4F1` | bordas de destaque, barras de progresso (trilho)         |
| `brand-300` | `#9AB2E6` | gráfico de receita (barra listrada)                      |
| `brand-400` | `#6889D4` | ícones/realces no modo escuro                            |
| `brand-500` | `#3F64BE` | links, anel de foco                                      |
| `brand-600` | `#2A4C9F` | hover de botão primário                                  |
| `brand-700` | `#1E3A80` | texto de marca, rótulos de seção                         |
| `brand-800` | `#152B61` | **cor primária** (botão primário, aba ativa)             |
| `brand-900` | `#0F1F47` | gradiente do card de insights (fim)                      |
| `brand-950` | `#0A1530` | textos sobre fundo claro de marca                        |

### Neutros e semânticas (modo claro)

| Token            | Hex       | Uso                                         |
| ---------------- | --------- | ------------------------------------------- |
| `bg`             | `#F6F6F4` | fundo da aplicação (off-white quente)       |
| `bg-subtle`      | `#EFEFEC` | sidebar, trilho de segmentados              |
| `surface`        | `#FFFFFF` | cards, sheets, inputs                       |
| `surface-muted`  | `#F7F7F5` | rodapé de KPI, linhas zebradas, inputs read |
| `border`         | `#E7E7E3` | bordas padrão                               |
| `border-strong`  | `#D6D6D1` | bordas de input em hover, divisores fortes  |
| `text`           | `#16181D` | texto principal                             |
| `text-muted`     | `#6B6F76` | texto secundário                            |
| `text-subtle`    | `#9A9EA5` | placeholders, legendas                      |
| `success`        | `#12A150` | receita, variação positiva, 👍 pago          |
| `success-soft`   | `#E7F6ED` | fundo de "Melhor 👍"                         |
| `danger`         | `#E5484D` | despesa, variação negativa, 👎 pendente      |
| `danger-soft`    | `#FDECEC` | fundo de "Pior 👎"                           |
| `warning`        | `#B7791F` | alertas                                     |
| `warning-soft`   | `#FEF6DA` | banner de aviso                             |
| `chart-expense`  | `#F2A3A5` | barra de despesa (listrada, vermelho suave) |
| `chart-neutral`  | `#D4D4D8` | série neutra (ex.: período anterior)        |

### Modo escuro

Neutro, sem azul: fundo cinza escuro, cards e seções em cinza mais claro, texto off-white e tons
claros. A rampa `brand-*` vira uma rampa de cinzas **invertida** (50 = escuro … 950 = claro), então
`text-brand-700` continua legível e `bg-brand-50` continua um tom sutil; cards em degradê usam os
tokens `hero-*` (`from-hero-from via-hero-via to-hero-to`, destaque `text-hero-accent`).

| Token | Hex | Token | Hex |
| --- | --- | --- | --- |
| `bg` | `#1E1E1E` | `fg` | `#F4F3EF` (off-white) |
| `bg-subtle` | `#252525` | `text-muted` | `#CAC9C3` |
| `surface` | `#2B2B2B` | `text-subtle` | `#9C9B95` |
| `surface-muted` | `#323232` | `primary` | `#F4F3EF` com texto `#1E1E1E` |
| `border` | `#3B3B3B` | `primary-soft` | `#3B3B3B` |
| `border-strong` | `#4C4C4B` | gráfico receita/despesa | `#E3E2DD` / `#C4595D` |

O fundo, a cor e a fonte de `html`/`body` ficam **fora** de `@layer` em `index.css`, para que estilos
de quem hospeda o app (ex.: o esqueleto do artifact do claude.ai) não os sobrescrevam.

Cores escolhidas pelo usuário muito escuras (ex.: o azul-marinho padrão de categorias e metas) são
clareadas no modo escuro por `useTone()` (`src/lib/theme.tsx`) para continuarem legíveis.

### Tipografia

- Família: **Plus Jakarta Sans** (variable, via `@fontsource-variable/plus-jakarta-sans`),
  fallback `ui-sans-serif, system-ui`.
- Números: `font-variant-numeric: tabular-nums` em valores monetários e tabelas.

| Estilo       | Tamanho/peso                     | Uso                                   |
| ------------ | -------------------------------- | ------------------------------------- |
| Display      | 28–32px / 700, tracking -0.02em  | valores-herói ("R$ 9.680,00")         |
| H1 (página)  | 22px / 600                       | título de página                      |
| H2 (card)    | 15–16px / 600                    | "Fluxo de Caixa", "Resumo do período" |
| Body         | 14px / 400–500                   | texto geral                           |
| Small        | 12–13px / 400–500                | legendas, rodapés de KPI              |
| Overline     | 11px / 600, uppercase, 0.12em    | "PLANEJAMENTO", "OPORTUNIDADE"        |

### Forma e profundidade

- Raio: `sm 8px` (chips), `md 12px` (inputs, botões), `lg 16px` (cards internos), `xl 20px`
  (cards de seção), `2xl 24px` (sheets/contêiner principal), `full` (pílulas, avatares).
- Sombra: `xs 0 1px 2px rgb(16 24 40 / .04)`; `sm 0 1px 3px rgb(16 24 40 / .06)`;
  `lg 0 12px 32px -8px rgb(16 24 40 / .18)` (sheets, popovers, barra flutuante).
- Espaçamento: escala de 4px; padding de card 20–24px; gap de grid 16px (mobile 12px).
- Movimento: 150–200ms `cubic-bezier(.2,.8,.2,1)`; sheets deslizam da direita (240ms).

## 2. Layout (app shell)

- **Sidebar** fixa de 76px (`bg-subtle`, borda direita): logo "Effinance" em texto no topo; ícones
  `lucide` 20px em botões 44×44 com raio 12; ativo = `surface` + sombra xs; tooltip com o nome à
  direita; rodapé com Configurações e avatar com iniciais (menu de conta e tema).
- **Sem topbar**: cada página abre direto com seu cabeçalho (overline + título + descrição).
- **Conteúdo**: max-width 1440px, padding 24px, seções em cards `xl`.
- **Barra flutuante** inferior centralizada (pílula `surface`, sombra lg): busca/⌘K, ações rápidas
  `+ Despesa` (texto `danger`), `+ Receita` (texto `success`), `Transferir`, `Fatura` e, à direita,
  o sino de notificações (contas vencidas, com contador; o menu abre para cima).
- **Mobile** (< 1024px): sidebar vira navegação inferior; "Buscar" e "Contas vencidas" ficam no
  menu "Mais"; sheets em tela cheia.

## 3. Componentes

| Componente         | Especificação                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| Button             | variantes `primary` (brand-800), `soft` (brand-100/brand-800), `outline` (surface + border), `ghost`, `danger`; tamanhos sm 32 / md 40 / lg 44; raio md |
| SegmentedControl   | trilho `bg-subtle` raio md, item ativo `surface` + sombra xs; variante `solid` com ativo `brand-800` texto branco (abas principais) |
| Card               | `surface`, borda, raio xl, padding 20–24; header com título H2 + subtítulo small muted + ação à direita |
| KpiCard            | rótulo small + ícone info; valor Display; rodapé `surface-muted` com seta (TrendingUp/Down) colorida, "% vs mês anterior" e chevron |
| Input / Select     | altura 44, raio md, borda `border`, foco: borda `brand-500` + anel 3px `brand-500/15` |
| CategoryPicker     | campo único de categoria: lista com busca no topo, categorias como títulos de grupo e só subcategorias selecionáveis (rádio circular); categoria sem subcategorias é selecionável; rodapé "+ Nova categoria" |
| SplitEditor        | "Dividir" no campo Categoria: linhas categoria + valor (2–10), "Dividir igualmente", "+ Adicionar categoria" (já com o valor que falta) e faixa de conferência (Falta / Excede / Valores conferem) |
| Select (lista)     | nunca o menu nativo: lista própria (Radix) com raio xl, borda, sombra lg, padding 6px; itens com raio lg, destaque `bg-subtle` no hover/teclado, item escolhido em negrito com ✓; grupos com rótulo overline e divisor |
| MoneyInput         | prefixo "R$" muted, digitação da direita para a esquerda (centavos), tabular-nums |
| Sheet (lateral)    | 440px, raio 2xl à esquerda, header (título H2 + subtítulo muted + X), corpo rolável, rodapé fixo com `Cancelar` (ghost) e `Salvar` (primary) |
| PaidToggle         | botão 👍/👎: pendente (padrão) = `ThumbsDown` em `danger-soft`/`danger`; pago = `ThumbsUp` em `success-soft`/`success`; animação de "pop" ao alternar |
| Badge              | pílula 11–12px: `brand`, `success`, `danger`, `warning`, `neutral` (soft) |
| EmptyState         | caixa com borda tracejada raio lg, ícone em quadrado `bg-subtle`, título 14/600, descrição muted, botão outline |
| ProgressBar        | trilho `brand-100`, preenchimento `brand-800` (metas) ou `success`/`danger` (limite) |
| InsightCard        | gradiente `brand-700 → brand-900`, texto branco, cartão interno vidro (`white/8`, borda `white/12`), chip overline |
| BankLogo           | círculo com cor oficial aproximada do banco e sigla (Nu, Itaú, BB, Cx...) — sem marcas registradas |
| CategoryIcon       | quadrado raio md com fundo `cor/12%` e ícone lucide na cor da categoria |

## 4. Padrões de tela

- **Dashboard**: abas (Dashboard / Insights); "Resumo do período" com seletor mês/ano; KPIs
  (Receitas, Despesas, Saldo do mês, Taxa de economia); Fluxo de caixa (barras listradas, seletor
  D/S/M/A); Saúde financeira (gauge 0–1000); InsightCard; gastos por categoria (donut); próximos
  vencimentos; metas; cartões (uso do limite); saldo por conta.
- **Listas** (contas a pagar/receber, extrato): filtros em linha (período segmentado + navegação
  ‹ mês ›, conta, status), totais no topo em mini-KPIs, linhas com CategoryIcon, descrição, contato,
  vencimento, valor colorido e PaidToggle; ações por linha em menu "⋯".
- **Cadastros** (categorias, contas, cartões, metas, contatos): grade de cards ou tabela, criação/
  edição em Sheet.
- **Relatórios**: abas por análise, seletor de período global, gráficos Recharts com tooltips
  formatados em R$, tabelas de apoio e frases de insight.
