# Effinance — API

Base: `/api` (o Vite faz proxy de `/api` → `http://localhost:3333` em desenvolvimento).
Autenticação: access token JWT de 15 min no cookie httpOnly `effinance_token` (definido no
login/registro/refresh) **ou** `Authorization: Bearer <token>`; renovação com o refresh token do cookie
`effinance_refresh` em `POST /api/auth/refresh` (veja "Autenticação e sessões"). Rotas públicas:
`/api/health`, `/api/auth/{register,login,mfa/verify,refresh,logout,password/forgot,password/reset}`,
`/api/invites/:token` (prévia), `/api/billing/plans` e o webhook do Mercado Pago. Corpos e queries são validados pelos schemas de `@effinance/shared`
(`schemas.ts`); respostas seguem `types.ts`.

Valores monetários: **centavos inteiros**. Datas: `YYYY-MM-DD`. Meses: `YYYY-MM`.
Erros: `{ error, message, details? }` com status HTTP adequado (400, 401, 402, 403, 404, 409, 415,
422, 429, 500).

| Método | Rota | Entrada | Resposta |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ status: 'ok' }` |
| POST | `/api/auth/register` | `registerSchema` | `AuthResponse` (201) — cria categorias padrão e a conta "Carteira" |
| POST | `/api/auth/login` | `loginSchema` | `AuthResponse` |
| POST | `/api/auth/logout` | — | 204 |
| GET | `/api/auth/me` | — | `MeResponse` (usuário + workspace ativo + lista) |
| PUT | `/api/auth/me` | `updateProfileSchema` | `MeUser` |
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
| POST | `/api/transactions/:id/anticipate` | `anticipateInstallmentsSchema` | `Transaction[]` — parcelas antecipadas |
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
| GET | `/api/search?q=` | `searchQuerySchema` | `SearchResponse` — descrição, nomes e CPF/CNPJ exato |

## Regras de negócio

- **Saldo da conta** = saldo inicial + receitas pagas − despesas pagas ± transferências pagas
  (data efetiva = `paidAt` quando pago, senão `date`). Compras no cartão **não** afetam contas; o
  pagamento da fatura é uma transferência `card_payment` que sai da conta.
- **Saldo em contas** soma contas não-investimento com `includeInTotal`; **investimentos** somam à
  parte. Transferir para conta de investimento = `investment` (aplicação); o inverso = `redemption`.
- **Parcelado**: N lançamentos criados de uma vez (`installmentNumber/Total`); com
  `installmentAmountMode = total` o valor é dividido e os centavos restantes vão para a 1ª parcela.
- **Antecipação de parcelas** (`count` opcional, padrão todas; `date` opcional, padrão hoje): move as
  últimas `count` parcelas pendentes posteriores a esta para `date`. No cartão, entram na fatura que
  recebe compras feitas nessa data (a fatura aberta atual). Só para `installment`; 422 se não houver
  parcelas futuras pendentes.
- **Recorrente**: frequência semanal/mensal/semestral/anual, com quantidade definida (`recurring`).
  Sem quantidade (vazio ou 0 na interface) vira `fixed`.
- **Divisão por categoria** (`splits`, 2–10 partes): o valor é distribuído entre categorias e a soma
  das partes deve ser igual ao total. Cria uma transação (ou série) por parte, com os mesmos dados
  (data, conta, status, repetição) e um `splitGroupId` em comum; relatórios por categoria somam cada
  parte na sua categoria. Cada parte pode ser editada ou excluída individualmente.
- **Fixa** (`fixed`): série sem fim na frequência escolhida (mensal por padrão). Séries sem fim são
  materializadas sob demanda até o fim do
  período consultado (mínimo hoje + 12 meses; teto hoje + 5 anos), então aparecem em extratos,
  relatórios e projeções de qualquer mês.
- **Escopo de edição/exclusão** em séries: `one` (só esta), `future` (esta e as próximas), `all`.
  Edição: ocorrências já pagas não são alteradas por `future`/`all`. Exclusão: `future` remove esta e
  as próximas pendentes e encerra a série (anteriores ficam no histórico); `all` remove a série
  inteira, inclusive as pagas.
- **Vencido**: pendente com data anterior a hoje; compras no cartão só vencem quando a fatura
  delas vence (não pela data da compra).
- **Fatura**: identificada pelo mês de vencimento. Compra entra na primeira fatura cujo fechamento é
  posterior à data da compra. Pagar a fatura marca as compras como pagas e cria a transferência.
- **Relatórios por competência** (categorias, contatos, comparação, visão geral) usam `date` e
  incluem compras no cartão; **fluxo de caixa** usa a data efetiva e só movimentos de contas, com
  faturas pendentes projetadas no vencimento.

---

# SaaS: workspaces, segurança e assinaturas

Contrato em `packages/shared/src/saas.ts`.

## Modelo de isolamento

- **Workspace = assinante (tenant).** Todo dado financeiro (categorias, contas, cartões, metas e
  aportes, contatos, séries e lançamentos) pertence a um workspace (`workspace_id`). Um usuário pode
  participar de vários workspaces (o pessoal, criado no cadastro, e de família/empresa) com papel
  `owner`, `editor` ou `viewer`.
- **Row Level Security (PostgreSQL)**: as tabelas de domínio têm `ENABLE` + `FORCE ROW LEVEL
  SECURITY` com a política `workspace_id = current_setting('app.workspace_id')::uuid`. Cada
  requisição autenticada roda numa transação que executa `SET LOCAL ROLE effinance_app` (papel sem
  `BYPASSRLS`, nunca dono das tabelas) e `set_config('app.workspace_id', <ativo>, true)`. Um bug que
  esqueça o filtro na aplicação não vaza dados de outro assinante. Os filtros explícitos continuam
  (defesa em profundidade).
- **Criptografia de envelope**: cada workspace tem uma chave de dados (AES-256) própria, gerada e
  protegida pelo AWS KMS (`KEY_PROVIDER=aws`; em desenvolvimento, `local` com
  `ENCRYPTION_MASTER_KEY`). Campos sensíveis são gravados cifrados com AES-256-GCM (AAD =
  workspace + tabela + coluna): contatos (CPF/CNPJ, e-mail, telefone, endereço completo,
  observações), observações de lançamentos e metas, segredo TOTP do usuário (chave mestra). CPF/CNPJ
  tem índice cego (HMAC) para busca exata. Excluir o workspace apaga a chave (crypto-shredding).
- **Em trânsito e em repouso**: TLS obrigatório (`DATABASE_SSL=verify-full` com o CA do RDS);
  RDS com armazenamento e snapshots criptografados pelo KMS e backups com PITR.

## Autenticação e sessões

- Access token JWT curto (15 min) em cookie httpOnly `effinance_token` (path `/api`); refresh token
  opaco (30 dias) em cookie httpOnly `effinance_refresh` (path `/api/auth`), guardado como hash em
  `sessions`, **rotacionado a cada uso** e com detecção de reuso (revoga a família). A sessão dura no
  máximo 90 dias, mesmo renovada. Logout, troca de senha e "encerrar sessão" revogam no servidor;
  trocar a senha também invalida links de redefinição pendentes.
- 2FA por TOTP (aplicativo autenticador) com códigos de recuperação de uso único (PBKDF2). Cada
  código é consumido de forma atômica (sem reuso em requisições simultâneas). Ativar exige `password`
  em `/auth/mfa/enable`, salvo login feito há menos de 15 min (`422` pede a senha).
- Recuperação de senha por e-mail: link `${APP_URL}/redefinir-senha#token=…` (o token fica no
  fragmento, fora de logs e do `Referer`), uso único, 30 min, guardado como hash.
