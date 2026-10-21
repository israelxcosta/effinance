# Deploy na AWS (produção)

Guia para colocar o Effinance no ar como SaaS na AWS com isolamento por assinante (RLS),
criptografia de envelope (KMS), TLS ponta a ponta e o mínimo de privilégio em cada peça.
Região sugerida: `sa-east-1` (São Paulo) — dados de brasileiros ficam no Brasil (LGPD).

Convenções: `<conta>` = ID da conta de produção; os nomes (`effinance-*`) são sugestões. Tudo o
que está aqui é configuração **da conta AWS** (console/IaC) — o repositório já traz a imagem
endurecida (`apps/api/Dockerfile`), o CI (`.github/workflows/ci.yml`) e as travas de supply chain
(`pnpm-workspace.yaml`).

## Arquitetura

```
                 Route 53 (effinance.com.br, CAA amazon.com)
                          │
                 CloudFront + AWS WAF ──────────────── S3 (web estático, privado via OAC)
                          │  /api/*                       └─ headers de segurança (CSP, HSTS…)
                          ▼
            ALB interno (HTTPS) — origem VPC do CloudFront (sem exposição à internet)
                          │
            ECS Fargate — API Node (sub-redes privadas, 2+ tarefas em AZs diferentes)
              │            │             │              │
              ▼            ▼             ▼              ▼
     RDS PostgreSQL 16   AWS KMS     Secrets Manager   Amazon SES      (ElastiCache Redis/Valkey,
     Multi-AZ, cifrado   (CMK dados)  (segredos)       (e-mails)        TLS+AUTH: rate limit)
```

- **Mesmo domínio** para web e API (`/api/*` roteado pelo CloudFront para o ALB): os cookies
  `SameSite` funcionam sem exceções e o CORS fica restrito a uma origem.
- **A origem só aceita o CloudFront.** Preferido: ALB **interno** como *CloudFront VPC origin*
  (o ALB nem tem IP público). Alternativa com ALB público: security group com o prefix list
  `com.amazonaws.global.cloudfront.origin-facing` **e** um cabeçalho secreto
  (`X-Origin-Verify: <segredo>`, adicionado pelo CloudFront e conferido por regra do listener do
  ALB, ação padrão 403, segredo rotacionado). Só o prefix list não basta: ele libera **qualquer**
  distribuição CloudFront — inclusive a de um atacante —, o que contorna o WAF e permite forjar
  `X-Forwarded-For` (rate limit e logs de auditoria usam esse IP; `TRUST_PROXY=2`).
- A API não tem IP público; o banco só aceita conexões do security group das tarefas da API.
- App Runner também serve (mais simples), mas ECS Fargate dá controle de rede (VPC privada,
  security groups), `readonlyRootFilesystem`, remoção de capabilities e tarefas avulsas
  (migrações). Se usar App Runner: VPC connector para o RDS, WAF associado ao serviço, *instance
  role* com as mesmas permissões da task role abaixo, segredos por referência ao Secrets Manager e
  health check em `/api/health`.

## Camadas de segurança

| Camada | Como |
| --- | --- |
| Isolamento entre assinantes | Workspace = tenant. Tabelas financeiras com `FORCE ROW LEVEL SECURITY`; cada requisição roda numa transação com `SET LOCAL ROLE effinance_app` + `app.workspace_id`. O usuário de login da API **não tem acesso direto** às tabelas financeiras (só via `effinance_app`). |
| Dados sensíveis | AES-256-GCM por campo com chave por workspace (envelope: chave de dados gerada e protegida pelo KMS, com *encryption context* = workspace). Excluir o workspace apaga a chave (crypto-shredding; ver §12 sobre backups). |
| Em repouso | RDS, snapshots, backups e Performance Insights cifrados com KMS; S3, logs e ECR com SSE-KMS. |
| Em trânsito | TLS 1.2+ no CloudFront/ALB; `DATABASE_SSL=verify-full` + `rds.force_ssl=1`; Redis com TLS; SES com `TlsPolicy=REQUIRE`. |
| Sessões | Access token de 15 min + refresh token rotativo com detecção de reuso; cookies `httpOnly`, `Secure`, `SameSite`. 2FA (TOTP). |
| Aplicação | CSP restritiva, HSTS, verificação de origem/JSON (CSRF), rate limit (Redis), WAF, logs de auditoria sem dados pessoais. |
| Pagamentos | Mercado Pago (o cartão nunca passa pelo Effinance); webhooks com assinatura HMAC verificada e status sempre reconsultado. |
| Supply chain | Lockfile congelado, pnpm fixado por hash, scripts de instalação só do `esbuild`, `minimumReleaseAge`/`trustPolicy`, imagens e actions fixadas por digest/SHA, varredura de segredos e dependências no CI. |

## Passo a passo

### 0. Conta e governança (CIS AWS Foundations)

