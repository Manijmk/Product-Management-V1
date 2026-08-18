import type { DbClient } from "../db/transaction.js";
import { AppError } from "../http/errors.js";

export interface ResolvedPrice {
  price: number;
  source: "CUSTOMER_PRICE" | "PRODUCT_DEFAULT";
}

export async function resolvePrice(
  db: DbClient,
  partyId: number,
  productId: number,
  at: string
): Promise<ResolvedPrice> {
  const customer = await db.query<{ price: string }>(
    `SELECT price FROM party_product_price
      WHERE party_id=$1 AND product_id=$2 AND approval_status='APPROVED'
        AND effective_from <= $3::timestamptz
        AND (effective_to IS NULL OR effective_to > $3::timestamptz)
      ORDER BY effective_from DESC LIMIT 1`,
    [partyId, productId, at]
  );
  if (customer.rows[0]) return { price: Number(customer.rows[0].price), source: "CUSTOMER_PRICE" };

  const product = await db.query<{ price: string }>(
    `SELECT price FROM product_price
      WHERE product_id=$1 AND status='ACTIVE'
        AND effective_from <= $2::timestamptz
        AND (effective_to IS NULL OR effective_to > $2::timestamptz)
      ORDER BY effective_from DESC LIMIT 1`,
    [productId, at]
  );
  if (product.rows[0]) return { price: Number(product.rows[0].price), source: "PRODUCT_DEFAULT" };
  throw new AppError(422, "PRICE_NOT_CONFIGURED", "No active customer or product price exists for the event time", { productId });
}

export async function resolveDamageRate(db: DbClient, productId: number, at: string): Promise<number> {
  const result = await db.query<{ rate: string }>(
    `SELECT rate FROM product_damage_rate
      WHERE product_id=$1 AND damage_type IN ('DAMAGED','BROKEN') AND status='ACTIVE'
        AND effective_from <= $2::timestamptz
        AND (effective_to IS NULL OR effective_to > $2::timestamptz)
      ORDER BY effective_from DESC LIMIT 1`,
    [productId, at]
  );
  if (!result.rows[0]) throw new AppError(422, "DAMAGE_RATE_NOT_CONFIGURED", "No active damage rate exists for the event time", { productId });
  return Number(result.rows[0].rate);
}
