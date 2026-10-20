import { format, formatDistanceToNowStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale/pt-BR';

/** "20/10/2026 às 14:32" for API timestamps. */
export function formatDateTime(iso: string): string {
  return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

/** "há 5 minutos" for API timestamps. */
export function formatRelative(iso: string): string {
  return formatDistanceToNowStrict(new Date(iso), { locale: ptBR, addSuffix: true });
}
