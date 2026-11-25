// /restaurar — first run on a new computer: connect Google Drive (or pick a file) and bring the data back.

import { Link } from 'react-router';
import { AuthLayout } from '@/features/auth/pages/auth-layout';
import { BackupList, DriveCard, useBackupEntries } from './backup-panel';

export default function RestorePage() {
  const { entries, reload } = useBackupEntries();
  return (
    <AuthLayout
      title="Restaurar backup"
      subtitle="Traga seus dados de outro computador: entre no Google Drive ou escolha um arquivo de backup."
      footer={
        <Link to="/login" className="font-semibold text-brand-text hover:underline">
          Voltar para o login
        </Link>
      }
    >
      <div className="flex flex-col gap-5">
        <DriveCard onChange={reload} className="p-4" />
        <BackupList entries={entries} />
      </div>
    </AuthLayout>
  );
}
