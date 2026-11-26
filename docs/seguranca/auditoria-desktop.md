# Auditoria de segurança — Effinance para Windows (Electron)

Data: 2026-11-26 · Agente: `security-electron-desktop` · Escopo: `apps/desktop` inteiro e
`apps/web/src/desktop` (modo `--mode desktop`). Método: skill `security-review` (só alta confiança,
com caminho real de entrada controlada pelo atacante) + Electron Security Checklist, Electron Fuses,
RFC 8252/9700, NIST SP 800-132 e OWASP Cryptographic Storage.

## Resumo

- **Achados**: 6 (0 Crítica, 0 Alta, 0 Média, 6 Baixa). Todos **corrigidos** com teste de regressão.
- **Nível de risco**: Baixo. A base já estava bem montada: `contextIsolation`, `sandbox`, sem
  `nodeIntegration`, preload com funções estreitas (sem `ipcRenderer` cru), CSP estrita na página
  (sem `unsafe-eval`, sem script inline fora do hash, `frame-src 'none'`), segredos no DPAPI sem
  fallback em claro, backup AES-256-GCM + PBKDF2-SHA256 600 mil com cabeçalho autenticado, OAuth com
  PKCE S256 + `state` + loopback `127.0.0.1` efêmero e escopo `drive.file`.
- **Confiança**: Alta. Os 6 achados são de defesa em profundidade: quase todos exigem antes um código
  rodando na página (XSS, hoje mitigado por React + CSP) ou um processo local do mesmo usuário, ou
  engenharia social (restaurar um backup do atacante com a senha dele).

| ID | Severidade | CWE | Local (antes da correção) | Status |
|----|-----------|-----|---------------------------|--------|
| DESK-01 | Baixa | CWE-22 | `src/main.ts:127`, `src/local-backups.ts:37` | Corrigido |
| DESK-02 | Baixa | CWE-346, CWE-20 | `src/main.ts:107-143` | Corrigido |
| DESK-03 | Baixa | CWE-276 | `src/main.ts:89-91` (sem handler de permissões) | Corrigido |
| DESK-04 | Baixa | CWE-939 | `src/main.ts:71-77` | Corrigido |
| DESK-05 | Baixa | CWE-693 | `electron-builder.yml` (sem `electronFuses`), `src/main.ts:61-67` | Corrigido (validar no Windows) |
| DESK-06 | Baixa | CWE-409, CWE-400 | `src/backup-file.ts:84`, `src/main.ts:126` | Corrigido |

## Achados

### [DESK-01] Path traversal na restauração local (Baixa)
- **Local**: `apps/desktop/src/main.ts:127` (`source.date` repassado sem validação) →
  `apps/desktop/src/local-backups.ts:37` (`readFileSync(join(this.folder, backupFileName(day)))`).
- **CWE**: CWE-22. **Confiança**: Alta.
- **Problema**: o canal `backup:read` aceitava `{ kind: 'local', date }` com qualquer texto. O "dia" ia
  direto para `join(pasta, 'effinance-backup-' + date + '.txt')`, então
  `date = 'x/../../../segredo'` abria `Documentos\segredo.txt` (qualquer `.txt` alcançável a partir da
  pasta de backups).
- **Impacto**: uma página comprometida (XSS) faz o processo principal ler arquivos `.txt` fora da
  pasta. O conteúdo não volta (só abriria se fosse um backup válido e com a senha certa), mas as
  mensagens de erro distinguem "não existe" de "não é backup" (oráculo de existência de arquivo).
  Caminho UNC a partir de uma pasta com letra de unidade não é alcançável por `..`.
- **Correção**: `parseRestoreSource` (`src/security.ts`) só aceita `YYYY-MM-DD` / id do Drive
  `[A-Za-z0-9_-]` e ignora qualquer `text` vindo da página; `backupFileName` agora recusa um dia que
  não seja `YYYY-MM-DD` (defesa também em `LocalBackups.read`).
- **Teste**: `security.test.ts › DESK-01` (falhava antes: o arquivo fora da pasta era aberto).

