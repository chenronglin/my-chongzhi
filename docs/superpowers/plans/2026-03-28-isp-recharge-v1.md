# ISP 话费充值 V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以破坏性更新方式把当前后端重建为“只做 ISP 话费充值 V1”的全新项目，实现 `mobile + faceValue + product_type` 下单、自动商品匹配、余额扣款、快充/混充 SLA、供应商同步与对账，并提供 OpenAPI 文档服务便于调试接口。

**Architecture:** 不做兼容层，不保留通用数字商品抽象，不保留独立支付服务。数据库初始迁移、种子数据、应用装配、核心模块契约全部按 ISP 话费充值 V1 重新设计：商品模型直接使用 `recharge_products`，下单直接走订单编排 + 账务扣款，供应商同步/日志/对账作为一等能力，OpenAPI 由 `@elysiajs/openapi` 直接暴露在 `/openapi` 与 `/openapi/json`。

**Tech Stack:** Bun, ElysiaJS, TypeBox, `@elysiajs/openapi`, Bun SQL/PostgreSQL, Bun Test, Biome

---

## 范围声明

这是一个新项目风格的重建计划，不追求兼容已有代码和已有数据。实施期间允许：

1. 重写现有初始迁移。
2. 重写现有种子脚本。
3. 删除整个 `payments` 模块。
4. 重写 `products / orders / suppliers / ledger / notifications / worker` 模块内部实现。
5. 删除旧测试并用新的 ISP 充值 V1 测试替换。

不在本计划内：

- 流量充值
- 慢充
- 微信/支付宝在线支付
- 多级分润
- 结算单工作流
- 短信/邮件通知
- 人工审核

## 目标代码结构

### 删除的目录

- `backend/src/modules/payments/`

### 保留并重写的目录

- `backend/src/modules/iam/`
- `backend/src/modules/channels/`
- `backend/src/modules/products/`
- `backend/src/modules/orders/`
- `backend/src/modules/suppliers/`
- `backend/src/modules/ledger/`
- `backend/src/modules/risk/`
- `backend/src/modules/notifications/`
- `backend/src/modules/worker/`

### 新增文件

- `backend/src/lib/mobile-lookup.ts`
- `backend/tests/openapi.test.ts`
- `backend/tests/mobile-matching.test.ts`
- `backend/tests/order-flow-v1.test.ts`
- `backend/tests/order-timeout-v1.test.ts`
- `backend/tests/supplier-sync-v1.test.ts`
- `backend/tests/supplier-reconcile-v1.test.ts`

### 重点重写文件

- `backend/package.json`
- `backend/src/app.ts`
- `backend/src/database/migrations/0001_init_schemas.sql`
- `backend/src/database/seeds/0001_base.seed.ts`
- `backend/src/modules/products/*`
- `backend/src/modules/orders/*`
- `backend/src/modules/suppliers/*`
- `backend/src/modules/ledger/*`
- `backend/src/modules/notifications/*`
- `backend/src/modules/worker/*`

### 目标表结构

必须收敛为以下直白模型，不保留通用商城抽象：

- `iam.admin_users`
- `iam.roles`
- `iam.user_role_relations`
- `iam.operation_audit_logs`
- `channel.channels`
- `channel.channel_api_credentials`
- `channel.channel_product_authorizations`
- `channel.channel_price_policies`
- `channel.channel_limit_rules`
- `channel.channel_callback_configs`
- `product.mobile_segments`
- `product.recharge_products`
- `product.product_supplier_mappings`
- `product.product_sync_logs`
- `ordering.orders`
- `ordering.order_events`
- `supplier.suppliers`
- `supplier.supplier_configs`
- `supplier.supplier_request_logs`
- `supplier.supplier_callback_logs`
- `supplier.supplier_reconcile_diffs`
- `supplier.supplier_runtime_breakers`
- `ledger.accounts`
- `ledger.account_ledgers`
- `risk.risk_rules`
- `risk.risk_black_white_list`
- `risk.risk_decisions`
- `notification.notification_tasks`
- `notification.notification_delivery_logs`
- `notification.notification_dead_letters`
- `worker.worker_jobs`
- `worker.worker_job_attempts`
- `worker.worker_dead_letters`

---

