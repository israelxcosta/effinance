# Deploy na AWS (produção)

Guia para colocar o Effinance no ar como SaaS na AWS com isolamento por assinante (RLS),
criptografia de envelope (KMS), TLS ponta a ponta e o mínimo de privilégio em cada peça.
Região sugerida: `sa-east-1` (São Paulo) — dados de brasileiros ficam no Brasil (LGPD).

## Arquitetura

```
                 Route 53 (effinance.com.br)
                          │
                 CloudFront + AWS WAF ──────────────── S3 (web estático, privado via OAC)
                          │  /api/*                       └─ headers de segurança (CSP, HSTS…)
                          ▼
            ALB (HTTPS, sub-redes públicas, só aceita o CloudFront)
                          │
            ECS Fargate — API Node (sub-redes privadas, 2+ tarefas em AZs diferentes)
              │            │             │              │
              ▼            ▼             ▼              ▼
     RDS PostgreSQL 16   AWS KMS     Secrets Manager   Amazon SES      (ElastiCache Redis,
     Multi-AZ, cifrado   (CMK dados)  (segredos)       (e-mails)        opcional: rate limit)
```

- **Mesmo domínio** para web e API (`/api/*` roteado pelo CloudFront para o ALB): os cookies
  `SameSite` funcionam sem exceções e o CORS fica restrito a uma origem.
- A API não tem IP público; o banco só aceita conexões do security group das tarefas da API.
- App Runner também serve (mais simples), mas ECS Fargate dá controle de rede (VPC privada,
  security groups) e de tarefas avulsas (migrações).

## Camadas de segurança

| Camada | Como |
| --- | --- |
| Isolamento entre assinantes | Workspace = tenant. Tabelas financeiras com `FORCE ROW LEVEL SECURITY`; cada requisição roda numa transação com `SET LOCAL ROLE effinance_app` + `app.workspace_id`. O usuário de login da API **não tem acesso direto** às tabelas financeiras (só via `effinance_app`). |
| Dados sensíveis | AES-256-GCM por campo com chave por workspace (envelope: chave de dados gerada e protegida pelo KMS, com *encryption context* = workspace). Excluir o workspace apaga a chave (crypto-shredding). |
| Em repouso | RDS, snapshots, backups e Performance Insights cifrados com KMS; S3 com SSE-KMS. |
| Em trânsito | TLS 1.2+ no CloudFront/ALB; `DATABASE_SSL=verify-full` + `rds.force_ssl=1`. |
| Sessões | Access token de 15 min + refresh token rotativo com detecção de reuso; cookies `httpOnly`, `Secure`, `SameSite`. 2FA (TOTP). |
| Aplicação | CSP restritiva, HSTS, verificação de origem/JSON (CSRF), rate limit (Redis), WAF, logs de auditoria sem dados pessoais. |
| Pagamentos | Mercado Pago (o cartão nunca passa pelo Effinance); webhooks com assinatura HMAC verificada e status sempre reconsultado. |

## Passo a passo

### 1. Rede (VPC)

1. VPC com 2–3 AZs: sub-redes **públicas** (ALB, NAT Gateway) e **privadas** (ECS, RDS, Redis).
2. Security groups:
   - `sg-alb`: entrada 443 apenas do prefix list gerenciado do CloudFront
     (`com.amazonaws.global.cloudfront.origin-facing`).
   - `sg-api`: entrada 3333 apenas de `sg-alb`.
   - `sg-db`: entrada 5432 apenas de `sg-api` (e do bastion/SSM, se houver).
   - `sg-redis`: entrada 6379 apenas de `sg-api`.
3. VPC endpoints (Interface) para KMS, Secrets Manager, ECR, CloudWatch Logs e SES: o tráfego com
   esses serviços não sai para a internet.

### 2. Chaves KMS

Crie duas *customer managed keys* (simétricas, rotação anual automática ligada):

- `alias/effinance-rds` — armazenamento do RDS, snapshots e Performance Insights.
- `alias/effinance-data` — envelope dos dados da aplicação (`KMS_KEY_ID`).

Política da `effinance-data` (trecho) — a role da tarefa só usa a chave com o contexto esperado:

```json
{
  "Sid": "ApiEnvelopeEncryption",
  "Effect": "Allow",
  "Principal": { "AWS": "arn:aws:iam::<conta>:role/effinance-api-task" },
  "Action": ["kms:GenerateDataKey", "kms:Decrypt", "kms:Encrypt"],
  "Resource": "*",
  "Condition": {
    "ForAnyValue:StringEquals": { "kms:EncryptionContextKeys": ["workspaceId", "purpose"] }
  }
}
```

