import { Logger } from '@nestjs/common';

export type SmsProviderName = 'log' | 'http';

export interface SmsMessage {
  to: string;
  body: string;
}

export interface SmsProvider {
  readonly name: SmsProviderName;
  send(message: SmsMessage): Promise<void>;
}

export class LogSmsProvider implements SmsProvider {
  readonly name: SmsProviderName = 'log';

  private readonly logger = new Logger(LogSmsProvider.name);

  send(message: SmsMessage): Promise<void> {
    this.logger.log(`SMS to ${message.to}: ${message.body}`);
    return Promise.resolve();
  }
}

export class HttpSmsProvider implements SmsProvider {
  readonly name: SmsProviderName = 'http';

  private readonly logger = new Logger(HttpSmsProvider.name);

  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  async send(message: SmsMessage): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ to: message.to, message: message.body }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`SMS provider responded with ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
