# Auditoria de segurança — novembro de 2026

Feita com as skills `security-review` (Sentry), `security-best-practices` e `security-threat-model`
(OpenAI), mais os checklists de `firebase-security-rules-auditor` e
`better-auth-security-best-practices` adaptados (o projeto não usa Firebase nem Better Auth).
Seis frentes, cada uma com um agente: API, banco, web, infraestrutura, desktop e modelo de ameaças.

- Modelo de ameaças: [`effinance-threat-model.md`](effinance-threat-model.md) (TM-001 a TM-014).
- Desktop (relatório completo do agente): [`auditoria-desktop.md`](auditoria-desktop.md).
- API, banco, web e infra: os agentes foram interrompidos pelo limite de uso antes do relatório
  final; os achados abaixo foram consolidados pela sessão principal a partir das correções e dos
  testes que eles deixaram (todos conferidos e passando).

## Resumo

| Frente | Crítica | Alta | Média | Baixa | Status |
|---|---|---|---|---|---|
| API (Node/Fastify) | 0 | 0 | 2 | 2 | corrigidos com teste |
| Banco (PostgreSQL/RLS) | 0 | 0 | 1 | 1 | corrigidos com teste (migração 0009) |
| Web (React) | 0 | 0 | 1 | 3 | corrigidos com teste |
| Infra / supply chain | 0 | 0 | 2 | 3 | corrigidos (CI, imagens, docs) |
| Desktop (Electron) | 0 | 0 | 0 | 6 | corrigidos com teste |

Nenhuma vulnerabilidade crítica ou alta encontrada no código. Os riscos mais altos estão no modelo
de ameaças e dependem de decisões de produto (ver "Pendências de decisão").

## API

- **API-01 · Média · CWE-307 — sem limite de senhas erradas por conta.** Só havia limite por IP;
  com vários IPs dava para adivinhar a senha de uma conta. Agora há um orçamento de tentativas por
  conta em 15 min (login e reautenticação: trocar senha, excluir conta, ativar 2FA), contado na
  trilha de auditoria; poucas digitações erradas não bloqueiam. `apps/api/src/modules/auth/password-attempts.ts`.
  Teste: `test/audit-api-r3.test.ts`.
- **API-02 · Média · CWE-598/532 — token do convite na URL do caminho.** O link `/convite/<token>`
  ia para logs de acesso e cabeçalho Referer. Agora é `/convite#token=…` (o fragmento nunca sai do
  navegador); o formato antigo segue aceito para links já enviados. `workspaces/service.ts`,
  `apps/web/src/features/workspaces/invite-token.ts`.
- **API-03 · Baixa · CWE-190 — total da compra de investimento sem teto.** Quantidade × preço podia
  passar do teto de valores e gerar uma Aplicação insegura. Contrato e serviço limitam a R$ 1 bilhão.
- **API-04 · Baixa — módulos novos (investimentos, pagar outro valor, categoria pai, evolução).**
  Conferidos: papel (403), assinatura (402), ids de outro espaço (BOLA → 404) e janela do relatório
  limitada; testes de regressão em `test/audit-api-r3.test.ts`.

## Banco

- **DB-01 · Média · CWE-639 — `investment_purchases.transfer_id` sem chave estrangeira.** Podia
  guardar o id de um lançamento de outro espaço e ficava apontando para transferências apagadas.
  Migração 0009: chave composta dentro do espaço, `ON DELETE SET NULL (transfer_id)`, limpeza dos
  vínculos órfãos. A mesma regra vale para o novo `goal_contributions.transfer_id` (0010). Teste:
  `test/audit-db.test.ts` (toda coluna de referência é FK; apagar a transferência só desvincula).
- **DB-02 · Baixa · CWE-190 — dinheiro sem teto no banco.** `CHECK` para o total da compra e para
  `transactions.amount ≤ Number.MAX_SAFE_INTEGER` (a API lê bigint como número JS).
- Demo/desktop (PGlite): mesmas migrações, RLS e chaves (teste de paridade em `src/demo/demo.test.ts`).

## Web

- **WEB-01 · Média · CWE-1236 — injeção de fórmula no CSV da Evolução.** Nomes de categoria como
  `=HYPERLINK(...)` viravam fórmula no Excel. Agora são neutralizados mesmo escondidos atrás de
  espaços, sinais de largura total ou quebras de linha. `features/reports/lib/evolution-csv.ts`.
- **WEB-02 · Baixa — página de erro do roteador mostrava mensagem e stack em inglês.** Nova tela de
  erro em pt-BR sem detalhes técnicos. `app/router.tsx`.
- **WEB-03 · Baixa — `?modo=`/`?data=` forjados quebravam as listas.** Valores desconhecidos caem
  no mês atual. `lib/active-month.ts` (+ teste).
- **WEB-04 · Baixa — demo pedia e-mail e senha sem aviso.** Aviso curto no cadastro: "Ambiente de
  testes. Não use sua senha de verdade."

## Infra e cadeia de suprimentos

- **INF-01 · Média — CI não rodava nos pushes.** O workflow só disparava em `main`, que não existe;
  auditoria de dependências, gitleaks e checagens de imagem só rodavam em PRs do Dependabot. Agora
  roda em `claude/**`.
- **INF-02 · Média — token com escrita junto de código de terceiros no build do instalador.** O
  workflow do desktop foi separado em dois jobs: o build roda com token somente leitura; um job sem
  checkout publica o rascunho, com atestado de proveniência assinado (SLSA/Sigstore) e checagem de
  que não há source maps. Verificar: `gh attestation verify Effinance-Setup-<v>.exe -R <owner>/<repo>`.
- **INF-03 · Baixa — imagens atrasadas em patches de segurança.** Node 22.23.3 → 22.23.5 e
  PostgreSQL 16.15 → 16.16 (tag + digest); Dependabot semanal e ignorando majors para propor os
  patches 22.x/16.x.
- **INF-04 · Baixa — `.dockerignore`** passa a excluir `apps/desktop`, `.agents` e `skills-lock.json`.
- **INF-05 · Baixa — docs de deploy:** ALB com TLS 1.3, `drop_invalid_header_fields`, desync
  `strictest`, access logs cifrados; prazo para patches do Node e fim de suporte do Node 22
  (30/04/2027); seed de demonstração bloqueado em produção sem `ALLOW_DEMO_SEED=yes`.
- **Bumps:** `pnpm audit` sem vulnerabilidades conhecidas no CI. Recomendado: Electron 45.4.1 →
  45.5.0 (estável mais recente) no próximo ciclo.

## Pendências de decisão (do modelo de ameaças)

1. **SaaS:** verificação de e-mail no cadastro; pedir senha/2FA para exportar dados; 2FA
   obrigatório para donos de espaços com membros (TM-002).
2. **Backup do desktop:** senha mínima maior (12+ ou frase) e KDF scrypt/Argon2id (TM-004).
3. **Produção:** exigir `REDIS_URL` e `TRUST_PROXY` explícitos em `env.ts` (TM-010).
4. **Instalador:** assinatura de código se for distribuído a terceiros; confirmar no Windows que a
  verificação de integridade do asar não impede o app de abrir (TM-008, DESK-05).
