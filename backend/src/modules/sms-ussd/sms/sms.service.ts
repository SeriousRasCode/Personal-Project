import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HttpSmsProvider,
  LogSmsProvider,
  type SmsMessage,
  type SmsProvider,
  type SmsProviderName,
} from './sms-provider.js';

const DEFAULT_TIMEOUT_MS = 5_000;

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly provider: SmsProvider;

  constructor(private readonly configService: ConfigService) {
    this.provider = this.resolveProvider();
  }

  get providerName(): SmsProviderName {
    return this.provider.name;
  }

  async send(message: SmsMessage): Promise<void> {
    await this.provider.send(message);
    this.logger.debug(`SMS queued via ${this.provider.name}`);
  }

  private resolveProvider(): SmsProvider {
    const provider =
      this.configService.get<SmsProviderName>('sms.provider') ??
      this.configService.get<SmsProviderName>('SMS_PROVIDER') ??
      'log';

    if (provider !== 'http') {
      return new LogSmsProvider();
    }

    const apiUrl =
      this.configService.get<string>('sms.apiUrl') ??
      this.configService.get<string>('SMS_API_URL');
    const apiKey =
      this.configService.get<string>('sms.apiKey') ??
      this.configService.get<string>('SMS_API_KEY');

    if (!apiUrl || !apiKey) {
      this.logger.warn(
        'SMS_PROVIDER is http but SMS_API_URL or SMS_API_KEY is missing, falling back to the log provider',
      );
      return new LogSmsProvider();
    }

    return new HttpSmsProvider(apiUrl, apiKey, DEFAULT_TIMEOUT_MS);
  }
}
