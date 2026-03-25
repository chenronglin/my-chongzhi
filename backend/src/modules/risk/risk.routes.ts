import { Elysia } from 'elysia';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { ok } from '@/lib/http';
import { getRequestIdFromRequest } from '@/lib/route-meta';
import type { IamService } from '@/modules/iam/iam.service';
import { CreateRiskRuleBodySchema, PreCheckBodySchema } from '@/modules/risk/risk.schema';
import type { RiskService } from '@/modules/risk/risk.service';

interface RiskRoutesDeps {
  riskService: RiskService;
  iamService: IamService;
}

export function createRiskRoutes({ riskService, iamService }: RiskRoutesDeps) {
  const adminRoutes = new Elysia({ prefix: '/admin/risk' })
    .get('/rules', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      return ok(requestId, await riskService.listRules());
    })
    .post(
      '/rules',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(requestId, await riskService.createRule(body));
      },
      {
        body: CreateRiskRuleBodySchema,
      },
    )
    .get('/black-white-lists', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      return ok(requestId, await riskService.listBlackWhiteEntries());
    });

  const internalRoutes = new Elysia({ prefix: '/internal/risk' }).post(
    '/pre-check',
    async ({ body, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      return ok(requestId, await riskService.preCheck(body));
    },
    {
      body: PreCheckBodySchema,
    },
  );

  return new Elysia().use(adminRoutes).use(internalRoutes);
}