1. Contas separadas no AWS Organizations: `prod`, `staging`, `log-archive`, `security` (GuardDuty/
   Security Hub delegados). Acesso humano só por IAM Identity Center (SSO) com MFA; **nenhuma**
   access key de longa duração (CI usa OIDC, §13).
2. Usuário root: MFA de hardware, sem access keys, e-mail de grupo; alarme de uso (§11).
3. S3 Block Public Access **no nível da conta**, criptografia padrão de EBS, IAM Access Analyzer
   (acesso externo e não utilizado), AWS Budgets com alerta.
4. SCPs na OU de produção: negar sair de `sa-east-1` (exceto serviços globais: IAM, CloudFront,
   WAF CLOUDFRONT, Route 53, ACM `us-east-1`), negar desligar CloudTrail/GuardDuty/Config/Security
   Hub, negar `kms:ScheduleKeyDeletion`/`kms:PutKeyPolicy` e `iam:CreateAccessKey` exceto para a role
   de break-glass.

### 1. Rede (VPC)

1. VPC com 2–3 AZs: sub-redes **públicas** só para NAT Gateway (e ALB, se não usar VPC origin) e
   **privadas** para ALB interno, ECS, RDS e Redis. VPC Flow Logs ligados (destino cifrado).
2. Security groups (entrada **e** saída mínimas):
   - `sg-alb`: entrada 443 só da origem VPC do CloudFront (ou do prefix list + cabeçalho secreto);
     saída 3333 só para `sg-api`.
   - `sg-api`: entrada 3333 apenas de `sg-alb`; saída 5432 → `sg-db`, 6379 → `sg-redis`, 443 →
     endpoints de VPC e NAT (API do Mercado Pago).
   - `sg-db`: entrada 5432 apenas de `sg-api` e `sg-migrate` (e do bastion SSM, se houver); sem saída.
   - `sg-redis`: entrada 6379 apenas de `sg-api`.
3. VPC endpoints (Interface) para KMS, Secrets Manager, ECR (`api` e `dkr`), CloudWatch Logs e SES
   (onde disponível); endpoint *Gateway* do S3 (camadas do ECR). Políticas de endpoint restritas
   aos recursos da conta (`aws:ResourceAccount`). O tráfego com esses serviços não sai para a
   internet e o KMS pode exigir o endpoint (`aws:SourceVpce`, §2).

### 2. Chaves KMS

Crie três *customer managed keys* simétricas, com **rotação automática** ligada (anual ou período
customizado de 90–2560 dias; a rotação mantém o material antigo para decifrar, sem recifrar dados):

- `alias/effinance-rds` — armazenamento do RDS, snapshots e Performance Insights.
- `alias/effinance-data` — envelope dos dados da aplicação (`KMS_KEY_ID`). Só a API e a migração usam.
- `alias/effinance-ops` — Secrets Manager, CloudWatch Logs, S3 (web e logs) e ECR.

A API usa a `effinance-data` de dois jeitos (`apps/api/src/lib/crypto/aws-kms.ts`):

| Operação | Ações | Encryption context |
| --- | --- | --- |
| Chave de dados por workspace | `GenerateDataKey`, `Decrypt` | `{ workspaceId }` |
| Segredos pequenos (semente TOTP) | `Encrypt`, `Decrypt` | `{ purpose: "secret", context }` |

