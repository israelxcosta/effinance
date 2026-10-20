import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import { updateProfileSchema } from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/misc';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { errorMessage } from '@/lib/api';
import { initials } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';

export default function SettingsPage() {
  const { user, updateProfile, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const form = useForm<z.input<typeof updateProfileSchema>, unknown, z.output<typeof updateProfileSchema>>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: user?.name ?? '' },
  });
  useEffect(() => {
    form.reset({ name: user?.name ?? '' });
  }, [user?.name, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await updateProfile(values);
      toast.success('Perfil atualizado');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader overline="Conta" title="Configurações" description="Perfil, aparência e sessão." />

      <Card className="p-6">
        <CardHeader title="Perfil" subtitle="Como você aparece no Effinance" />
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4" noValidate>
          <div className="flex items-center gap-4">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-lg font-bold text-primary-soft-fg">{initials(user?.name)}</span>
            <div>
              <p className="font-semibold">{user?.name}</p>
              <p className="text-sm text-muted">{user?.email}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" error={form.formState.errors.name?.message}>
              <Input {...form.register('name')} />
            </Field>
            <Field label="E-mail" hint="O e-mail não pode ser alterado.">
              <Input value={user?.email ?? ''} disabled readOnly />
            </Field>
          </div>
          <div>
            <Button type="submit" loading={form.formState.isSubmitting}>Salvar alterações</Button>
          </div>
        </form>
      </Card>

      <Card className="p-6">
        <CardHeader title="Aparência" subtitle="Escolha o tema da interface" />
        <SegmentedControl
          className="mt-5"
          ariaLabel="Tema"
          value={theme}
          onChange={(t: ThemePreference) => setTheme(t)}
          options={[
            { value: 'light', label: 'Claro', icon: <Sun /> },
            { value: 'dark', label: 'Escuro', icon: <Moon /> },
            { value: 'system', label: 'Sistema', icon: <Monitor /> },
          ]}
        />
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h2 className="text-[15px] font-semibold">Sair da conta</h2>
          <p className="text-xs text-muted">Encerra a sessão neste dispositivo.</p>
        </div>
        <Button
          variant="danger-soft"
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut /> Sair
        </Button>
      </Card>
    </div>
  );
}
