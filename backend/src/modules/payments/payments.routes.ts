import { Elysia } from 'elysia';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { ok } from '@/lib/http';
import { getRequestIdFromRequest } from '@/lib/route-meta';
import type { IamService } from '@/modules/iam/iam.service';
import {
  CreatePaymentBodySchema,
  MockPaymentCallbackBodySchema,
  RefundBodySchema,
} from '@/modules/payments/payments.schema';
import type { PaymentsService } from '@/modules/payments/payments.service';

interface PaymentsRoutesDeps {
  paymentsService: PaymentsService;
  iamService: IamService;
}

export function createPaymentsRoutes({ paymentsService, iamService }: PaymentsRoutesDeps) {
  const adminRoutes = new Elysia()
    .get('/admin/payment-channels', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      return ok(requestId, await paymentsService.listChannels());
    })
    .get('/admin/payment-orders', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      return ok(requestId, await paymentsService.listPaymentOrders());
    });

  const internalRoutes = new Elysia({ prefix: '/internal/payments' })
    .post(
      '/create',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        return ok(requestId, await paymentsService.createPaymentForOrder(body));
      },
      {
        body: CreatePaymentBodySchema,
      },
    )
    .post(
      '/balance-pay',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        return ok(
          requestId,
          await paymentsService.createPaymentForOrder({
            ...body,
            paymentMode: 'BALANCE',
          }),
        );
      },
      {
        body: CreatePaymentBodySchema,
      },
    )
    .post(
      '/refund',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        await paymentsService.handleRefundRequested({
          orderNo: body.orderNo,
          refundNo: body.refundNo,
          reason: body.reason ?? '手工退款',
        });
        return ok(requestId, { success: true });
      },
      {
        body: RefundBodySchema,
      },
    );

  const callbackRoutes = new Elysia({ prefix: '/callbacks/payments' }).post(
    '/mock',
    async ({ body, request }) => {
      const requestId = getRequestIdFromRequest(request);
      return ok(
        requestId,
        await paymentsService.handleMockPaymentCallback({
          ...body,
          requestId,
        }),
      );
    },
    {
      body: MockPaymentCallbackBodySchema,
    },
  );

  return new Elysia().use(adminRoutes).use(internalRoutes).use(callbackRoutes);
}
