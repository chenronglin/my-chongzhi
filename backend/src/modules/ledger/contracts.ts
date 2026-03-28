export interface LedgerContract {
  payByBalance(input: {
    channelId: string;
    orderNo: string;
    amount: number;
  }): Promise<{ referenceNo: string }>;
  handleOnlinePayment(input: { orderNo: string; amount: number; paymentNo: string }): Promise<void>;
  refundOrderPayment(orderNo: string): Promise<{ referenceNo: string }>;
}
