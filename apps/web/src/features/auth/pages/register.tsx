import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { registerSchema } from '@effinance/shared';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { useAuth } from '../auth-context';
import { AuthLayout } from './auth-layout';
import { PasswordInput } from './login';
import { FullPageLoader } from '@/components/layout/app-shell';

type RegisterForm = z.input<typeof registerSchema>;

export default function RegisterPage() {
  const { user, loading, register: signUp } = useAuth();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const form = useForm<RegisterForm, unknown, z.output<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  if (loading) return <FullPageLoader />;
  if (user) return <Navigate to="/" replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await signUp(values);
      toast.success('Conta criada! Já deixamos categorias e uma carteira prontas para você.');
      navigate('/', { replace: true });
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
          <Link to="/login" className="font-semibold text-brand-text hover:underline">
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
        <Field label="Senha" hint="Mínimo de 8 caracteres" error={form.formState.errors.password?.message}>
          <PasswordInput show={show} onToggle={() => setShow((s) => !s)} autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Button type="submit" size="lg" className="mt-2 w-full" loading={form.formState.isSubmitting}>
          Criar conta
        </Button>
      </form>
    </AuthLayout>
  );
}
