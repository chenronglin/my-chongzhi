import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { buildApp } from '@/app';
import { runSeed } from '@/database/seeds/0001_base.seed';
import { db, executeFile } from '@/lib/sql';

let runtime: Awaited<ReturnType<typeof buildApp>>;

const migrationFile = join(import.meta.dir, '../src/database/migrations/0001_init_schemas.sql');

async function rebuildManagedSchemas() {
  await db.unsafe(`
    DROP SCHEMA IF EXISTS iam CASCADE;
    DROP SCHEMA IF EXISTS channel CASCADE;
    DROP SCHEMA IF EXISTS product CASCADE;
    DROP SCHEMA IF EXISTS ordering CASCADE;
    DROP SCHEMA IF EXISTS supplier CASCADE;
    DROP SCHEMA IF EXISTS ledger CASCADE;
    DROP SCHEMA IF EXISTS risk CASCADE;
    DROP SCHEMA IF EXISTS notification CASCADE;
    DROP SCHEMA IF EXISTS worker CASCADE;
    DROP TABLE IF EXISTS public.app_migrations;
  `);

  await executeFile(migrationFile);
  await runSeed(db);
  await db`
    INSERT INTO product.recharge_products (
      id,
      product_code,
      product_name,
      carrier_code,
      province_name,
      face_value,
      recharge_mode,
      sales_unit,
      status
    )
    VALUES (
      'itest-product-cmcc-mixed-100',
      'itest-cmcc-mixed-100',
      '广东移动慢充 100 元',
      'CMCC',
      '广东',
      100,
      'MIXED',
      'CNY',
      'ACTIVE'
    )
    ON CONFLICT (product_code) DO NOTHING
  `;
  await db`
    INSERT INTO product.product_supplier_mappings (
      id,
      product_id,
      supplier_id,
      supplier_product_code,
      route_type,
      priority,
      cost_price,
      status
    )
    VALUES (
      'itest-product-mapping-cmcc-mixed-100',
      'itest-product-cmcc-mixed-100',
      'seed-supplier-mock',
      'itest-cmcc-mixed-100',
      'PRIMARY',
      1,
      98,
      'ACTIVE'
    )
    ON CONFLICT (product_id, supplier_id) DO NOTHING
  `;
}

beforeAll(async () => {
  await rebuildManagedSchemas();
  runtime = await buildApp({ startWorkerScheduler: false });
});

afterAll(() => {
  runtime.stop();
});

describe('ISP 充值商品匹配', () => {
  test('默认不传 product_type 时命中混充商品', async () => {
    const matched = await runtime.services.products.matchRechargeProduct({
      mobile: '13800138000',
      faceValue: 100,
    });

    expect(matched.mobileContext.province).toBe('广东');
    expect(matched.mobileContext.ispName).toBe('CMCC');
    expect(matched.product.productType).toBe('MIXED');
  });

  test('传 FAST 时命中快充商品', async () => {
    const matched = await runtime.services.products.matchRechargeProduct({
      mobile: '13800138000',
      faceValue: 100,
      productType: 'FAST',
    });

    expect(matched.product.productType).toBe('FAST');
  });
});
