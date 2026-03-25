export interface LedgerContract {
  payByBalance(input: {
    channelId: string;
    orderNo: string;
    amount: number;
    paymentNo: string;
  }): Promise<void>;
  handleOnlinePayment(input: { orderNo: string; amount: number; paymentNo: string }): Promise<void>;
  handleRefundSuccess(orderNo: string): Promise<void>;
}
