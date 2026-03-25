import { Elysia } from 'elysia';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { ok } from '@/lib/http';
import { getRequestIdFromRequest } from '@/lib/route-meta';
import type { ChannelsService } from '@/modules/channels/channels.service';
import type { IamService } from '@/modules/iam/iam.service';
import {
  CreateCategoryBodySchema,
  CreateMappingBodySchema,
  CreateProductBodySchema,
  CreateSkuBodySchema,
} from '@/modules/products/products.schema';
import type { ProductsService } from '@/modules/products/products.service';

interface ProductsRoutesDeps {
  productsService: ProductsService;
  iamService: IamService;
  channelsService: ChannelsService;
}

export function createProductsRoutes({
  productsService,
  iamService,
  channelsService,
}: ProductsRoutesDeps) {
  const adminRoutes = new Elysia()
    .get('/admin/product-categories', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const tokenPayload = await verifyAdminAuthorizationHeader(
        request.headers.get('authorization'),
      );
      await iamService.requireActiveAdmin(tokenPayload.sub);
      return ok(requestId, await productsService.listCategories());
    })
    .post(
      '/admin/product-categories',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        await iamService.requireActiveAdmin(tokenPayload.sub);
        return ok(requestId, await productsService.createCategory(body));
      },
      {
        body: CreateCategoryBodySchema,
      },
    )
    .get('/admin/products', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const tokenPayload = await verifyAdminAuthorizationHeader(
        request.headers.get('authorization'),
      );
      await iamService.requireActiveAdmin(tokenPayload.sub);
      return ok(requestId, await productsService.listProducts());
    })
    .post(
      '/admin/products',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        await iamService.requireActiveAdmin(tokenPayload.sub);
        return ok(requestId, await productsService.createProduct(body));
      },
      {
        body: CreateProductBodySchema,
      },
    )
    .post(
      '/admin/product-skus',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        await iamService.requireActiveAdmin(tokenPayload.sub);
        return ok(requestId, await productsService.createSku(body));
      },
      {
        body: CreateSkuBodySchema,
      },
    )
    .post(
      '/admin/product-supplier-mappings',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        await iamService.requireActiveAdmin(tokenPayload.sub);
        await productsService.addSupplierMapping(body);
        return ok(requestId, { success: true });
      },
      {
        body: CreateMappingBodySchema,
      },
    );

  const openRoutes = new Elysia({ prefix: '/open-api/products' }).get('/', async ({ request }) => {
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

    return ok(requestId, await productsService.listProducts());
  });

  const internalRoutes = new Elysia({ prefix: '/internal/products' })
    .get('/skus/:skuId/saleability', async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      return ok(requestId, await productsService.isSkuSaleable(params.skuId));
    })
    .get('/skus/:skuId/snapshot', async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      return ok(requestId, await productsService.getSkuOrderSnapshot(params.skuId));
    })
    .get('/skus/:skuId/supplier-candidates', async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      const snapshot = await productsService.getSkuOrderSnapshot(params.skuId);
      return ok(requestId, snapshot.supplierCandidates);
    });

  return new Elysia().use(adminRoutes).use(openRoutes).use(internalRoutes);
}
