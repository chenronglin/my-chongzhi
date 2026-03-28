export interface LedgerContract {
  payByBalance(input: {
    channelId: string;
    orderNo: string;
    amount: number;
  }): Promise<{ referenceNo: string }>;
  refundOrderPayment(orderNo: string): Promise<{ referenceNo: string }>;
}
