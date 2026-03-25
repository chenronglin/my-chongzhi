import { generateId } from '@/lib/id';
import { db, first } from '@/lib/sql';
import { parseJsonValue } from '@/lib/utils';
import { productsSql } from '@/modules/products/products.sql';
import type {
  Product,
  ProductCategory,
  ProductSku,
  SkuSupplierMapping,
} from '@/modules/products/products.types';

export class ProductsRepository {
  private mapProduct(row: Product): Product {
    return {
      ...row,
      baseAttributesJson: parseJsonValue(row.baseAttributesJson, {}),
    };
  }

  private mapSku(row: ProductSku): ProductSku {
    return {
      ...row,
      extJson: parseJsonValue(row.extJson, {}),
    };
  }

  async listProducts(): Promise<Product[]> {
    const rows = await db.unsafe<Product[]>(productsSql.listProducts);
    return rows.map((row) => this.mapProduct(row));
  }

  async listCategories(): Promise<ProductCategory[]> {
    return db<ProductCategory[]>`
      SELECT
        id,
        category_name AS "categoryName",
        parent_id AS "parentId",
        status,
        sort_no AS "sortNo"
      FROM product.product_categories
      ORDER BY sort_no ASC, created_at DESC
    `;
  }

  async createCategory(input: {
    categoryName: string;
    parentId?: string;
    sortNo?: number;
  }): Promise<ProductCategory> {
    const rows = await db<ProductCategory[]>`
      INSERT INTO product.product_categories (
        id,
        category_name,
        parent_id,
        status,
        sort_no,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.categoryName},
        ${input.parentId ?? null},
        'ACTIVE',
        ${input.sortNo ?? 0},
        NOW(),
        NOW()
      )
      RETURNING
        id,
        category_name AS "categoryName",
        parent_id AS "parentId",
        status,
        sort_no AS "sortNo"
    `;

    const category = rows[0];

    if (!category) {
      throw new Error('创建商品分类失败');
    }

    return category;
  }

  async createProduct(input: {
    categoryId: string;
    productName: string;
    productType: string;
    deliveryType: string;
    targetType: string;
  }): Promise<Product> {
    const rows = await db<Product[]>`
      INSERT INTO product.products (
        id,
        category_id,
        product_name,
        product_type,
        delivery_type,
        target_type,
        status,
        base_attributes_json,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.categoryId},
        ${input.productName},
        ${input.productType},
        ${input.deliveryType},
        ${input.targetType},
        'ACTIVE',
        '{}'::jsonb,
        NOW(),
        NOW()
      )
      RETURNING
        id,
        category_id AS "categoryId",
        product_name AS "productName",
        product_type AS "productType",
        delivery_type AS "deliveryType",
        target_type AS "targetType",
        status,
        valid_from AS "validFrom",
        valid_to AS "validTo",
        base_attributes_json AS "baseAttributesJson"
    `;

    const product = rows[0];

    if (!product) {
      throw new Error('创建商品失败');
    }

    return this.mapProduct(product);
  }

  async createSku(input: {
    productId: string;
    skuName: string;
    faceValue: number;
    operator?: string;
    region?: string;
    baseCostPrice: number;
    baseSalePrice: number;
  }): Promise<ProductSku> {
    const rows = await db<ProductSku[]>`
      INSERT INTO product.product_skus (
        id,
        product_id,
        sku_name,
        face_value,
        operator,
        region,
        sale_status,
        base_cost_price,
        base_sale_price,
        ext_json,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.productId},
        ${input.skuName},
        ${input.faceValue},
        ${input.operator ?? null},
        ${input.region ?? null},
        'ON_SHELF',
        ${input.baseCostPrice},
        ${input.baseSalePrice},
        '{}'::jsonb,
        NOW(),
        NOW()
      )
      RETURNING
        id,
        product_id AS "productId",
        sku_name AS "skuName",
        face_value AS "faceValue",
        operator,
        region,
        sale_status AS "saleStatus",
        base_cost_price AS "baseCostPrice",
        base_sale_price AS "baseSalePrice",
        ext_json AS "extJson"
    `;

    const sku = rows[0];

    if (!sku) {
      throw new Error('创建 SKU 失败');
    }

    return this.mapSku(sku);
  }

  async addSupplierMapping(input: {
    skuId: string;
    supplierId: string;
    supplierSkuCode: string;
    priority?: number;
    weight?: number;
    routeType?: string;
    costPrice: number;
  }): Promise<void> {
    await db`
      INSERT INTO product.sku_supplier_mappings (
        id,
        sku_id,
        supplier_id,
        supplier_sku_code,
        priority,
        weight,
        route_type,
        cost_price,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.skuId},
        ${input.supplierId},
        ${input.supplierSkuCode},
        ${input.priority ?? 1},
        ${input.weight ?? 100},
        ${input.routeType ?? 'PRIMARY'},
        ${input.costPrice},
        'ACTIVE',
        NOW(),
        NOW()
      )
    `;
  }

  async findProductById(productId: string): Promise<Product | null> {
    const row = await first<Product>(db<Product[]>`
      SELECT
        id,
        category_id AS "categoryId",
        product_name AS "productName",
        product_type AS "productType",
        delivery_type AS "deliveryType",
        target_type AS "targetType",
        status,
        valid_from AS "validFrom",
        valid_to AS "validTo",
        base_attributes_json AS "baseAttributesJson"
      FROM product.products
      WHERE id = ${productId}
      LIMIT 1
    `);

    return row ? this.mapProduct(row) : null;
  }

  async findSkuById(skuId: string): Promise<ProductSku | null> {
    const row = await first<ProductSku>(db<ProductSku[]>`
      SELECT
        id,
        product_id AS "productId",
        sku_name AS "skuName",
        face_value AS "faceValue",
        operator,
        region,
        sale_status AS "saleStatus",
        base_cost_price AS "baseCostPrice",
        base_sale_price AS "baseSalePrice",
        ext_json AS "extJson"
      FROM product.product_skus
      WHERE id = ${skuId}
      LIMIT 1
    `);

    return row ? this.mapSku(row) : null;
  }

  async listMappingsBySkuId(skuId: string): Promise<SkuSupplierMapping[]> {
    return db<SkuSupplierMapping[]>`
      SELECT
        id,
        sku_id AS "skuId",
        supplier_id AS "supplierId",
        supplier_sku_code AS "supplierSkuCode",
        priority,
        weight,
        route_type AS "routeType",
        cost_price AS "costPrice",
        status
      FROM product.sku_supplier_mappings
      WHERE sku_id = ${skuId}
        AND status = 'ACTIVE'
      ORDER BY priority ASC, weight DESC, created_at ASC
    `;
  }
}
