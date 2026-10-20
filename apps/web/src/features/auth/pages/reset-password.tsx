import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { newPasswordSchema } from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { resetPassword } from '../api';
import { PasswordChecklist } from '../password-checklist';
import { AuthLayout } from './auth-layout';
import { PasswordInput } from './login';

const schema = z
  .object({ password: newPasswordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'As senhas não conferem', path: ['confirm'] });

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  // The e-mail link carries the token in the query (`?token=`) or in the fragment (`#token=`, never
  // sent to servers). It moves into this history entry's state and leaves the address bar, so it
  // doesn't linger in the browser history, screenshots or the Referer of later requests.
  const urlToken = params.get('token') ?? new URLSearchParams(location.hash.slice(1)).get('token');
  const stateToken = (location.state as { resetToken?: unknown } | null)?.resetToken;
  const token = urlToken ?? (typeof stateToken === 'string' ? stateToken : '');
  useEffect(() => {
    if (urlToken) navigate(location.pathname, { replace: true, state: { resetToken: urlToken } });
  }, [urlToken, location.pathname, navigate]);
  const [show, setShow] = useState(false);
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = form.handleSubmit(async ({ password }) => {
    try {
      await resetPassword({ token, password });
      toast.success('Senha redefinida. Entre com a nova senha.');
      navigate('/login', { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  const footer = (
    <Link to="/login" className="font-semibold text-brand-text hover:underline">
      Voltar ao login
    </Link>
  );

  if (token.length < 20) {
    return (
      <AuthLayout title="Link inválido" subtitle="Este link de redefinição está incompleto ou expirou. Abra de novo o link do e-mail." footer={footer}>
        <div className="flex flex-col items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-4 text-sm">
          <span className="inline-flex items-center gap-2 font-semibold text-warning">
            <TriangleAlert className="size-4" /> Não foi possível usar este link
          </span>
          <p className="text-muted">Peça um novo link — ele vale por 30 minutos e só pode ser usado uma vez.</p>
          <Button asChild size="sm">
            <Link to="/esqueci-senha">Pedir novo link</Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Criar nova senha" subtitle="Escolha uma senha forte, que você não use em outros sites." footer={footer}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <Field label="Nova senha" error={form.formState.errors.password?.message}>
            <PasswordInput show={show} onToggle={() => setShow((s) => !s)} autoComplete="new-password" autoFocus {...form.register('password')} />
          </Field>
          <PasswordChecklist value={form.watch('password') ?? ''} />
        </div>
        <Field label="Confirme a nova senha" error={form.formState.errors.confirm?.message}>
          <PasswordInput show={show} onToggle={() => setShow((s) => !s)} autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Button type="submit" size="lg" className="mt-2 w-full" loading={form.formState.isSubmitting}>
          Salvar nova senha
        </Button>
      </form>
    </AuthLayout>
  );
}
