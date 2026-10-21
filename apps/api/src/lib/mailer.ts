// Outgoing e-mail. `console` logs the message (development), `memory` keeps it for tests, `webhook`
// POSTs it as JSON to an endpoint you control (e.g. a Lambda or an e-mail service integration), and
// `ses` sends through Amazon SES v2 (production on AWS; see mailer-ses.ts, kept apart so the browser
// demo never bundles the AWS SDK).

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Header-safe single line (subjects may carry user-chosen names such as a workspace's). */
export function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();
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
      body: JSON.stringify({ from: this.from, ...message, subject: oneLine(message.subject) }),
    });
    if (!res.ok) throw new Error(`Mail webhook respondeu ${res.status}`);
  }
}