Política da `effinance-data` — cada ação só com o *formato* de contexto correspondente, ninguém além
das roles da aplicação consegue cifrar/decifrar, e o uso só vale pelo endpoint de VPC:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "KeyAdministrationWithoutCryptoUse",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<conta>:role/effinance-kms-admin" },
      "Action": [
        "kms:Describe*", "kms:List*", "kms:Get*", "kms:Create*", "kms:Put*", "kms:Update*",
        "kms:Enable*", "kms:Disable*", "kms:Revoke*", "kms:TagResource", "kms:UntagResource",
        "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion", "kms:RotateKeyOnDemand"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AccountBreakGlass",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<conta>:root" },
      "Action": ["kms:Describe*", "kms:Get*", "kms:List*", "kms:PutKeyPolicy"],
      "Resource": "*"
    },
    {
      "Sid": "WorkspaceDataKeys",
      "Effect": "Allow",
      "Principal": {
        "AWS": [
          "arn:aws:iam::<conta>:role/effinance-api-task",
          "arn:aws:iam::<conta>:role/effinance-migrate-task"
        ]
      },
      "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
      "Resource": "*",
      "Condition": {
        "ForAllValues:StringEquals": { "kms:EncryptionContextKeys": ["workspaceId"] },
        "Null": { "kms:EncryptionContext:workspaceId": "false" }
      }
    },
    {
      "Sid": "SmallSecrets",
      "Effect": "Allow",
      "Principal": {
        "AWS": [
          "arn:aws:iam::<conta>:role/effinance-api-task",
          "arn:aws:iam::<conta>:role/effinance-migrate-task"
        ]
      },
      "Action": ["kms:Encrypt", "kms:Decrypt"],
      "Resource": "*",
      "Condition": {
        "StringEquals": { "kms:EncryptionContext:purpose": "secret" },
        "ForAllValues:StringEquals": { "kms:EncryptionContextKeys": ["purpose", "context"] },
        "Null": { "kms:EncryptionContext:context": "false" }
      }
    },
    {
      "Sid": "DenyCryptoToEveryoneElse",
      "Effect": "Deny",
      "Principal": "*",
      "Action": ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*"],
      "Resource": "*",
      "Condition": {
        "ArnNotEquals": {
          "aws:PrincipalArn": [
            "arn:aws:iam::<conta>:role/effinance-api-task",
            "arn:aws:iam::<conta>:role/effinance-migrate-task"
          ]
        }
      }
    },
    {
      "Sid": "DenyUseOutsideTheVpc",
      "Effect": "Deny",
      "Principal": "*",
      "Action": ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*"],
      "Resource": "*",
      "Condition": { "StringNotEquals": { "aws:SourceVpce": "<vpce-kms-id>" } }
    }
  ]
}
```

- `ForAllValues` sozinho aceita contexto **vazio**; por isso cada statement também exige a chave
  com `Null: false`.
- `AccountBreakGlass` evita uma chave impossível de administrar; quem pode chamar
  `kms:PutKeyPolicy` via IAM pode se dar acesso, então restrinja isso por SCP (§0).
- A `effinance-rds` e a `effinance-ops` seguem o mesmo padrão (admins sem uso), liberando uso só
  para os serviços com `kms:ViaService` (`rds.sa-east-1.amazonaws.com`,
  `secretsmanager.sa-east-1.amazonaws.com`, `logs.sa-east-1.amazonaws.com`…), e para o
  CloudFront (`cloudfront.amazonaws.com` com `aws:SourceArn` = distribuição) ler o S3 cifrado.
- Chamadas ao KMS (`Decrypt`, `GenerateDataKey`…) são **eventos de gerenciamento** do CloudTrail,
  registrados com o encryption context (o `workspaceId`): **não** marque "Exclude AWS KMS events"
  na trilha. Alarme para `DisableKey`/`ScheduleKeyDeletion` (§11).
- **Nunca agende a exclusão da `effinance-data`**: sem ela, nenhum backup é legível (§12).
- *Kill switch* em incidente: remover as roles dos statements de uso para a API parar de decifrar.

### 3. Banco (RDS PostgreSQL 16)

- Multi-AZ, classe `db.t4g.medium`+ (ajuste ao uso), gp3 cifrado com `alias/effinance-rds`,
  backups automáticos com **PITR de 35 dias**, *deletion protection*, *copy tags to snapshots*,
  Performance Insights cifrado, Enhanced Monitoring, minor upgrades automáticos.
- **Sem acesso público** (`PubliclyAccessible=false`), subnet group só com sub-redes privadas;
  snapshots nunca compartilhados publicamente (regra do Config `rds-snapshots-public-prohibited`).
- Senha do usuário mestre gerenciada pelo Secrets Manager (`--manage-master-user-password`,
  rotação automática). O mestre é só break-glass: nem a API nem as migrações o usam.
- Parameter group:

  | Parâmetro | Valor | Motivo |
  | --- | --- | --- |
  | `rds.force_ssl` | `1` | recusa conexões sem TLS |
  | `ssl_min_protocol_version` | `TLSv1.2` | sem TLS antigo |
  | `password_encryption` | `scram-sha-256` | sem MD5 |
  | `log_connections`, `log_disconnections` | `1` | trilha de acesso |
  | `log_statement` | `ddl` | mudanças de schema auditadas |
  | `log_min_duration_statement` | `1000` | consultas lentas |
  | `log_parameter_max_length`, `log_parameter_max_length_on_error` | `0` | **não** gravar valores de parâmetros (dados pessoais) nos logs |
  | `shared_preload_libraries` | `pgaudit` (opcional) | `pgaudit.log = 'role,ddl'` — não use `read`/`write` (vazaria dados) |

- Exporte o log `postgresql` para o CloudWatch Logs (cifrado com `effinance-ops`, retenção 90 dias).

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
CREATE ROLE effinance_api LOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '<gerada>';
GRANT CONNECT ON DATABASE effinance TO effinance_owner, effinance_api;
GRANT effinance_app TO effinance_api;

-- Limites contra consultas presas e esgotamento de conexões (ajuste à carga).
ALTER ROLE effinance_api CONNECTION LIMIT 60;
ALTER ROLE effinance_api SET statement_timeout = '15s';
ALTER ROLE effinance_api SET idle_in_transaction_session_timeout = '30s';
```

Depois de rodar as migrações (passo 6), como `effinance_owner`:

