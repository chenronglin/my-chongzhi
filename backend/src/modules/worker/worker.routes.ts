import { Elysia } from 'elysia';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { buildPageResult, ok, parsePagination } from '@/lib/http';
import { getRequestIdFromRequest } from '@/lib/route-meta';
import type { IamService } from '@/modules/iam/iam.service';
import { EnqueueJobBodySchema } from '@/modules/worker/worker.schema';
import type { WorkerService } from '@/modules/worker/worker.service';

interface WorkerRoutesDeps {
  workerService: WorkerService;
  iamService: IamService;
}

export function createWorkerRoutes({ workerService, iamService }: WorkerRoutesDeps) {
  const adminRoutes = new Elysia({ prefix: '/admin/jobs' })
    .get('/', async ({ query, request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);

      const { page, pageSize } = parsePagination(query as Record<string, unknown>);
      const result = await workerService.list(page, pageSize);

      return ok(requestId, buildPageResult(result.items, page, pageSize, result.total));
    })
    .get('/:jobId', async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);

      return ok(requestId, await workerService.getById(params.jobId));
    })
    .post('/:jobId/retry', async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      await workerService.retry(params.jobId);
      return ok(requestId, { success: true });
    })
    .post('/:jobId/cancel', async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      await workerService.cancel(params.jobId);
      return ok(requestId, { success: true });
    })
    .get('/dead-letters', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      return ok(requestId, await workerService.listDeadLetters());
    });

  const internalRoutes = new Elysia({ prefix: '/internal/jobs' })
    .post(
      '/enqueue',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));

        const job = await workerService.enqueue({
          jobType: body.jobType,
          businessKey: body.businessKey,
          payload: body.payload,
          maxAttempts: body.maxAttempts,
        });

        return ok(requestId, job);
      },
      {
        body: EnqueueJobBodySchema,
      },
    )
    .post(
      '/schedule',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));

        const delaySeconds = body.delaySeconds ?? 0;
        const job = await workerService.schedule({
          jobType: body.jobType,
          businessKey: body.businessKey,
          payload: body.payload,
          maxAttempts: body.maxAttempts,
          nextRunAt: new Date(Date.now() + delaySeconds * 1000),
        });

        return ok(requestId, job);
      },
      {
        body: EnqueueJobBodySchema,
      },
    );

  return new Elysia().use(adminRoutes).use(internalRoutes);
}
