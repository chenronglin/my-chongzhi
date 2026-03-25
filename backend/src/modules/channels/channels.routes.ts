import { Elysia } from 'elysia';
import { writeAuditLog } from '@/lib/audit';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { ok } from '@/lib/http';
import { getClientIpFromRequest, getRequestIdFromRequest } from '@/lib/route-meta';
import { stableStringify } from '@/lib/utils';
import {
  CreateAuthorizationBodySchema,
  CreateCallbackConfigBodySchema,
  CreateChannelBodySchema,
  CreateCredentialBodySchema,
  CreateLimitRuleBodySchema,
  CreatePricePolicyBodySchema,
} from '@/modules/channels/channels.schema';
import type { ChannelsService } from '@/modules/channels/channels.service';
import type { IamService } from '@/modules/iam/iam.service';

interface ChannelsRoutesDeps {
  channelsService: ChannelsService;
  iamService: IamService;
}

async function requireOpenChannelContext(
  channelsService: ChannelsService,
  request: Request,
  body: unknown,
) {
  return channelsService.authenticateOpenRequest({
    accessKey: request.headers.get('AccessKey') ?? request.headers.get('accesskey') ?? '',
    signature: request.headers.get('Sign') ?? request.headers.get('sign') ?? '',
    timestamp: request.headers.get('Timestamp') ?? request.headers.get('timestamp') ?? '',
    nonce: request.headers.get('Nonce') ?? request.headers.get('nonce') ?? '',
    method: request.method,
    path: new URL(request.url).pathname,
    bodyText: stableStringify(body),
  });
}

export function createChannelsRoutes({ channelsService, iamService }: ChannelsRoutesDeps) {
  const adminRoutes = new Elysia()
    .get('/admin/channels', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const tokenPayload = await verifyAdminAuthorizationHeader(
        request.headers.get('authorization'),
      );
      await iamService.requireActiveAdmin(tokenPayload.sub);
      return ok(requestId, await channelsService.listChannels());
    })
    .post(
      '/admin/channels',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const operator = await iamService.requireActiveAdmin(tokenPayload.sub);
        const channel = await channelsService.createChannel(body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'CREATE_CHANNEL',
          resourceType: 'CHANNEL',
          resourceId: channel.id,
          details: body,
          requestId,
          ip: clientIp,
        });

        return ok(requestId, channel);
      },
      {
        body: CreateChannelBodySchema,
      },
    )
    .get('/admin/channel-api-keys', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const tokenPayload = await verifyAdminAuthorizationHeader(
        request.headers.get('authorization'),
      );
      await iamService.requireActiveAdmin(tokenPayload.sub);
      return ok(requestId, await channelsService.listCredentials());
    })
    .post(
      '/admin/channel-api-keys',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const operator = await iamService.requireActiveAdmin(tokenPayload.sub);
        await channelsService.createCredential(body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'UPSERT_CHANNEL_CREDENTIAL',
          resourceType: 'CHANNEL_CREDENTIAL',
          resourceId: body.channelId,
          details: {
            accessKey: body.accessKey,
          },
          requestId,
          ip: clientIp,
        });

        return ok(requestId, { success: true });
      },
      {
        body: CreateCredentialBodySchema,
      },
    )
    .post(
      '/admin/channel-products',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        await iamService.requireActiveAdmin(tokenPayload.sub);
        await channelsService.addAuthorization(body);
        return ok(requestId, { success: true });
      },
      {
        body: CreateAuthorizationBodySchema,
      },
    )
    .post(
      '/admin/channel-prices',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        await iamService.requireActiveAdmin(tokenPayload.sub);
        await channelsService.upsertPricePolicy(body);
        return ok(requestId, { success: true });
      },
      {
        body: CreatePricePolicyBodySchema,
      },
    )
    .post(
      '/admin/channel-limits',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        await iamService.requireActiveAdmin(tokenPayload.sub);
        await channelsService.upsertLimitRule(body);
        return ok(requestId, { success: true });
      },
      {
        body: CreateLimitRuleBodySchema,
      },
    )
    .post(
      '/admin/channel-callback-configs',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        await iamService.requireActiveAdmin(tokenPayload.sub);
        await channelsService.upsertCallbackConfig({
          ...body,
          timeoutSeconds: body.timeoutSeconds ?? 5,
        });
        return ok(requestId, { success: true });
      },
      {
        body: CreateCallbackConfigBodySchema,
      },
    );

  const openRoutes = new Elysia({ prefix: '/open-api/channel' })
    .get('/profile', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const auth = await requireOpenChannelContext(channelsService, request, {});
      return ok(requestId, auth.channel);
    })
    .get('/quota', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const auth = await requireOpenChannelContext(channelsService, request, {});
      const policy = await channelsService
        .getOrderPolicy({
          channelId: auth.channel.id,
          productId: '',
          skuId: '',
          orderAmount: 0,
        })
        .catch(() => null);

      return ok(requestId, {
        channelId: auth.channel.id,
        limitRule: policy?.limitRule ?? null,
      });
    });

  const internalRoutes = new Elysia({ prefix: '/internal/channels' })
    .post('/resolve-access-key', async ({ body, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      const payloadBody = body as Record<string, string>;
      const auth = await channelsService.authenticateOpenRequest({
        accessKey: payloadBody.accessKey,
        signature: payloadBody.signature,
        timestamp: payloadBody.timestamp,
        nonce: payloadBody.nonce,
        method: payloadBody.method,
        path: payloadBody.path,
        bodyText: payloadBody.bodyText,
      });

      return ok(requestId, auth);
    })
    .get('/:channelId/order-policy', async ({ params, query, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      const result = await channelsService.getOrderPolicy({
        channelId: params.channelId,
        productId: String(query.productId ?? ''),
        skuId: String(query.skuId ?? ''),
        orderAmount: Number(query.orderAmount ?? 0),
      });

      return ok(requestId, result);
    })
    .get('/:channelId/callback-config', async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      return ok(requestId, await channelsService.getCallbackConfig(params.channelId));
    });

  return new Elysia().use(adminRoutes).use(openRoutes).use(internalRoutes);
}