```sql
GRANT USAGE ON SCHEMA public TO effinance_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, workspaces, workspace_members, workspace_invites, password_resets
TO effinance_api;
-- Nunca apagados pela API (cascatas rodam como dono da tabela).
GRANT SELECT, INSERT, UPDATE ON subscriptions, billing_events, sessions TO effinance_api;
-- Trilha de auditoria: só acrescenta.
GRANT SELECT, INSERT ON audit_logs TO effinance_api;
-- Tabelas financeiras: NENHUM grant para effinance_api. Só effinance_app (com RLS).
```

Os grants são os mesmos de `apps/api/test/db-roles.ts` (`IDENTITY_GRANTS`) — a suíte de testes
roda exatamente com esse modelo (`test/global-setup.ts` cria um `effinance_api_test`
equivalente), então qualquer rota que tocasse dados financeiros fora do RLS, ou precisasse de um
privilégio a mais, quebraria os testes. Ao criar tabelas novas, atualize os dois lugares.

Verificação (deve retornar `f`/`f`/`f` e nenhuma linha):

```sql
SELECT rolsuper, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = 'effinance_api';
SELECT table_name FROM information_schema.role_table_grants
 WHERE grantee = 'effinance_api' AND table_name NOT IN
  ('users','workspaces','workspace_members','workspace_invites','subscriptions',
   'billing_events','sessions','password_resets','audit_logs');
```

### 4. Segredos (Secrets Manager)

Todos cifrados com `alias/effinance-ops`, com *resource policy* negando `GetSecretValue` a qualquer
principal que não seja a execution role correspondente (e a role de break-glass).

| Segredo | Conteúdo | Quem lê |
| --- | --- | --- |
| `effinance/api/database-url` | `postgres://effinance_api:<senha>@<endpoint>:5432/effinance` | execution role da API |
| `effinance/api/jwt-secret` | 48+ bytes aleatórios (`openssl rand -base64 48`) | execution role da API |
| `effinance/api/mercadopago` | JSON `{"MP_ACCESS_TOKEN": "...", "MP_WEBHOOK_SECRET": "..."}` | execution role da API |
| `effinance/api/redis-url` | `rediss://<usuário>:<senha>@<endpoint>:6379` | execution role da API |
| `effinance/migrator/database-url` | `postgres://effinance_owner:<senha>@<endpoint>:5432/effinance` | execution role da migração |

- Gere os valores fora do IaC (ou com atributos *write-only*): segredos gerados pelo
  Terraform/CloudFormation ficam no state.
- A tarefa recebe os segredos como variáveis (`secrets` na task definition) — nunca no código, na
  imagem, em `--build-arg` ou em `environment` em texto puro.
- **Rotação**:
  - Senhas do banco: rotação automática a cada 30–90 dias. O ECS injeta segredos **só na
    partida** da tarefa e o driver recicla conexões a cada 30–60 min; então dispare um
    `aws ecs update-service --force-new-deployment` (regra do EventBridge em `RotationSucceeded`)
    ou use a estratégia de usuários alternados. Teste em staging.
  - `JWT_SECRET`: troca manual (trimestral ou em incidente) + novo deploy; invalida os access
    tokens emitidos (15 min). Em incidente, revogue também as sessões no banco.
  - Mercado Pago: renove as credenciais no painel, atualize o segredo e faça o deploy; regenere a
    assinatura secreta do webhook do mesmo jeito (o MP reenvia notificações que falharem).
- `ENCRYPTION_MASTER_KEY` **não** existe em produção (`KEY_PROVIDER=aws`).

### 5. Imagem (ECR)

```bash
aws ecr create-repository --repository-name effinance-api \
  --image-tag-mutability IMMUTABLE \
  --encryption-configuration encryptionType=KMS,kmsKey=alias/effinance-ops
# Amazon Inspector (enhanced scanning, contínuo) + lifecycle policy para imagens antigas.
docker buildx build --platform linux/arm64 -f apps/api/Dockerfile \
  --provenance=mode=max --sbom=true \
  -t <conta>.dkr.ecr.sa-east-1.amazonaws.com/effinance-api:<git-sha> --push .
```

A imagem (ver comentários no `Dockerfile`):

- base `node:22-alpine` fixada por **tag + digest** (multi-arch: amd64/arm64); atualizações via
  Dependabot e rebuild ao menos mensal para patches do SO;
- dependências só do `pnpm-lock.yaml` (`--frozen-lockfile` + `pnpm deploy` não legado), apenas de
  produção; sem npm/corepack/yarn no runtime; sem o seed de demonstração;
- usuário `10001:10001`, código pertencente ao root (somente leitura), compatível com
  `readonlyRootFilesystem`, `tini` como PID 1 (SIGTERM → desligamento gracioso);
- bundle de CA do RDS **da região** em `/etc/ssl/certs/rds-ca-sa-east-1.pem`, fixado por SHA-256
  (o build falha se a AWS mudar o arquivo — revise e atualize o checksum);
- nenhum segredo em `ARG`/`ENV`/camadas; `.dockerignore` exclui `.env`, chaves, `.git`, testes e docs.

