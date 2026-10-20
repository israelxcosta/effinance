import type { Mailer } from './mailer';

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
