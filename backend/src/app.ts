import { Elysia } from 'elysia';

import { env } from '@/lib/env';
import { eventBus } from '@/lib/event-bus';
import { generateBusinessNo } from '@/lib/id';
import { signJwt } from '@/lib/jwt-token';
import { getRequestIdFromRequest } from '@/lib/route-meta';
import { createChannelsModule } from '@/modules/channels';
import { createIamModule } from '@/modules/iam';
import { createLedgerModule } from '@/modules/ledger';
import { createNotificationsModule } from '@/modules/notifications';
import { createOrdersModule } from '@/modules/orders';
import type { OrderContract } from '@/modules/orders/contracts';
import type { OrdersService } from '@/modules/orders/orders.service';
import { createPaymentsModule } from '@/modules/payments';
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

function createOrderContractProxy(getService: () => OrdersService): OrderContract {
  return {
    getOrderByNo(orderNo: string) {
      return getService().getOrderByNo(orderNo);
    },
    getSupplierExecutionContext(orderNo: string) {
      return getService().getSupplierExecutionContext(orderNo);
    },
    getNotificationContext(orderNo: string) {
      return getService().getNotificationContext(orderNo);
    },
    getLedgerContext(orderNo: string) {
      return getService().getLedgerContext(orderNo);
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

  let ordersServiceRef: OrdersService | null = null;
  const orderContract = createOrderContractProxy(() => {
    if (!ordersServiceRef) {
      throw new Error('订单服务尚未完成初始化');
    }

    return ordersServiceRef;
  });

  const ledgerModule = createLedgerModule(iamModule.service, orderContract);
  const paymentsModule = createPaymentsModule(iamModule.service, ledgerModule.service);
  const ordersModule = createOrdersModule({
    channelContract: channelsModule.contract,
    productContract: productsModule.contract,
    riskContract: riskModule.contract,
    paymentContract: paymentsModule.contract,
    workerContract: workerModule.contract,
    channelsService: channelsModule.service,
    iamService: iamModule.service,
  });

  ordersServiceRef = ordersModule.service;

  const suppliersModule = createSuppliersModule({
    iamService: iamModule.service,
    orderContract,
    workerContract: workerModule.contract,
  });
  const notificationsModule = createNotificationsModule({
    iamService: iamModule.service,
    orderContract,
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
  eventBus.subscribe('PaymentSucceeded', (payload) =>
    ordersModule.service.handlePaymentSucceeded(payload),
  );
  eventBus.subscribe('PaymentFailed', (payload) =>
    ordersModule.service.handlePaymentFailed(payload),
  );
  eventBus.subscribe('SupplierAccepted', (payload) =>
    ordersModule.service.handleSupplierAccepted(payload),
  );
  eventBus.subscribe('SupplierSucceeded', async (payload) => {
    await ordersModule.service.handleSupplierSucceeded(payload);
    await ledgerModule.service.handleSettlementTriggered(payload.orderNo);
  });
  eventBus.subscribe('SupplierFailed', (payload) =>
    ordersModule.service.handleSupplierFailed(payload),
  );
  eventBus.subscribe('RefundRequested', (payload) =>
    paymentsModule.service.handleRefundRequested(payload),
  );
  eventBus.subscribe('RefundSucceeded', async (payload) => {
    await ordersModule.service.handleRefundSucceeded(payload);
    await ledgerModule.service.handleRefundSuccess(payload.orderNo);
  });
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
    .use(paymentsModule.routes)
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
      payments: paymentsModule.service,
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
