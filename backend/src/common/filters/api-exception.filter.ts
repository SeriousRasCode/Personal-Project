import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

interface HttpErrorBody {
  error?: string;
  message?: string | string[];
  [key: string]: unknown;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const normalizedResponse =
      typeof exceptionResponse === 'string'
        ? { message: exceptionResponse }
        : ((exceptionResponse as HttpErrorBody | undefined) ?? {});
    const message =
      normalizedResponse.message ??
      (status === 500 ? 'An unexpected error occurred' : 'Request failed');

    if (status >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `${request.method} ${request.url} failed: ${String(message)}`,
        stack,
      );
    }

    void reply.status(status).send({
      statusCode: status,
      error: normalizedResponse.error ?? HttpStatus[status] ?? 'Error',
      message,
      path: request.url,
      method: request.method,
      requestId: request.id,
      timestamp: new Date().toISOString(),
      ...(status < 500 ? { details: normalizedResponse } : {}),
    });
  }
}
