import { openapi } from '@elysiajs/openapi';
import { Elysia } from 'elysia';

import { env } from '@/lib/env';
import { eventBus } from '@/lib/event-bus';
import { generateBusinessNo } from '@/lib/id';
import { signJwt } from '@/lib/jwt-token';
import { getRequestIdFromRequest } from '@/lib/route-meta';
import { createChannelsModule } from '@/modules/channels';
import { createIamModule } from '@/modules/iam';
import { createLedgerModule } from '@/modules/ledger';
import type { LedgerContract } from '@/modules/ledger/contracts';
import type { LedgerService } from '@/modules/ledger/ledger.service';
import { createNotificationsModule } from '@/modules/notifications';
import { createOrdersModule } from '@/modules/orders';
import { createProductsModule } from '@/modules/products';
import { createRiskModule } from '@/modules/risk';
import { createSuppliersModule } from '@/modules/suppliers';
import { createWorkerModule } from '@/modules/worker';
import { createAuthPlugin } from '@/plugins/auth.plugin';
import { createErrorPlugin } from '@/plugins/error.plugin';
import { createRequestContextPlugin } from '@/plugins/request-context.plugin';

interface BuildAppOptions {
  startWorkerScheduler?: boolean;
}

function createLedgerContractProxy(getService: () => LedgerService): LedgerContract {
  return {
    payByBalance(input) {
      return getService().payByBalance(input);
    },
    handleOnlinePayment(input) {
      return getService().handleOnlinePayment(input);
    },
    refundOrderPayment(orderNo) {
      return getService().refundOrderPayment(orderNo);
    },
  };
}

export async function buildApp(options: BuildAppOptions = {}) {
  eventBus.clear();

  const iamModule = createIamModule();
  const workerModule = createWorkerModule(iamModule.service);
  const channelsModule = createChannelsModule(iamModule.service);
  const productsModule = createProductsModule(iamModule.service, channelsModule.service);
  const riskModule = createRiskModule(iamModule.service);
  let ledgerServiceRef: LedgerService | null = null;
  const ledgerContract = createLedgerContractProxy(() => {
    if (!ledgerServiceRef) {
      throw new Error('账务服务尚未完成初始化');
    }

    return ledgerServiceRef;
  });
  const ordersModule = createOrdersModule({
    channelContract: channelsModule.contract,
    productContract: productsModule.contract,
    riskContract: riskModule.contract,
    ledgerContract,
    workerContract: workerModule.contract,
    channelsService: channelsModule.service,
    iamService: iamModule.service,
  });
  const ledgerModule = createLedgerModule(iamModule.service, ordersModule.contract);
  ledgerServiceRef = ledgerModule.service;

  const suppliersModule = createSuppliersModule({
    iamService: iamModule.service,
    orderContract: ordersModule.contract,
    workerContract: workerModule.contract,
  });
  const notificationsModule = createNotificationsModule({
    iamService: iamModule.service,
    orderContract: ordersModule.contract,
    workerContract: workerModule.contract,
  });

  // 统一注册 Worker 处理器。
  workerModule.service.registerHandler('supplier.submit', (payload) =>
    suppliersModule.service.handleSupplierSubmitJob(payload),
  );
  workerModule.service.registerHandler('supplier.query', (payload) =>
    suppliersModule.service.handleSupplierQueryJob(payload),
  );
  workerModule.service.registerHandler('notification.deliver', (payload) =>
    notificationsModule.service.handleDeliverJob(payload),
  );

  // 统一注册领域事件订阅。
  eventBus.subscribe('SupplierAccepted', (payload) =>
    ordersModule.service.handleSupplierAccepted(payload),
  );
  eventBus.subscribe('SupplierSucceeded', (payload) => ordersModule.service.handleSupplierSucceeded(payload));
  eventBus.subscribe('SupplierFailed', (payload) =>
    ordersModule.service.handleSupplierFailed(payload),
  );
  eventBus.subscribe('SettlementTriggered', (payload) =>
    ledgerModule.service.handleSettlementTriggered(payload.orderNo),
  );
  eventBus.subscribe('NotificationRequested', (payload) =>
    notificationsModule.service.handleNotificationRequested(payload),
  );
  eventBus.subscribe('NotificationSucceeded', (payload) =>
    ordersModule.service.handleNotificationSucceeded(payload),
  );
  eventBus.subscribe('NotificationFailed', (payload) =>
    ordersModule.service.handleNotificationFailed(payload),
  );

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
    .get('/health', ({ request }) => ({
      code: 0,
      message: 'success',
      data: {
        env: env.appEnv,
        status: 'ok',
      },
      requestId: getRequestIdFromRequest(request),
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
    async issueInternalToken(serviceName = 'integration-test'): Promise<string> {
      return signJwt(
        {
          sub: serviceName,
          type: 'internal',
          roleIds: [],
          scope: 'internal',
          jti: generateBusinessNo('internal'),
        },
        env.internalJwtSecret,
        5 * 60,
      );
    },
    stop() {
      workerModule.service.stopScheduler();
    },
  };
}
