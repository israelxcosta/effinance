// Outgoing e-mail. `console` logs the message (development), `memory` keeps it for tests, `webhook`
// POSTs it as JSON to an endpoint you control (e.g. a Lambda or an e-mail service integration), and
// `ses` sends through Amazon SES v2 (production on AWS).

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly name: 'console' | 'memory' | 'webhook' | 'ses';
  /** True when messages actually leave the server (links must not be returned in API responses). */
  readonly delivers: boolean;
  send(message: MailMessage): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  readonly name = 'console' as const;
  readonly delivers = false;
  constructor(private readonly log: (msg: string) => void = (m) => console.info(m)) {}
  async send(message: MailMessage) {
    this.log(`[mail] para ${message.to}: ${message.subject}\n${message.text}`);
  }
}

export class MemoryMailer implements Mailer {
  readonly name = 'memory' as const;
  readonly delivers = false;
  readonly outbox: MailMessage[] = [];
  async send(message: MailMessage) {
    this.outbox.push(message);
  }
}

export class WebhookMailer implements Mailer {
  readonly name = 'webhook' as const;
  readonly delivers = true;
  constructor(
    private readonly url: string,
    private readonly secret: string | undefined,
    private readonly from: string,
  ) {}
  async send(message: MailMessage) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.secret ? { authorization: `Bearer ${this.secret}` } : {}),
      },
      body: JSON.stringify({ from: this.from, ...message }),
    });
    if (!res.ok) throw new Error(`Mail webhook respondeu ${res.status}`);
  }
}

export async function createSesMailer(options: { from: string; region?: string }): Promise<Mailer> {
  const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
  const client = new SESv2Client(options.region ? { region: options.region } : {});
  return {
    name: 'ses',
    delivers: true,
    async send(message) {
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: options.from,
          Destination: { ToAddresses: [message.to] },
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: 'UTF-8' },
              Body: { Text: { Data: message.text, Charset: 'UTF-8' } },
            },
          },
        }),
      );
    },
  };
}
