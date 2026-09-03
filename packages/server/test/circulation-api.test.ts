import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppContext, createLogger, type AppContext } from '@school-library/core';
import { buildApp } from '../src/app.js';

const quietLogger = createLogger({ level: 'fatal' });

describe('circulation API', () => {
  let root: string;
  let context: AppContext;
  let app: FastifyInstance;
  let studentPublicId: string;
  let bookPublicId: string;

  const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload });
  const get = (url: string) => app.inject({ method: 'GET', url });

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'school-library-circ-'));
    context = createAppContext({ dataRoot: root, logger: quietLogger });
    app = buildApp(context);
    await app.ready();

    const student = await post('/api/v1/students', { firstName: 'שרה', lastName: 'כהן' });
    studentPublicId = (student.json() as { publicId: string }).publicId;

    const book = await post('/api/v1/books', { title: 'מסילת ישרים' });
    bookPublicId = (book.json() as { publicId: string }).publicId;
    await post('/api/v1/copies', { bookPublicId, barcode: '001796' });
  });

  afterEach(async () => {
    await app.close();
    context.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('checks a book out and back in', async () => {
    const out = await post('/api/v1/circulation/checkout', { studentPublicId, barcode: '001796' });
    expect(out.statusCode).toBe(201);
    const loan = out.json() as { publicId: string; dueAt: string; studentLastName: string };
    expect(loan.studentLastName).toBe('כהן');
    expect(loan.dueAt).toBeTruthy();

    const back = await post('/api/v1/circulation/checkin', { barcode: '001796' });
    expect(back.statusCode).toBe(200);
    const result = back.json() as { loan: { returnedAt: string }; wasOverdue: boolean };
    expect(result.loan.returnedAt).toBeTruthy();
    expect(result.wasOverdue).toBe(false);
  });

  it('reports a second checkout as a conflict naming the borrower', async () => {
    const other = await post('/api/v1/students', { firstName: 'יוסי', lastName: 'מזרחי' });
    const otherId = (other.json() as { publicId: string }).publicId;

    await post('/api/v1/circulation/checkout', { studentPublicId, barcode: '001796' });
    const second = await post('/api/v1/circulation/checkout', {
      studentPublicId: otherId,
      barcode: '001796',
    });

    expect(second.statusCode).toBe(409);
    const body = second.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('COPY_ALREADY_ON_LOAN');
    expect(body.error.message).toContain('שרה');
  });

  it('answers an unknown barcode with COPY_NOT_FOUND, not a server error', async () => {
    const response = await post('/api/v1/circulation/checkout', { studentPublicId, barcode: '999' });

    expect(response.statusCode).toBe(404);
    expect((response.json() as { error: { code: string } }).error.code).toBe('COPY_NOT_FOUND');
  });

  it('refuses to return a copy nobody has borrowed', async () => {
    const response = await post('/api/v1/circulation/checkin', { barcode: '001796' });

    expect(response.statusCode).toBe(409);
    expect((response.json() as { error: { code: string } }).error.code).toBe('NOT_ON_LOAN');
  });

  it('renews an open loan', async () => {
    const out = await post('/api/v1/circulation/checkout', { studentPublicId, barcode: '001796' });
    const loan = out.json() as { publicId: string; dueAt: string };

    const renewed = await post('/api/v1/circulation/renew', {
      loanPublicId: loan.publicId,
      extraDays: 7,
    });

    expect(renewed.statusCode).toBe(200);
    const body = renewed.json() as { renewalCount: number; dueAt: string };
    expect(body.renewalCount).toBe(1);
    expect(Date.parse(body.dueAt)).toBeGreaterThan(Date.parse(loan.dueAt));
  });

  it('returns the student card summary', async () => {
    await post('/api/v1/circulation/checkout', { studentPublicId, barcode: '001796' });

    const response = await get(`/api/v1/students/${studentPublicId}/library-summary`);
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      activeLoanCount: number;
      overdueCount: number;
      lifetimeLoanCount: number;
      activeLoans: Array<{ barcode: string }>;
    };
    expect(body.activeLoanCount).toBe(1);
    expect(body.overdueCount).toBe(0);
    expect(body.lifetimeLoanCount).toBe(1);
    expect(body.activeLoans[0]?.barcode).toBe('001796');
  });

  it('shows the current borrower on the book card (§16)', async () => {
    await post('/api/v1/circulation/checkout', { studentPublicId, barcode: '001796' });

    const response = await get(`/api/v1/books/${bookPublicId}`);
    const body = response.json() as {
      copies: Array<{ barcode: string; onLoan: boolean; borrowerName: string | null }>;
    };

    expect(body.copies[0]?.onLoan).toBe(true);
    expect(body.copies[0]?.borrowerName).toBe('שרה כהן');
  });

  it('filters loans by status', async () => {
    await post('/api/v1/circulation/checkout', { studentPublicId, barcode: '001796' });

    expect((((await get('/api/v1/loans?status=active')).json()) as { total: number }).total).toBe(1);
    expect((((await get('/api/v1/loans?status=overdue')).json()) as { total: number }).total).toBe(0);
    expect((((await get('/api/v1/loans?status=returned')).json()) as { total: number }).total).toBe(0);

    await post('/api/v1/circulation/checkin', { barcode: '001796' });

    expect((((await get('/api/v1/loans?status=active')).json()) as { total: number }).total).toBe(0);
    expect((((await get('/api/v1/loans?status=returned')).json()) as { total: number }).total).toBe(1);
  });

  it('rejects an unknown loan status rather than ignoring it', async () => {
    const response = await get('/api/v1/loans?status=whenever');

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe('VALIDATION');
  });
});
