export interface ProductCategory {
  id: string;
  categoryName: string;
  parentId: string | null;
  status: string;
  sortNo: number;
}

export interface Product {
  id: string;
  categoryId: string;
  productName: string;
  productType: string;
  deliveryType: string;
  targetType: string;
  status: string;
  validFrom: string | null;
  validTo: string | null;
  baseAttributesJson: Record<string, unknown>;
}

export interface ProductSku {
  id: string;
  productId: string;
  skuName: string;
  faceValue: number;
  operator: string | null;
  region: string | null;
  saleStatus: string;
  baseCostPrice: number;
  baseSalePrice: number;
  extJson: Record<string, unknown>;
}

export interface SkuSupplierMapping {
  id: string;
  skuId: string;
  supplierId: string;
  supplierSkuCode: string;
  priority: number;
  weight: number;
  routeType: string;
  costPrice: number;
  status: string;
}

export interface SkuOrderSnapshot {
  product: Product;
  sku: ProductSku;
  supplierCandidates: SkuSupplierMapping[];
}
