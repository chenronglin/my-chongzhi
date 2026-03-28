import { conflict } from '@/lib/errors';
import { db, first } from '@/lib/sql';
import { productsSql } from '@/modules/products/products.sql';
import type {
  ProductSupplierMapping,
  RechargeProduct,
  RechargeProductType,
} from '@/modules/products/products.types';

export class ProductsRepository {
  private mapProduct(row: RechargeProduct): RechargeProduct {
    return {
      ...row,
      faceValue: Number(row.faceValue),
    };
  }

  private mapSupplierMapping(row: ProductSupplierMapping): ProductSupplierMapping {
    return {
      ...row,
      costPrice: Number(row.costPrice),
    };
  }

  async listProducts(): Promise<RechargeProduct[]> {
    const rows = await db.unsafe<RechargeProduct[]>(productsSql.listProducts);
    return rows.map((row) => this.mapProduct(row));
  }

  async findMatchingRechargeProduct(input: {
    carrierCode: string;
    province: string;
    faceValue: number;
    productType: RechargeProductType;
  }): Promise<RechargeProduct | null> {
    const provinceMatches = await db<RechargeProduct[]>`
      SELECT
        id,
        product_code AS "productCode",
        product_name AS "productName",
        carrier_code AS "carrierCode",
        province_name AS "provinceName",
        face_value AS "faceValue",
        recharge_mode AS "productType",
        sales_unit AS "salesUnit",
        status
      FROM product.recharge_products
      WHERE carrier_code = ${input.carrierCode}
        AND face_value = ${input.faceValue}
        AND recharge_mode = ${input.productType}
        AND status = 'ACTIVE'
        AND province_name = ${input.province}
      ORDER BY product_code ASC
      LIMIT 2
    `;

    if (provinceMatches.length > 1) {
      throw conflict('命中多个有效充值商品');
    }

    const provinceMatch = provinceMatches[0];

    if (provinceMatch) {
      return this.mapProduct(provinceMatch);
    }

    const nationalMatches = await db<RechargeProduct[]>`
      SELECT
        id,
        product_code AS "productCode",
        product_name AS "productName",
        carrier_code AS "carrierCode",
        province_name AS "provinceName",
        face_value AS "faceValue",
        recharge_mode AS "productType",
        sales_unit AS "salesUnit",
        status
      FROM product.recharge_products
      WHERE carrier_code = ${input.carrierCode}
        AND face_value = ${input.faceValue}
        AND recharge_mode = ${input.productType}
        AND status = 'ACTIVE'
        AND province_name = '全国'
      ORDER BY product_code ASC
      LIMIT 2
    `;

    if (nationalMatches.length > 1) {
      throw conflict('命中多个有效充值商品');
    }

    return nationalMatches[0] ? this.mapProduct(nationalMatches[0]) : null;
  }

  async findProductById(productId: string): Promise<RechargeProduct | null> {
    const row = await first<RechargeProduct>(db<RechargeProduct[]>`
      SELECT
        id,
        product_code AS "productCode",
        product_name AS "productName",
        carrier_code AS "carrierCode",
        province_name AS "provinceName",
        face_value AS "faceValue",
        recharge_mode AS "productType",
        sales_unit AS "salesUnit",
        status
      FROM product.recharge_products
      WHERE id = ${productId}
      LIMIT 1
    `);

    return row ? this.mapProduct(row) : null;
  }

  async listMappingsByProductId(productId: string): Promise<ProductSupplierMapping[]> {
    const rows = await db<ProductSupplierMapping[]>`
      SELECT
        id,
        product_id AS "productId",
        supplier_id AS "supplierId",
        supplier_product_code AS "supplierProductCode",
        priority,
        route_type AS "routeType",
        cost_price AS "costPrice",
        status
      FROM product.product_supplier_mappings
      WHERE product_id = ${productId}
        AND status = 'ACTIVE'
      ORDER BY priority ASC, created_at ASC
    `;

    return rows.map((row) => this.mapSupplierMapping(row));
  }
}
