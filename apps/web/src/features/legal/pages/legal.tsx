import { Link } from 'react-router';
import { ArrowLeft, Scale } from 'lucide-react';
import { GRACE_DAYS, TRIAL_DAYS } from '@effinance/shared';

interface Section {
  title: string;
  paragraphs: string[];
}

const UPDATED_AT = '20/10/2026';

const TERMS: Section[] = [
  {
    title: '1. O serviço',
    paragraphs: [
      'O Effinance é um sistema on-line de organização financeira pessoal, familiar e empresarial: contas, cartões, contas a pagar e a receber, metas, contatos e relatórios.',
      'O Effinance não é instituição financeira, não movimenta dinheiro e não presta consultoria de investimentos. As informações e projeções exibidas são estimativas baseadas nos dados que você cadastra.',
    ],
  },
  {
    title: '2. Conta e segurança',
    paragraphs: [
      'Você é responsável pelas informações cadastradas e por manter sua senha em sigilo. Recomendamos ativar a verificação em duas etapas.',
      'Cada espaço (pessoal, família ou empresa) tem um proprietário, que define quem participa e com qual permissão (editor ou leitor).',
    ],
  },
  {
    title: '3. Assinatura, teste e pagamento',
    paragraphs: [
      `Novos espaços têm ${TRIAL_DAYS} dias de teste grátis, sem cartão. Depois disso, é necessário assinar um plano para continuar criando e editando dados; a consulta e a exportação continuam disponíveis.`,
      'Os pagamentos são processados pelo Mercado Pago, em cobrança recorrente mensal ou anual conforme o plano. O Effinance não armazena dados de cartão.',
      `Se um pagamento falhar, o espaço mantém acesso completo por ${GRACE_DAYS} dias enquanto a cobrança é refeita. Você pode cancelar a qualquer momento; o acesso segue até o fim do período já pago.`,
    ],
  },
  {
    title: '4. Uso aceitável',
    paragraphs: [
      'É proibido usar o serviço para fins ilícitos, tentar acessar dados de outros usuários, sobrecarregar a infraestrutura ou contornar mecanismos de segurança.',
    ],
  },
  {
    title: '5. Encerramento',
    paragraphs: [
      'Você pode excluir um espaço ou a sua conta nas Configurações. A exclusão é definitiva: os dados e as chaves de criptografia do espaço são destruídos.',
      'Podemos suspender contas que violem estes termos, com aviso prévio sempre que possível.',
    ],
  },
  {
    title: '6. Limitação de responsabilidade',
    paragraphs: [
      'O serviço é oferecido com esforço contínuo de disponibilidade e segurança, mas pode passar por interrupções. Não nos responsabilizamos por decisões financeiras tomadas com base nas informações exibidas.',
    ],
  },
  {
    title: '7. Alterações e foro',
    paragraphs: [
      'Avisaremos com antecedência sobre mudanças relevantes nestes termos. Fica eleito o foro do domicílio do consumidor, nos termos do Código de Defesa do Consumidor.',
    ],
  },
];

const PRIVACY: Section[] = [
  {
    title: '1. Quem somos',
    paragraphs: [
      'Esta política explica como o Effinance trata dados pessoais conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018 — LGPD). Controlador: [RAZÃO SOCIAL], CNPJ [00.000.000/0000-00], [ENDEREÇO].',
      'Encarregado (DPO): [NOME] — [e-mail do encarregado].',
    ],
  },
  {
    title: '2. Dados que tratamos',
    paragraphs: [
      'Cadastro: nome, e-mail e senha (guardada apenas como hash). Dados financeiros que você registra: contas, cartões, lançamentos, metas, categorias e observações.',
      'Contatos que você cadastra: nome, CPF/CNPJ, e-mail, telefone e endereço. Dados técnicos de segurança: IP, navegador e datas de acesso das sessões.',
    ],
  },
  {
    title: '3. Para que usamos',
    paragraphs: [
      'Prestar o serviço (execução de contrato), proteger sua conta e prevenir fraudes (legítimo interesse e segurança), cobrar a assinatura (execução de contrato) e cumprir obrigações legais. Não vendemos dados e não os usamos para publicidade.',
    ],
  },
  {
    title: '4. Compartilhamento',
    paragraphs: [
      'Somente com operadores necessários ao serviço: Amazon Web Services (hospedagem e chaves de criptografia, no Brasil), Mercado Pago (pagamentos) e o provedor de envio de e-mails. Membros de um espaço compartilhado veem os dados daquele espaço conforme a permissão dada pelo proprietário.',
    ],
  },
  {
    title: '5. Segurança',
    paragraphs: [
      'Cada espaço é isolado no banco de dados e tem chave de criptografia própria. Dados sensíveis (documentos, contatos, observações) são gravados cifrados com AES-256; a conexão usa TLS; backups são cifrados.',
      'Oferecemos verificação em duas etapas, controle de sessões ativas e registro de auditoria das ações sensíveis.',
    ],
  },
  {
    title: '6. Retenção',
    paragraphs: [
      'Mantemos os dados enquanto a conta ou o espaço existir. Após a exclusão, os dados são removidos e a chave de criptografia destruída; cópias de backup expiram no ciclo de retenção [30] dias. Registros exigidos por lei (como os de acesso, art. 15 do Marco Civil da Internet) são guardados pelo prazo legal.',
    ],
  },
  {
    title: '7. Seus direitos',
    paragraphs: [
      'Você pode confirmar o tratamento, acessar, corrigir, exportar (portabilidade) e excluir seus dados diretamente nas Configurações, além de revogar consentimentos e pedir informações pelo e-mail do encarregado.',
    ],
  },
  {
    title: '8. Cookies',
    paragraphs: [
      'Usamos apenas cookies essenciais de sessão (autenticação), sem rastreamento de terceiros. Preferências de interface, como o tema, ficam no seu navegador.',
    ],
  },
];

function LegalPage({ title, sections }: { title: string; sections: Section[] }) {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-lg font-extrabold tracking-tight text-fg">
            effinance
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-text hover:underline">
            <ArrowLeft className="size-4" /> Voltar
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="eyebrow text-brand-text">Documentos legais</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted">Última atualização: {UPDATED_AT}</p>
        <div role="note" className="mt-6 flex gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-fg">
          <Scale className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>
            <strong className="font-semibold">Modelo a ser revisado por advogado.</strong> Este texto é um ponto de partida e
            os campos entre colchetes precisam ser preenchidos antes da publicação.
          </p>
        </div>
        <div className="mt-8 flex flex-col gap-7">
          {sections.map((s) => (
            <section key={s.title}>
              <h2 className="text-base font-semibold tracking-tight">{s.title}</h2>
              {s.paragraphs.map((p) => (
                <p key={p} className="mt-2 text-sm leading-relaxed text-muted">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>
        <p className="mt-10 border-t border-border pt-5 text-sm text-muted">
          Veja também:{' '}
          {title.startsWith('Termos') ? (
            <Link to="/privacidade" className="font-semibold text-brand-text hover:underline">
              Política de privacidade
            </Link>
          ) : (
            <Link to="/termos" className="font-semibold text-brand-text hover:underline">
              Termos de uso
            </Link>
          )}
        </p>
      </main>
    </div>
  );
}

export function TermsPage() {
  return <LegalPage title="Termos de uso" sections={TERMS} />;
}

export function PrivacyPage() {
  return <LegalPage title="Política de privacidade" sections={PRIVACY} />;
}
