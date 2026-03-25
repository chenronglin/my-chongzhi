export type MainOrderStatus =
  | 'CREATED'
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'WAIT_SUPPLIER_SUBMIT'
  | 'SUPPLIER_PROCESSING'
  | 'SUCCESS'
  | 'FAIL'
  | 'REFUNDING'
  | 'REFUNDED'
  | 'CLOSED';

export interface OrderRecord {
  id: string;
  orderNo: string;
  channelOrderNo: string;
  channelId: string;
  parentChannelId: string | null;
  productId: string;
  skuId: string;
  salePrice: number;
  costPrice: number;
  currency: string;
  paymentMode: string;
  paymentNo: string | null;
  mainStatus: MainOrderStatus;
  paymentStatus: string;
  supplierStatus: string;
  notifyStatus: string;
  riskStatus: string;
  channelSnapshotJson: Record<string, unknown>;
  productSnapshotJson: Record<string, unknown>;
  callbackSnapshotJson: Record<string, unknown>;
  supplierRouteSnapshotJson: Record<string, unknown>;
  riskSnapshotJson: Record<string, unknown>;
  extJson: Record<string, unknown>;
  exceptionTag: string | null;
  remark: string | null;
  version: number;
  requestId: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  finishedAt: string | null;
}

export interface OrderEventRecord {
  id: string;
  orderNo: string;
  eventType: string;
  sourceService: string;
  sourceNo: string | null;
  beforeStatusJson: Record<string, unknown>;
  afterStatusJson: Record<string, unknown>;
  payloadJson: Record<string, unknown>;
  idempotencyKey: string;
  operator: string;
  requestId: string;
  occurredAt: string;
}
