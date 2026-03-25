export interface Supplier {
  id: string;
  supplierCode: string;
  supplierName: string;
  protocolType: string;
  status: string;
}

export interface SupplierConfig {
  id: string;
  supplierId: string;
  configJson: Record<string, unknown>;
  credentialEncrypted: string;
  callbackSecretEncrypted: string;
  timeoutMs: number;
}

export interface SupplierOrder {
  id: string;
  orderNo: string;
  supplierId: string;
  supplierOrderNo: string;
  requestPayloadJson: Record<string, unknown>;
  responsePayloadJson: Record<string, unknown>;
  standardStatus: string;
  attemptNo: number;
  durationMs: number;
}
