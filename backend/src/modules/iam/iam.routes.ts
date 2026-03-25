import { Elysia, t } from 'elysia';
import { writeAuditLog } from '@/lib/audit';
import { verifyAdminAuthorizationHeader } from '@/lib/auth';
import { buildPageResult, ok, parsePagination } from '@/lib/http';
import { getClientIpFromRequest, getRequestIdFromRequest } from '@/lib/route-meta';
import {
  CreateAdminUserBodySchema,
  CreateRoleBodySchema,
  LoginBodySchema,
  RefreshBodySchema,
} from '@/modules/iam/iam.schema';
import type { IamService } from '@/modules/iam/iam.service';

interface IamRoutesDeps {
  iamService: IamService;
}

export function createIamRoutes({ iamService }: IamRoutesDeps) {
  const authRoutes = new Elysia({ prefix: '/admin/auth' })
    .post(
      '/login',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        return ok(requestId, await iamService.login(body.username, body.password));
      },
      {
        body: LoginBodySchema,
        response: t.Any(),
      },
    )
    .post(
      '/refresh',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        return ok(requestId, await iamService.refresh(body.refreshToken));
      },
      {
        body: RefreshBodySchema,
        response: t.Any(),
      },
    )
    .post(
      '/logout',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await iamService.logout(body.refreshToken);
        return ok(requestId, { success: true });
      },
      {
        body: RefreshBodySchema,
        response: t.Any(),
      },
    );

  const userRoutes = new Elysia({ prefix: '/admin/users' })
    .get('/', async ({ query, request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      const { page, pageSize } = parsePagination(query as Record<string, unknown>);
      const result = await iamService.listUsers(page, pageSize);

      return ok(requestId, buildPageResult(result.items, page, pageSize, result.total));
    })
    .post(
      '/',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        const createdUser = await iamService.createUser(body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'CREATE_ADMIN_USER',
          resourceType: 'ADMIN_USER',
          resourceId: createdUser.id,
          details: {
            username: createdUser.username,
          },
          requestId,
          ip: clientIp,
        });

        return ok(requestId, createdUser);
      },
      {
        body: CreateAdminUserBodySchema,
        response: t.Any(),
      },
    );

  const roleRoutes = new Elysia({ prefix: '/admin/roles' })
    .get('/', async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
      await iamService.requireActiveAdmin(payload.sub);
      return ok(requestId, await iamService.listRoles());
    })
    .post(
      '/',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        const role = await iamService.createRole(body.roleCode, body.roleName);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'CREATE_ROLE',
          resourceType: 'ROLE',
          resourceId: role.id,
          details: {
            roleCode: role.roleCode,
          },
          requestId,
          ip: clientIp,
        });

        return ok(requestId, role);
      },
      {
        body: CreateRoleBodySchema,
        response: t.Any(),
      },
    );

  return new Elysia().use(authRoutes).use(userRoutes).use(roleRoutes);
}
