import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

describe('catalog API', () => {
  let harness: TestApp;

  beforeEach(async () => {
    harness = await createTestApp();
  });

  afterEach(async () => {
    await harness.close();
  });

  const post = (url: string, payload?: unknown) => harness.post(url, payload);
  const patch = (url: string, payload: unknown) => harness.patch(url, payload);
  const get = (url: string) => harness.get(url);

  it('creates a class and a student in it', async () => {
    const klass = await post('/api/v1/classes', { name: 'ז-1', grade: 'ז' });
    expect(klass.statusCode).toBe(201);
    const classPublicId = (klass.json() as { publicId: string }).publicId;

    const student = await post('/api/v1/students', {
      firstName: 'שרה',
      lastName: 'כהן',
      classPublicId,
    });
    expect(student.statusCode).toBe(201);
    expect((student.json() as { className: string }).className).toBe('ז-1');
  });

  it('rejects a student with no name, with a field-level code', async () => {
    const response = await post('/api/v1/students', { firstName: '', lastName: 'כהן' });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.message).toContain('שם פרטי');
  });

  it('creates a book with copies and returns them together', async () => {
    const book = await post('/api/v1/books', { title: 'מסילת ישרים', authorText: 'רמח"ל' });
    const bookPublicId = (book.json() as { publicId: string }).publicId;

    await post('/api/v1/copies', { bookPublicId, barcode: '001796' });
    await post('/api/v1/copies', { bookPublicId, barcode: '001797' });

    const detail = await get(`/api/v1/books/${bookPublicId}`);
    const body = detail.json() as { copyCount: number; copies: Array<{ barcode: string }> };

    expect(body.copyCount).toBe(2);
    expect(body.copies.map((copy) => copy.barcode)).toEqual(['001796', '001797']);
  });

  it('answers a barcode scan exactly, preserving leading zeros', async () => {
    const book = await post('/api/v1/books', { title: 'ספר' });
    const bookPublicId = (book.json() as { publicId: string }).publicId;
    await post('/api/v1/copies', { bookPublicId, barcode: '0000123' });

    const hit = await get('/api/v1/copies/by-barcode/0000123');
    expect(hit.statusCode).toBe(200);
    expect((hit.json() as { barcode: string }).barcode).toBe('0000123');

    const miss = await get('/api/v1/copies/by-barcode/123');
    expect(miss.statusCode).toBe(404);
    expect((miss.json() as { error: { code: string } }).error.code).toBe('BARCODE_NOT_FOUND');
  });

  it('reports a duplicate barcode as a conflict, not a server error', async () => {
    const book = await post('/api/v1/books', { title: 'ספר' });
    const bookPublicId = (book.json() as { publicId: string }).publicId;

    await post('/api/v1/copies', { bookPublicId, barcode: '555' });
    const duplicate = await post('/api/v1/copies', { bookPublicId, barcode: '555' });

    expect(duplicate.statusCode).toBe(409);
    const body = duplicate.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('DUPLICATE_BARCODE');
    expect(body.error.message).toContain('555');
  });

  it('searches books and filters students by class', async () => {
    const klass = await post('/api/v1/classes', { name: 'ח-2' });
    const classPublicId = (klass.json() as { publicId: string }).publicId;
    await post('/api/v1/students', { firstName: 'יוסי', lastName: 'מזרחי', classPublicId });
    await post('/api/v1/students', { firstName: 'רונית', lastName: 'אברהם' });
    await post('/api/v1/books', { title: 'מסילת ישרים' });
    await post('/api/v1/books', { title: 'שערי תשובה' });

    const byClass = await get(`/api/v1/students?classPublicId=${classPublicId}`);
    expect((byClass.json() as { total: number }).total).toBe(1);

    const search = await get('/api/v1/books?query=%D7%9E%D7%A1%D7%99%D7%9C%D7%AA');
    expect((search.json() as { total: number }).total).toBe(1);
  });

  it('deactivates a student through PATCH rather than deleting', async () => {
    const created = await post('/api/v1/students', { firstName: 'דוד', lastName: 'לוי' });
    const publicId = (created.json() as { publicId: string }).publicId;

    const updated = await patch(`/api/v1/students/${publicId}`, { active: false });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { active: boolean }).active).toBe(false);

    // Still retrievable — history must survive (§7).
    const fetched = await get(`/api/v1/students/${publicId}`);
    expect(fetched.statusCode).toBe(200);

    const deleteAttempt = await harness.app.inject({ method: 'DELETE', headers: { cookie: harness.cookie }, url: `/api/v1/students/${publicId}` });
    expect(deleteAttempt.statusCode).toBe(404);
  });

  it('returns 404 with a code for an unknown record', async () => {
    const response = await get('/api/v1/books/does-not-exist');

    expect(response.statusCode).toBe(404);
    expect((response.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed body at the boundary', async () => {
    const response = await post('/api/v1/books', { title: { nested: 'object' } });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION');
  });

  it('never leaks SQL or internal identifiers in an error', async () => {
    const response = await post('/api/v1/copies', { bookPublicId: 'missing', barcode: '1' });

    expect(response.statusCode).toBe(400);
    expect(response.body.toUpperCase()).not.toContain('INSERT');
    expect(response.body).not.toContain('sqlite');
  });
});
