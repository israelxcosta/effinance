import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { registerSchema, TRIAL_DAYS } from '@effinance/shared';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { useAuth } from '../auth-context';
import { AuthLayout } from './auth-layout';
import { PasswordInput } from './login';
import { PasswordChecklist } from '../password-checklist';
import { FullPageLoader } from '@/components/layout/app-shell';

type RegisterForm = z.input<typeof registerSchema>;

export default function RegisterPage() {
  const { user, loading, register: signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Coming from an invite: return there afterwards, with the invited e-mail prefilled.
  const state = location.state as { from?: string; email?: string } | null;
  const from = state?.from ?? '/';
  const [show, setShow] = useState(false);
  const form = useForm<RegisterForm, unknown, z.output<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: state?.email ?? '', password: '', acceptTerms: false as unknown as true },
  });

  if (loading) return <FullPageLoader />;
  if (user) return <Navigate to={from} replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await signUp(values);
      toast.success(`Conta criada! Você tem ${TRIAL_DAYS} dias grátis, com categorias e uma carteira prontas.`);
      navigate(from, { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <AuthLayout
      title="Crie sua conta"
      subtitle="Comece a organizar suas finanças em minutos."
      footer={
        <>
          Já tem conta?{' '}
          <Link to="/login" state={location.state} className="font-semibold text-brand-text hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Nome" error={form.formState.errors.name?.message}>
          <Input autoComplete="name" placeholder="Seu nome" autoFocus {...form.register('name')} />
        </Field>
        <Field label="E-mail" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" placeholder="voce@email.com" {...form.register('email')} />
        </Field>
        <div className="flex flex-col gap-2">
          <Field label="Senha" hint="Mínimo de 10 caracteres, com letras e números" error={form.formState.errors.password?.message}>
            <PasswordInput show={show} onToggle={() => setShow((s) => !s)} autoComplete="new-password" {...form.register('password')} />
          </Field>
          <PasswordChecklist value={form.watch('password') ?? ''} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-snug text-muted">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--app-primary)]" {...form.register('acceptTerms')} />
            <span>
              Li e aceito os{' '}
              <Link to="/termos" target="_blank" className="font-semibold text-brand-text hover:underline">
                Termos de uso
              </Link>{' '}
              e a{' '}
              <Link to="/privacidade" target="_blank" className="font-semibold text-brand-text hover:underline">
                Política de privacidade
              </Link>
              .
            </span>
          </label>
          {form.formState.errors.acceptTerms ? (
            <p className="text-xs text-danger">{form.formState.errors.acceptTerms.message}</p>
          ) : null}
        </div>
        <Button type="submit" size="lg" className="mt-2 w-full" loading={form.formState.isSubmitting}>
          Criar conta
        </Button>
      </form>
    </AuthLayout>
  );
}