Administradores da chave (rotação, desativação) devem ser outra role, sem permissão de uso.
Ative o CloudTrail com *data events* do KMS para auditar cada uso.

### 3. Banco (RDS PostgreSQL 16)

- Multi-AZ, classe `db.t4g.medium`+ (ajuste ao uso), armazenamento gp3 cifrado com
  `alias/effinance-rds`, backups automáticos com **PITR de 35 dias**, *deletion protection*,
  Performance Insights cifrado, minor upgrades automáticos.
- Parameter group: `rds.force_ssl = 1`, `log_min_duration_statement = 1000`,
  `password_encryption = scram-sha-256`.
- Sem acesso público; senha do usuário mestre gerenciada pelo Secrets Manager.

Papéis do banco (como usuário mestre, uma vez):

```sql
-- Dono do schema: só migrações usam este login.
CREATE ROLE effinance_owner LOGIN PASSWORD '<gerada>';
GRANT effinance_owner TO CURRENT_USER;
CREATE DATABASE effinance OWNER effinance_owner;
\c effinance
REVOKE ALL ON DATABASE effinance FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Papel das requisições de tenant (sem login, sem BYPASSRLS). A migração 0003 também o cria
-- se não existir; aqui ele nasce antes para o dono poder concedê-lo.
CREATE ROLE effinance_app NOLOGIN NOBYPASSRLS;
GRANT effinance_app TO effinance_owner WITH ADMIN OPTION;

-- Login da API: NOINHERIT = nenhum privilégio de effinance_app sem SET ROLE explícito.
CREATE ROLE effinance_api LOGIN NOINHERIT NOBYPASSRLS PASSWORD '<gerada>';
GRANT CONNECT ON DATABASE effinance TO effinance_owner, effinance_api;
GRANT effinance_app TO effinance_api;
```

Depois de rodar as migrações (passo 6), como `effinance_owner`:

```sql
GRANT USAGE ON SCHEMA public TO effinance_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, workspaces, workspace_members, workspace_invites, subscriptions,
  billing_events, sessions, password_resets, audit_logs
TO effinance_api;
-- Tabelas financeiras: NENHUM grant para effinance_api. Só effinance_app (com RLS).
```

A suíte de testes da API roda exatamente com esse modelo (`test/global-setup.ts` cria um
`effinance_api_test` equivalente), então qualquer rota que tocasse dados financeiros fora do
RLS quebraria os testes.

### 4. Segredos (Secrets Manager)

| Segredo | Conteúdo |
| --- | --- |
| `effinance/api/database-url` | `postgres://effinance_api:<senha>@<endpoint>:5432/effinance` |
| `effinance/migrator/database-url` | `postgres://effinance_owner:<senha>@<endpoint>:5432/effinance` |
| `effinance/api/jwt-secret` | 48+ bytes aleatórios (`openssl rand -base64 48`) |
| `effinance/api/mercadopago` | `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` |

Ative a rotação automática das senhas do banco. A tarefa recebe os segredos como variáveis
(`secrets` na task definition) — nunca no código ou na imagem.

### 5. Imagem (ECR)

```bash
aws ecr create-repository --repository-name effinance-api --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=KMS
docker build -f apps/api/Dockerfile -t effinance-api .
docker tag effinance-api <conta>.dkr.ecr.sa-east-1.amazonaws.com/effinance-api:<git-sha>
docker push <conta>.dkr.ecr.sa-east-1.amazonaws.com/effinance-api:<git-sha>
```

A imagem roda como usuário sem privilégios, com o código somente leitura, `tini` como init e
healthcheck em `/api/health`. Use tags imutáveis (o SHA do commit).

### 6. ECS Fargate

Task definition `effinance-api` (ARM64, 0.5 vCPU / 1 GB para começar), `readonlyRootFilesystem: true`,
logs no CloudWatch (retenção 90 dias, cifrados com KMS). Variáveis:

```
NODE_ENV=production
PORT=3333
TRUST_PROXY=2                 # CloudFront + ALB
CORS_ORIGIN=https://app.effinance.com.br
APP_URL=https://app.effinance.com.br
DATABASE_SSL=verify-full
DATABASE_CA_FILE=/app/rds-ca.pem   # bundle global do RDS (adicione à imagem ou monte via volume)
KEY_PROVIDER=aws
KMS_KEY_ID=arn:aws:kms:sa-east-1:<conta>:key/<id>
AWS_REGION=sa-east-1
MAILER=ses
MAIL_FROM=Effinance <nao-responda@effinance.com.br>
BILLING_PROVIDER=mercadopago
REDIS_URL=rediss://<endpoint-elasticache>:6379
# segredos: DATABASE_URL, JWT_SECRET, MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET
```

