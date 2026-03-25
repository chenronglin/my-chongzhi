import { generateBusinessNo, generateId } from '@/lib/id';
import { encryptText } from '@/lib/security';
import { db, first } from '@/lib/sql';
import { suppliersSql } from '@/modules/suppliers/suppliers.sql';
import type { Supplier, SupplierOrder } from '@/modules/suppliers/suppliers.types';

export class SuppliersRepository {
  async listSuppliers(): Promise<Supplier[]> {
    return db.unsafe<Supplier[]>(suppliersSql.listSuppliers);
  }

  async createSupplier(input: {
    supplierCode: string;
    supplierName: string;
    protocolType: string;
  }): Promise<Supplier> {
    const rows = await db<Supplier[]>`
      INSERT INTO supplier.suppliers (
        id,
        supplier_code,
        supplier_name,
        protocol_type,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.supplierCode},
        ${input.supplierName},
        ${input.protocolType},
        'ACTIVE',
        NOW(),
        NOW()
      )
      RETURNING
        id,
        supplier_code AS "supplierCode",
        supplier_name AS "supplierName",
        protocol_type AS "protocolType",
        status
    `;

    const supplier = rows[0];

    if (!supplier) {
      throw new Error('创建供应商失败');
    }

    return supplier;
  }

  async upsertConfig(input: {
    supplierId: string;
    configJson: Record<string, unknown>;
    credential: string;
    callbackSecret: string;
    timeoutMs: number;
  }): Promise<void> {
    await db`
      INSERT INTO supplier.supplier_configs (
        id,
        supplier_id,
        config_json,
        credential_encrypted,
        callback_secret_encrypted,
        timeout_ms,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.supplierId},
        ${JSON.stringify(input.configJson)},
        ${encryptText(input.credential)},
        ${encryptText(input.callbackSecret)},
        ${input.timeoutMs},
        NOW(),
        NOW()
      )
      ON CONFLICT (supplier_id) DO UPDATE
      SET
        config_json = EXCLUDED.config_json,
        credential_encrypted = EXCLUDED.credential_encrypted,
        callback_secret_encrypted = EXCLUDED.callback_secret_encrypted,
        timeout_ms = EXCLUDED.timeout_ms,
        updated_at = NOW()
    `;
  }

  async findSupplierById(supplierId: string): Promise<Supplier | null> {
    return first<Supplier>(db<Supplier[]>`
      SELECT
        id,
        supplier_code AS "supplierCode",
        supplier_name AS "supplierName",
        protocol_type AS "protocolType",
        status
      FROM supplier.suppliers
      WHERE id = ${supplierId}
      LIMIT 1
    `);
  }

  async findSupplierByCode(supplierCode: string): Promise<Supplier | null> {
    return first<Supplier>(db<Supplier[]>`
      SELECT
        id,
        supplier_code AS "supplierCode",
        supplier_name AS "supplierName",
        protocol_type AS "protocolType",
        status
      FROM supplier.suppliers
      WHERE supplier_code = ${supplierCode}
      LIMIT 1
    `);
  }

  async findSupplierOrderByOrderNo(orderNo: string): Promise<SupplierOrder | null> {
    return first<SupplierOrder>(db<SupplierOrder[]>`
      SELECT
        id,
        order_no AS "orderNo",
        supplier_id AS "supplierId",
        supplier_order_no AS "supplierOrderNo",
        request_payload_json AS "requestPayloadJson",
        response_payload_json AS "responsePayloadJson",
        standard_status AS "standardStatus",
        attempt_no AS "attemptNo",
        duration_ms AS "durationMs"
      FROM supplier.supplier_orders
      WHERE order_no = ${orderNo}
      ORDER BY created_at DESC
      LIMIT 1
    `);
  }

  async findSupplierOrderBySupplierOrderNo(supplierOrderNo: string): Promise<SupplierOrder | null> {
    return first<SupplierOrder>(db<SupplierOrder[]>`
      SELECT
        id,
        order_no AS "orderNo",
        supplier_id AS "supplierId",
        supplier_order_no AS "supplierOrderNo",
        request_payload_json AS "requestPayloadJson",
        response_payload_json AS "responsePayloadJson",
        standard_status AS "standardStatus",
        attempt_no AS "attemptNo",
        duration_ms AS "durationMs"
      FROM supplier.supplier_orders
      WHERE supplier_order_no = ${supplierOrderNo}
      LIMIT 1
    `);
  }

  async createSupplierOrder(input: {
    orderNo: string;
    supplierId: string;
    requestPayloadJson: Record<string, unknown>;
    responsePayloadJson: Record<string, unknown>;
    standardStatus: string;
  }): Promise<SupplierOrder> {
    const rows = await db<SupplierOrder[]>`
      INSERT INTO supplier.supplier_orders (
        id,
        order_no,
        supplier_id,
        supplier_order_no,
        request_payload_json,
        response_payload_json,
        standard_status,
        attempt_no,
        duration_ms,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.orderNo},
        ${input.supplierId},
        ${generateBusinessNo('suporder')},
        ${JSON.stringify(input.requestPayloadJson)},
        ${JSON.stringify(input.responsePayloadJson)},
        ${input.standardStatus},
        1,
        100,
        NOW(),
        NOW()
      )
      RETURNING
        id,
        order_no AS "orderNo",
        supplier_id AS "supplierId",
        supplier_order_no AS "supplierOrderNo",
        request_payload_json AS "requestPayloadJson",
        response_payload_json AS "responsePayloadJson",
        standard_status AS "standardStatus",
        attempt_no AS "attemptNo",
        duration_ms AS "durationMs"
    `;

    const supplierOrder = rows[0];

    if (!supplierOrder) {
      throw new Error('创建供应商订单失败');
    }

    return supplierOrder;
  }

  async updateSupplierOrderStatus(
    supplierOrderNo: string,
    status: string,
    responsePayloadJson: Record<string, unknown>,
  ) {
    await db`
      UPDATE supplier.supplier_orders
      SET
        standard_status = ${status},
        response_payload_json = ${JSON.stringify(responsePayloadJson)},
        updated_at = NOW()
      WHERE supplier_order_no = ${supplierOrderNo}
    `;
  }

  async addCallbackLog(input: {
    supplierId: string | null;
    supplierCode: string;
    supplierOrderNo: string | null;
    bodyJson: Record<string, unknown>;
    parsedStatus: string | null;
    idempotencyKey: string;
  }): Promise<void> {
    await db`
      INSERT INTO supplier.supplier_callback_logs (
        id,
        supplier_id,
        supplier_code,
        supplier_order_no,
        headers_json,
        body_json,
        signature_valid,
        parsed_status,
        idempotency_key,
        created_at
      )
      VALUES (
        ${generateId()},
        ${input.supplierId},
        ${input.supplierCode},
        ${input.supplierOrderNo},
        '{}'::jsonb,
        ${JSON.stringify(input.bodyJson)},
        TRUE,
        ${input.parsedStatus},
        ${input.idempotencyKey},
        NOW()
      )
    `;
  }
}
