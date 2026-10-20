import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { loginSchema } from '@effinance/shared';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { CodeInput } from '@/components/ui/code-input';
import { Field, Input } from '@/components/ui/input';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { useAuth } from '../auth-context';
import { AuthLayout } from './auth-layout';
import { FullPageLoader } from '@/components/layout/app-shell';
import { IS_DEMO } from '@/lib/demo';

type LoginForm = z.input<typeof loginSchema>;

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [show, setShow] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const form = useForm<LoginForm, unknown, z.output<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    // The demo build ships a sample user; prefill it so testers can sign in with one click.
    defaultValues: IS_DEMO ? { email: 'demo@effinance.app', password: 'demo12345' } : { email: '', password: '' },
  });
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (loading) return <FullPageLoader />;
  if (user) return <Navigate to={from} replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await login(values);
      if (result.mfaRequired) setMfaToken(result.mfaToken);
      else navigate(from, { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  if (mfaToken) {
    return (
      <MfaStep
        mfaToken={mfaToken}
        onDone={() => navigate(from, { replace: true })}
        onBack={() => {
          setMfaToken(null);
          form.setValue('password', '');
        }}
      />
    );
  }

  return (
    <AuthLayout
      title="Bem-vindo de volta"
      subtitle="Entre para acompanhar suas finanças."
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link to="/cadastro" state={location.state} className="font-semibold text-brand-text hover:underline">
            Criar conta grátis
          </Link>
        </>
      }
    >
      {IS_DEMO ? (
        <p className="mb-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-fg">
          <strong className="font-semibold">Ambiente de testes.</strong> A conta de demonstração já está
          preenchida — é só clicar em Entrar. Você também pode criar sua própria conta.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="E-mail" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" placeholder="voce@email.com" autoFocus {...form.register('email')} />
        </Field>
        <Field
          label="Senha"
          error={form.formState.errors.password?.message}
          aside={
            <Link to="/esqueci-senha" className="text-xs font-semibold text-brand-text hover:underline">
              Esqueci minha senha
            </Link>
          }
        >
          <PasswordInput show={show} onToggle={() => setShow((s) => !s)} autoComplete="current-password" {...form.register('password')} />
        </Field>
        <Button type="submit" size="lg" className="mt-2 w-full" loading={form.formState.isSubmitting}>
          Entrar
        </Button>
      </form>
    </AuthLayout>
  );
}

/** Second login step when the account has two-factor authentication enabled. */
function MfaStep({ mfaToken, onDone, onBack }: { mfaToken: string; onDone: () => void; onBack: () => void }) {
  const { verifyMfa } = useAuth();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(value = code) {
    const trimmed = value.trim();
    if (recovery ? !/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(trimmed) : !/^\d{6}$/.test(trimmed)) {
      setError(recovery ? 'Use o formato xxxx-xxxx.' : 'Digite os 6 dígitos.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await verifyMfa({ mfaToken, code: trimmed });
      onDone();
    } catch (err) {
      // An expired challenge (5 min) can't be retried: the user has to sign in again.
      if (err instanceof ApiRequestError && err.status === 401 && /expir/i.test(err.message)) {
        toast.error('O tempo para confirmar expirou. Entre novamente.');
        onBack();
        return;
      }
      setError(errorMessage(err));
      setCode('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Verificação em duas etapas"
      subtitle={
        recovery
          ? 'Digite um dos códigos de recuperação que você guardou ao ativar a verificação.'
          : 'Digite o código de 6 dígitos do seu aplicativo autenticador.'
      }
      footer={
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 font-semibold text-brand-text hover:underline">
          <ArrowLeft className="size-4" /> Voltar ao login
        </button>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-muted px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-soft text-primary-soft-fg">
            <ShieldCheck className="size-4" />
          </span>
          <p className="text-[13px] text-muted">Sua conta está protegida com um segundo fator.</p>
        </div>
        {recovery ? (
          <Field label="Código de recuperação" error={error ?? undefined}>
            <Input
              autoFocus
              autoComplete="one-time-code"
              placeholder="xxxx-xxxx"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="tabular tracking-widest"
            />
          </Field>
        ) : (
          <div className="flex flex-col gap-1.5">
            <CodeInput value={code} onChange={setCode} onComplete={(v) => void submit(v)} autoFocus invalid={!!error} disabled={submitting} />
            {error ? (
              <p role="alert" className="text-xs font-medium text-danger">
                {error}
              </p>
            ) : null}
          </div>
        )}
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Confirmar
        </Button>
        <button
          type="button"
          className="text-center text-[13px] font-semibold text-brand-text hover:underline"
          onClick={() => {
            setRecovery((r) => !r);
            setCode('');
            setError(null);
          }}
        >
          {recovery ? 'Usar o código do aplicativo' : 'Usar código de recuperação'}
        </button>
      </form>
    </AuthLayout>
  );
}

export const PasswordInput = ({
  show,
  onToggle,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { show: boolean; onToggle: () => void; ref?: React.Ref<HTMLInputElement> }) => (
  <div className="relative">
    <Input type={show ? 'text' : 'password'} className="pr-11" {...props} />
    <button
      type="button"
      onClick={onToggle}
      className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:text-fg"
      aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
    >
      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  </div>
);