- Senhas: scrypt; novas senhas com 10+ caracteres, letras e números.
- Limites (429): por IP em login/2FA/recuperação/convites/exportação/checkout/webhook (Redis
  opcional via `REDIS_URL` para múltiplas instâncias); por conta, 10 falhas de código 2FA a cada
  15 min e 5 e-mails de redefinição por hora (a resposta continua 204); 20 convites por workspace por
  hora; até 10 workspaces próprios por usuário.
- CSP restritiva e `Cache-Control: no-store` nas respostas da API; requisições que alteram dados
  exigem JSON e origem permitida (CSRF).
- Cabeçalho opcional `X-Workspace-Id`: o web envia o workspace exibido; uma gravação (fora de
  `/api/auth/`) para outro workspace → `409 workspace_mismatch` (outra aba trocou a sessão).
- Conflitos de unicidade/integridade (convite pendente repetido, dono único) → `409`.
- Log de auditoria (login, 2FA, membros, assinatura, exportação, exclusões) sem dados pessoais; os
  logs da aplicação removem parâmetros SQL, CPF em buscas, tokens no caminho e e-mails.

## Permissões e assinatura

- `viewer` só lê; `editor` altera dados financeiros; `owner` também gerencia membros, assinatura e
  exclusão. Violação → `403 forbidden`.