### [DESK-02] IPC sem validação de remetente e de argumentos (Baixa)
- **Local**: `apps/desktop/src/main.ts:107-143` (todos os `ipcMain.handle`).
- **CWE**: CWE-346 (validação de origem), CWE-20. **Confiança**: Alta (padrão), impacto condicionado.
- **Problema**: nenhum handler conferia `event.senderFrame` (checklist Electron nº 17); argumentos
  eram convertidos com `String(...)` sem limite de tamanho; `backup:finish-restore` aceitava qualquer
  chave de 64 hex depois de qualquer leitura bem-sucedida.
- **Impacto**: hoje só a página `app://effinance/` tem o preload, e a navegação para fora é bloqueada;
  mas qualquer falha futura (iframe, navegação, `window.open`) entregaria a **chave mestra dos dados**,
  a troca da senha do backup e a substituição da chave mestra a conteúdo de outra origem. Strings
  enormes travariam o processo principal.
- **Correção**: wrapper `handle()` em `main.ts:38` que recusa o pedido se o remetente não for o frame
  de topo em `app://effinance/` (`isTrustedSender`; note que `URL.origin` de `app:` é `"null"`, por isso
  compara protocolo e host); `stringArg(valor, 1024)` em senhas e credenciais OAuth;
  `finishRestore` só grava a chave **do backup que acabou de ser aberto** (`pendingRestore`).
- **Teste**: `security.test.ts › DESK-02` e `DESK-01` (`parseRestoreSource`, `stringArg`). Conferido
  também no Electron real (abaixo).

### [DESK-03] Permissões do navegador concedidas por padrão (Baixa)
- **Local**: `apps/desktop/src/main.ts:89-91` (nenhum `setPermissionRequestHandler`).
- **CWE**: CWE-276. **Confiança**: Alta.
- **Problema**: o Electron concede **toda** permissão pedida pela página quando não há handler
  (câmera, microfone, localização, notificações, HID/USB/serial), sem perguntar ao usuário.
- **Impacto**: com XSS, a página ligaria câmera/microfone ou leria a localização em silêncio.
- **Correção**: `setPermissionRequestHandler`/`setPermissionCheckHandler` com allowlist
  (`isPermissionAllowed`): só `clipboard-sanitized-write` (botões "Copiar") da própria página;
  `setDevicePermissionHandler(() => false)`.
- **Teste**: `security.test.ts › DESK-03`; no Electron real `getUserMedia`, geolocalização e
  `Notification.requestPermission()` passaram a ser negados e "copiar" continua funcionando.

### [DESK-04] Links externos e navegação mais largos que o necessário (Baixa)
- **Local**: `apps/desktop/src/main.ts:71-77`.
- **CWE**: CWE-939. **Confiança**: Alta.
- **Problema**: `setWindowOpenHandler` mandava ao navegador qualquer `http(s)://` (inclusive `http:`
  e URLs com credenciais); não havia `will-redirect` nem bloqueio global de `<webview>`
  (`will-attach-webview`) para web contents criados depois.
- **Correção**: `externalUrl` (só `https:`, sem usuário/senha, URL normalizada); `will-navigate` e
  `will-redirect` presos a `app://effinance/`; `app.on('web-contents-created')` nega `<webview>` e
  novas janelas; `webviewTag: false`, `navigateOnDragDrop: false`, `webSecurity: true`,
  `allowRunningInsecureContent: false` explícitos.
- **Teste**: `security.test.ts › DESK-04` (`file:`, `smb:`, UNC, `ms-msdt:`, `search-ms:`,
  `javascript:`, `http:` recusados).

### [DESK-05] Electron Fuses desligados e DevTools no instalador (Baixa)
- **Local**: `apps/desktop/electron-builder.yml` (sem `electronFuses`); `src/main.ts:61-67`
  (`devTools` não desligado).
- **CWE**: CWE-693. **Confiança**: Alta.
- **Problema**: o `Effinance.exe` instalado respeitava `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` e
  `--inspect`, e carregaria uma pasta `app` fora do `app.asar`.