### Task 1: 重置应用基础设施并接入 OpenAPI

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/src/app.ts`
- Create: `backend/tests/openapi.test.ts`
- Delete: `backend/src/modules/payments/index.ts`
- Delete: `backend/src/modules/payments/payments.routes.ts`
- Delete: `backend/src/modules/payments/payments.service.ts`
- Delete: `backend/src/modules/payments/payments.repository.ts`
- Delete: `backend/src/modules/payments/payments.schema.ts`
- Delete: `backend/src/modules/payments/payments.sql.ts`
- Delete: `backend/src/modules/payments/payments.types.ts`
- Delete: `backend/src/modules/payments/contracts.ts`
- Delete: `backend/src/modules/payments/README.md`

- [ ] **Step 1: 先写失败的 OpenAPI 文档测试**

```ts
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
    const response = await runtime.app.handle(
      new Request('http://localhost/openapi/json'),
    );
    const json = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(json.openapi).toBeTruthy();
    expect(json.info).toMatchObject({
      title: 'ISP 话费充值平台 API',
    });
  });
});
```

- [ ] **Step 2: 运行测试，确认当前尚未提供 OpenAPI**

Run:

```bash
cd /Users/moses/Developer/Docs/backend && bun test tests/openapi.test.ts
```

Expected:

```text
FAIL
Expected: 200
Received: 404
```

- [ ] **Step 3: 安装 `@elysiajs/openapi` 并重置应用装配**

先安装依赖：

```bash
cd /Users/moses/Developer/Docs/backend && bun add @elysiajs/openapi
```

然后把 `backend/package.json` 至少改成：

```json
{
  "name": "docs-backend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test",
    "lint": "biome check src tests",
    "format": "biome check --write src tests",
    "db:migrate": "bun run src/database/migrate.ts",
    "db:seed": "bun run src/database/seed.ts"
  },
  "dependencies": {
    "@elysiajs/jwt": "^1.4.1",
    "@elysiajs/openapi": "^1.4.0",
    "elysia": "^1.4.28"
  }
}
```

把 `backend/src/app.ts` 重写成“不导入 payments 模块”的装配方式，并接入 OpenAPI：

```ts
import { Elysia } from 'elysia';
import { openapi } from '@elysiajs/openapi';

import { env } from '@/lib/env';
import { createChannelsModule } from '@/modules/channels';
import { createIamModule } from '@/modules/iam';
import { createLedgerModule } from '@/modules/ledger';
import { createNotificationsModule } from '@/modules/notifications';
import { createOrdersModule } from '@/modules/orders';
import { createProductsModule } from '@/modules/products';
import { createRiskModule } from '@/modules/risk';
import { createSuppliersModule } from '@/modules/suppliers';
import { createWorkerModule } from '@/modules/worker';
import { createAuthPlugin } from '@/plugins/auth.plugin';
import { createErrorPlugin } from '@/plugins/error.plugin';
import { createRequestContextPlugin } from '@/plugins/request-context.plugin';

export async function buildApp(options: { startWorkerScheduler?: boolean } = {}) {
  const iamModule = createIamModule();
  const workerModule = createWorkerModule(iamModule.service);
  const channelsModule = createChannelsModule(iamModule.service);
  const productsModule = createProductsModule(iamModule.service, channelsModule.service);
  const riskModule = createRiskModule(iamModule.service);
  const ledgerModule = createLedgerModule(iamModule.service);
  const ordersModule = createOrdersModule({
    iamService: iamModule.service,
    channelsService: channelsModule.service,
    channelsContract: channelsModule.contract,
    productsContract: productsModule.contract,
    riskContract: riskModule.contract,
    ledgerContract: ledgerModule.contract,
    workerContract: workerModule.contract,
  });
  const suppliersModule = createSuppliersModule({
    iamService: iamModule.service,
    orderContract: ordersModule.contract,
    productsService: productsModule.service,
    workerContract: workerModule.contract,
  });
  const notificationsModule = createNotificationsModule({
    iamService: iamModule.service,
    orderContract: ordersModule.contract,
    workerContract: workerModule.contract,
  });

  const app = new Elysia()
    .use(
      openapi({
        documentation: {
          info: {
            title: 'ISP 话费充值平台 API',
            version: '1.0.0',
            description: 'ISP 话费充值 V1 的后台、开放、内部接口文档',
          },
          tags: [
            { name: 'open-api', description: '渠道开放接口' },
            { name: 'admin', description: '后台管理接口' },
            { name: 'internal', description: '内部服务接口' },
            { name: 'callbacks', description: '供应商回调接口' },
          ],
        },
        path: '/openapi',
      }),
    )
    .use(createRequestContextPlugin())
    .use(createErrorPlugin())
    .use(createAuthPlugin())
    .get('/health', () => ({
      code: 0,
      message: 'success',
      data: {
        env: env.appEnv,
        status: 'ok',
      },
    }))
    .use(iamModule.routes)
    .use(channelsModule.routes)
    .use(productsModule.routes)
    .use(riskModule.routes)
    .use(workerModule.routes)
    .use(ledgerModule.routes)
    .use(ordersModule.routes)
    .use(suppliersModule.routes)
    .use(notificationsModule.routes);

  if (options.startWorkerScheduler ?? true) {
    workerModule.service.startScheduler();
  }

  return {
    app,
    services: {
      iam: iamModule.service,
      channels: channelsModule.service,
      products: productsModule.service,
      risk: riskModule.service,
      worker: workerModule.service,
      ledger: ledgerModule.service,
      orders: ordersModule.service,
      suppliers: suppliersModule.service,
      notifications: notificationsModule.service,
    },
    stop() {
      workerModule.service.stopScheduler();
    },
  };
}
```

- [ ] **Step 4: 删除整个 `payments` 模块**

Run:

```bash
cd /Users/moses/Developer/Docs && git rm -r backend/src/modules/payments
```

Expected:

```text
rm 'backend/src/modules/payments/...'
```

- [ ] **Step 5: 运行 OpenAPI 测试，确认文档服务可用**

Run:

```bash
cd /Users/moses/Developer/Docs/backend && bun test tests/openapi.test.ts
```

Expected:

```text
PASS
1 test passed
```

- [ ] **Step 6: 提交基础设施重建**

```bash
git add backend/package.json backend/bun.lock backend/src/app.ts backend/tests/openapi.test.ts
git commit -m "feat: reset app foundation and add openapi docs"
```

### Task 2: 直接重写初始数据库模型和种子数据

**Files:**
- Modify: `backend/src/database/migrations/0001_init_schemas.sql`
- Modify: `backend/src/database/seeds/0001_base.seed.ts`
- Create: `backend/tests/schema-v1.test.ts`

- [ ] **Step 1: 先写失败的表结构测试**

```ts
import { expect, test } from 'bun:test';