- Gravações exigem assinatura válida: `trialing` (14 dias, sem cartão), `active` ou `past_due` dentro
  da carência de 7 dias. Fora disso → `402 subscription_required` (leitura e exportação continuam).
- Limite de membros por plano ao convidar.

## Endpoints novos

| Método | Rota | Entrada | Resposta |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | `registerSchema` (com `acceptTerms`) | `AuthResponse` (201) — cria o workspace pessoal em teste |
| POST | `/api/auth/login` | `loginSchema` | `AuthResponse` ou `MfaChallengeResponse` |
| POST | `/api/auth/mfa/verify` | `mfaVerifySchema` | `AuthResponse` |
| POST | `/api/auth/refresh` | — (cookie) | 204 |
| POST | `/api/auth/logout` | — | 204 (revoga a sessão) |
| GET | `/api/auth/me` | — | `MeResponse` |
| PUT | `/api/auth/me` | `updateProfileSchema` | `MeUser` |
| DELETE | `/api/auth/me` | `deleteAccountSchema` | 204 — exclui a conta e os workspaces em que é o único proprietário |
| POST | `/api/auth/password` | `changePasswordSchema` | 204 — revoga as outras sessões |
| POST | `/api/auth/password/forgot` | `forgotPasswordSchema` | 204 (sempre) |
| POST | `/api/auth/password/reset` | `resetPasswordSchema` | 204 |
| GET | `/api/auth/sessions` | — | `SessionInfo[]` |
| DELETE | `/api/auth/sessions/:id` | — | 204 |
| POST | `/api/auth/mfa/setup` | — | `MfaSetupResponse` |
| POST | `/api/auth/mfa/enable` | `mfaCodeSchema` | `MfaEnableResponse` |
| POST | `/api/auth/mfa/disable` | `mfaCodeSchema` | 204 |
| POST | `/api/auth/switch-workspace` | `switchWorkspaceSchema` | `MeResponse` |
| GET | `/api/workspaces` | — | `WorkspaceSummary[]` |
| POST | `/api/workspaces` | `workspaceInputSchema` | `WorkspaceSummary` (201, em teste) |
| PUT | `/api/workspaces/current` | `workspaceUpdateSchema` | `WorkspaceSummary` (owner) |
| DELETE | `/api/workspaces/current` | `deleteWorkspaceSchema` | 204 (owner; cancela assinatura e destrói a chave) |
| GET | `/api/workspaces/current/members` | — | `Member[]` |
| PATCH | `/api/workspaces/current/members/:userId` | `memberRoleSchema` | `Member` (owner) |
| DELETE | `/api/workspaces/current/members/:userId` | — | 204 (owner remove; membro pode sair) |
| GET | `/api/workspaces/current/invites` | — | `Invite[]` (owner) |
| POST | `/api/workspaces/current/invites` | `inviteInputSchema` | `Invite` (201, owner) |
| DELETE | `/api/workspaces/current/invites/:id` | — | 204 (owner) |
| GET | `/api/invites/:token` | — | `InvitePreview` (público) |
| POST | `/api/invites/:token/accept` | — | `MeResponse` (e-mail do convite = e-mail logado) |
| GET | `/api/workspaces/current/export` | — | JSON com todos os dados decifrados (owner, LGPD) |
| GET | `/api/workspaces/current/audit` | `auditQuerySchema` | `Paginated<AuditLogEntry>` (owner) |
| GET | `/api/billing/plans` | — | `Plan[]` |
| GET | `/api/billing/subscription` | — | `Subscription` |
| POST | `/api/billing/checkout` | `checkoutSchema` | `CheckoutResponse` (owner) |
| POST | `/api/billing/cancel` | — | `Subscription` (owner; cancela ao fim do período) |
| POST | `/api/billing/webhooks/mercadopago` | notificação MP | 200 (assinatura `x-signature` verificada, idempotente) |
| POST | `/api/billing/dev/activate` | `checkoutSchema` | `Subscription` — só com `BILLING_PROVIDER=fake` (dev/demo) |

