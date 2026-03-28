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

  test('未命中省份商品时回退到全国商品', async () => {
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
        'itest-product-cmcc-national-30',
        'itest-cmcc-national-30',
        '全国移动慢充 30 元',
        'CMCC',
        '全国',
        30,
        'MIXED',
        'CNY',
        'ACTIVE'
      )
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
        'itest-product-mapping-cmcc-national-30',
        'itest-product-cmcc-national-30',
        'seed-supplier-mock',
        'itest-cmcc-national-30',
        'PRIMARY',
        1,
        29,
        'ACTIVE'
      )
    `;

    const matched = await runtime.services.products.matchRechargeProduct({
      mobile: '13800138000',
      faceValue: 30,
    });

    expect(matched.product.productCode).toBe('itest-cmcc-national-30');
    expect(matched.product.provinceName).toBe('全国');
  });

  test('命中多个有效商品时不会按创建时间静默兜底', async () => {
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
      VALUES
        (
          'itest-duplicate-product-1',
          'itest-duplicate-1',
          '广东移动慢充 80 元 A',
          'CMCC',
          '广东',
          80,
          'MIXED',
          'CNY',
          'ACTIVE'
        ),
        (
          'itest-duplicate-product-2',
          'itest-duplicate-2',
          '广东移动慢充 80 元 B',
          'CMCC',
          '广东',
          80,
          'MIXED',
          'CNY',
          'ACTIVE'
        )
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
      VALUES
        (
          'itest-duplicate-mapping-1',
          'itest-duplicate-product-1',
          'seed-supplier-mock',
          'itest-duplicate-1',
          'PRIMARY',
          1,
          79,
          'ACTIVE'
        ),
        (
          'itest-duplicate-mapping-2',
          'itest-duplicate-product-2',
          'seed-supplier-mock',
          'itest-duplicate-2',
          'PRIMARY',
          1,
          79,
          'ACTIVE'
        )
    `;

    await expect(
      runtime.services.products.matchRechargeProduct({
        mobile: '13800138000',
        faceValue: 80,
      }),
    ).rejects.toThrow('命中多个有效充值商品');
  });
});
