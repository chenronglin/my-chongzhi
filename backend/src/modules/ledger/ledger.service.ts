import { notFound } from '@/lib/errors';
import type { LedgerContract } from '@/modules/ledger/contracts';
import type { LedgerRepository } from '@/modules/ledger/ledger.repository';
import type { OrderContract } from '@/modules/orders/contracts';

export class LedgerService implements LedgerContract {
  constructor(
    private readonly repository: LedgerRepository,
    private readonly orderContract: OrderContract,
  ) {}

  async listAccounts() {
    return this.repository.listAccounts();
  }

  async listLedgerEntries() {
    return this.repository.listLedgerEntries();
  }

  async listProfitRules() {
    return this.repository.listProfitRules();
  }

  async createProfitRule(input: {
    ruleName: string;
    channelId?: string;
    productId?: string;
    skuId?: string;
    configJson: Record<string, unknown>;
  }) {
    return this.repository.createProfitRule(input);
  }

  async payByBalance(input: {
    channelId: string;
    orderNo: string;
    amount: number;
    paymentNo: string;
  }): Promise<void> {
    const existing = await this.repository.findLedgerByReference(
      'ORDER',
      input.paymentNo,
      'BALANCE_PAYMENT',
    );

    if (existing) {
      return;
    }

    const channelAccount = await this.repository.findAccount('CHANNEL', input.channelId);
    const platformAccount = await this.repository.findPlatformAccount();

    if (!channelAccount || !platformAccount) {
      throw notFound('余额账户不存在');
    }

    await this.repository.transferBalance({
      fromAccountId: channelAccount.id,
      toAccountId: platformAccount.id,
      orderNo: input.orderNo,
      amount: input.amount,
      referenceNo: input.paymentNo,
      actionType: 'BALANCE_PAYMENT',
    });
  }

  async handleOnlinePayment(input: {
    orderNo: string;
    amount: number;
    paymentNo: string;
  }): Promise<void> {
    const existing = await this.repository.findLedgerByReference(
      'PAYMENT',
      input.paymentNo,
      'ONLINE_PAYMENT',
    );

    if (existing) {
      return;
    }

    const platformAccount = await this.repository.findPlatformAccount();

    if (!platformAccount) {
      throw notFound('平台账户不存在');
    }

    await this.repository.createSingleLedger({
      accountId: platformAccount.id,
      orderNo: input.orderNo,
      actionType: 'ONLINE_PAYMENT',
      direction: 'CREDIT',
      amount: input.amount,
      referenceType: 'PAYMENT',
      referenceNo: input.paymentNo,
    });
  }

  async handleSettlementTriggered(orderNo: string): Promise<void> {
    const existing = await this.repository.findLedgerByReference(
      'ORDER',
      orderNo,
      'ORDER_SETTLEMENT',
    );

    if (existing) {
      return;
    }

    const order = await this.orderContract.getLedgerContext(orderNo);
    const platformAccount = await this.repository.findPlatformAccount();

    if (!platformAccount) {
      throw notFound('平台账户不存在');
    }

    if (order.costPrice > 0) {
      await this.repository.createSingleLedger({
        accountId: platformAccount.id,
        orderNo,
        actionType: 'ORDER_SETTLEMENT',
        direction: 'DEBIT',
        amount: order.costPrice,
        referenceType: 'ORDER',
        referenceNo: orderNo,
      });
    }
  }

  async handleRefundSuccess(orderNo: string): Promise<void> {
    const existing = await this.repository.findLedgerByReference('ORDER', orderNo, 'ORDER_REFUND');

    if (existing) {
      return;
    }

    const order = await this.orderContract.getLedgerContext(orderNo);
    const platformAccount = await this.repository.findPlatformAccount();

    if (!platformAccount) {
      throw notFound('平台账户不存在');
    }

    if (order.paymentMode === 'BALANCE') {
      const channelAccount = await this.repository.findAccount('CHANNEL', order.channelId);

      if (!channelAccount) {
        throw notFound('渠道账户不存在');
      }

      await this.repository.transferBalance({
        fromAccountId: platformAccount.id,
        toAccountId: channelAccount.id,
        orderNo,
        amount: order.salePrice,
        referenceNo: orderNo,
        actionType: 'ORDER_REFUND',
      });

      return;
    }

    await this.repository.createSingleLedger({
      accountId: platformAccount.id,
      orderNo,
      actionType: 'ORDER_REFUND',
      direction: 'DEBIT',
      amount: order.salePrice,
      referenceType: 'ORDER',
      referenceNo: orderNo,
    });
  }
}