## Detalhes de implementação

- **Fronteira de tenant**: as rotas financeiras são montadas por `lib/tenant-routes.ts`, que autentica,
  verifica permissão de escrita (papel + assinatura) e abre a transação RLS exposta como `req.db`.
  Os serviços recebem `(db, workspaceId, …)`. Workspaces, membros, convites, sessões e assinaturas
  não ficam sob RLS: são acessados pelo login da API, com checagem explícita de papel.
- **Busca com dados cifrados**: observações não são pesquisáveis (a busca de lançamentos usa só a
  descrição). Contatos: busca parcial por nome ou exata por CPF/CNPJ (índice cego); e-mail e
  telefone não são pesquisáveis.
- **Limite de membros**: plano pago → `maxMembers` do plano; em teste → 1 (pessoal), 5 (família),
  15 (empresa). Membros + convites pendentes acima do limite → `422`. Convites pedem assinatura
  com escrita liberada (`402`).
- **Regras de exclusão**: o espaço pessoal só sai junto com a conta (`422`); o proprietário não pode
  sair do próprio espaço (`422`); excluir/sair troca a sessão para outro espaço do usuário.
- **Convite**: `POST /invites/:token/accept` exige o mesmo e-mail do convite (`403` caso contrário),
  vale 7 dias e uso único; o token só existe no link (guardado como SHA-256).
- **Assinatura**: o checkout grava `pending` (o teste continua valendo até acabar); cancelar mantém
  o acesso até `currentPeriodEnd`. `POST /billing/dev/activate` responde `404` fora do provedor fake.
- **Refresh**: um token já rotacionado reapresentado em até 10 s (requisições simultâneas da mesma
  aba) recebe `204` sem novos cookies; depois disso é tratado como roubo e revoga a sessão inteira.
  Se o membro foi removido do workspace da sessão, o refresh troca para outro workspace dele.
- **Corpo vazio**: `Content-Type: application/json` com corpo vazio é aceito como "sem corpo".
- **Dados legados**: `db:migrate` gera as chaves dos workspaces migrados e cifra campos ainda em
  texto puro (idempotente). A demo faz o mesmo ao abrir uma base antiga do IndexedDB.
- **Demo (PGlite)**: mesmas rotas e serviços, inclusive RLS e criptografia (chave mestra fixa e
  pública da demo), sessão no `localStorage` e provedor de pagamento fake.

## Mercado Pago (assinaturas)

`POST /preapproval` com `external_reference = workspaceId`, `payer_email`, `auto_recurring`
(valor e frequência do plano, BRL) e `back_url` → o usuário paga no `init_point`. Webhooks
`subscription_preapproval` / `subscription_authorized_payment` / `payment`: valida `x-signature`
(HMAC-SHA256 de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` com `MP_WEBHOOK_SECRET`), grava
o evento (idempotência) e consulta `GET /preapproval/:id` para obter o status oficial:
`authorized → active`, `paused → past_due`, `cancelled → canceled`, `pending → pending`.
