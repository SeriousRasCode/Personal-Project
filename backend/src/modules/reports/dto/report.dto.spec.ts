import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { FlowStatus, ReportSource } from '../../../generated/prisma/enums.js';
import {
  CreateQueueWaitReportDto,
  CreateTapStatusReportDto,
  ListQueueReportsQueryDto,
  ListTapReportsQueryDto,
} from './report.dto.js';

const standpipeId = '3f1b1a52-9d0a-4a2f-8f2a-6b7f0f5b1c22';

const validTapReport = {
  standpipeId,
  status: FlowStatus.FULL_FLOW,
};

const validQueueReport = {
  standpipeId,
  waitMinutes: 25,
};

describe('CreateTapStatusReportDto', () => {
  it('accepts a minimal report and applies defaults', async () => {
    const dto = plainToInstance(CreateTapStatusReportDto, validTapReport);

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.source).toBe(ReportSource.CITIZEN_APP);
    expect(dto.reliabilityWeight).toBe(1);
  });

  it('rejects a missing standpipe', async () => {
    const errors = await validate(
      plainToInstance(CreateTapStatusReportDto, {
        status: FlowStatus.DRY,
      }),
    );

    expect(errors).toHaveLength(1);
  });

  it('rejects an unknown flow status', async () => {
    const errors = await validate(
      plainToInstance(CreateTapStatusReportDto, {
        ...validTapReport,
        status: 'SPOUTING',
      }),
    );

    expect(errors).toHaveLength(1);
  });

  it('rejects a non uuid standpipe', async () => {
    const errors = await validate(
      plainToInstance(CreateTapStatusReportDto, {
        ...validTapReport,
        standpipeId: 'not-a-uuid',
      }),
    );

    expect(errors).toHaveLength(1);
  });

  it('rejects a weight above the ceiling', async () => {
    const errors = await validate(
      plainToInstance(CreateTapStatusReportDto, {
        ...validTapReport,
        reliabilityWeight: 50,
      }),
    );

    expect(errors).toHaveLength(1);
  });

  it('rejects a weight below the floor', async () => {
    const errors = await validate(
      plainToInstance(CreateTapStatusReportDto, {
        ...validTapReport,
        reliabilityWeight: 0,
      }),
    );

    expect(errors).toHaveLength(1);
  });

  it('coerces a string weight', async () => {
    const dto = plainToInstance(CreateTapStatusReportDto, {
      ...validTapReport,
      reliabilityWeight: '2.5',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.reliabilityWeight).toBe(2.5);
  });

  it('rejects a note longer than the column limit', async () => {
    const errors = await validate(
      plainToInstance(CreateTapStatusReportDto, {
        ...validTapReport,
        note: 'x'.repeat(501),
      }),
    );

    expect(errors).toHaveLength(1);
  });

  it('rejects a string observedAt', async () => {
    const errors = await validate(
      plainToInstance(CreateTapStatusReportDto, {
        ...validTapReport,
        observedAt: 'yesterday',
      }),
    );

    expect(errors).toHaveLength(1);
  });

  it('coerces an iso observedAt', async () => {
    const dto = plainToInstance(CreateTapStatusReportDto, {
      ...validTapReport,
      observedAt: '2026-09-27T09:00:00.000Z',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.observedAt).toBeInstanceOf(Date);
  });

  it('rejects explicit null for non nullable optional fields', async () => {
    const errors = await validate(
      plainToInstance(CreateTapStatusReportDto, {
        ...validTapReport,
        source: null,
        reliabilityWeight: null,
        observedAt: null,
      }),
    );

    expect(errors).toHaveLength(3);
  });

  it('accepts an explicit null note', async () => {
    const dto = plainToInstance(CreateTapStatusReportDto, {
      ...validTapReport,
      note: null,
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.note).toBeNull();
  });
});

describe('CreateQueueWaitReportDto', () => {
  it('accepts a minimal queue report', async () => {
    const dto = plainToInstance(CreateQueueWaitReportDto, validQueueReport);

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.source).toBe(ReportSource.CITIZEN_APP);
  });

  it('rejects a negative wait', async () => {
    const errors = await validate(
      plainToInstance(CreateQueueWaitReportDto, {
        standpipeId,
        waitMinutes: -5,
      }),
    );

    expect(errors).toHaveLength(1);
  });

  it('rejects a wait longer than a day', async () => {
    const errors = await validate(
      plainToInstance(CreateQueueWaitReportDto, {
        standpipeId,
        waitMinutes: 1441,
      }),
    );

    expect(errors).toHaveLength(1);
  });

  it('rejects a fractional wait', async () => {
    const errors = await validate(
      plainToInstance(CreateQueueWaitReportDto, {
        standpipeId,
        waitMinutes: 12.5,
      }),
    );

    expect(errors).toHaveLength(1);
  });

  it('accepts an explicit null queue size', async () => {
    const dto = plainToInstance(CreateQueueWaitReportDto, {
      ...validQueueReport,
      queueSize: null,
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.queueSize).toBeNull();
  });

  it('accepts a queue size within bounds', async () => {
    const dto = plainToInstance(CreateQueueWaitReportDto, {
      ...validQueueReport,
      queueSize: 0,
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.queueSize).toBe(0);
  });
});

describe('report list queries', () => {
  it('requires a standpipe for tap reports', async () => {
    expect(
      await validate(plainToInstance(ListTapReportsQueryDto, {})),
    ).toHaveLength(1);
  });

  it('applies pagination defaults', () => {
    const query = plainToInstance(ListTapReportsQueryDto, { standpipeId });

    expect(query.page).toBe(1);
    expect(query.limit).toBe(20);
    expect(query.skip).toBe(0);
    expect(query.take).toBe(20);
  });

  it('computes offsets for later pages', () => {
    const query = plainToInstance(ListTapReportsQueryDto, {
      standpipeId,
      page: 3,
      limit: 25,
    });

    expect(query.skip).toBe(50);
    expect(query.take).toBe(25);
  });

  it('rejects a limit above the maximum', async () => {
    const errors = await validate(
      plainToInstance(ListQueueReportsQueryDto, { standpipeId, limit: 500 }),
    );

    expect(errors).toHaveLength(1);
  });

  it('accepts an optional status filter', async () => {
    const query = plainToInstance(ListTapReportsQueryDto, {
      standpipeId,
      status: FlowStatus.DRY,
    });

    expect(await validate(query)).toHaveLength(0);
    expect(query.status).toBe(FlowStatus.DRY);
  });
});