Faça o deploy **por digest** (`effinance-api@sha256:...`), nunca por tag mutável. Opcional:
assinar com AWS Signer/Notation e verificar antes do deploy.

### 6. ECS Fargate

Duas roles por task definition — não misture:

- **Execution role** (`effinance-api-execution`): usada pelo agente do ECS para puxar a imagem,
  escrever logs e **ler os segredos** na partida.
- **Task role** (`effinance-api-task`): credenciais da aplicação em tempo de execução — KMS
  (concedido pela política da chave, §2) e SES. **Não** lê o Secrets Manager.

Execution role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "EcrAuth", "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
    {
      "Sid": "PullImage",
      "Effect": "Allow",
      "Action": ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
      "Resource": "arn:aws:ecr:sa-east-1:<conta>:repository/effinance-api"
    },
    {
      "Sid": "WriteLogs",
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "arn:aws:logs:sa-east-1:<conta>:log-group:/effinance/api:*"
    },
    {
      "Sid": "ReadApiSecrets",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:sa-east-1:<conta>:secret:effinance/api/*"
    },
    {
      "Sid": "DecryptSecrets",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:sa-east-1:<conta>:key/<id-effinance-ops>",
      "Condition": { "StringEquals": { "kms:ViaService": "secretsmanager.sa-east-1.amazonaws.com" } }
    }
  ]
}
```

Task role (KMS vem da política da chave; o SES só envia do remetente oficial):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendTransactionalMail",
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": [
        "arn:aws:ses:sa-east-1:<conta>:identity/effinance.com.br",
        "arn:aws:ses:sa-east-1:<conta>:configuration-set/effinance-transactional"
      ],
      "Condition": { "StringEquals": { "ses:FromAddress": "nao-responda@effinance.com.br" } }
    }
  ]
}
```

Task definition `effinance-api` (ARM64, 0.5 vCPU / 1 GB para começar) — campos de segurança:

```json
{
  "family": "effinance-api",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "runtimePlatform": { "cpuArchitecture": "ARM64", "operatingSystemFamily": "LINUX" },
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::<conta>:role/effinance-api-execution",
  "taskRoleArn": "arn:aws:iam::<conta>:role/effinance-api-task",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "<conta>.dkr.ecr.sa-east-1.amazonaws.com/effinance-api@sha256:<digest>",
      "essential": true,
      "user": "10001:10001",
      "readonlyRootFilesystem": true,
      "privileged": false,
      "linuxParameters": { "capabilities": { "drop": ["ALL"] } },
      "portMappings": [{ "containerPort": 3333, "protocol": "tcp" }],
      "secrets": [
        { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:sa-east-1:<conta>:secret:effinance/api/database-url-<sufixo>" },
        { "name": "JWT_SECRET", "valueFrom": "arn:aws:secretsmanager:sa-east-1:<conta>:secret:effinance/api/jwt-secret-<sufixo>" },
        { "name": "MP_ACCESS_TOKEN", "valueFrom": "arn:aws:secretsmanager:sa-east-1:<conta>:secret:effinance/api/mercadopago-<sufixo>:MP_ACCESS_TOKEN::" },
        { "name": "MP_WEBHOOK_SECRET", "valueFrom": "arn:aws:secretsmanager:sa-east-1:<conta>:secret:effinance/api/mercadopago-<sufixo>:MP_WEBHOOK_SECRET::" },
        { "name": "REDIS_URL", "valueFrom": "arn:aws:secretsmanager:sa-east-1:<conta>:secret:effinance/api/redis-url-<sufixo>" }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "wget -q -T 2 -O /dev/null http://127.0.0.1:3333/api/health || exit 1"],
        "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 15
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/effinance/api",
          "awslogs-region": "sa-east-1",
          "awslogs-stream-prefix": "api"
        }
      }
    }
  ]
}
```

Variáveis (`environment`, sem segredos):

```
NODE_ENV=production
PORT=3333
TRUST_PROXY=2                 # CloudFront + ALB (só é seguro se a origem aceitar apenas o CloudFront)
CORS_ORIGIN=https://app.effinance.com.br
APP_URL=https://app.effinance.com.br
DATABASE_SSL=verify-full
DATABASE_CA_FILE=/etc/ssl/certs/rds-ca-sa-east-1.pem   # já incluído na imagem
KEY_PROVIDER=aws
KMS_KEY_ID=arn:aws:kms:sa-east-1:<conta>:key/<id-effinance-data>
AWS_REGION=sa-east-1
MAILER=ses                    # obrigatório: "console" grava os e-mails (links de redefinição) no log
MAIL_FROM=Effinance <nao-responda@effinance.com.br>
BILLING_PROVIDER=mercadopago
LOG_LEVEL=info
# nunca: EFFINANCE_TODAY (só testes), ENCRYPTION_MASTER_KEY
```

Log group `/effinance/api` cifrado com `effinance-ops`, retenção 90 dias.

Serviço: 2+ tarefas em AZs diferentes atrás do ALB (health check `/api/health`), `assignPublicIp:
DISABLED`, *deployment circuit breaker* com rollback, auto scaling por CPU, `enableExecuteCommand:
false` (se precisar de ECS Exec, ligue só temporariamente, com IAM restrito e sessão registrada).

**Migrações**: antes de cada deploy, rode uma tarefa avulsa com a **mesma imagem**, task definition
`effinance-migrate` com roles próprias (`effinance-migrate-execution` lendo só
`effinance/migrator/*`; `effinance-migrate-task` com acesso à `effinance-data` pela política da
chave, sem SES) e `sg-migrate`:

```bash
aws ecs run-task --cluster effinance --task-definition effinance-migrate \
  --network-configuration 'awsvpcConfiguration={subnets=[<privadas>],securityGroups=[<sg-migrate>],assignPublicIp=DISABLED}' \
  --overrides '{"containerOverrides":[{"name":"api","command":["node","dist/migrate.js"]}]}'
```

`migrate.js` aplica o SQL (inclusive papéis e políticas de RLS), apaga registros de segurança
expirados e, se houver workspaces sem chave (dados antigos), gera as chaves e cifra os campos
sensíveis (idempotente) — por isso precisa da chave KMS. Hoje ele valida o ambiente completo da
API: dê à tarefa de migração `JWT_SECRET` aleatório próprio e valores fictícios para
`MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` (ela não fala com o Mercado Pago) — **nunca** os segredos
reais da API.

### 7. Web (S3 + CloudFront)

1. Build: `pnpm --filter @effinance/web build`. O Vite não gera sourcemaps (o CI falha se houver
   `.map` em `dist`); envie mesmo assim excluindo-os:
   ```bash
   aws s3 sync apps/web/dist s3://<bucket-web> --delete --exclude '*.map' \
     --cache-control 'public,max-age=31536000,immutable' --exclude index.html
   aws s3 cp apps/web/dist/index.html s3://<bucket-web>/index.html --cache-control 'no-cache'
   ```
2. Bucket privado: Block Public Access, SSE-KMS (`effinance-ops`), versionamento, *bucket policy*
   permitindo `s3:GetObject` só ao `cloudfront.amazonaws.com` com `AWS:SourceArn` = distribuição
   (OAC) e negando `aws:SecureTransport = false`.
3. **A build de demonstração (`dist-demo`) nunca vai para este bucket/domínio**: ela embute as
   credenciais públicas de demo e precisa de `'wasm-unsafe-eval'`. Se publicar, use outro domínio.
4. CloudFront:
   - Viewer: `redirect-to-https`, política TLS mínima `TLSv1.2_2021`, HTTP/2 e HTTP/3, certificado
     ACM em `us-east-1`.
   - Comportamento padrão (S3 via OAC): rotas da SPA reescritas por uma **CloudFront Function** —
     não use *custom error responses* 403/404 → `/index.html`: elas valem para a distribuição
     inteira e transformariam 401/403/404 da API em `200 index.html`.
     ```js
     function handler(event) {
       var req = event.request;
       var last = req.uri.split('/').pop();
       if (last.indexOf('.') === -1) req.uri = '/index.html';
       return req;
     }
     ```
   - Comportamento `/api/*` → origem ALB: cache policy `CachingDisabled`, origin request policy
     `AllViewerExceptHostHeader` (cookies, query e cabeçalhos), métodos
     GET/HEAD/OPTIONS/PUT/POST/PATCH/DELETE, HTTPS-only até a origem. A API já envia seus próprios
     cabeçalhos (helmet).
   - Logs padrão (v2) em bucket/log group cifrado, retenção 90 dias (IPs são dados pessoais).
5. *Response headers policy* do site (comportamento padrão):

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-Tx3gv5eNbn+Hf+VoVYfVEoj6NuvY41vj9EhirVY+UE4='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

   A CSP acima é gerada por `apps/web/src/lib/csp.ts` (`contentSecurityPolicy({ scriptHashes:
   [THEME_SCRIPT_HASH], header: true })`): é a mesma política da `<meta>` injetada em
   `dist/index.html`, mais `frame-ancestors` e `upgrade-insecure-requests` (que a `<meta>` não
   aceita). Se o script inline de `index.html` mudar, o hash muda — o teste `csp.test.ts` falha e o
   header precisa ser atualizado junto. `style-src 'unsafe-inline'` é exigido por Radix/sonner.
   Recomendado: `Content-Security-Policy-Report-Only: require-trusted-types-for 'script'` com um
   endpoint de relatórios. A demo (`dist-demo`) usa a mesma política com `'wasm-unsafe-eval'` em
   `script-src` (PGlite) e deve ficar em domínio separado.

   Ative "Origin override" nesses cabeçalhos. Antes do `preload`, confirme que **todos** os
   subdomínios servem HTTPS.
6. Route 53: registro CAA (`0 issue "amazon.com"`), DNSSEC opcional.

### 8. WAF (no CloudFront, escopo `CLOUDFRONT`, criado em `us-east-1`)

Ordem sugerida das regras (comece em **Count** por 1–2 semanas, revise os logs e passe para Block):

1. `AWSManagedRulesAmazonIpReputationList`.
2. `AWSManagedRulesCommonRuleSet` — atenção a `SizeRestrictions_BODY` (8 KB) e
   `CrossSiteScripting_BODY` em campos de observação; se der falso positivo, *scope-down* ou Count
   só nessas sub-regras.
3. `AWSManagedRulesKnownBadInputsRuleSet`, `AWSManagedRulesSQLiRuleSet`.
4. *Rate-based* em `/api/auth/*` (ex.: 100 req/5 min por IP, resposta 429) — além do rate limit da API.
5. Webhook `/api/billing/webhooks/mercadopago`: bloquear método ≠ `POST`, ausência do cabeçalho
   `x-signature` e corpo > 64 KB; *rate-based* próprio (ex.: 300 req/5 min por IP).
6. *Rate-based* geral em `/api/*` (ex.: 2000 req/5 min por IP).
7. Opcionais pagos: Account Takeover Prevention (`AWSManagedRulesATPRuleSet`) no login, Bot Control.
8. Opcional: bloqueio geográfico fora do Brasil — **exceto** o caminho do webhook.

Logs do WAF em `aws-waf-logs-effinance` (cifrado) com *redaction* dos cabeçalhos `cookie` e
`authorization`.

### 9. E-mail (SES)

1. Identidade de domínio com Easy DKIM (2048 bits) e *custom MAIL FROM* (`mail.effinance.com.br`).
2. DNS: SPF `v=spf1 include:amazonses.com -all` no MAIL FROM; DMARC
   `v=DMARC1; p=quarantine; adkim=s; aspf=s; rua=mailto:dmarc@effinance.com.br` → `p=reject`
   depois de 4–8 semanas de relatórios limpos.
3. *Configuration set* `effinance-transactional` como **padrão da identidade** (a API não informa
   um): `TlsPolicy=REQUIRE` (links de redefinição só trafegam com TLS), eventos de
   bounce/complaint para o CloudWatch/EventBridge, lista de supressão da conta ligada.
4. Peça a saída do sandbox; alarme para taxa de bounce > 5% e complaint > 0,1%.

### 10. Mercado Pago

1. Crie a aplicação em *Suas integrações* e use as credenciais de produção (`APP_USR-...`) — só no
   Secrets Manager. Conta do Mercado Pago com 2FA e acesso restrito a quem opera cobrança.
2. Em *Webhooks*, cadastre `https://app.effinance.com.br/api/billing/webhooks/mercadopago` com os
   tópicos **Planos e assinaturas** (`subscription_preapproval`, `subscription_authorized_payment`)
   e **Pagamentos**; copie a *assinatura secreta* para `MP_WEBHOOK_SECRET`.
3. A API valida `x-signature` (HMAC-SHA256, tolerância de 5 min), grava cada notificação uma vez
   (`billing_events`) e consulta `GET /preapproval/:id` para obter o status oficial
   (`authorized → active`, `paused → past_due`, `cancelled → canceled`). A assinatura + reconsulta
   são o controle principal: **não** dependa de allowlist de IP (as faixas de origem não são um
   contrato estável e uma mudança derrubaria a cobrança em silêncio). Use as regras do WAF (§8)
   como camada extra.
4. Teste com usuários de teste do Mercado Pago antes de virar a chave.

### 11. Observabilidade e resposta a incidentes

- **CloudTrail** da organização, multi-região, *log file validation*, bucket na conta
  `log-archive` com Object Lock (compliance) e SSE-KMS; eventos de gerenciamento completos
  (inclui KMS e Secrets Manager).
- **GuardDuty** com RDS Protection, ECS Runtime Monitoring, S3 Protection e Malware Protection;
  **Security Hub** (CIS AWS Foundations + AWS Foundational Security Best Practices); **AWS Config**
  (ex.: `rds-storage-encrypted`, `rds-instance-public-access-check`, `s3-bucket-level-public-access-prohibited`,
  `cloudtrail-enabled`, `iam-root-access-key-check`, `kms-cmk-not-scheduled-for-deletion`,
  `ecs-containers-readonly-access`, `ecs-containers-nonprivileged`).
- **Alarmes** (CloudWatch/EventBridge → SNS): 5xx no ALB, latência p95, CPU/memória das tarefas,
  tarefas paradas com erro, conexões e armazenamento do RDS, eventos de failover; falhas de
  `kms:Decrypt`, `DisableKey`/`ScheduleKeyDeletion`; falha de rotação de segredos; achados do
  GuardDuty; login do root e mudanças de IAM/políticas de chave (CIS 4.x); pico de bloqueios no
  WAF; picos de `auth.login_failed` / `auth.refresh_token_reuse` no log de auditoria (metric filter).
- Higiene de logs: sem dados pessoais nem segredos (nada de `MAILER=console`, parâmetros SQL fora
  do log do Postgres), log groups cifrados, retenção definida (90 dias aplicação; 1 ano trilhas).
- *Runbook* mínimo: girar `JWT_SECRET` e revogar sessões; girar credenciais do banco/MP; cortar o
  uso da chave KMS (kill switch, §2); preservar evidências (snapshots, logs); comunicar à ANPD e aos
  titulares quando houver risco relevante, no prazo do regulamento de incidentes (Resolução
  CD/ANPD nº 15/2024: 3 dias úteis).

### 12. Backups e restauração

- RDS: backups automáticos com PITR de 35 dias + AWS Backup (diário/mensal) com *vault lock* e
  cópia para outra conta (de preferência na mesma região — transferência internacional exige base
  legal na LGPD).
- **A chave `effinance-data` é parte do backup**: as chaves de dados dos workspaces estão cifradas
  com ela. Restaurar em outra conta/região exige acesso a essa chave (ou uma *multi-Region key*
  planejada desde o início). Sem ela os campos cifrados são irrecuperáveis.
- Crypto-shredding: excluir um workspace apaga a chave dele no banco, mas backups e PITR ainda a
  contêm até expirarem (35 dias / retenção do AWS Backup). Declare esse prazo na política de
  privacidade.
- Teste de restauração **trimestral** em conta isolada: restaurar snapshot/PITR, subir a imagem
  apontando para ele, conferir migrações, ler um registro cifrado (KMS), medir RTO/RPO e registrar.

### 13. CI/CD

- CI (`.github/workflows/ci.yml`, em todo PR e push na `main`): token só `contents: read`, actions
  fixadas por SHA, `pnpm install --frozen-lockfile`, typecheck, testes com Postgres, builds (falha
  se houver sourcemap no web), `pnpm audit`, gitleaks no histórico inteiro (`.gitleaks.toml`) e
  build da imagem com checagens (UID 10001, FS somente leitura, sem npm, sem seed, CA presente).
  Dependabot (`.github/dependabot.yml`) mantém SHAs, digests e dependências atualizados.
- No GitHub: proteção da `main` (PR com revisão, checks obrigatórios `verify`/`audit`/`secrets`/
  `image`), CODEOWNERS para `apps/api/Dockerfile`, `.github/`, `pnpm-workspace.yaml`,
  `pnpm-lock.yaml` e `docs/deploy-aws.md`; secret scanning com *push protection*; Dependabot alerts;
  *private vulnerability reporting*.
- Deploy (workflow separado, a criar): `environment: production` com aprovação obrigatória,
  `permissions: { id-token: write, contents: read }`, credenciais AWS por **OIDC** (sem access keys
  em secrets). Trust policy da role de deploy:
  `token.actions.githubusercontent.com:aud = sts.amazonaws.com` e
  `token.actions.githubusercontent.com:sub = repo:israelxcosta/effinance:environment:production`.
  Permissões só para: push no repositório ECR, `ecs:RegisterTaskDefinition`, `ecs:UpdateService` e
  `ecs:RunTask` (migração) nos recursos do Effinance, `iam:PassRole` nas quatro roles com
  `iam:PassedToService = ecs-tasks.amazonaws.com`, `s3:PutObject/DeleteObject` no bucket web e
  `cloudfront:CreateInvalidation` na distribuição. Nada de `pull_request_target`.

## Checklist antes de vender

- [ ] Termos de uso e política de privacidade revisados por advogado (as páginas atuais são modelo).
- [ ] Encarregado (DPO) e canal de atendimento ao titular publicados (LGPD art. 41).
- [ ] Preços dos planos confirmados em `packages/shared/src/saas.ts` (enviados ao Mercado Pago).
- [ ] `KEY_PROVIDER=aws`; `ENCRYPTION_MASTER_KEY` **não** usada em produção.
- [ ] `MAILER=ses` (nunca `console`), `DATABASE_SSL=verify-full`, `NODE_ENV=production`,
      `EFFINANCE_TODAY` ausente.
- [ ] Usuário de login da API sem grants nas tabelas financeiras e sem `BYPASSRLS` (consultas do §3).
- [ ] Origem (ALB) inacessível fora do CloudFront; `TRUST_PROXY=2` conferido com um IP forjado.
- [ ] Política da `effinance-data` com contexto obrigatório; nenhuma outra role decifra.
- [ ] Execution role ≠ task role; migração com roles e segredo próprios.
- [ ] Imagem implantada por digest; ECR imutável com Inspector; CI verde em `main`.
- [ ] CSP de `apps/web/src/lib/csp.ts` aplicada no CloudFront (hash conferido); `dist-demo` fora do domínio de produção.
- [ ] WAF fora do modo Count após o período de observação.
- [ ] Teste de restauração executado e registrado.
- [ ] Pentest externo e revisão do WAF antes do lançamento.