- **Impacto**: um processo local (ou um atalho alterado) roda código arbitrário com a identidade do
  Effinance (LOLBin, contorno de allowlist de antivírus) ou se conecta ao processo principal, que tem
  os segredos decifrados em memória; troca do `app.asar` não é detectada.
- **Correção**: `electronFuses` no `electron-builder.yml`: `runAsNode: false`,
  `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`,
  `onlyLoadAppFromAsar: true`, `enableEmbeddedAsarIntegrityValidation: true` (o electron-builder 26
  grava o hash do asar no recurso `ELECTRONASAR` do .exe; Windows suportado desde o Electron 30),
  `enableCookieEncryption: true`, `grantFileProtocolExtraPrivileges: false`. `devTools: !app.isPackaged`.
- **Teste**: `security.test.ts › DESK-05` (lê o `electron-builder.yml`). **Exige teste real no
  Windows**: baixar o instalador do rascunho, instalar e abrir (ver "Precisa verificar").

### [DESK-06] Restauração sem limite de tamanho (bomba gzip) (Baixa)
- **Local**: `apps/desktop/src/backup-file.ts:84` (`gunzipSync(plain)` sem teto); `src/main.ts:126`
  (`readFile` do arquivo escolhido sem checar tamanho).
- **CWE**: CWE-409, CWE-400. **Confiança**: Alta (condição: engenharia social).
- **Problema**: um backup criado pelo atacante com a senha dele (que convence a vítima a restaurá-lo)
  com poucos KB inflava para gigabytes no processo principal; um arquivo enorme era lido inteiro.
- **Impacto**: o app trava/fecha (negação de serviço). Não há execução de conteúdo: o snapshot vira
  linhas de tabela por `json_populate_recordset` com nomes de tabela/coluna vindos do próprio banco.
- **Correção**: `BACKUP_LIMITS` (arquivo até 64 MiB, conteúdo descompactado até 256 MiB;
  backups reais têm KB a poucos MB), `gunzipSync(..., { maxOutputLength })`, `readBackupText` checa o
  tamanho antes de ler; validação de tipos do cabeçalho (`salt` ≥ 16 bytes, `iv` de 12 bytes) e do
  JSON (`null`/não-objeto) com mensagens limpas.
- **Teste**: `security.test.ts › DESK-06` (bomba de 8 MiB com teto de 1 MiB recusada; cabeçalhos e
  payloads malformados).

