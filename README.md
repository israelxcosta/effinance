# Effinance

Sistema financeiro pessoal com visual SaaS clean (inspirado no Graniq, em azul-marinho):
contas e carteiras, cartões de crédito com faturas, categorias e subcategorias com ícones e cores,
metas, contatos, contas a pagar/receber com parcelas, recorrências e lançamentos fixos, extrato por
conta, transferências e investimentos, e relatórios com insights.

## Stack

| Camada    | Tecnologias |
| --------- | ----------- |
| Frontend  | React 19, TypeScript, Vite, Tailwind CSS v4, TanStack Query, React Router, react-hook-form + Zod, Radix UI, Recharts, lucide |
| Backend   | Node.js 22, Fastify 5, Zod (type provider), Drizzle ORM, PostgreSQL 16 (Row Level Security), sessões com refresh token rotativo, 2FA, criptografia de envelope (AWS KMS) |
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
  deploy-aws.md      produção na AWS (RDS, KMS, ECS, CloudFront, WAF, SES, Mercado Pago)
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
pnpm db:seed          # demo@effinance.app / demo12345 (espaço "Família Costa" com rafael@effinance.app)

# API (3333) + Web (5173)
pnpm dev
```

Acesse http://localhost:5173.

## Ambiente de testes (sem servidor)

`pnpm --filter @effinance/web build:demo` gera em `apps/web/dist-demo` uma versão estática e completa
do sistema: as mesmas rotas e regras da API rodam no navegador sobre o PGlite (PostgreSQL em
WebAssembly). Cada navegador ganha sua própria base, salva no IndexedDB e já preenchida com os dados
de demonstração; o login vem preenchido com a conta demo e um aviso permite restaurar os dados.

A pasta pode ser publicada em qualquer hospedagem estática (Netlify, Vercel, GitHub Pages, S3).
Para testar localmente: `pnpm --filter @effinance/web dev:demo`.

Para produção use a API real (Node + PostgreSQL): ela é a fonte da verdade, com autenticação por
cookie httpOnly e dados no servidor.

## Scripts

| Comando           | O que faz |
| ----------------- | --------- |
| `pnpm dev`        | API e Web em modo watch |
| `pnpm typecheck`  | checagem de tipos em todos os pacotes |
| `pnpm test`       | testes (a API usa o banco `effinance_test` e conecta com o papel de privilégio mínimo `effinance_api_test`, criado pelo setup) |
| `pnpm build`      | build de produção (API em `apps/api/dist`, Web em `apps/web/dist`) |
| `pnpm --filter @effinance/web build:demo` | build estático de testes, sem servidor (`apps/web/dist-demo`) |
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

## SaaS e segurança

- **Assinantes (workspaces)**: cada pessoa tem um espaço pessoal e pode criar espaços de Família ou
  Empresa e convidar membros como Editor ou Leitor. Todo dado financeiro pertence a um workspace.
- **Isolamento no banco**: PostgreSQL compartilhado com **Row Level Security** forçado nas tabelas
  financeiras. Cada requisição roda numa transação com o papel `effinance_app` e o workspace ativo
  fixado em `app.workspace_id`; mesmo uma consulta sem filtro não enxerga outro assinante. O login
  da API não tem acesso direto às tabelas financeiras (veja `docs/deploy-aws.md`).
- **Criptografia**: CPF/CNPJ, e-mail, telefone, endereço e observações de contatos, observações de
  lançamentos e metas são cifrados por campo (AES-256-GCM) com uma chave por workspace, protegida
  pelo AWS KMS em produção (`KEY_PROVIDER=aws`) ou por `ENCRYPTION_MASTER_KEY` em desenvolvimento.
  CPF/CNPJ continua pesquisável por igualdade (índice cego HMAC). Excluir um workspace destrói a
  chave. O segredo do 2FA é cifrado com a chave mestra.
- **Sessões**: access token de 15 min e refresh token rotativo (cookie `httpOnly` restrito a
  `/api/auth`) com detecção de reuso; logout, troca de senha e "encerrar sessão" revogam no
  servidor. 2FA por aplicativo autenticador com códigos de recuperação. Recuperação de senha por
  e-mail com link de uso único.
- **Proteções**: CSP restritiva e HSTS, verificação de origem e de JSON em toda escrita (CSRF),
  rate limit (Redis opcional para várias instâncias), log de auditoria sem dados pessoais.
- **Assinaturas**: Mercado Pago (assinaturas recorrentes); webhooks com assinatura HMAC verificada
  e status sempre reconsultado na API do Mercado Pago. Teste grátis de 14 dias; sem assinatura
  válida o espaço fica somente leitura (`402`). Em desenvolvimento e na demo, `BILLING_PROVIDER=fake`.
- **LGPD**: aceite dos termos no cadastro, exportação completa dos dados (JSON) e exclusão da conta
  e dos espaços.

Produção: imagem em `apps/api/Dockerfile` e passo a passo em [`docs/deploy-aws.md`](docs/deploy-aws.md).
