// Desktop: until a backup password exists, closing the app saves nothing. Say so on every screen.

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { CloudUpload } from 'lucide-react';

export function BackupReminder() {
  const location = useLocation();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.effinanceDesktop?.backup.status().then((s) => alive && setMissing(!s.hasPassword));
    return () => {
      alive = false;
    };
  }, [location.pathname, location.search]);

  if (!missing || location.search.includes('aba=backup')) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warning/30 bg-warning-soft px-4 py-2.5 text-label text-fg">
      <CloudUpload className="size-4 shrink-0 text-warning" aria-hidden />
      <span className="font-semibold">Backup automático desativado</span>
      <span className="text-muted">Defina a senha do backup para salvar seus dados ao fechar o aplicativo.</span>
      <Link to="/configuracoes?aba=backup" className="ml-auto font-semibold text-warning hover:underline">
        Ativar backup
      </Link>
    </div>
  );
}
