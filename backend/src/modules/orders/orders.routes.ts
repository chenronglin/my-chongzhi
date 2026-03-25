import { Elysia } from 'elysia';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { ok } from '@/lib/http';
import { getClientIpFromRequest, getRequestIdFromRequest } from '@/lib/route-meta';
import { stableStringify } from '@/lib/utils';
import type { ChannelsService } from '@/modules/channels/channels.service';
import type { IamService } from '@/modules/iam/iam.service';
import {
  CreateOrderBodySchema,
  MarkExceptionBodySchema,
  RemarkBodySchema,
} from '@/modules/orders/orders.schema';
import type { OrdersService } from '@/modules/orders/orders.service';

interface OrdersRoutesDeps {
  ordersService: OrdersService;
  channelsService: ChannelsService;
  iamService: IamService;
}

export function createOrdersRoutes({
  ordersService,
  channelsService,
  iamService,
}: OrdersRoutesDeps) {
  const openRoutes = new Elysia({ prefix: '/open-api/orders' })
    .post(
      '/',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const openAuth = await channelsService.authenticateOpenRequest({
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: stableStringify(body),
        });

        return ok(
          requestId,
          await ordersService.createOrder({
            channelId: openAuth.channel.id,
            channelOrderNo: body.channelOrderNo,
            skuId: body.skuId,
            paymentMode: body.paymentMode,
            extJson: body.ext ?? {},
            requestId,
            clientIp,
          }),
        );
      },
      {
        body: CreateOrderBodySchema,
      },
    )
    .get('/:orderNo', async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await channelsService.authenticateOpenRequest({
        accessKey: request.headers.get('AccessKey') ?? '',
        signature: request.headers.get('Sign') ?? '',
        timestamp: request.headers.get('Timestamp') ?? '',
        nonce: request.headers.get('Nonce') ?? '',
        method: request.method,
        path: new URL(request.url).pathname,
        bodyText: '',
      });
      return ok(requestId, await ordersService.getOrderByNo(params.orderNo));
    })
    .get('/:orderNo/events', async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await channelsService.authenticateOpenRequest({
        accessKey: request.headers.get('AccessKey') ?? '',
        signature: request.headers.get('Sign') ?? '',
        timestamp: request.headers.get('Timestamp') ?? '',
        nonce: request.headers.get('Nonce') ?? '',
        method: request.method,
        path: new URL(request.url).pathname,
        bodyText: '',
      });
      return ok(requestId, await ordersService.listEvents(params.orderNo));
    });

  const adminRoutes = new Elysia({ prefix: '/admin/orders' })
    .get('/', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      return ok(requestId, await ordersService.listOrders());
    })
    .get('/:orderNo', async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      return ok(requestId, await ordersService.getOrderByNo(params.orderNo));
    })
    .get('/:orderNo/events', async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      return ok(requestId, await ordersService.listEvents(params.orderNo));
    })
    .post('/:orderNo/close', async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      await ordersService.closeOrder(params.orderNo, requestId);
      return ok(requestId, { success: true });
    })
    .post(
      '/:orderNo/mark-exception',
      async ({ params, body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        await ordersService.markException(params.orderNo, body.exceptionTag, requestId);
        return ok(requestId, { success: true });
      },
      {
        body: MarkExceptionBodySchema,
      },
    )
    .post(
      '/:orderNo/remarks',
      async ({ params, body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        await ordersService.addRemark(params.orderNo, body.remark, admin.userId);
        return ok(requestId, { success: true });
      },
      {
        body: RemarkBodySchema,
      },
    )
    .post('/:orderNo/retry-notify', async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      const order = await ordersService.getOrderByNo(params.orderNo);
      await ordersService.handleNotificationFailed({
        orderNo: order.orderNo,
        taskNo: 'manual-retry',
        reason: '管理员手工重试通知',
      });
      return ok(requestId, { success: true });
    });

  const internalRoutes = new Elysia({ prefix: '/internal/orders' })
    .post('/:orderNo/payment-events', async ({ params, body, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      const payloadBody = body as Record<string, any>;

      if (payloadBody.status === 'SUCCESS') {
        await ordersService.handlePaymentSucceeded({
          orderNo: params.orderNo,
          paymentNo: String(payloadBody.paymentNo),
          paymentMode: String(payloadBody.paymentMode),
          paidAmount: Number(payloadBody.paidAmount),
        });
      } else {
        await ordersService.handlePaymentFailed({
          orderNo: params.orderNo,
          paymentNo: String(payloadBody.paymentNo),
          reason: String(payloadBody.reason ?? '支付失败'),
        });
      }

      return ok(requestId, { success: true });
    })
    .post('/:orderNo/supplier-events', async ({ params, body, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      const payloadBody = body as Record<string, any>;

      if (payloadBody.status === 'ACCEPTED' || payloadBody.status === 'PROCESSING') {
        await ordersService.handleSupplierAccepted({
          orderNo: params.orderNo,
          supplierId: String(payloadBody.supplierId),
          supplierOrderNo: String(payloadBody.supplierOrderNo),
          status: payloadBody.status,
        });
      } else if (payloadBody.status === 'SUCCESS') {
        await ordersService.handleSupplierSucceeded({
          orderNo: params.orderNo,
          supplierId: String(payloadBody.supplierId),
          supplierOrderNo: String(payloadBody.supplierOrderNo),
          costPrice: Number(payloadBody.costPrice ?? 0),
        });
      } else {
        await ordersService.handleSupplierFailed({
          orderNo: params.orderNo,
          supplierId: String(payloadBody.supplierId),
          supplierOrderNo: String(payloadBody.supplierOrderNo),
          reason: String(payloadBody.reason ?? '供应商失败'),
        });
      }

      return ok(requestId, { success: true });
    })
    .post('/:orderNo/notification-events', async ({ params, body, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      const payloadBody = body as Record<string, any>;

      if (payloadBody.status === 'SUCCESS') {
        await ordersService.handleNotificationSucceeded({
          orderNo: params.orderNo,
          taskNo: String(payloadBody.taskNo),
        });
      } else {
        await ordersService.handleNotificationFailed({
          orderNo: params.orderNo,
          taskNo: String(payloadBody.taskNo),
          reason: String(payloadBody.reason ?? '通知失败'),
        });
      }

      return ok(requestId, { success: true });
    });

  return new Elysia().use(openRoutes).use(adminRoutes).use(internalRoutes);
}