import { db } from '@/lib/sql';

test('数据库应只有 ISP 充值 V1 所需核心表', async () => {
  const rows = await db.unsafe<{ table_name: string }[]>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'product'
    ORDER BY table_name
  `);

  expect(rows.map((row) => row.table_name)).toEqual([
    'mobile_segments',
    'product_supplier_mappings',
    'product_sync_logs',
    'recharge_products',
  ]);
});
```

- [ ] **Step 2: 运行测试，确认旧模型仍然存在**

Run:

```bash
cd /Users/moses/Developer/Docs/backend && bun test tests/schema-v1.test.ts
```

Expected:

```text
FAIL
Expected product tables to equal simplified list
```

- [ ] **Step 3: 重写 `0001_init_schemas.sql`，只保留新模型**

将 `backend/src/database/migrations/0001_init_schemas.sql` 直接重写为以下结构：

```sql
DROP SCHEMA IF EXISTS worker CASCADE;
DROP SCHEMA IF EXISTS notification CASCADE;
DROP SCHEMA IF EXISTS risk CASCADE;
DROP SCHEMA IF EXISTS ledger CASCADE;
DROP SCHEMA IF EXISTS supplier CASCADE;
DROP SCHEMA IF EXISTS ordering CASCADE;
DROP SCHEMA IF EXISTS product CASCADE;
DROP SCHEMA IF EXISTS channel CASCADE;
DROP SCHEMA IF EXISTS iam CASCADE;

CREATE SCHEMA iam;
CREATE SCHEMA channel;
CREATE SCHEMA product;
CREATE SCHEMA ordering;
CREATE SCHEMA supplier;
CREATE SCHEMA ledger;
CREATE SCHEMA risk;
CREATE SCHEMA notification;
CREATE SCHEMA worker;

CREATE TABLE iam.admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE iam.roles (
  id TEXT PRIMARY KEY,
  role_code TEXT NOT NULL UNIQUE,
  role_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE iam.user_role_relations (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE iam.operation_audit_logs (
  id TEXT PRIMARY KEY,
  operator_user_id TEXT,
  operator_username TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE channel.channels (
  id TEXT PRIMARY KEY,
  channel_code TEXT NOT NULL UNIQUE,
  channel_name TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  parent_channel_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE channel.channel_api_credentials (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL UNIQUE,
  access_key TEXT NOT NULL UNIQUE,
  secret_key_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE channel.channel_product_authorizations (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE channel.channel_price_policies (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  sale_price NUMERIC(18, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE channel.channel_limit_rules (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL UNIQUE,
  single_limit NUMERIC(18, 2) NOT NULL,
  daily_limit NUMERIC(18, 2) NOT NULL,
  qps_limit INTEGER NOT NULL
);

CREATE TABLE channel.channel_callback_configs (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL UNIQUE,
  callback_url TEXT NOT NULL,
  sign_secret_encrypted TEXT NOT NULL,
  retry_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  timeout_seconds INTEGER NOT NULL DEFAULT 5
);

CREATE TABLE product.mobile_segments (
  prefix TEXT PRIMARY KEY,
  province TEXT NOT NULL,
  isp_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE product.recharge_products (
  id TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  province TEXT NOT NULL,
  isp_name TEXT NOT NULL,
  face_value NUMERIC(18, 2) NOT NULL,
  product_type TEXT NOT NULL,
  purchase_price NUMERIC(18, 2) NOT NULL,
  inventory_quantity INTEGER NOT NULL DEFAULT 0,
  sales_status TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  dynamic_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (province, isp_name, face_value, product_type)
);

CREATE TABLE product.product_supplier_mappings (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  supplier_product_code TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE product.product_sync_logs (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ordering.orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  channel_order_no TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  parent_channel_id TEXT,
  mobile TEXT NOT NULL,
  province TEXT NOT NULL,
  isp_name TEXT NOT NULL,
  face_value NUMERIC(18, 2) NOT NULL,
  requested_product_type TEXT NOT NULL,
  matched_product_id TEXT NOT NULL,
  sale_price NUMERIC(18, 2) NOT NULL,
  purchase_price NUMERIC(18, 2) NOT NULL,
  main_status TEXT NOT NULL,
  supplier_status TEXT NOT NULL,
  notify_status TEXT NOT NULL,
  refund_status TEXT NOT NULL,
  monitor_status TEXT NOT NULL,
  warning_deadline_at TIMESTAMPTZ NOT NULL,
  expire_deadline_at TIMESTAMPTZ NOT NULL,
  channel_snapshot_json JSONB NOT NULL,
  product_snapshot_json JSONB NOT NULL,
  callback_snapshot_json JSONB NOT NULL,
  supplier_route_snapshot_json JSONB NOT NULL,
  risk_snapshot_json JSONB NOT NULL,
  ext_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  UNIQUE (channel_id, channel_order_no)
);
```

继续在同一个迁移文件里补齐：

- `ordering.order_events`
- `supplier.suppliers`
- `supplier.supplier_configs`
- `supplier.supplier_request_logs`
- `supplier.supplier_callback_logs`
- `supplier.supplier_reconcile_diffs`
- `supplier.supplier_runtime_breakers`
- `ledger.accounts`
- `ledger.account_ledgers`
- `risk.risk_rules`
- `risk.risk_black_white_list`
- `risk.risk_decisions`
- `notification.notification_tasks`
- `notification.notification_delivery_logs`
- `notification.notification_dead_letters`
- `worker.worker_jobs`
- `worker.worker_job_attempts`
- `worker.worker_dead_letters`

- [ ] **Step 4: 重写种子数据，只种 ISP 充值场景**

把 `backend/src/database/seeds/0001_base.seed.ts` 重写为只包含：

```ts
// 管理员
// demo-channel
// mock-supplier
// 广东移动 100 元混充
// 广东移动 100 元快充
// 号段 1380013 -> 广东 / CMCC
// 渠道授权、渠道售价、回调配置、余额账户
```

最低要求的种子断言：

- 一个后台管理员
- 一个演示渠道
- 一个 mock 供应商
- 两个商品：`MIXED` 和 `FAST`
- 一个可用余额账户

- [ ] **Step 5: 重新跑 schema 测试**

Run:

```bash
cd /Users/moses/Developer/Docs/backend && bun test tests/schema-v1.test.ts
```

Expected:

```text
PASS
1 test passed
```

- [ ] **Step 6: 提交数据库重置**

```bash
git add backend/src/database/migrations/0001_init_schemas.sql backend/src/database/seeds/0001_base.seed.ts backend/tests/schema-v1.test.ts
git commit -m "feat: reset schema for isp recharge v1"
```

### Task 3: 先重建商品匹配与渠道策略，不做任何兼容层

**Files:**
- Create: `backend/src/lib/mobile-lookup.ts`
- Modify: `backend/src/modules/products/contracts.ts`
- Modify: `backend/src/modules/products/products.types.ts`
- Modify: `backend/src/modules/products/products.repository.ts`
- Modify: `backend/src/modules/products/products.service.ts`
- Modify: `backend/src/modules/products/products.routes.ts`
- Modify: `backend/src/modules/channels/contracts.ts`
- Modify: `backend/src/modules/channels/channels.types.ts`
- Modify: `backend/src/modules/channels/channels.repository.ts`
- Modify: `backend/src/modules/channels/channels.service.ts`
- Create: `backend/tests/mobile-matching.test.ts`

- [ ] **Step 1: 写失败的商品自动匹配测试**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';

let runtime: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
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
```

- [ ] **Step 2: 运行测试，确认匹配接口还不存在**

Run:

```bash
cd /Users/moses/Developer/Docs/backend && bun test tests/mobile-matching.test.ts
```

Expected:

```text
FAIL
matchRechargeProduct is not a function
```

- [ ] **Step 3: 重写商品模块 contract、repository、service**

`backend/src/lib/mobile-lookup.ts`：

```ts
import { badRequest } from '@/lib/errors';
import { db, first } from '@/lib/sql';

export async function resolveMobileContext(mobile: string) {
  const normalized = mobile.replace(/\D/g, '');

  if (!/^\d{11}$/.test(normalized)) {
    throw badRequest('mobile 必须是 11 位手机号');
  }

  const prefix = normalized.slice(0, 7);
  const segment = await first<{ province: string; ispName: string }>(db`
    SELECT province, isp_name AS "ispName"
    FROM product.mobile_segments
    WHERE prefix = ${prefix}
    LIMIT 1
  `);

  if (!segment) {
    throw badRequest('不支持的手机号号段');
  }

  return {
    mobile: normalized,
    province: segment.province,
    ispName: segment.ispName,
  };
}
```

`backend/src/modules/products/contracts.ts`：

```ts
export interface ProductContract {
  matchRechargeProduct(input: {
    mobile: string;
    faceValue: number;
    productType?: 'FAST' | 'MIXED';
  }): Promise<{
    mobileContext: {
      mobile: string;
      province: string;
      ispName: string;
    };
    product: RechargeProduct;
    supplierCandidates: ProductSupplierMapping[];
  }>;
}
```

`backend/src/modules/products/products.service.ts` 的核心逻辑必须直接按新表查询：

```ts
async matchRechargeProduct(input: {
  mobile: string;
  faceValue: number;
  productType?: 'FAST' | 'MIXED';
}) {
  const mobileContext = await resolveMobileContext(input.mobile);
  const productType = input.productType ?? 'MIXED';
  const product = await this.repository.findBestMatchedProduct({
    province: mobileContext.province,
    ispName: mobileContext.ispName,
    faceValue: input.faceValue,
    productType,
  });

  if (!product) {
    throw badRequest('未找到可售充值商品');
  }

  const supplierCandidates = await this.repository.listSupplierMappings(product.id);

  if (supplierCandidates.length === 0) {
    throw badRequest('商品没有可用供应商映射');
  }

  return {
    mobileContext,
    product,
    supplierCandidates,
  };
}
```

`backend/src/modules/channels/contracts.ts` 只保留 `productId` 口径：

```ts
export interface ChannelContract {
  authenticateOpenRequest(input: {
    accessKey: string;
    signature: string;
    timestamp: string;
    nonce: string;
    method: string;
    path: string;
    bodyText: string;
  }): Promise<OpenChannelContext>;
  getOrderPolicy(input: {
    channelId: string;
    productId: string;
    orderAmount: number;
  }): Promise<OrderPolicy>;
}
```

- [ ] **Step 4: 给开放查询接口补上 OpenAPI 元数据**

`backend/src/modules/products/products.routes.ts` 至少为内部匹配接口和开放商品列表接口增加 `detail`：

```ts
.get('/open-api/products', async ({ request }) => {
  return ok(getRequestIdFromRequest(request), await productsService.listProducts());
}, {
  detail: {
    tags: ['open-api'],
    summary: '查询可售充值商品',
    description: '返回当前可售的 ISP 话费充值商品列表',
  },
})
```

- [ ] **Step 5: 跑商品匹配测试**

Run:

```bash
cd /Users/moses/Developer/Docs/backend && bun test tests/mobile-matching.test.ts
```

Expected:

```text
PASS
2 tests passed
```

- [ ] **Step 6: 提交商品与渠道策略重建**

```bash
git add backend/src/lib/mobile-lookup.ts \
  backend/src/modules/products/contracts.ts \
  backend/src/modules/products/products.types.ts \
  backend/src/modules/products/products.repository.ts \
  backend/src/modules/products/products.service.ts \
  backend/src/modules/products/products.routes.ts \
  backend/src/modules/channels/contracts.ts \
  backend/src/modules/channels/channels.types.ts \
  backend/src/modules/channels/channels.repository.ts \
  backend/src/modules/channels/channels.service.ts \
  backend/tests/mobile-matching.test.ts
git commit -m "feat: rebuild recharge product matching and channel policy"
```

### Task 4: 重建订单编排、余额账务与风控

**Files:**
- Modify: `backend/src/modules/orders/contracts.ts`
- Modify: `backend/src/modules/orders/orders.types.ts`
- Modify: `backend/src/modules/orders/orders.repository.ts`
- Modify: `backend/src/modules/orders/orders.schema.ts`
- Modify: `backend/src/modules/orders/orders.routes.ts`
- Modify: `backend/src/modules/orders/orders.service.ts`
- Modify: `backend/src/modules/ledger/contracts.ts`
- Modify: `backend/src/modules/ledger/ledger.types.ts`
- Modify: `backend/src/modules/ledger/ledger.repository.ts`
- Modify: `backend/src/modules/ledger/ledger.service.ts`
- Modify: `backend/src/modules/risk/contracts.ts`
- Modify: `backend/src/modules/risk/risk.service.ts`
- Create: `backend/tests/order-flow-v1.test.ts`

- [ ] **Step 1: 先写失败的主交易链路测试**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';
import { buildOpenApiCanonicalString, signOpenApiPayload } from '@/lib/security';
import { stableStringify } from '@/lib/utils';

let runtime: Awaited<ReturnType<typeof buildApp>>;

function buildSignedHeaders(path: string, body: Record<string, unknown>) {
  const timestamp = String(Date.now());
  const nonce = `nonce-${Date.now()}`;
  const bodyText = stableStringify(body);
  const canonical = buildOpenApiCanonicalString({
    method: 'POST',
    path,
    timestamp,
    nonce,
    body: bodyText,
  });

  return {
    'content-type': 'application/json',
    AccessKey: 'demo-access-key',
    Sign: signOpenApiPayload('demo-secret-key', canonical),
    Timestamp: timestamp,
    Nonce: nonce,
  };
}

beforeAll(async () => {
  runtime = await buildApp({ startWorkerScheduler: false });
});

afterAll(() => {
  runtime.stop();
});

describe('ISP 充值主链路', () => {
  test('mobile + faceValue + product_type 可以完成余额扣款和订单创建', async () => {
    const body = {
      channelOrderNo: `itest-${Date.now()}`,
      mobile: '13800138000',
      faceValue: 100,
      product_type: 'MIXED',
    };

    const response = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders('/open-api/orders', body),
        body: JSON.stringify(body),
      }),
    );
    const json = await response.json() as {
      code: number;
      data: {
        orderNo: string;
        mainStatus: string;
        matchedProductId: string;
      };
    };

    expect(json.code).toBe(0);
    expect(json.data.orderNo).toBeTruthy();
    expect(json.data.mainStatus).toBe('CREATED');
    expect(json.data.matchedProductId).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试，确认新下单契约尚未落地**

Run:

```bash
cd /Users/moses/Developer/Docs/backend && bun test tests/order-flow-v1.test.ts
```

Expected:

```text
FAIL
status 400 or property missing
```

- [ ] **Step 3: 重写订单输入、状态机与账务 contract**

`backend/src/modules/orders/orders.schema.ts`：

```ts
export const CreateOrderBodySchema = t.Object({
  channelOrderNo: t.String({ minLength: 1 }),
  mobile: t.String({ pattern: '^\\d{11}$' }),
  faceValue: t.Number({ minimum: 1 }),
  product_type: t.Optional(t.Union([t.Literal('FAST'), t.Literal('MIXED')])),
  ext: t.Optional(t.Record(t.String(), t.Unknown())),
});
```

`backend/src/modules/ledger/contracts.ts`：

```ts
export interface LedgerContract {
  ensureBalanceSufficient(input: {
    channelId: string;
    amount: number;
  }): Promise<void>;
  debitOrderAmount(input: {
    channelId: string;
    orderNo: string;
    amount: number;
  }): Promise<void>;
  refundOrderAmount(input: {
    channelId: string;
    orderNo: string;
    amount: number;
  }): Promise<void>;
  confirmOrderProfit(input: {
    orderNo: string;
    salePrice: number;
    purchasePrice: number;
  }): Promise<void>;
}
```

`backend/src/modules/risk/risk.service.ts` 必须只返回：

```ts
type RiskDecision = 'PASS' | 'REJECT';
```

不再出现 `REVIEW`。

`backend/src/modules/orders/orders.service.ts` 的创建逻辑应简化为：

```ts
const matched = await this.productContract.matchRechargeProduct({
  mobile: input.mobile,
  faceValue: input.faceValue,
  productType: input.productType,
});

const policy = await this.channelContract.getOrderPolicy({
  channelId: input.channelId,
  productId: matched.product.id,
  orderAmount: matched.product.faceValue,
});

await this.ledgerContract.ensureBalanceSufficient({
  channelId: input.channelId,
  amount: Number(policy.pricePolicy.salePrice),
});

const riskDecision = await this.riskContract.preCheck({
  channelId: input.channelId,
  amount: Number(policy.pricePolicy.salePrice),
  ip: input.clientIp,
});

if (riskDecision.decision !== 'PASS') {
  throw forbidden(riskDecision.reason);
}

const now = Date.now();
const isFast = matched.product.productType === 'FAST';
const warningDeadlineAt = new Date(now + (isFast ? 10 : 150) * 60 * 1000);
const expireDeadlineAt = new Date(now + (isFast ? 60 : 180) * 60 * 1000);

const order = await this.repository.createOrder({
  channelId: input.channelId,
  channelOrderNo: input.channelOrderNo,
  mobile: matched.mobileContext.mobile,
  province: matched.mobileContext.province,
  ispName: matched.mobileContext.ispName,
  faceValue: input.faceValue,
  requestedProductType: input.productType ?? 'MIXED',
  matchedProductId: matched.product.id,
  salePrice: Number(policy.pricePolicy.salePrice),
  purchasePrice: Number(matched.product.purchasePrice),
  mainStatus: 'CREATED',
  supplierStatus: 'WAIT_SUBMIT',
  notifyStatus: 'PENDING',
  refundStatus: 'NONE',
  monitorStatus: 'NORMAL',
  warningDeadlineAt,
  expireDeadlineAt,
  channelSnapshotJson: {
    channel: policy.channel,
    pricePolicy: policy.pricePolicy,
  },
  productSnapshotJson: {
    product: matched.product,
  },
  callbackSnapshotJson: {
    callbackConfig: policy.callbackConfig,
  },
  supplierRouteSnapshotJson: {
    supplierCandidates: matched.supplierCandidates,
  },
  riskSnapshotJson: riskDecision,
  extJson: input.extJson ?? {},
  requestId: input.requestId,
});

await this.ledgerContract.debitOrderAmount({
  channelId: order.channelId,
  orderNo: order.orderNo,
  amount: order.salePrice,
});

await this.workerContract.enqueue({
  jobType: 'supplier.submit',
  businessKey: order.orderNo,
  payload: {
    orderNo: order.orderNo,
  },
});
```

- [ ] **Step 4: 给下单接口补 OpenAPI 描述**

`backend/src/modules/orders/orders.routes.ts`：

```ts
.post(
  '/',
  async ({ body, request }) => {
    // ...
  },
  {
    body: CreateOrderBodySchema,
    detail: {
      tags: ['open-api'],
      summary: '创建 ISP 充值订单',
      description: '渠道按 mobile + faceValue + product_type 发起话费充值',
    },
  },
)
```

- [ ] **Step 5: 跑主交易链路测试**

Run:

```bash
cd /Users/moses/Developer/Docs/backend && bun test tests/order-flow-v1.test.ts
```

Expected:

```text
PASS
1 test passed
```

- [ ] **Step 6: 提交订单、账务、风控重建**

```bash
git add backend/src/modules/orders backend/src/modules/ledger backend/src/modules/risk backend/tests/order-flow-v1.test.ts
git commit -m "feat: rebuild order flow with direct ledger debit"
```

### Task 5: 重建供应商同步、履约、对账与 Worker 调度

**Files:**
- Modify: `backend/src/modules/suppliers/contracts.ts`
- Modify: `backend/src/modules/suppliers/suppliers.types.ts`
- Modify: `backend/src/modules/suppliers/suppliers.repository.ts`
- Modify: `backend/src/modules/suppliers/suppliers.service.ts`
- Modify: `backend/src/modules/worker/contracts.ts`
- Modify: `backend/src/modules/worker/worker.types.ts`
- Modify: `backend/src/modules/worker/worker.repository.ts`
- Modify: `backend/src/modules/worker/worker.service.ts`
- Modify: `backend/src/app.ts`
- Create: `backend/tests/supplier-sync-v1.test.ts`
- Create: `backend/tests/supplier-reconcile-v1.test.ts`

- [ ] **Step 1: 先写失败的供应商同步测试**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';
import { db } from '@/lib/sql';

let runtime: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  runtime = await buildApp({ startWorkerScheduler: false });
});

afterAll(() => {
  runtime.stop();
});

describe('供应商动态同步', () => {
  test('每次动态同步会刷新商品价格、库存并记录日志', async () => {
    await runtime.services.suppliers.syncDynamicCatalog({
      supplierCode: 'mock-supplier',
      items: [
        {
          supplierProductCode: 'cmcc-gd-100-mixed',
          salesStatus: 'ON_SHELF',
          purchasePrice: 94.5,
          inventoryQuantity: 1500,
        },
      ],
    });

    const productRows = await db.unsafe<{ purchase_price: string; inventory_quantity: number }[]>(`
      SELECT purchase_price, inventory_quantity
      FROM product.recharge_products
      WHERE product_type = 'MIXED'
      LIMIT 1
    `);

    expect(Number(productRows[0]?.purchase_price)).toBe(94.5);
    expect(productRows[0]?.inventory_quantity).toBe(1500);
  });
});
```

- [ ] **Step 2: 运行测试，确认同步接口还不存在**

Run:

```bash
cd /Users/moses/Developer/Docs/backend && bun test tests/supplier-sync-v1.test.ts
```

Expected:

```text
FAIL
syncDynamicCatalog is not a function
```

- [ ] **Step 3: 重建供应商服务的 4 个一等能力**

`backend/src/modules/suppliers/suppliers.service.ts` 必须明确拆出：

```ts
async syncFullCatalog(input: { supplierCode: string; items: SupplierCatalogItem[] }) {}
async syncDynamicCatalog(input: { supplierCode: string; items: SupplierDynamicItem[] }) {}
async submitOrder(payload: { orderNo: string }) {}
async queryOrder(payload: { orderNo: string; supplierOrderNo: string; attemptIndex: number }) {}
async runInflightReconcile() {}
async runDailyReconcile() {}
```

动态同步逻辑必须直接更新 `product.recharge_products`：

```ts
await this.productsRepository.applyDynamicRefresh({
  supplierProductCode: item.supplierProductCode,
  salesStatus: item.salesStatus,
  purchasePrice: item.purchasePrice,
  inventoryQuantity: item.inventoryQuantity,
});
```

运行时熔断规则必须写死：

```ts
if (consecutiveFailures >= 3) {
  await this.repository.openRuntimeBreaker({
    supplierId,
    mappingKey,
    reason,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });
}
```

Worker 必须注册这些任务类型：

```ts
supplier.catalog.full-sync
supplier.catalog.delta-sync
supplier.submit
supplier.query
supplier.reconcile.inflight
supplier.reconcile.daily
order.timeout.scan
notification.deliver
```

- [ ] **Step 4: 写失败的对账差异测试**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';
import { db } from '@/lib/sql';

let runtime: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  runtime = await buildApp({ startWorkerScheduler: false });
});

