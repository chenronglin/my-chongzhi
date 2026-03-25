import { generateBusinessNo, generateId } from '@/lib/id';
import { db, first } from '@/lib/sql';
import { paymentsSql } from '@/modules/payments/payments.sql';
import type {
  PaymentChannel,
  PaymentOrder,
  PaymentRefund,
} from '@/modules/payments/payments.types';

export class PaymentsRepository {
  async listChannels(): Promise<PaymentChannel[]> {
    return db.unsafe<PaymentChannel[]>(paymentsSql.listChannels);
  }

  async listPaymentOrders(): Promise<PaymentOrder[]> {
    return db.unsafe<PaymentOrder[]>(paymentsSql.listOrders);
  }

  async findPaymentChannelByCode(channelCode: string): Promise<PaymentChannel | null> {
    return first<PaymentChannel>(db<PaymentChannel[]>`
      SELECT
        id,
        channel_code AS "channelCode",
        channel_name AS "channelName",
        provider_type AS "providerType",
        config_json AS "configJson",
        status
      FROM payment.payment_channels
      WHERE channel_code = ${channelCode}
      LIMIT 1
    `);
  }

  async createPaymentOrder(input: {
    orderNo: string;
    channelId: string;
    amount: number;
    paymentChannelCode: string;
    paymentMode: string;
    status: string;
  }): Promise<PaymentOrder> {
    const rows = await db<PaymentOrder[]>`
      INSERT INTO payment.payment_orders (
        id,
        payment_no,
        order_no,
        channel_id,
        payment_channel_code,
        pay_amount,
        currency,
        status,
        payment_mode,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${generateBusinessNo('pay')},
        ${input.orderNo},
        ${input.channelId},
        ${input.paymentChannelCode},
        ${input.amount},
        'CNY',
        ${input.status},
        ${input.paymentMode},
        NOW(),
        NOW()
      )
      RETURNING
        id,
        payment_no AS "paymentNo",
        order_no AS "orderNo",
        channel_id AS "channelId",
        payment_channel_code AS "paymentChannelCode",
        pay_amount AS "payAmount",
        currency,
        status,
        payment_mode AS "paymentMode",
        third_trade_no AS "thirdTradeNo",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        paid_at AS "paidAt"
    `;

    const paymentOrder = rows[0];

    if (!paymentOrder) {
      throw new Error('创建支付单失败');
    }

    return paymentOrder;
  }

  async findPaymentOrderByNo(paymentNo: string): Promise<PaymentOrder | null> {
    return first<PaymentOrder>(db<PaymentOrder[]>`
      SELECT
        id,
        payment_no AS "paymentNo",
        order_no AS "orderNo",
        channel_id AS "channelId",
        payment_channel_code AS "paymentChannelCode",
        pay_amount AS "payAmount",
        currency,
        status,
        payment_mode AS "paymentMode",
        third_trade_no AS "thirdTradeNo",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        paid_at AS "paidAt"
      FROM payment.payment_orders
      WHERE payment_no = ${paymentNo}
      LIMIT 1
    `);
  }

  async findPaymentOrderByOrderNo(orderNo: string): Promise<PaymentOrder | null> {
    return first<PaymentOrder>(db<PaymentOrder[]>`
      SELECT
        id,
        payment_no AS "paymentNo",
        order_no AS "orderNo",
        channel_id AS "channelId",
        payment_channel_code AS "paymentChannelCode",
        pay_amount AS "payAmount",
        currency,
        status,
        payment_mode AS "paymentMode",
        third_trade_no AS "thirdTradeNo",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        paid_at AS "paidAt"
      FROM payment.payment_orders
      WHERE order_no = ${orderNo}
      ORDER BY created_at DESC
      LIMIT 1
    `);
  }

  async updatePaymentOrderToSuccess(paymentNo: string, thirdTradeNo?: string): Promise<void> {
    await db`
      UPDATE payment.payment_orders
      SET
        status = 'SUCCESS',
        third_trade_no = COALESCE(${thirdTradeNo ?? null}, third_trade_no),
        paid_at = NOW(),
        updated_at = NOW()
      WHERE payment_no = ${paymentNo}
    `;
  }

  async updatePaymentOrderToFail(paymentNo: string): Promise<void> {
    await db`
      UPDATE payment.payment_orders
      SET
        status = 'FAIL',
        updated_at = NOW()
      WHERE payment_no = ${paymentNo}
    `;
  }

  async addCallbackLog(input: {
    paymentNo?: string;
    provider: string;
    headersJson: Record<string, unknown>;
    bodyJson: Record<string, unknown>;
    signatureValid: boolean;
    requestId: string;
  }): Promise<void> {
    await db`
      INSERT INTO payment.payment_callback_logs (
        id,
        payment_no,
        provider,
        headers_json,
        body_json,
        signature_valid,
        request_id,
        created_at
      )
      VALUES (
        ${generateId()},
        ${input.paymentNo ?? null},
        ${input.provider},
        ${JSON.stringify(input.headersJson)},
        ${JSON.stringify(input.bodyJson)},
        ${input.signatureValid},
        ${input.requestId},
        NOW()
      )
    `;
  }

  async createRefund(input: {
    paymentNo: string;
    orderNo: string;
    amount: number;
    status: string;
  }): Promise<PaymentRefund> {
    const rows = await db<PaymentRefund[]>`
      INSERT INTO payment.payment_refunds (
        id,
        refund_no,
        payment_no,
        order_no,
        amount,
        status,
        provider_refund_no,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${generateBusinessNo('refund')},
        ${input.paymentNo},
        ${input.orderNo},
        ${input.amount},
        ${input.status},
        ${generateBusinessNo('mockrefund')},
        NOW(),
        NOW()
      )
      RETURNING
        id,
        refund_no AS "refundNo",
        payment_no AS "paymentNo",
        order_no AS "orderNo",
        amount,
        status,
        provider_refund_no AS "providerRefundNo"
    `;

    const refund = rows[0];

    if (!refund) {
      throw new Error('创建退款记录失败');
    }

    return refund;
  }
}
