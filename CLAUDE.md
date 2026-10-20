# Effinance

Sistema financeiro pessoal (pt-BR). Monorepo pnpm:

- `packages/shared` — contrato: schemas Zod (`schemas.ts`), tipos de resposta (`types.ts`),
  catálogos (`constants.ts`: bancos, bandeiras, ícones, cores) e utilitários (datas, dinheiro,
  CPF/CNPJ, fatura, recorrência). **Altere o contrato primeiro.**
- `apps/api` — Fastify 5 + Drizzle + PostgreSQL. Ver `docs/api.md`.
- `apps/web` — React 19 + Vite + Tailwind v4 + TanStack Query. Ver `docs/design-system.md`.

## Agentes por função (`.claude/agents/`)

- `backend-senior` — API, banco, regras financeiras, testes de integração.
- `frontend-specialist` — telas, componentes, formulários, gráficos.
- `ui-saas-designer` — tokens, componentes e revisão visual (estilo Graniq em azul-marinho).

## Regras

- Dinheiro em centavos inteiros; datas de calendário como `YYYY-MM-DD`.
- Toda query do backend filtra por `userId`.
- UI em pt-BR; código em inglês.
- Antes de concluir: `pnpm typecheck && pnpm test` (API precisa de Postgres; veja README).
