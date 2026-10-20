# Effinance

Sistema financeiro pessoal com visual SaaS clean (inspirado no Graniq, em azul-marinho):
contas e carteiras, cartões de crédito com faturas, categorias e subcategorias com ícones e cores,
metas, contatos, contas a pagar/receber com parcelas, recorrências e lançamentos fixos, extrato por
conta, transferências e investimentos, e relatórios com insights.

## Stack

| Camada    | Tecnologias |
| --------- | ----------- |
| Frontend  | React 19, TypeScript, Vite, Tailwind CSS v4, TanStack Query, React Router, react-hook-form + Zod, Radix UI, Recharts, lucide |
| Backend   | Node.js 22, Fastify 5, Zod (type provider), Drizzle ORM, PostgreSQL 16, JWT em cookie httpOnly |
| Contrato  | `packages/shared` — schemas Zod, tipos de resposta e regras (datas, dinheiro, fatura, recorrência) usados pelos dois lados |
| Testes    | Vitest (unitários no shared, integração da API contra Postgres real) |

## Estrutura

```
apps/
  api/         Fastify + Drizzle (rotas em /api)
  web/         SPA React (Vite, porta 5173, proxy /api → 3333)
packages/
  shared/      contrato compartilhado
docs/
  api.md             endpoints e regras de negócio
  design-system.md   tokens, componentes e padrões de tela
.claude/agents/      agentes por função (backend, frontend, UI designer)
```

## Rodando localmente

Pré-requisitos: Node 22+, pnpm 10+, PostgreSQL 16 (ou Docker).

```bash
pnpm install

# banco (opção Docker)
docker compose up -d db

# configuração da API
cp apps/api/.env.example apps/api/.env

# migrações + dados de demonstração
pnpm db:migrate
pnpm db:seed          # usuário demo@effinance.app / demo12345

# API (3333) + Web (5173)
pnpm dev
```

Acesse http://localhost:5173.

## Scripts

| Comando           | O que faz |
| ----------------- | --------- |
| `pnpm dev`        | API e Web em modo watch |
| `pnpm typecheck`  | checagem de tipos em todos os pacotes |
| `pnpm test`       | testes (a API usa o banco `effinance_test`, veja `apps/api/.env.example`) |
| `pnpm build`      | build de produção (API em `apps/api/dist`, Web em `apps/web/dist`) |
| `pnpm db:migrate` | aplica as migrações do Drizzle |
| `pnpm db:seed`    | cria/recria o usuário de demonstração com dados realistas |

## Funcionalidades

1. **Categorias e subcategorias** de receitas e despesas, com ícone e cor.
2. **Contas**: corrente, poupança, carteira, benefício, investimento; saldo atual e previsto.
3. **Cartões de crédito**: banco (ícones dos principais bancos), bandeira, limite, dia de
   fechamento e vencimento; faturas por mês, limite usado/disponível e pagamento de fatura.
4. **Metas** com aportes, progresso e quanto guardar por mês até o prazo.
5. **Contatos** com nome, CPF/CNPJ (validado), endereço, e-mail e telefone.
6. **Extrato** diário, semanal ou mensal por conta (ou todas), com saldo inicial, saldo após cada
   lançamento e saldo previsto.
7. **Contas a pagar** e **8. contas a receber**: valor, categoria/subcategoria, vencimento,
   descrição, observação, contato, conta de pagamento, 👍 pago / 👎 pendente (padrão), recorrência
   semanal/mensal/semestral/anual, parcelamento e lançamento fixo mensal (gerado mês a mês nos
   relatórios e projeções).
9. **Transferências** entre contas, **aplicações e resgates** em contas de investimento (saldo
   investido somado à parte).
10. **Relatórios**: visão geral com insights, evolução e projeção por categoria, totais e evolução
    por contato, comparação entre períodos, fluxo de caixa realizado × previsto, saúde financeira.
