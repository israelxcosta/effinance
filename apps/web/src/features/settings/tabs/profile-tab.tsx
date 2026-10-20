import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Monitor, Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import { updateProfileSchema } from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { toastError } from '@/lib/notify';
import { initials } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';
import { Cell, TabGrid } from './layout';

export function ProfileTab() {
  const { user, updateProfile } = useAuth();
  const { theme, setTheme } = useTheme();
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
      toastError(error);
    }
  });

  return (
    <TabGrid>
      <Cell>
        <Card className="p-6">
          <CardHeader title="Perfil" subtitle="Como você aparece para os membros dos seus espaços" />
          <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4" noValidate>
            <div className="flex items-center gap-4">
              <span className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-lg font-bold text-primary-soft-fg">{initials(user?.name)}</span>
              <div className="min-w-0">
                <p className="truncate font-semibold">{user?.name}</p>
                <p className="truncate text-sm text-muted">{user?.email}</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome" error={form.formState.errors.name?.message}>
                <Input autoComplete="name" {...form.register('name')} />
              </Field>
              <Field label="E-mail" hint="O e-mail não pode ser alterado.">
                <Input value={user?.email ?? ''} disabled readOnly />
              </Field>
            </div>
            <div>
              <Button type="submit" loading={form.formState.isSubmitting}>
                Salvar alterações
              </Button>
            </div>
          </form>
        </Card>
      </Cell>

      <Cell>
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
      </Cell>
    </TabGrid>
  );
}
