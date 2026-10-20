import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { forgotPasswordSchema } from '@effinance/shared';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { forgotPassword } from '../api';
import { AuthLayout } from './auth-layout';

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<z.input<typeof forgotPasswordSchema>, unknown, z.output<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await forgotPassword(values);
      setSentTo(values.email);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  const footer = (
    <>
      Lembrou a senha?{' '}
      <Link to="/login" className="font-semibold text-brand-text hover:underline">
        Entrar
      </Link>
    </>
  );

  if (sentTo) {
    return (
      <AuthLayout title="Verifique seu e-mail" subtitle="Enviamos as instruções, se houver uma conta com esse endereço." footer={footer}>
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface-muted px-5 py-6 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg">
            <MailCheck className="size-5" />
          </span>
          <p className="text-sm text-fg">
            Se <strong className="font-semibold">{sentTo}</strong> estiver cadastrado, você receberá um link para criar uma
            nova senha. O link vale por 30 minutos e só pode ser usado uma vez.
          </p>
          <p className="text-xs text-muted">Não chegou? Confira a caixa de spam ou tente de novo em alguns minutos.</p>
          <Button variant="outline" size="sm" className="mt-1" onClick={() => setSentTo(null)}>
            Usar outro e-mail
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Esqueci minha senha" subtitle="Informe seu e-mail e enviaremos um link para redefinir a senha." footer={footer}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="E-mail" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" placeholder="voce@email.com" autoFocus {...form.register('email')} />
        </Field>
        <Button type="submit" size="lg" className="mt-2 w-full" loading={form.formState.isSubmitting}>
          Enviar link
        </Button>
      </form>
    </AuthLayout>
  );
}
