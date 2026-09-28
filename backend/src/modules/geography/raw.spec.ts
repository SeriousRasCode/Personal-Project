import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { joinSql, whereSql } from './raw.js';

function sqlText(value: Prisma.Sql): string {
  return value.text;
}

describe('joinSql', () => {
  it('returns empty sql for no parts', () => {
    expect(joinSql([], Prisma.sql` AND `).text).toBe('');
  });

  it('returns a single part without a separator', () => {
    const joined = joinSql([Prisma.sql`a = 1`], Prisma.sql` AND `);

    expect(sqlText(joined)).toBe('a = 1');
  });

  it('joins parts with the separator and no leading separator', () => {
    const joined = joinSql(
      [Prisma.sql`a = 1`, Prisma.sql`b = 2`, Prisma.sql`c = 3`],
      Prisma.sql` AND `,
    );

    expect(sqlText(joined)).toBe('a = 1 AND b = 2 AND c = 3');
  });

  it('interpolates values as parameters rather than inlining them', () => {
    const joined = joinSql(
      [Prisma.sql`a = ${1}`, Prisma.sql`b = ${2}`],
      Prisma.sql`, `,
    );

    expect(sqlText(joined)).toBe('a = $1, b = $2');
    expect(joined.values).toEqual([1, 2]);
  });
});

describe('whereSql', () => {
  it('matches everything when there are no conditions', () => {
    expect(whereSql([]).text).toBe('TRUE');
  });

  it('returns a bare condition for a single filter', () => {
    expect(whereSql([Prisma.sql`c.status = 'OPEN'`]).text).toBe(
      "c.status = 'OPEN'",
    );
  });

  it('joins several conditions with AND', () => {
    const filter = whereSql([
      Prisma.sql`c.status = ${'OPEN'}`,
      Prisma.sql`c.kebele_id = ${'kebele-id'}`,
    ]);

    expect(filter.text).toBe('c.status = $1 AND c.kebele_id = $2');
    expect(filter.values).toEqual(['OPEN', 'kebele-id']);
  });
});
