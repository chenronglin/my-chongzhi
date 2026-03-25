import { badRequest, notFound } from '@/lib/errors';
import { eventBus } from '@/lib/event-bus';
import type { LedgerService } from '@/modules/ledger/ledger.service';
import type { PaymentContract } from '@/modules/payments/contracts';
import type { PaymentsRepository } from '@/modules/payments/payments.repository';

export class PaymentsService implements PaymentContract {
  constructor(
    private readonly repository: PaymentsRepository,
    private readonly ledgerService: LedgerService,
  ) {}

  async listChannels() {
    return this.repository.listChannels();
  }

  async listPaymentOrders() {
    return this.repository.listPaymentOrders();
  }

  async createPaymentForOrder(input: {
    orderNo: string;
    channelId: string;
    amount: number;
    paymentMode: 'ONLINE' | 'BALANCE' | 'FREE';
  }) {
    if (input.paymentMode === 'FREE') {
      const paymentOrder = await this.repository.createPaymentOrder({
        ...input,
        paymentChannelCode: 'free',
        status: 'SUCCESS',
      });

      await eventBus.publish('PaymentSucceeded', {
        orderNo: input.orderNo,
        paymentNo: paymentOrder.paymentNo,
        paymentMode: input.paymentMode,
        paidAmount: input.amount,
      });

      return paymentOrder;
    }

    if (input.paymentMode === 'BALANCE') {
      const paymentOrder = await this.repository.createPaymentOrder({
        ...input,
        paymentChannelCode: 'balance',
        status: 'SUCCESS',
      });

      await this.ledgerService.payByBalance({
        channelId: input.channelId,
        orderNo: input.orderNo,
        amount: input.amount,
        paymentNo: paymentOrder.paymentNo,
      });

      await eventBus.publish('PaymentSucceeded', {
        orderNo: input.orderNo,
        paymentNo: paymentOrder.paymentNo,
        paymentMode: input.paymentMode,
        paidAmount: input.amount,
      });

      return paymentOrder;
    }

    const paymentChannel = await this.repository.findPaymentChannelByCode('mockpay');

    if (!paymentChannel || paymentChannel.status !== 'ACTIVE') {
      throw notFound('可用支付通道不存在');
    }

    return this.repository.createPaymentOrder({
      ...input,
      paymentChannelCode: paymentChannel.channelCode,
      status: 'PENDING',
    });
  }

  async handleMockPaymentCallback(input: {
    paymentNo: string;
    status: 'SUCCESS' | 'FAIL';
    thirdTradeNo?: string;
    requestId: string;
  }) {
    const paymentOrder = await this.repository.findPaymentOrderByNo(input.paymentNo);

    await this.repository.addCallbackLog({
      paymentNo: input.paymentNo,
      provider: 'mockpay',
      headersJson: {},
      bodyJson: {
        paymentNo: input.paymentNo,
        status: input.status,
        thirdTradeNo: input.thirdTradeNo ?? null,
      },
      signatureValid: true,
      requestId: input.requestId,
    });

    if (!paymentOrder) {
      throw notFound('支付单不存在');
    }

    if (paymentOrder.status === 'SUCCESS') {
      return paymentOrder;
    }

    if (input.status === 'FAIL') {
      await this.repository.updatePaymentOrderToFail(input.paymentNo);
      await eventBus.publish('PaymentFailed', {
        orderNo: paymentOrder.orderNo,
        paymentNo: paymentOrder.paymentNo,
        reason: '模拟支付失败',
      });

      return this.repository.findPaymentOrderByNo(input.paymentNo);
    }

    await this.repository.updatePaymentOrderToSuccess(input.paymentNo, input.thirdTradeNo);
    await this.ledgerService.handleOnlinePayment({
      orderNo: paymentOrder.orderNo,
      amount: Number(paymentOrder.payAmount),
      paymentNo: paymentOrder.paymentNo,
    });

    await eventBus.publish('PaymentSucceeded', {
      orderNo: paymentOrder.orderNo,
      paymentNo: paymentOrder.paymentNo,
      paymentMode: paymentOrder.paymentMode,
      paidAmount: Number(paymentOrder.payAmount),
    });

    return this.repository.findPaymentOrderByNo(input.paymentNo);
  }

  async handleRefundRequested(input: { orderNo: string; refundNo: string; reason: string }) {
    const paymentOrder = await this.repository.findPaymentOrderByOrderNo(input.orderNo);

    if (!paymentOrder) {
      throw notFound('退款对应的支付单不存在');
    }

    if (paymentOrder.status !== 'SUCCESS') {
      throw badRequest('支付未成功，无法发起退款');
    }

    await this.repository.createRefund({
      paymentNo: paymentOrder.paymentNo,
      orderNo: paymentOrder.orderNo,
      amount: Number(paymentOrder.payAmount),
      status: 'SUCCESS',
    });

    await eventBus.publish('RefundSucceeded', {
      orderNo: paymentOrder.orderNo,
      refundNo: input.refundNo,
      source: 'payment',
    });
  }
}
