# Effinance — API

Base: `/api` (o Vite faz proxy de `/api` → `http://localhost:3333` em desenvolvimento).
Autenticação: cookie httpOnly `effinance_token` (definido no login/registro) **ou**
`Authorization: Bearer <token>`. Todas as rotas exceto `/api/health` e `/api/auth/{register,login}`
exigem autenticação. Corpos e queries são validados pelos schemas de `@effinance/shared`
(`schemas.ts`); respostas seguem `types.ts`.

Valores monetários: **centavos inteiros**. Datas: `YYYY-MM-DD`. Meses: `YYYY-MM`.
Erros: `{ error, message, details? }` com status HTTP adequado (400, 401, 404, 409, 422, 429, 500).

| Método | Rota | Entrada | Resposta |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ status: 'ok' }` |
| POST | `/api/auth/register` | `registerSchema` | `AuthResponse` (201) — cria categorias padrão e a conta "Carteira" |
| POST | `/api/auth/login` | `loginSchema` | `AuthResponse` |
| POST | `/api/auth/logout` | — | 204 |
| GET | `/api/auth/me` | — | `User` |
| PUT | `/api/auth/me` | `updateProfileSchema` | `User` |
| GET | `/api/categories` | `categoryQuerySchema` | `CategoryWithChildren[]` |
| POST | `/api/categories` | `categoryInputSchema` | `Category` (201) |
| PUT | `/api/categories/:id` | `categoryUpdateSchema` | `Category` |
| DELETE | `/api/categories/:id` | — | 204 (409 se houver lançamentos → arquivar) |
| GET | `/api/accounts` | `accountQuerySchema` | `Account[]` |
| GET | `/api/accounts/:id` | — | `Account` |
| POST | `/api/accounts` | `accountInputSchema` | `Account` (201) |
| PUT | `/api/accounts/:id` | `accountInputSchema` | `Account` |
| DELETE | `/api/accounts/:id` | — | 204 (409 se houver lançamentos → arquivar) |
| GET | `/api/credit-cards` | `accountQuerySchema` | `CreditCard[]` |
| POST | `/api/credit-cards` | `creditCardInputSchema` | `CreditCard` (201) |
| PUT | `/api/credit-cards/:id` | `creditCardInputSchema` | `CreditCard` |
| DELETE | `/api/credit-cards/:id` | — | 204 (409 se houver lançamentos) |
| GET | `/api/credit-cards/:id/invoices?from=YYYY-MM&to=YYYY-MM` | — | `InvoiceSummary[]` |
| GET | `/api/credit-cards/:id/invoices/:month` | — | `Invoice` |
| POST | `/api/credit-cards/:id/invoices/:month/pay` | `payInvoiceSchema` | `Invoice` |
| GET | `/api/goals` | — | `Goal[]` |
| POST | `/api/goals` | `goalInputSchema` | `Goal` (201) |
| PUT | `/api/goals/:id` | `goalInputSchema` | `Goal` |
| DELETE | `/api/goals/:id` | — | 204 |
| GET | `/api/goals/:id/contributions` | — | `GoalContribution[]` |
| POST | `/api/goals/:id/contributions` | `goalContributionInputSchema` | `GoalContribution` (201) |
| DELETE | `/api/goals/:id/contributions/:contributionId` | — | 204 |
| GET | `/api/contacts` | `contactQuerySchema` | `Paginated<Contact>` |
| GET | `/api/contacts/:id` | — | `Contact` |
| POST | `/api/contacts` | `contactInputSchema` | `Contact` (201) |
| PUT | `/api/contacts/:id` | `contactInputSchema` | `Contact` |
| DELETE | `/api/contacts/:id` | — | 204 (lançamentos ficam sem contato) |
| GET | `/api/transactions` | `transactionQuerySchema` | `TransactionListResponse` |
| GET | `/api/transactions/:id` | — | `Transaction` |
| POST | `/api/transactions` | `transactionInputSchema` | `Transaction[]` (201) — todas as ocorrências criadas (e todas as partes, se dividido) |
| PUT | `/api/transactions/:id?scope=one\|future\|all` | `transactionUpdateSchema` | `Transaction` |
| PATCH | `/api/transactions/:id/paid` | `setPaidSchema` | `Transaction` |
| DELETE | `/api/transactions/:id?scope=one\|future\|all` | — | 204 |
| GET | `/api/transfers` | `transferQuerySchema` | `Paginated<Transaction>` |
| POST | `/api/transfers` | `transferInputSchema` | `Transaction` (201) — `transferKind` derivado (aplicação/resgate) |
| PUT | `/api/transfers/:id` | `transferInputSchema` | `Transaction` |
| DELETE | `/api/transfers/:id` | — | 204 |
| GET | `/api/statement` | `statementQuerySchema` | `StatementResponse` |
| GET | `/api/dashboard?month=YYYY-MM` | `dashboardQuerySchema` | `DashboardResponse` |
| GET | `/api/reports/overview` | `overviewReportQuerySchema` | `OverviewReportResponse` |
| GET | `/api/reports/categories` | `categoryReportQuerySchema` | `CategoryReportResponse` |
| GET | `/api/reports/contacts` | `contactReportQuerySchema` | `ContactReportResponse` |
| GET | `/api/reports/comparison` | `comparisonReportQuerySchema` | `ComparisonReportResponse` |
| GET | `/api/reports/cashflow` | `cashflowReportQuerySchema` | `CashflowReportResponse` |
| GET | `/api/search?q=` | `searchQuerySchema` | `SearchResponse` |

## Regras de negócio

- **Saldo da conta** = saldo inicial + receitas pagas − despesas pagas ± transferências pagas
  (data efetiva = `paidAt` quando pago, senão `date`). Compras no cartão **não** afetam contas; o
  pagamento da fatura é uma transferência `card_payment` que sai da conta.
- **Saldo em contas** soma contas não-investimento com `includeInTotal`; **investimentos** somam à
  parte. Transferir para conta de investimento = `investment` (aplicação); o inverso = `redemption`.
- **Parcelado**: N lançamentos criados de uma vez (`installmentNumber/Total`); com
  `installmentAmountMode = total` o valor é dividido e os centavos restantes vão para a 1ª parcela.
- **Recorrente**: frequência semanal/mensal/semestral/anual, com quantidade definida ou sem fim.
- **Divisão por categoria** (`splits`, 2–10 partes): o valor é distribuído entre categorias e a soma
  das partes deve ser igual ao total. Cria uma transação (ou série) por parte, com os mesmos dados
  (data, conta, status, repetição) e um `splitGroupId` em comum; relatórios por categoria somam cada
  parte na sua categoria. Cada parte pode ser editada ou excluída individualmente.
- **Fixa mensal**: série mensal sem fim. Séries sem fim são materializadas sob demanda até o fim do
  período consultado (mínimo hoje + 12 meses; teto hoje + 5 anos), então aparecem em extratos,
  relatórios e projeções de qualquer mês.
- **Escopo de edição/exclusão** em séries: `one` (só esta), `future` (esta e as próximas), `all`.
  Ocorrências já pagas não são alteradas por `future`/`all`. Excluir `future` encerra a série.
- **Vencido**: pendente com data anterior a hoje; compras no cartão só vencem quando a fatura
  delas vence (não pela data da compra).
- **Fatura**: identificada pelo mês de vencimento. Compra entra na primeira fatura cujo fechamento é
  posterior à data da compra. Pagar a fatura marca as compras como pagas e cria a transferência.
- **Relatórios por competência** (categorias, contatos, comparação, visão geral) usam `date` e
  incluem compras no cartão; **fluxo de caixa** usa a data efetiva e só movimentos de contas, com
  faturas pendentes projetadas no vencimento.
