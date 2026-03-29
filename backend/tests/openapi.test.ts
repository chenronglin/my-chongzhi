import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';

let runtime: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  runtime = await buildApp({ startWorkerScheduler: false });
});

afterAll(() => {
  runtime.stop();
});

describe('OpenAPI 文档服务', () => {
  test('/openapi/json 应返回 OpenAPI 规范', async () => {
    const response = await runtime.app.handle(new Request('http://localhost/openapi/json'));
    const json = (await response.json()) as {
      openapi?: string;
      info?: Record<string, unknown>;
      tags?: Array<{ name?: string }>;
      paths?: Record<string, { get?: { summary?: string; tags?: string[] } }>;
    };

    expect(response.status).toBe(200);
    expect(json.openapi).toBeTruthy();
    expect(json.info).toMatchObject({
      title: 'ISP 话费充值平台 API',
      version: '1.0.0',
    });
    expect(json.tags?.some((tag) => tag.name === 'open-api')).toBe(true);
    expect(json.paths?.['/health']).toBeTruthy();
    expect(json.paths?.['/open-api/products/']?.get?.summary).toBe('列出可售充值商品');
    expect(json.paths?.['/open-api/products/']?.get?.tags).toContain('open-api');
  });
});
