import { Elysia } from 'elysia';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { ok } from '@/lib/http';
import { getRequestIdFromRequest } from '@/lib/route-meta';
import type { IamService } from '@/modules/iam/iam.service';
import type { LedgerService } from '@/modules/ledger/ledger.service';

interface LedgerRoutesDeps {
  ledgerService: LedgerService;
  iamService: IamService;
}

export function createLedgerRoutes({ ledgerService, iamService }: LedgerRoutesDeps) {
  const adminRoutes = new Elysia()
    .get('/admin/accounts', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      return ok(requestId, await ledgerService.listAccounts());
    })
    .get('/admin/ledger-entries', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      return ok(requestId, await ledgerService.listLedgerEntries());
    });

  const internalRoutes = new Elysia({ prefix: '/internal/settlement' })
    .post('/accounts/freeze', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      return ok(requestId, { success: true, note: 'V1 暂未启用冻结逻辑' });
    })
    .post('/accounts/unfreeze', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      return ok(requestId, { success: true, note: 'V1 暂未启用解冻逻辑' });
    });

  return new Elysia().use(adminRoutes).use(internalRoutes);
}
