import { Elysia } from 'elysia';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { ok } from '@/lib/http';
import { getRequestIdFromRequest } from '@/lib/route-meta';
import type { IamService } from '@/modules/iam/iam.service';
import { CreateNotificationBodySchema } from '@/modules/notifications/notifications.schema';
import type { NotificationsService } from '@/modules/notifications/notifications.service';

interface NotificationsRoutesDeps {
  notificationsService: NotificationsService;
  iamService: IamService;
}

export function createNotificationsRoutes({
  notificationsService,
  iamService,
}: NotificationsRoutesDeps) {
  const adminRoutes = new Elysia({ prefix: '/admin/notifications' })
    .get('/tasks', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      return ok(requestId, await notificationsService.listTasks());
    })
    .get('/tasks/:taskNo', async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      return ok(requestId, await notificationsService.getTask(params.taskNo));
    })
    .post('/tasks/:taskNo/retry', async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      await notificationsService.retryTask(params.taskNo);
      return ok(requestId, { success: true });
    })
    .get('/dead-letters', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      return ok(requestId, await notificationsService.listDeadLetters());
    });

  const internalRoutes = new Elysia({ prefix: '/internal/notifications' })
    .post(
      '/webhook',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        await notificationsService.handleNotificationRequested({
          orderNo: body.orderNo,
          channelId: body.channelId,
          notifyType: 'WEBHOOK',
          triggerReason: 'INTERNAL_MANUAL',
        });
        return ok(requestId, { success: true });
      },
      {
        body: CreateNotificationBodySchema,
      },
    )
    .post('/sms', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      return ok(requestId, { success: true, note: 'V1 短信通道使用接口桩' });
    })
    .post('/email', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      return ok(requestId, { success: true, note: 'V1 邮件通道使用接口桩' });
    })
    .post('/retry', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      return ok(requestId, { success: true });
    });

  return new Elysia().use(adminRoutes).use(internalRoutes);
}