afterAll(() => {
  runtime.stop();
});

describe('供应商对账差异', () => {
  test('已退款但供应商成功时应产生差异记录', async () => {
    await runtime.services.suppliers.recordReconcileDiff({
      supplierId: 'mock-supplier-id',
      diffType: 'REFUNDED_BUT_SUPPLIER_SUCCESS',
      orderNo: 'order-1',
      supplierOrderNo: 'supplier-order-1',
      payloadJson: {
        platformStatus: 'REFUNDED',
        supplierStatus: 'SUCCESS',
      },
    });

    const rows = await db.unsafe<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM supplier.supplier_reconcile_diffs WHERE order_no = 'order-1'`,
    );

    expect(rows[0]?.count).toBe(1);
  });
});
```

- [ ] **Step 5: 跑同步与对账测试**

Run:

```bash
cd /Users/moses/Developer/Docs/backend && bun test tests/supplier-sync-v1.test.ts tests/supplier-reconcile-v1.test.ts
```

Expected:

```text
PASS
2 tests passed
```

- [ ] **Step 6: 提交供应商与 Worker 重建**

```bash
git add backend/src/modules/suppliers backend/src/modules/worker backend/src/app.ts backend/tests/supplier-sync-v1.test.ts backend/tests/supplier-reconcile-v1.test.ts
git commit -m "feat: rebuild supplier sync reconcile and worker jobs"
```

### Task 6: 重建超时扫描、终态通知与全链路回归

**Files:**
- Modify: `backend/src/modules/orders/orders.service.ts`
- Modify: `backend/src/modules/orders/orders.repository.ts`
- Modify: `backend/src/modules/notifications/notifications.types.ts`
- Modify: `backend/src/modules/notifications/notifications.repository.ts`
- Modify: `backend/src/modules/notifications/notifications.service.ts`
- Modify: `backend/src/modules/notifications/notifications.routes.ts`
- Modify: `backend/src/app.ts`
- Create: `backend/tests/order-timeout-v1.test.ts`

- [ ] **Step 1: 先写失败的超时与退款测试**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';
import { db } from '@/lib/sql';

let runtime: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  runtime = await buildApp({ startWorkerScheduler: false });
});

afterAll(() => {
  runtime.stop();
});

describe('订单 SLA', () => {
  test('快充超时后进入预警，超过 1 小时触发退款', async () => {
    const orderRows = await db.unsafe<{ order_no: string }[]>(`
      SELECT order_no
      FROM ordering.orders
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const orderNo = orderRows[0]?.order_no;

    expect(orderNo).toBeTruthy();

    await db`
      UPDATE ordering.orders
      SET
        main_status = 'PROCESSING',
        warning_deadline_at = NOW() - INTERVAL '1 minute',
        expire_deadline_at = NOW() - INTERVAL '1 second'
      WHERE order_no = ${orderNo}
    `;

    await runtime.services.orders.scanTimeouts(new Date());

    const order = await runtime.services.orders.getOrderByNo(String(orderNo));
    expect(order.monitorStatus).toBe('TIMEOUT_WARNING');
    expect(order.mainStatus).toBe('REFUNDED');
    expect(order.refundStatus).toBe('SUCCESS');
  });
});
```

- [ ] **Step 2: 运行测试，确认超时扫描尚未完成**

Run:

```bash
cd /Users/moses/Developer/Docs/backend && bun test tests/order-timeout-v1.test.ts
```

Expected:

```text
FAIL
scanTimeouts or refund assertion failed
```

- [ ] **Step 3: 重建超时扫描与通知服务**

订单扫描逻辑必须写成：

```ts
async scanTimeouts(now = new Date()) {
  const orders = await this.repository.listInflightOrdersForTimeout(now);

  for (const order of orders) {
    if (order.monitorStatus !== 'TIMEOUT_WARNING') {
      await this.repository.updateStatuses(order.orderNo, {
        monitorStatus: 'TIMEOUT_WARNING',
      });
    }

    await this.repository.updateStatuses(order.orderNo, {
      mainStatus: 'FAIL',
      refundStatus: 'PENDING',
    });

    await this.ledgerContract.refundOrderAmount({
      channelId: order.channelId,
      orderNo: order.orderNo,
      amount: order.salePrice,
    });

    await this.repository.updateStatuses(order.orderNo, {
      mainStatus: 'REFUNDED',
      refundStatus: 'SUCCESS',
      finishedAt: true,
    });

    await this.notificationsService.enqueueOrderRefunded(order.orderNo);
  }
}
```

通知服务必须收敛成两个公开入口：

```ts
async enqueueOrderSuccess(orderNo: string) {}
async enqueueOrderRefunded(orderNo: string) {}
```

并且只投递终态 Webhook，不再支持短信邮件。

`backend/src/modules/notifications/notifications.routes.ts` 里的后台查询接口必须加入 `detail`：

```ts
detail: {
  tags: ['admin'],
  summary: '查询通知任务',
}
```

- [ ] **Step 4: 跑超时测试与全量测试**

Run:

```bash
cd /Users/moses/Developer/Docs/backend && bun test tests/order-timeout-v1.test.ts
cd /Users/moses/Developer/Docs/backend && bun test
cd /Users/moses/Developer/Docs/backend && bun run lint
```

Expected:

```text
PASS
All tests passed
Checked 0 problems
```

- [ ] **Step 5: 提交终态链路收口**

```bash
git add backend/src/modules/orders backend/src/modules/notifications backend/src/app.ts backend/tests/order-timeout-v1.test.ts
git commit -m "feat: finalize sla scan and terminal webhooks"
```

## 自检结果

### 规格覆盖

- 破坏性更新、无兼容层：Task 1、Task 2
- 删除独立支付模块：Task 1
- OpenAPI 服务：Task 1
- 简化数据库模型：Task 2
- `mobile + faceValue + product_type` 下单：Task 3、Task 4
- 默认混充、显式快充：Task 3
- 余额扣款：Task 4
- 供应商同步、日志、对账：Task 5
- 快充/混充 SLA：Task 6
- 终态 Webhook：Task 6

### 占位词扫描

- 计划中没有 `TODO`、`TBD`、`后续补充`、`实现时决定`。
- 每个任务都列出了精确文件、代码片段、运行命令和提交动作。

### 类型一致性

- 对外请求参数统一为 `mobile`、`faceValue`、`product_type`。
- 内部充值类型统一为 `FAST` / `MIXED`。
- 商品表统一为 `product.recharge_products`。
- 订单匹配字段统一为 `matchedProductId`。
- 不再出现 `skuId`、`paymentMode=ONLINE`、`REVIEW` 等旧口径。
