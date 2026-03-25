import type { SkuOrderSnapshot } from '@/modules/products/products.types';

export interface ProductContract {
  getSkuOrderSnapshot(skuId: string): Promise<SkuOrderSnapshot>;
}
