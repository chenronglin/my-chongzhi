export interface NotificationTask {
  id: string;
  taskNo: string;
  orderNo: string;
  channelId: string;
  notifyType: string;
  destination: string;
  payloadJson: Record<string, unknown>;
  signature: string | null;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
}
