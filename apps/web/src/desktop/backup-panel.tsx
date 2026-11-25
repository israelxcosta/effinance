// Backup screens of the desktop app: the "Backup" tab in Configurações and the /restaurar page
// (a new computer restores from Google Drive before any account exists locally).

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CloudUpload, FileUp, FolderOpen, HardDrive, LogOut, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateBR } from '@effinance/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/input';
import { PasswordInput } from '@/features/auth/pages/login';
import { desktopBridge, type BackupEntry, type BackupStatus, type DriveStatus, type RestoreSource } from './bridge';
import { restoreBackup } from './runtime';

const MIN_PASSWORD = 8;

const errorText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  return `${formatDateBR(iso.slice(0, 10))} às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Configurações > Backup. */
export function BackupSettings() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [entries, setEntries] = useState<BackupEntry[] | null>(null);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    const bridge = desktopBridge();
    setStatus(await bridge.backup.status());
    setEntries(await bridge.backup.list().catch(() => []));
  }, []);
  useEffect(() => void refresh(), [refresh]);

  async function runNow() {
    setRunning(true);
    try {
      setStatus(await desktopBridge().backup.runNow());
      toast.success('Backup salvo.');
      await refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="p-5">
        <CardHeader
          title="Backup automático"
          subtitle={`Ao fechar o aplicativo, um backup cifrado é salvo neste computador e no Google Drive. Ficam os últimos ${status?.retentionDays ?? 30} dias.`}
          icon={<CloudUpload />}
        />
        <div className="mt-4 flex flex-col gap-1 text-sm">
          <p>
            <span className="text-muted">Último backup: </span>
            <span className="font-semibold">{status?.lastBackupAt ? formatWhen(status.lastBackupAt) : 'nenhum ainda'}</span>
          </p>
          {status?.lastError ? <p className="text-danger">Falhou da última vez: {status.lastError}</p> : null}
          {status && !status.hasPassword ? (
            <p className="text-warning">Defina a senha do backup para ativar o backup automático.</p>
          ) : null}
        </div>
        <PasswordForm hasPassword={Boolean(status?.hasPassword)} onSaved={refresh} />
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <Button onClick={runNow} loading={running} disabled={!status?.hasPassword}>
            <CloudUpload /> Fazer backup agora
          </Button>
          <Button variant="outline" onClick={() => void desktopBridge().backup.openFolder()}>
            <FolderOpen /> Abrir a pasta dos backups
          </Button>
        </div>
      </Card>
      <DriveCard onChange={refresh} />
      <Card className="p-5 xl:col-span-2">
        <CardHeader
          title={`Backups dos últimos ${status?.retentionDays ?? 30} dias`}
          subtitle="Um por dia. Restaurar substitui todos os dados deste computador pelos do backup."
          icon={<HardDrive />}
        />
        <BackupList entries={entries} className="mt-4" />
      </Card>
    </div>
  );
}

function PasswordForm({ hasPassword, onSaved }: { hasPassword: boolean; onSaved: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`Use pelo menos ${MIN_PASSWORD} caracteres.`);
    if (password !== confirm) return setError('As senhas não conferem.');
    setSaving(true);
    try {
      await desktopBridge().backup.setPassword(password);
      setPassword('');
      setConfirm('');
      setEditing(false);
      setError(null);
      toast.success('Senha do backup salva neste computador.');
      await onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  if (hasPassword && !editing) {
    return (
      <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-surface-muted px-4 py-3 text-label">
        <span>Senha do backup definida. Guarde-a: sem ela não dá para restaurar em outro computador.</span>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Trocar
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2" noValidate>
      <Field label="Senha do backup" hint="Ela cifra os arquivos. Anote em lugar seguro.">
        <PasswordInput show={show} onToggle={() => setShow((s) => !s)} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
      <Field label="Repita a senha" error={error ?? undefined}>
        <PasswordInput show={show} onToggle={() => setShow((s) => !s)} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" loading={saving}>
          Salvar senha
        </Button>
        {hasPassword ? (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Google Drive connection: OAuth client from the person's Google Cloud project, then sign-in. */
export function DriveCard({ onChange, className }: { onChange?: () => Promise<void> | void; className?: string }) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void desktopBridge().drive.status().then(setStatus);
  }, []);

  async function act(fn: () => Promise<DriveStatus>, success?: string) {
    setBusy(true);
    try {
      setStatus(await fn());
      if (success) toast.success(success);
      await onChange?.();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={className ?? 'p-5'}>
      <CardHeader title="Google Drive" subtitle="Os backups vão para a pasta “Effinance Backups” do seu Drive." icon={<CloudUpload />} />
      {!status ? null : !status.configured ? (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => desktopBridge().drive.configure(clientId.trim(), clientSecret.trim()));
          }}
        >
          <p className="text-label text-muted">
            Cole as credenciais do “app para computador” criado no Google Cloud (passo a passo no guia do Effinance para
            Windows). É feito uma vez neste computador.
          </p>
          <Field label="ID do cliente">
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" />
          </Field>
          <Field label="Chave secreta do cliente">
            <Input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} type="password" />
          </Field>
          <Button type="submit" loading={busy} disabled={!clientId.trim() || !clientSecret.trim()} className="self-start">
            Salvar credenciais
          </Button>
        </form>
      ) : !status.connected ? (
        <div className="mt-4 flex flex-col items-start gap-3">
          <p className="text-label text-muted">O navegador abre para você entrar e autorizar. O Effinance só enxerga os arquivos que ele mesmo criar.</p>
          <Button onClick={() => void act(() => desktopBridge().drive.connect(), 'Google Drive conectado.')} loading={busy}>
            Entrar com Google
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-success-soft px-4 py-3 text-label">
          <span>
            Conectado{status.email ? (
              <>
                {' '}como <span className="font-semibold">{status.email}</span>
              </>
            ) : null}
            .
          </span>
          <Button variant="ghost" size="sm" onClick={() => void act(() => desktopBridge().drive.disconnect(), 'Google Drive desconectado.')}>
            <LogOut /> Desconectar
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Backups by day, each restorable; plus "restore from a file". */
export function BackupList({ entries, className }: { entries: BackupEntry[] | null; className?: string }) {
  const [restoring, setRestoring] = useState<RestoreSource | null>(null);
  return (
    <div className={className}>
      {entries === null ? null : entries.length === 0 ? (
        <EmptyState compact icon={<HardDrive />} title="Nenhum backup ainda" description="O primeiro é salvo quando você fechar o aplicativo." />
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((e) => (
            <li key={e.date} className="flex items-center gap-3 py-2.5">
              <span className="text-sm font-semibold tabular">{formatDateBR(e.date)}</span>
              <span className="text-xs text-muted">{formatSize(e.size)}</span>
              <span className="flex gap-1">
                {e.local ? <Badge>Neste computador</Badge> : null}
                {e.driveId ? <Badge tone="brand">Google Drive</Badge> : null}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => setRestoring(e.local ? { kind: 'local', date: e.date } : { kind: 'drive', id: e.driveId! })}
              >
                <RotateCcw /> Restaurar
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" size="sm" className="mt-3" onClick={() => setRestoring({ kind: 'file' })}>
        <FileUp /> Restaurar de um arquivo…
      </Button>
      <RestoreDialog source={restoring} onClose={() => setRestoring(null)} />
    </div>
  );
}

function RestoreDialog({ source, onClose }: { source: RestoreSource | null; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      // On success the window reloads; a cancelled file picker just closes the dialog.
      if (!(await restoreBackup(source, password))) close();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  function close() {
    setPassword('');
    setError(null);
    setBusy(false);
    onClose();
  }

  return (
    <Modal
      open={source !== null}
      onOpenChange={(open) => !open && !busy && close()}
      title="Restaurar backup"
      description="Todos os dados deste computador serão substituídos pelos do backup. Depois, entre com o e-mail e a senha da sua conta."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={confirm} loading={busy} disabled={!password}>
            Restaurar
          </Button>
        </>
      }
    >
      <Field label="Senha do backup" error={error ?? undefined}>
        <PasswordInput show={show} onToggle={() => setShow((s) => !s)} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

/** Backups listed on the restore page (Drive and this computer). */
export function useBackupEntries() {
  const [entries, setEntries] = useState<BackupEntry[] | null>(null);
  const reload = useCallback(async () => setEntries(await desktopBridge().backup.list().catch(() => [])), []);
  useEffect(() => void reload(), [reload]);
  return { entries, reload };
}
