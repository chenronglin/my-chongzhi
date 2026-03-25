import { badRequest, notFound } from '@/lib/errors';
import type { ProductContract } from '@/modules/products/contracts';
import type { ProductsRepository } from '@/modules/products/products.repository';

export class ProductsService implements ProductContract {
  constructor(private readonly repository: ProductsRepository) {}

  async listCategories() {
    return this.repository.listCategories();
  }

  async listProducts() {
    return this.repository.listProducts();
  }

  async createCategory(input: { categoryName: string; parentId?: string; sortNo?: number }) {
    return this.repository.createCategory(input);
  }

  async createProduct(input: {
    categoryId: string;
    productName: string;
    productType: string;
    deliveryType: string;
    targetType: string;
  }) {
    return this.repository.createProduct(input);
  }

  async createSku(input: {
    productId: string;
    skuName: string;
    faceValue: number;
    operator?: string;
    region?: string;
    baseCostPrice: number;
    baseSalePrice: number;
  }) {
    return this.repository.createSku(input);
  }

  async addSupplierMapping(input: {
    skuId: string;
    supplierId: string;
    supplierSkuCode: string;
    priority?: number;
    weight?: number;
    routeType?: string;
    costPrice: number;
  }) {
    await this.repository.addSupplierMapping(input);
  }

  async getSkuOrderSnapshot(skuId: string) {
    const sku = await this.repository.findSkuById(skuId);

    if (!sku) {
      throw notFound('SKU 不存在');
    }

    const product = await this.repository.findProductById(sku.productId);

    if (!product) {
      throw notFound('商品不存在');
    }

    if (product.status !== 'ACTIVE' || sku.saleStatus !== 'ON_SHELF') {
      throw badRequest('商品或 SKU 当前不可售');
    }

    const supplierCandidates = await this.repository.listMappingsBySkuId(skuId);

    if (supplierCandidates.length === 0) {
      throw badRequest('SKU 暂无可用供应商映射');
    }

    return {
      product,
      sku,
      supplierCandidates,
    };
  }

  async isSkuSaleable(skuId: string) {
    const snapshot = await this.getSkuOrderSnapshot(skuId);

    return {
      saleable: true,
      snapshot,
    };
  }
}
