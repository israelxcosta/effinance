import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { BR_STATES, contactInputSchema, formatCEP, formatDocument, formatPhone, type Contact } from '@effinance/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/api';
import { useSaveContact } from './api';

type FormIn = z.input<typeof contactInputSchema>;
type FormOut = z.output<typeof contactInputSchema>;

function defaults(c?: Contact | null): FormIn {
  return {
    name: c?.name ?? '',
    document: c?.document ? formatDocument(c.document) : '',
    email: c?.email ?? '',
    phone: c?.phone ? formatPhone(c.phone) : '',
    zipCode: c?.zipCode ? formatCEP(c.zipCode) : '',
    street: c?.street ?? '',
    number: c?.number ?? '',
    complement: c?.complement ?? '',
    district: c?.district ?? '',
    city: c?.city ?? '',
    state: c?.state ?? '',
    notes: c?.notes ?? '',
  };
}

export function ContactSheet({ open, onOpenChange, contact }: { open: boolean; onOpenChange: (o: boolean) => void; contact?: Contact | null }) {
  const save = useSaveContact();
  const form = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(contactInputSchema), defaultValues: defaults(contact) });
  const { register, control, handleSubmit, reset, formState } = form;
  const e = formState.errors;

  useEffect(() => {
    if (open) reset(defaults(contact));
  }, [open, contact, reset]);

  const onSubmit = handleSubmit(async (input) => {
    try {
      await save.mutateAsync({ id: contact?.id, input });
      toast.success(contact ? 'Contato atualizado' : 'Contato criado');
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  const masked = (name: 'document' | 'phone' | 'zipCode', format: (v: string) => string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Input {...props} value={field.value ?? ''} onChange={(ev) => field.onChange(format(ev.target.value))} onBlur={field.onBlur} ref={field.ref} />
      )}
    />
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={contact ? 'Editar contato' : 'Novo contato'}
      description="Pessoas e empresas ligadas aos seus lançamentos"
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onSubmit} loading={save.isPending} className="min-w-[110px]">Salvar</Button>
        </>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={(ev) => { ev.preventDefault(); void onSubmit(); }} noValidate>
        <p className="eyebrow text-brand-text">Dados básicos</p>
        <Field label="Nome" error={e.name?.message}>
          <Input placeholder="Nome completo ou razão social" {...register('name')} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="CPF / CNPJ" error={e.document?.message}>
            {masked('document', formatDocument, { placeholder: '000.000.000-00', inputMode: 'numeric' })}
          </Field>
          <Field label="Telefone" error={e.phone?.message}>
            {masked('phone', formatPhone, { placeholder: '(00) 00000-0000', inputMode: 'tel' })}
          </Field>
        </div>
        <Field label="E-mail" error={e.email?.message}>
          <Controller
            control={control}
            name="email"
            render={({ field }) => <Input type="email" placeholder="contato@email.com" value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} />}
          />
        </Field>

        <p className="eyebrow mt-2 text-brand-text">Endereço</p>
        <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
          <Field label="CEP" error={e.zipCode?.message}>
            {masked('zipCode', formatCEP, { placeholder: '00000-000', inputMode: 'numeric' })}
          </Field>
          <Field label="Logradouro" error={e.street?.message}>
            <Input placeholder="Rua, avenida…" {...register('street')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
          <Field label="Número" error={e.number?.message}>
            <Input {...register('number')} />
          </Field>
          <Field label="Complemento" error={e.complement?.message}>
            <Input placeholder="Apto, bloco…" {...register('complement')} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_110px]">
          <Field label="Bairro" error={e.district?.message}>
            <Input {...register('district')} />
          </Field>
          <Field label="Cidade" error={e.city?.message}>
            <Input {...register('city')} />
          </Field>
          <Field label="UF" error={e.state?.message}>
            <Controller
              control={control}
              name="state"
              render={({ field }) => (
                <Select value={field.value ?? ''} onChange={field.onChange}>
                  <option value="">—</option>
                  {BR_STATES.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                </Select>
              )}
            />
          </Field>
        </div>
        <Field label="Observações" error={e.notes?.message}>
          <Controller control={control} name="notes" render={({ field }) => <Textarea value={field.value ?? ''} onChange={field.onChange} />} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
