import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { loginSchema } from '@effinance/shared';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
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
      await login(values);
      navigate(from, { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <AuthLayout
      title="Bem-vindo de volta"
      subtitle="Entre para acompanhar suas finanças."
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link to="/cadastro" className="font-semibold text-brand-text hover:underline">
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
        <Field label="Senha" error={form.formState.errors.password?.message}>
          <PasswordInput show={show} onToggle={() => setShow((s) => !s)} autoComplete="current-password" {...form.register('password')} />
        </Field>
        <Button type="submit" size="lg" className="mt-2 w-full" loading={form.formState.isSubmitting}>
          Entrar
        </Button>
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
