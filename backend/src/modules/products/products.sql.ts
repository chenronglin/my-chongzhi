export const productsSql = {
  listProducts: `
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
    ORDER BY created_at DESC
  `,
} as const;
