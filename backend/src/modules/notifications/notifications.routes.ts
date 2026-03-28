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

  const internalRoutes = new Elysia({ prefix: '/internal/notifications' });

  internalRoutes.post(
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
  );

  return new Elysia().use(adminRoutes).use(internalRoutes);
}