### Endurecimentos sem achado (feitos junto)
- `protocol.ts`: `resolveAsset` recusa `%` malformado, NUL e `:` (letra de unidade e fluxos NTFS
  `index.html::$DATA`) e confere `isAbsolute(rel)`; testes com `path.win32` (barras invertidas, prefixo
  UNC `/\..\`, `C:\`). O código anterior **não** era explorável (o `relative(...).startsWith('..')`
  segurava), mas não havia teste com semântica do Windows.
- `drive.ts`: `driveQueryLiteral` escapa `\` e `'` nos literais de `q`; id do arquivo codificado no
  `PATCH` de upload. Os valores vêm do Google/`settings.json`, não da página.

## Precisa verificar

- **[VERIFY-01] Pasta `renderer` fora do asar.** `extraResources` copia o build web para
  `resources\renderer`, que **não** é coberto pela integridade do asar. Na instalação por usuário
  (`perMachine: false`) a pasta é gravável pelo próprio usuário: um processo local pode alterar o JS
  da página, que recebe a chave mestra. Recomendação: empacotar o renderer dentro do `app.asar`
  (`files`) e servi-lo de lá (o `fs` do processo principal lê asar), junto com assinatura de código.
  Mesmo assim, malware do mesmo usuário também decifra DPAPI: risco residual aceito por ora.
- **[VERIFY-02] Integridade do asar no Windows real.** Se o hash embutido não bater, o app fecha na
  abertura. O fluxo é o documentado (electron-builder 26.18 + Electron 45), mas só foi testado no
  Linux. Teste: instalar o `.exe` do rascunho, abrir, criar conta, definir senha, fechar (backup),
  reabrir, restaurar. Se falhar, desligar só `enableEmbeddedAsarIntegrityValidation` e reportar.
- **[VERIFY-03] `safeStorage` no Windows.** Pelo código, sem DPAPI o app não abre (erro visível) e
  nunca grava em claro; `EFFINANCE_DEV_PLAIN_SECRETS` só vale fora do instalador (`!app.isPackaged`).
  Conferir no Windows que `secrets.bin` não é JSON legível.

## Itens conferidos sem problema

- `BrowserWindow`: `contextIsolation`, `sandbox`, sem `nodeIntegration`; preload sem `ipcRenderer`
  cru; `desktop:snapshot-response` já validava o `sender` e o `id`.
- `registerSchemesAsPrivileged`: `standard`, `secure`, `supportFetchAPI`, `corsEnabled`, `stream`;
  sem `bypassCSP`. CSP via `<meta>` no build desktop (`'wasm-unsafe-eval'` para o PGlite).
- Segredos: `secrets.bin` cifrado com `safeStorage`; `updateSecrets` lança se o cofre não existe;
  nenhum segredo volta ao renderer (status só traz `hasPassword`/`configured`), nem vai a logs.
- Backup: AES-256-GCM, IV aleatório de 12 bytes por arquivo, tag de 16 bytes verificada,
  PBKDF2-SHA256 600 mil com salt aleatório de 16 bytes, versão no formato, cabeçalho como AAD;
  iterações aceitas na leitura limitadas a 100 mil–5 milhões.
- Retenção de 30 dias: só apaga nomes `effinance-backup-AAAA-MM-DD.txt` dentro da pasta local e
  arquivos listados na pasta do app no Drive (escopo `drive.file` não enxerga arquivos de terceiros).
- OAuth (RFC 8252): navegador do sistema, PKCE S256, `state` de 128 bits conferido, loopback em
  `127.0.0.1` com porta efêmera, timeout de 5 min e `server.close()` no `finally`; refresh token no
  DPAPI; revogação ao desconectar; `invalid_grant` apaga o token. Client secret tratado como não
  confidencial (app instalado).
- Renderer desktop (`apps/web/src/desktop`): SQL da licença local usa constante; `importSnapshot`
  usa nomes de tabela/coluna do próprio banco (com `ident()`), numa transação; React escapa as
  mensagens de erro exibidas.
- Instalador: NSIS por usuário (sem elevação), sem atualização automática (sem canal inseguro).

## Testes

- Novo: `apps/desktop/src/security.test.ts` (12 testes; 8 falhavam antes das correções, os de
  `security.ts` não existiam).
- `pnpm --filter @effinance/desktop typecheck` e `pnpm --filter @effinance/desktop test`: 24/24.
- **Electron real** (Linux, Xvfb + CDP, perfil temporário): a página abre e o banco inicia (chave
  mestra via IPC); `backup:read` com `date` malicioso → "Origem do backup inválida."; senha de 5000
  caracteres recusada; `finishRestore` com chave diferente da aberta recusado; backup → listar →
  abrir com a senha → `finishRestore` com a chave certa funcionou; câmera/localização/notificações
  negadas, "copiar" permitido; `window.open('file:…')` e navegação para `https://` bloqueados.

## Riscos residuais e recomendações

- **Bump recomendado**: Electron `45.4.1` → **`45.5.0`** (latest estável, publicado em 2026-11-24;
  correções do Chromium). Fica com o agente de supply chain (lockfile).
- Instalador **sem assinatura de código** (SmartScreen): a origem depende do rascunho do GitHub e do
  SHA-256/atestado. Assinar (Azure Trusted Signing ou OV) quando houver outros usuários.
- VERIFY-01 (renderer fora do asar) e VERIFY-02 (integridade do asar só validada no Windows real).
- A chave mestra dos dados é entregue à página por design (a API roda no renderer sobre PGlite):
  qualquer XSS futuro lê os dados. A defesa é a CSP estrita + React; manter `dangerouslySetInnerHTML`
  fora do código.
- Revogação no Google envia o token na query string de um POST para `oauth2.googleapis.com` (aceito
  pelo Google; mover para o corpo é opcional).
