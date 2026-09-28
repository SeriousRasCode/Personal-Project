import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';

export type RawRow = Record<string, unknown>;

export interface RawExecutor {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
}

export type TransactionClient = Prisma.TransactionClient;

export function rawExecutor(value: unknown): RawExecutor {
  return value as RawExecutor;
}

export function joinSql(
  parts: Prisma.Sql[],
  separator: Prisma.Sql,
): Prisma.Sql {
  const [first, ...rest] = parts;
  if (first === undefined) {
    return Prisma.sql``;
  }
  return rest.reduce(
    (query, part) => Prisma.sql`${query}${separator}${part}`,
    first,
  );
}

export function whereSql(parts: Prisma.Sql[]): Prisma.Sql {
  if (parts.length === 0) {
    return Prisma.sql`TRUE`;
  }
  return joinSql(parts, Prisma.sql` AND `);
}

export async function queryRows<T>(
  executor: RawExecutor,
  query: Prisma.Sql,
): Promise<T[]> {
  const result = await executor.$queryRaw<T | T[]>(query);
  if (Array.isArray(result)) {
    return result;
  }
  return [result];
}

export async function queryOne<T>(
  executor: RawExecutor,
  query: Prisma.Sql,
): Promise<T | null> {
  const rows = await queryRows<T>(executor, query);
  return rows[0] ?? null;
}

export async function runInTransaction<T>(
  prisma: PrismaService,
  callback: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  const transaction = (
    prisma as unknown as {
      $transaction?: (
        callback: (client: TransactionClient) => Promise<T>,
      ) => Promise<T>;
    }
  ).$transaction;
  if (typeof transaction !== 'function') {
    throw new InternalServerErrorException(
      'Database transactions are not available',
    );
  }
  return transaction.call(prisma, callback);
}

export function rowValue(row: RawRow, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }
  return undefined;
}

export function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function toNumber(value: unknown, fieldName: string): number {
  const numberValue = toNullableNumber(value);
  if (numberValue === null) {
    throw new InternalServerErrorException(`${fieldName} is not numeric`);
  }
  return numberValue;
}

export function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === 'false' || value === 0 || value === '0') {
    return false;
  }
  return fallback;
}

export function toNullableDate(value: unknown, fieldName: string): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (
    !(value instanceof Date) &&
    typeof value !== 'string' &&
    typeof value !== 'number'
  ) {
    throw new InternalServerErrorException(`${fieldName} is not a valid date`);
  }
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new InternalServerErrorException(`${fieldName} is not a valid date`);
  }
  return date;
}

export function toDate(value: unknown, fieldName: string): Date {
  const date = toNullableDate(value, fieldName);
  if (date === null) {
    throw new InternalServerErrorException(`${fieldName} is missing`);
  }
  return date;
}

export function toStringValue(value: unknown, fieldName: string): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    throw new InternalServerErrorException(`${fieldName} is missing`);
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  throw new InternalServerErrorException(`${fieldName} is invalid`);
}

export function parseJsonValue(value: unknown, fieldName: string): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new InternalServerErrorException(`${fieldName} is not valid JSON`);
  }
}
