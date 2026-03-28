import { Elysia } from 'elysia';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { ok } from '@/lib/http';
import { getRequestIdFromRequest } from '@/lib/route-meta';
import type { IamService } from '@/modules/iam/iam.service';
import {
  CreateSupplierBodySchema,
  CreateSupplierConfigBodySchema,
  SupplierCallbackBodySchema,
  SupplierQueryBodySchema,
  SupplierSubmitBodySchema,
} from '@/modules/suppliers/suppliers.schema';
import type { SuppliersService } from '@/modules/suppliers/suppliers.service';

interface SuppliersRoutesDeps {
  suppliersService: SuppliersService;
  iamService: IamService;
}

export function createSuppliersRoutes({ suppliersService, iamService }: SuppliersRoutesDeps) {
  const adminRoutes = new Elysia()
    .get('/admin/suppliers', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      return ok(requestId, await suppliersService.listSuppliers());
    })
    .post(
      '/admin/suppliers',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(requestId, await suppliersService.createSupplier(body));
      },
      {
        body: CreateSupplierBodySchema,
      },
    )
    .post(
      '/admin/supplier-configs',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        await suppliersService.upsertConfig({
          ...body,
          timeoutMs: body.timeoutMs ?? 2000,
        });
        return ok(requestId, { success: true });
      },
      {
        body: CreateSupplierConfigBodySchema,
      },
    );

  const internalRoutes = new Elysia({ prefix: '/internal/suppliers/orders' })
    .post(
      '/submit',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        await suppliersService.handleSupplierSubmitJob(body as Record<string, unknown>);
        return ok(requestId, { success: true });
      },
      {
        body: SupplierSubmitBodySchema,
      },
    )
    .post(
      '/query',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        await suppliersService.handleSupplierQueryJob(body as Record<string, unknown>);
        return ok(requestId, { success: true });
      },
      {
        body: SupplierQueryBodySchema,
      },
    );

  const callbackRoutes = new Elysia({ prefix: '/callbacks/suppliers' }).post(
    '/:supplierCode',
    async ({ params, body, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await suppliersService.handleSupplierCallback(params.supplierCode, body);
      return ok(requestId, { success: true });
    },
    {
      body: SupplierCallbackBodySchema,
    },
  );

  return new Elysia().use(adminRoutes).use(internalRoutes).use(callbackRoutes);
}
