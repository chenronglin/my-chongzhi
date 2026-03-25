import type { PaymentOrder } from '@/modules/payments/payments.types';

export interface PaymentContract {
  createPaymentForOrder(input: {
    orderNo: string;
    channelId: string;
    amount: number;
    paymentMode: 'ONLINE' | 'BALANCE' | 'FREE';
  }): Promise<PaymentOrder>;
}
