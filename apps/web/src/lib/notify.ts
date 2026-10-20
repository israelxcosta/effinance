import { toast } from 'sonner';
import { errorMessage, isAccessError } from './api';

/** Error toast for a failed action. 402/403 are already explained by the global access toast. */
export function toastError(error: unknown): void {
  if (isAccessError(error)) return;
  toast.error(errorMessage(error));
}
