import { describe, it, expect } from 'vitest';
import { AppError, ErrorCodes } from '../src/errors.js';

describe('AppError', () => {
  it('创建一个 404 错误', () => {
    const err = new AppError(404, ErrorCodes.NOT_FOUND, '资源不存在', { id: '123' });
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('资源不存在');
    expect(err.details).toEqual({ id: '123' });
  });
});
