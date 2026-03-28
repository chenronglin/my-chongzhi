import type { SQL } from 'bun';

import { env } from '@/lib/env';
import { generateId } from '@/lib/id';
import { encryptText, hashPassword } from '@/lib/security';

/**
 * 初始化开发环境可直接使用的基础数据。
 * 这里的 seed 明确要求幂等执行，因此所有写入都使用 upsert 风格。
 */
export async function runSeed(db: SQL): Promise<void> {
  const adminUserId = generateId();
  const superAdminRoleId = generateId();
  const operatorRoleId = generateId();
  const financeRoleId = generateId();
  const riskRoleId = generateId();
  const supportRoleId = generateId();
  const channelId = generateId();
  const credentialId = generateId();
  const callbackConfigId = generateId();
  const categoryId = generateId();
  const productId = generateId();
  const skuId = generateId();
  const supplierId = generateId();
  const supplierConfigId = generateId();
  const mappingId = generateId();
  const pricePolicyId = generateId();
  const limitRuleId = generateId();
  const authId = generateId();
  const riskRuleId = generateId();
  const profitRuleId = generateId();
  const platformAccountId = generateId();
  const channelAccountId = generateId();
  const dataScopeId = generateId();
  const templateId = generateId();

  const passwordHash = await hashPassword(env.seed.adminPassword);
  const encryptedSecretKey = encryptText(env.seed.secretKey);
  const encryptedCallbackSecret = encryptText('demo-callback-secret');
  const encryptedSupplierCredential = encryptText('mock-supplier-token');
  const encryptedSupplierCallbackSecret = encryptText('mock-supplier-callback');

  await db.begin(async (tx) => {
    await tx`
      INSERT INTO iam.admin_users (
        id,
        username,
        password_hash,
        display_name,
        status
      )
      VALUES (
        ${adminUserId},
        ${env.seed.adminUsername},
        ${passwordHash},
        ${env.seed.adminDisplayName},
        'ACTIVE'
      )
      ON CONFLICT (username) DO UPDATE
      SET
        password_hash = EXCLUDED.password_hash,
        display_name = EXCLUDED.display_name,
        status = 'ACTIVE',
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO iam.roles (id, role_code, role_name, status)
      VALUES
        (${superAdminRoleId}, 'SUPER_ADMIN', '超级管理员', 'ACTIVE'),
        (${operatorRoleId}, 'OPERATOR', '平台运营', 'ACTIVE'),
        (${financeRoleId}, 'FINANCE', '平台财务', 'ACTIVE'),
        (${riskRoleId}, 'RISK_ADMIN', '平台风控', 'ACTIVE'),
        (${supportRoleId}, 'SUPPORT', '技术支持', 'ACTIVE')
      ON CONFLICT (role_code) DO UPDATE
      SET
        role_name = EXCLUDED.role_name,
        status = EXCLUDED.status,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO iam.permissions (id, permission_code, permission_name, permission_group)
      VALUES
        (${generateId()}, 'admin:*', '后台全局权限', 'admin'),
        (${generateId()}, 'orders:*', '订单全权限', 'orders'),
        (${generateId()}, 'channels:*', '渠道全权限', 'channels'),
        (${generateId()}, 'products:*', '商品全权限', 'products')
      ON CONFLICT (permission_code) DO NOTHING
    `;

    await tx`
      INSERT INTO iam.user_role_relations (user_id, role_id)
      SELECT user_ref.id, role.id
      FROM iam.admin_users user_ref
      CROSS JOIN iam.roles role
      WHERE user_ref.username = ${env.seed.adminUsername}
        AND role.role_code = 'SUPER_ADMIN'
      ON CONFLICT (user_id, role_id) DO NOTHING
    `;

    await tx`
      INSERT INTO iam.user_data_scopes (id, user_id, scope_type, scope_values_json)
      SELECT
        ${dataScopeId},
        id,
        'ALL',
        '[]'::jsonb
      FROM iam.admin_users
      WHERE username = ${env.seed.adminUsername}
      ON CONFLICT (user_id) DO UPDATE
      SET
        scope_type = EXCLUDED.scope_type,
        scope_values_json = EXCLUDED.scope_values_json,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO channel.channels (
        id,
        channel_code,
        channel_name,
        channel_type,
        status
      )
      VALUES (
        ${channelId},
        ${env.seed.channelCode},
        '演示渠道',
        'MERCHANT',
        'ACTIVE'
      )
      ON CONFLICT (channel_code) DO UPDATE
      SET
        channel_name = EXCLUDED.channel_name,
        channel_type = EXCLUDED.channel_type,
        status = EXCLUDED.status,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO channel.channel_api_credentials (
        id,
        channel_id,
        access_key,
        secret_key_encrypted,
        sign_algorithm,
        status
      )
      SELECT
        ${credentialId},
        id,
        ${env.seed.accessKey},
        ${encryptedSecretKey},
        'HMAC_SHA256',
        'ACTIVE'
      FROM channel.channels
      WHERE channel_code = ${env.seed.channelCode}
      ON CONFLICT (access_key) DO UPDATE
      SET
        secret_key_encrypted = EXCLUDED.secret_key_encrypted,
        sign_algorithm = EXCLUDED.sign_algorithm,
        status = EXCLUDED.status,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO channel.channel_callback_configs (
        id,
        channel_id,
        callback_url,
        sign_type,
        secret_encrypted,
        retry_enabled,
        timeout_seconds
      )
      SELECT
        ${callbackConfigId},
        id,
        'mock://success',
        'HMAC_SHA256',
        ${encryptedCallbackSecret},
        TRUE,
        5
      FROM channel.channels
      WHERE channel_code = ${env.seed.channelCode}
      ON CONFLICT (channel_id) DO UPDATE
      SET
        callback_url = EXCLUDED.callback_url,
        sign_type = EXCLUDED.sign_type,
        secret_encrypted = EXCLUDED.secret_encrypted,
        retry_enabled = EXCLUDED.retry_enabled,
        timeout_seconds = EXCLUDED.timeout_seconds,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO channel.channel_limit_rules (
        id,
        channel_id,
        single_limit,
        daily_limit,
        monthly_limit,
        qps_limit
      )
      SELECT
        ${limitRuleId},
        id,
        1000,
        10000,
        100000,
        100
      FROM channel.channels
      WHERE channel_code = ${env.seed.channelCode}
      ON CONFLICT (channel_id) DO UPDATE
      SET
        single_limit = EXCLUDED.single_limit,
        daily_limit = EXCLUDED.daily_limit,
        monthly_limit = EXCLUDED.monthly_limit,
        qps_limit = EXCLUDED.qps_limit,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO product.product_categories (
        id,
        category_name,
        status,
        sort_no
      )
      VALUES (${categoryId}, '话费充值', 'ACTIVE', 1)
      ON CONFLICT (id) DO NOTHING
    `;

    await tx`
      INSERT INTO product.products (
        id,
        category_id,
        product_name,
        product_type,
        delivery_type,
        target_type,
        status,
        base_attributes_json
      )
      VALUES (
        ${productId},
        ${categoryId},
        '移动话费充值',
        'TOPUP',
        'API',
        'MOBILE',
        'ACTIVE',
        ${JSON.stringify({ brand: '中国移动' })}
      )
      ON CONFLICT (id) DO NOTHING
    `;

    await tx`
      INSERT INTO product.product_skus (
        id,
        product_id,
        sku_name,
        face_value,
        operator,
        region,
        sale_status,
        base_cost_price,
        base_sale_price
      )
      VALUES (
        ${skuId},
        ${productId},
        '移动 100 元',
        100,
        'CMCC',
        'CN',
        'ON_SHELF',
        95,
        100
      )
      ON CONFLICT (id) DO NOTHING
    `;

    await tx`
      INSERT INTO channel.channel_product_authorizations (
        id,
        channel_id,
        product_id,
        sku_id,
        status
      )
      SELECT
        ${authId},
        c.id,
        ${productId},
        ${skuId},
        'ACTIVE'
      FROM channel.channels c
      WHERE c.channel_code = ${env.seed.channelCode}
      ON CONFLICT DO NOTHING
    `;

    await tx`
      INSERT INTO channel.channel_price_policies (
        id,
        channel_id,
        sku_id,
        sale_price,
        currency,
        status
      )
      SELECT
        ${pricePolicyId},
        c.id,
        ${skuId},
        100,
        'CNY',
        'ACTIVE'
      FROM channel.channels c
      WHERE c.channel_code = ${env.seed.channelCode}
      ON CONFLICT DO NOTHING
    `;

    await tx`
      INSERT INTO supplier.suppliers (
        id,
        supplier_code,
        supplier_name,
        protocol_type,
        status
      )
      VALUES (
        ${supplierId},
        ${env.seed.supplierCode},
        '模拟供应商',
        'MOCK',
        'ACTIVE'
      )
      ON CONFLICT (supplier_code) DO UPDATE
      SET
        supplier_name = EXCLUDED.supplier_name,
        protocol_type = EXCLUDED.protocol_type,
        status = EXCLUDED.status,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO supplier.supplier_configs (
        id,
        supplier_id,
        config_json,
        credential_encrypted,
        callback_secret_encrypted,
        timeout_ms
      )
      SELECT
        ${supplierConfigId},
        id,
        ${JSON.stringify({ mode: 'mock-auto-success' })},
        ${encryptedSupplierCredential},
        ${encryptedSupplierCallbackSecret},
        2000
      FROM supplier.suppliers
      WHERE supplier_code = ${env.seed.supplierCode}
      ON CONFLICT (supplier_id) DO UPDATE
      SET
        config_json = EXCLUDED.config_json,
        credential_encrypted = EXCLUDED.credential_encrypted,
        callback_secret_encrypted = EXCLUDED.callback_secret_encrypted,
        timeout_ms = EXCLUDED.timeout_ms,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO product.sku_supplier_mappings (
        id,
        sku_id,
        supplier_id,
        supplier_sku_code,
        priority,
        weight,
        route_type,
        cost_price,
        status
      )
      SELECT
        ${mappingId},
        ${skuId},
        id,
        'mock-topup-100',
        1,
        100,
        'PRIMARY',
        95,
        'ACTIVE'
      FROM supplier.suppliers
      WHERE supplier_code = ${env.seed.supplierCode}
      ON CONFLICT DO NOTHING
    `;

    await tx`
      INSERT INTO risk.risk_rules (
        id,
        rule_code,
        rule_name,
        rule_type,
        config_json,
        priority,
        status
      )
      VALUES (
        ${riskRuleId},
        'AMOUNT_REVIEW',
        '大额订单人工复核',
        'AMOUNT',
        ${JSON.stringify({ threshold: 500 })},
        1,
        'ACTIVE'
      )
      ON CONFLICT (rule_code) DO UPDATE
      SET
        rule_name = EXCLUDED.rule_name,
        rule_type = EXCLUDED.rule_type,
        config_json = EXCLUDED.config_json,
        priority = EXCLUDED.priority,
        status = EXCLUDED.status,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO ledger.accounts (
        id,
        owner_type,
        owner_id,
        available_balance,
        frozen_balance,
        currency,
        status
      )
      VALUES
        (${platformAccountId}, 'PLATFORM', 'SYSTEM', 0, 0, 'CNY', 'ACTIVE')
      ON CONFLICT (owner_type, owner_id, currency) DO UPDATE
      SET
        status = EXCLUDED.status,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO ledger.accounts (
        id,
        owner_type,
        owner_id,
        available_balance,
        frozen_balance,
        currency,
        status
      )
      SELECT
        ${channelAccountId},
        'CHANNEL',
        id,
        10000,
        0,
        'CNY',
        'ACTIVE'
      FROM channel.channels
      WHERE channel_code = ${env.seed.channelCode}
      ON CONFLICT (owner_type, owner_id, currency) DO UPDATE
      SET
        available_balance = EXCLUDED.available_balance,
        status = EXCLUDED.status,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO ledger.profit_rules (
        id,
        rule_name,
        channel_id,
        product_id,
        sku_id,
        config_json,
        status
      )
      SELECT
        ${profitRuleId},
        '默认分润规则',
        c.id,
        ${productId},
        ${skuId},
        ${JSON.stringify({ platformRate: 0.05 })},
        'ACTIVE'
      FROM channel.channels c
      WHERE c.channel_code = ${env.seed.channelCode}
      ON CONFLICT DO NOTHING
    `;

    await tx`
      INSERT INTO notification.notification_templates (
        id,
        template_code,
        notify_type,
        subject,
        body_template,
        status
      )
      VALUES (
        ${templateId},
        'ORDER_RESULT',
        'WEBHOOK',
        '订单结果通知',
        ${JSON.stringify({
          title: '订单结果通知',
          fields: ['orderNo', 'mainStatus', 'paymentStatus', 'supplierStatus'],
        })},
        'ACTIVE'
      )
      ON CONFLICT (template_code) DO UPDATE
      SET
        notify_type = EXCLUDED.notify_type,
        subject = EXCLUDED.subject,
        body_template = EXCLUDED.body_template,
        status = EXCLUDED.status,
        updated_at = NOW()
    `;
  });
}
