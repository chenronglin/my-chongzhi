export interface PaymentChannel {
  id: string;
  channelCode: string;
  channelName: string;
  providerType: string;
  configJson: Record<string, unknown>;
  status: string;
}

export interface PaymentOrder {
  id: string;
  paymentNo: string;
  orderNo: string;
  channelId: string;
  paymentChannelCode: string;
  payAmount: number;
  currency: string;
  status: string;
  paymentMode: string;
  thirdTradeNo: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
}

export interface PaymentRefund {
  id: string;
  refundNo: string;
  paymentNo: string;
  orderNo: string;
  amount: number;
  status: string;
  providerRefundNo: string | null;
}