Role da tarefa (`effinance-api-task`): `kms:GenerateDataKey/Decrypt/Encrypt` na chave de dados,
`ses:SendEmail` com condição `ses:FromAddress`, leitura dos seus segredos. Nada além.

**Migrações**: antes de cada deploy, rode uma tarefa avulsa com a mesma imagem e o segredo do
migrador:

```bash
aws ecs run-task --cluster effinance --task-definition effinance-migrate \
  --overrides '{"containerOverrides":[{"name":"api","command":["node","dist/migrate.js"]}]}' ...
```

`migrate.js` aplica o SQL (inclusive papéis e políticas de RLS) e, se houver workspaces sem chave
(dados antigos), gera as chaves e cifra os campos sensíveis (idempotente). Para isso a tarefa de
migração também precisa de acesso à chave KMS.

Serviço: 2+ tarefas em AZs diferentes atrás do ALB (health check `/api/health`), *deployment
circuit breaker* com rollback, auto scaling por CPU.

### 7. Web (S3 + CloudFront)

1. `pnpm --filter @effinance/web build` e envie `apps/web/dist` para um bucket privado
   (Block Public Access, SSE-KMS, versionamento).
2. CloudFront com OAC para o bucket, `index.html` como fallback de rotas (erro 403/404 → `/index.html`, 200)
   e o comportamento `/api/*` → origem ALB (sem cache, encaminhando cookies e todos os headers
   de autorização; métodos GET/HEAD/OPTIONS/PUT/POST/PATCH/DELETE).
3. *Response headers policy* para o site:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';
  base-uri 'self'; form-action 'self'; object-src 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

4. Certificado ACM (em `us-east-1` para o CloudFront), TLS mínimo `TLSv1.2_2021`.

### 8. WAF (no CloudFront)

- Regras gerenciadas: `AWSManagedRulesCommonRuleSet`, `KnownBadInputsRuleSet`,
  `SQLiRuleSet`, `AmazonIpReputationList`.
- *Rate-based rule* em `/api/auth/*` (ex.: 100 req/5 min por IP) — além do rate limit da API.
- Opcional: bloqueio geográfico se o público for só Brasil.

### 9. E-mail (SES)

Verifique o domínio com DKIM (Easy DKIM), publique SPF e DMARC (`p=quarantine`), peça a saída do
sandbox e configure um *configuration set* com eventos de bounce/complaint para o CloudWatch.

### 10. Mercado Pago

1. Crie a aplicação em *Suas integrações* e use as credenciais de produção (`APP_USR-...`).
2. Em *Webhooks*, cadastre `https://app.effinance.com.br/api/billing/webhooks/mercadopago` com os
   tópicos **Planos e assinaturas** (`subscription_preapproval`, `subscription_authorized_payment`)
   e **Pagamentos**; copie a *assinatura secreta* para `MP_WEBHOOK_SECRET`.
3. A API valida `x-signature` (HMAC-SHA256, tolerância de 5 min), grava cada notificação uma vez
   (`billing_events`) e consulta `GET /preapproval/:id` para obter o status oficial
   (`authorized → active`, `paused → past_due`, `cancelled → canceled`).
4. Teste com usuários de teste do Mercado Pago antes de virar a chave.

### 11. Observabilidade e resposta a incidentes

- Alarmes: 5xx no ALB, latência p95, CPU/memória das tarefas, conexões e armazenamento do RDS,
  falhas de `kms:Decrypt`, picos de `auth.login_failed` / `auth.refresh_token_reuse` no log de auditoria.
- GuardDuty, Security Hub (CIS/AWS Foundational), AWS Config e CloudTrail (multi-região, bucket com
  Object Lock).
- Backups: PITR do RDS + AWS Backup com cópia para outra região/conta (cofre com bloqueio).
- Teste de restauração trimestral (restore em conta isolada).

## Checklist antes de vender

- [ ] Termos de uso e política de privacidade revisados por advogado (as páginas atuais são modelo).
- [ ] Encarregado (DPO) e canal de atendimento ao titular publicados (LGPD art. 41).
- [ ] Preços dos planos confirmados em `packages/shared/src/saas.ts` (enviados ao Mercado Pago).
- [ ] `ENCRYPTION_MASTER_KEY` **não** usada em produção (use `KEY_PROVIDER=aws`).
- [ ] Usuário de login da API sem grants nas tabelas financeiras (passo 3).
- [ ] Pentest externo e revisão do WAF antes do lançamento.
