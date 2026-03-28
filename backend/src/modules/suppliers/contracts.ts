import type {
  SupplierCatalogItem,
  SupplierDynamicItem,
  SupplierReconcileDiff,
} from '@/modules/suppliers/suppliers.types';

export interface SupplierContract {
  syncFullCatalog(input: {
    supplierCode: string;
    items: SupplierCatalogItem[];
  }): Promise<{ syncedProducts: string[] }>;
  syncDynamicCatalog(input: {
    supplierCode: string;
    items: SupplierDynamicItem[];
  }): Promise<{ updatedProducts: string[] }>;
  submitOrder(payload: { orderNo: string }): Promise<void>;
  queryOrder(payload: {
    orderNo: string;
    supplierOrderNo: string;
    attemptIndex: number;
  }): Promise<void>;
  runInflightReconcile(): Promise<SupplierReconcileDiff[]>;
  runDailyReconcile(input?: { reconcileDate?: string }): Promise<SupplierReconcileDiff[]>;
}
