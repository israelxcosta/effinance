import { useCallback } from 'react';
import { toast } from 'sonner';
import { toastError } from '@/lib/notify';
import { useUndoImport } from './api';

/** Undo of a whole import batch (toast action after importing and the history list). */
export function useUndoImportAction(): (batchId: string) => Promise<boolean> {
  const { mutateAsync } = useUndoImport();
  return useCallback(
    async (batchId: string) => {
      try {
        await mutateAsync(batchId);
        toast.success('Importação desfeita', { description: 'Os lançamentos criados por ela foram excluídos.' });
        return true;
      } catch (error) {
        toastError(error);
        return false;
      }
    },
    [mutateAsync],
  );
}
