# Effinance para Windows

O mesmo Effinance da web, instalado no computador: funciona sem internet, guarda os dados só
neste computador e faz **backup automático ao fechar**, no próprio computador e no Google Drive,
mantendo os **últimos 30 dias**.

## Como funciona por dentro

- `apps/desktop` é um app [Electron](https://www.electronjs.org/). A janela carrega o build
  `vite build --mode desktop` do `apps/web`, servido pelo protocolo `app://effinance/`.
- Como na demo, a API inteira roda dentro da página sobre o **PGlite** (PostgreSQL em
  WebAssembly), com Row Level Security e criptografia de campos. O banco fica no IndexedDB do perfil
  do app, gravado a cada alteração (sem gravação "relaxada").
- Sem assinatura: uma "licença local" mantém todos os espaços ativos. Open Finance fica desligado
  (precisa de servidor); a importação de OFX/CSV funciona normalmente.
- Segredos (chave mestra dos dados, senha do backup, acesso ao Google) ficam cifrados com o cofre do
  Windows (DPAPI, via `safeStorage`), legíveis só pelo usuário do Windows que instalou.

## Instalar

1. No GitHub, abra **Releases** do repositório e baixe `Effinance-Setup-<versão>.exe` do rascunho
   **"Effinance para Windows (teste)"** (gerado pelo workflow `Desktop (Windows)` a cada push).
   Opcional, para conferir que o arquivo saiu do workflow deste repositório (sem alteração no
   caminho): `gh attestation verify Effinance-Setup-<versão>.exe -R israelxcosta/effinance`. O
   SHA-256 também está nas notas do rascunho.
2. Abra o instalador. Se aparecer **"O Windows protegeu o computador"**, clique em
   **Mais informações → Executar assim mesmo** (o instalador não tem assinatura de código paga).
3. Escolha a pasta e conclua. O atalho **Effinance** fica na área de trabalho e no menu Iniciar.

## Primeiro uso

- **Computador novo, sem dados:** clique em **Criar conta neste computador**. A conta é local
  (e-mail e senha só para abrir o app).
- **Já usava em outro computador:** clique em **Restaurar backup → Entrar com Google** (ou escolha um
  arquivo), escolha o dia, digite a **senha do backup** e entre com seu e-mail e senha.

## Backup automático

1. Em **Configurações → Backup**, defina a **senha do backup** (mínimo de 8 caracteres). Anote-a:
   sem ela não dá para restaurar em outro computador. Enquanto ela não existir, um aviso amarelo
   aparece no topo do app.
2. Ao **fechar o aplicativo**, ele mostra "Salvando o backup antes de fechar…" e:
   - grava `effinance-backup-AAAA-MM-DD.txt` em **Documentos\Effinance\Backups** (um por dia; fechar
     de novo no mesmo dia substitui o arquivo do dia);
   - envia o mesmo arquivo pela internet para a pasta **Effinance Backups** do seu Google Drive, se
     você entrou com Google (nada para instalar: o Effinance fala direto com o Google Drive);
   - apaga, nos dois lugares, os arquivos com mais de **30 dias**.
3. Também dá para **Fazer backup agora** na mesma tela.

O arquivo é **texto** (poucos KB) e vai **cifrado** (AES-256-GCM, chave derivada da senha com
PBKDF2-SHA256, 600 mil iterações): abri-lo num editor mostra só letras e números. Ele inclui a chave
dos dados, por isso restaura em qualquer computador só com a senha. Se o envio ao Drive falhar
(sem internet), a cópia local fica salva e a tela de Backup mostra o erro.

## Google Drive: Entrar com Google

Em **Configurações → Backup → Google Drive**, clique em **Entrar com Google**: o navegador abre,
você entra na sua conta e autoriza. Pronto — cada backup ao fechar vai direto para o Drive, sem
instalar nada. O Effinance usa o login oficial do Google para apps instalados e o escopo
**`drive.file`**: só enxerga os arquivos que ele mesmo criou, nunca o resto do seu Drive.

### Registro do Effinance no Google (uma única vez, por quem publica o app)

O Google só deixa um programa acessar o Drive se ele estiver registrado. Isso é feito **uma vez**,
por quem publica o Effinance, e vai embutido no instalador: quem usa o app nunca vê esta parte.

1. Acesse <https://console.cloud.google.com/> com sua conta Google e crie um projeto
   (ex.: "Effinance").
2. **APIs e serviços → Biblioteca**: procure **Google Drive API** e clique em **Ativar**.
3. **APIs e serviços → Tela de permissão OAuth** (ou "Google Auth Platform"):
   - Tipo de usuário **Externo**; nome do app "Effinance"; seu e-mail como suporte e contato.
   - Em **Escopos**, adicione `.../auth/drive.file` (e `openid`, `email`).
   - Em **Público-alvo / Status de publicação**, clique em **Publicar app** (Em produção). No modo
     "Teste" o Google derruba a conexão a cada 7 dias. Com só esses escopos não há verificação.
4. **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**:
   - Tipo de aplicativo: **App para computador**; nome "Effinance Windows".
   - Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`) e a **Chave secreta**.
5. No GitHub, em **Settings → Secrets and variables → Actions → New repository secret**, crie
   `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET` com esses valores. O próximo instalador
   gerado pelo workflow já vem com o registro: é só clicar em **Entrar com Google**.
   (Enquanto não houver os secrets, dá para colar os dois em **Backup → Google Drive → Avançado**.)

> Para apps instalados, o Google considera essa "chave secreta" não confidencial: quem tem o
> instalador consegue lê-la. O que protege sua conta é o login do Google e o escopo restrito.

## Limitações

- **Senha da conta esquecida:** o app não envia e-mail. Restaure um backup e use a senha da época,
  ou crie outra conta.
- **Senha do backup esquecida:** os backups antigos não abrem. Defina outra; os próximos usam a nova.
- **Sem atualização automática:** para atualizar, instale o `.exe` novo por cima (dados e backups
  ficam). Desinstalar também mantém dados e backups.
- Open Finance, assinatura e convites por e-mail não existem no app instalado.

## Desenvolvimento

```bash
pnpm --filter @effinance/desktop start      # build do web (desktop) + main e abre o Electron
pnpm --filter @effinance/desktop test       # formato do backup, retenção, Drive (simulado), protocolo
pnpm --filter @effinance/web exec vitest run src/desktop   # retrato do banco e licença local
pnpm --filter @effinance/desktop dist:win   # instalador (no Linux exige Wine 32 bits)
```

Sem cofre de senhas do sistema (Linux de CI), rode com `EFFINANCE_DEV_PLAIN_SECRETS=1` (só fora do
instalador). Peças: `src/main.ts` (janela, IPC, backup ao fechar), `src/preload.ts` (ponte
`window.effinanceDesktop`, espelhada em `apps/web/src/desktop/bridge.ts`), `src/backup-file.ts`
(formato), `src/backup-service.ts` (orquestração e 30 dias), `src/drive.ts` (OAuth e Drive),
`src/protocol.ts` (`app://`), `src/security.ts` (remetente do IPC, links externos, permissões); no web,
`src/desktop/` (retrato do banco, licença, telas). Auditoria de segurança: `docs/seguranca/auditoria-desktop.md`.
