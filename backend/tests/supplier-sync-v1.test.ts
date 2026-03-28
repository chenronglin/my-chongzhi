import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';

import { buildApp } from '@/app';
import { runSeed } from '@/database/seeds/0001_base.seed';
import { db, executeFile } from '@/lib/sql';
import { resetTestState } from './test-support';

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
}

function normalizeJsonLike(input: unknown) {
  if (typeof input === 'string') {
    return JSON.parse(input) as Record<string, unknown>;
  }

  return (input ?? {}) as Record<string, unknown>;
}

beforeAll(async () => {
  await rebuildManagedSchemas();
  await runSeed(db);
  runtime = await buildApp({
    startWorkerScheduler: false,
  });
});

beforeEach(async () => {
  await resetTestState();
});

afterAll(() => {
  runtime.stop();
});

test('动态目录同步会刷新商品价格库存并记录同步日志', async () => {
  await runtime.services.suppliers.syncDynamicCatalog({
    supplierCode: 'mock-supplier',
    items: [
      {
        productCode: 'cmcc-mixed-50',
        salesStatus: 'ON_SALE',
        purchasePrice: 47.25,
        inventoryQuantity: 88,
      },
    ],
  });

  const productRows = await db<
    {
      salesStatus: string;
      purchasePrice: string;
      inventoryQuantity: number;
      dynamicUpdatedAt: string | null;
    }[]
  >`
    SELECT
      sales_status AS "salesStatus",
      purchase_price::text AS "purchasePrice",
      inventory_quantity AS "inventoryQuantity",
      dynamic_updated_at::text AS "dynamicUpdatedAt"
    FROM product.recharge_products
    WHERE product_code = 'cmcc-mixed-50'
    LIMIT 1
  `;
  const logRows = await db<
    {
      syncType: string;
      status: string;
      responsePayloadJson: Record<string, unknown>;
    }[]
  >`
    SELECT
      sync_type AS "syncType",
      status,
      response_payload_json AS "responsePayloadJson"
    FROM product.product_sync_logs
    ORDER BY created_at DESC
    LIMIT 1
  `;

  expect(productRows[0]).toMatchObject({
    salesStatus: 'ON_SALE',
    purchasePrice: '47.25',
    inventoryQuantity: 88,
  });
  expect(productRows[0]?.dynamicUpdatedAt).toBeTruthy();
  expect(logRows[0]).toMatchObject({
    syncType: 'DYNAMIC',
    status: 'SUCCESS',
  });
  expect(normalizeJsonLike(logRows[0]?.responsePayloadJson)).toMatchObject({
    updatedProducts: ['cmcc-mixed-50'],
  });
});

test('全量目录同步会退役供应商缺失商品映射并让商品下架', async () => {
  await runtime.services.suppliers.syncFullCatalog({
    supplierCode: 'mock-supplier',
    items: [
      {
        productCode: 'cmcc-fast-100',
        productName: '广东移动快充 100 元',
        carrierCode: 'CMCC',
        provinceName: '广东',
        faceValue: 100,
        rechargeMode: 'FAST',
        salesUnit: 'CNY',
        salesStatus: 'ON_SALE',
        purchasePrice: 95.5,
        inventoryQuantity: 120,
        supplierProductCode: 'mock-cmcc-fast-100',
      },
    ],
  });

  const mappingRows = await db<
    {
      status: string;
    }[]
  >`
    SELECT status
    FROM product.product_supplier_mappings
    WHERE product_id = 'seed-product-cmcc-mixed-50'
      AND supplier_id = 'seed-supplier-mock'
    LIMIT 1
  `;
  const productRows = await db<
    {
      salesStatus: string;
      inventoryQuantity: number;
    }[]
  >`
    SELECT
      sales_status AS "salesStatus",
      inventory_quantity AS "inventoryQuantity"
    FROM product.recharge_products
    WHERE id = 'seed-product-cmcc-mixed-50'
    LIMIT 1
  `;

  expect(mappingRows[0]?.status).toBe('INACTIVE');
  expect(productRows[0]).toMatchObject({
    salesStatus: 'OFF_SALE',
    inventoryQuantity: 0,
  });
  await expect(
    runtime.services.products.matchRechargeProduct({
      mobile: '13800130000',
      faceValue: 50,
      productType: 'MIXED',
    }),
  ).rejects.toThrow('未匹配到可用充值商品');
});
