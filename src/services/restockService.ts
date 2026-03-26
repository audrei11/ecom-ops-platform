import { tryGetDb } from '@/lib/supabase';
import * as mockDb from '@/lib/mockDb';
import type { RestockRecommendation, ServiceResult } from '@/lib/types';

// =============================================================================
// Restock Service
//
// Formula:
//   avg_daily_sales         = total_sold_in_window / window_days
//   demand_during_lead_time = avg_daily_sales × lead_time_days
//   reorder_point           = demand_during_lead_time + safety_stock
//   recommended_quantity    = ceil(reorder_point - current_stock)   if > 0
//   days_until_stockout     = current_stock / avg_daily_sales       (null if no sales)
//
// Urgency tiers:
//   critical  → stock ≤ 0, OR avg_daily_sales > 0 AND days_until_stockout < lead_time_days
//   warning   → needs_restock AND not critical
//   ok        → no action needed
// =============================================================================

export interface RestockInput {
  product_id: string;
  window_days?: number;
}

export type RestockUrgency = 'critical' | 'warning' | 'ok';

export interface RestockCalculation {
  product_id: string;
  sku: string;
  product_name: string;
  window_days: number;
  // stock
  current_stock: number;
  safety_stock: number;
  // velocity
  avg_daily_sales: number;
  // lead time
  lead_time_days: number;
  demand_during_lead_time: number;
  // thresholds
  reorder_point: number;
  recommended_quantity: number;
  // derived
  days_until_stockout: number | null;   // null means "won't run out at current velocity"
  needs_restock: boolean;
  urgency: RestockUrgency;
}

// =============================================================================
// Pure calculation helper — shared by mock and Supabase paths
// =============================================================================

interface ProductSnapshot {
  id: string;
  sku: string;
  name: string;
  lead_time_weeks: number;
  safety_stock_units: number;
  current_stock: number;    // on_hand − reserved, pre-computed by caller
}

function computeRestock(
  product: ProductSnapshot,
  totalSold: number,
  windowDays: number
): RestockCalculation {
  // Clamp — negative stock is treated as zero for calculation purposes
  const currentStock = Math.max(0, product.current_stock);

  // Guard against windowDays = 0 (shouldn't happen after API validation, but be safe)
  const avgDailySales = totalSold / Math.max(windowDays, 1);

  const leadTimeDays = product.lead_time_weeks * 7;
  const safetyStock  = product.safety_stock_units;

  const demandDuringLeadTime = avgDailySales * leadTimeDays;
  const reorderPoint         = demandDuringLeadTime + safetyStock;

  // Recommended quantity: how many to order to reach the reorder point
  const recommendedQuantity = Math.max(0, Math.ceil(reorderPoint - currentStock));
  const needsRestock        = currentStock < reorderPoint;

  // Days until stock runs out at current velocity
  const daysUntilStockout: number | null =
    currentStock <= 0   ? 0 :
    avgDailySales <= 0  ? null :              // won't run out
    currentStock / avgDailySales;

  // Urgency tier
  const urgency: RestockUrgency =
    currentStock <= 0 ||
    (avgDailySales > 0 && daysUntilStockout !== null && daysUntilStockout < leadTimeDays)
      ? 'critical'
    : needsRestock
      ? 'warning'
      : 'ok';

  return {
    product_id:              product.id,
    sku:                     product.sku,
    product_name:            product.name,
    window_days:             windowDays,
    current_stock:           currentStock,
    safety_stock:            safetyStock,
    avg_daily_sales:         parseFloat(avgDailySales.toFixed(4)),
    lead_time_days:          leadTimeDays,
    demand_during_lead_time: parseFloat(demandDuringLeadTime.toFixed(2)),
    reorder_point:           parseFloat(reorderPoint.toFixed(2)),
    recommended_quantity:    recommendedQuantity,
    days_until_stockout:     daysUntilStockout !== null
                               ? parseFloat(daysUntilStockout.toFixed(1))
                               : null,
    needs_restock:           needsRestock,
    urgency,
  };
}

// =============================================================================
// Sort helper — urgency first, then highest recommended_quantity
// =============================================================================

const URGENCY_RANK: Record<RestockUrgency, number> = {
  critical: 0,
  warning:  1,
  ok:       2,
};

export function sortByUrgency(recs: RestockCalculation[]): RestockCalculation[] {
  return [...recs].sort((a, b) => {
    const rankDiff = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (rankDiff !== 0) return rankDiff;
    return b.recommended_quantity - a.recommended_quantity;
  });
}

// =============================================================================
// Main service function
// =============================================================================

/**
 * Calculate restock recommendations for the given products (or all products).
 * Returns recommendations sorted by urgency (critical → warning → ok).
 */
export async function calculateRestockRecommendations(
  inputs: RestockInput[] = [],
  windowDays = 30
): Promise<ServiceResult<RestockCalculation[]>> {
  const db = tryGetDb();

  // ---- Mock DB path ----------------------------------------------------------
  if (!db) {
    console.log('[restockService] Using MOCK DB');

    const productIds = inputs.length > 0 ? inputs.map((i) => i.product_id) : undefined;
    const products   = mockDb.getProductsWithInventory(productIds);

    if (products.length === 0) {
      return { success: true, data: [] };
    }

    const since = new Date();
    since.setDate(since.getDate() - windowDays);

    const allIds   = products.map((p) => p.id);
    const salesRaw = mockDb.getOrderItemsSince(allIds, since);

    // Aggregate total units sold per product
    const salesByProduct = new Map<string, number>();
    for (const sale of salesRaw) {
      salesByProduct.set(sale.product_id, (salesByProduct.get(sale.product_id) ?? 0) + sale.quantity);
    }

    const recommendations = products.map((p) => {
      const inv          = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
      const currentStock = inv ? inv.quantity_on_hand - inv.quantity_reserved : 0;
      const totalSold    = salesByProduct.get(p.id) ?? 0;

      return computeRestock(
        { id: p.id, sku: p.sku, name: p.name, lead_time_weeks: p.lead_time_weeks, safety_stock_units: p.safety_stock_units, current_stock: currentStock },
        totalSold,
        windowDays
      );
    });

    return { success: true, data: sortByUrgency(recommendations) };
  }

  // ---- Supabase path ---------------------------------------------------------

  let query = db
    .from('products')
    .select(`
      id,
      sku,
      name,
      lead_time_weeks,
      safety_stock_units,
      inventory!inner (
        quantity_on_hand,
        quantity_reserved
      )
    `);

  if (inputs.length > 0) {
    query = query.in('id', inputs.map((i) => i.product_id));
  }

  const { data: products, error: productsError } = await query;

  if (productsError) {
    return { success: false, error: productsError.message };
  }

  if (!products || products.length === 0) {
    return { success: true, data: [] };
  }

  // Sales over the window
  const since      = new Date();
  since.setDate(since.getDate() - windowDays);
  const productIds = products.map((p: { id: string }) => p.id);

  const { data: salesData, error: salesError } = await db
    .from('order_items')
    .select('product_id, quantity')
    .in('product_id', productIds)
    .gte('created_at', since.toISOString());

  if (salesError) {
    return { success: false, error: salesError.message };
  }

  const salesByProduct = new Map<string, number>();
  for (const sale of salesData ?? []) {
    salesByProduct.set(sale.product_id, (salesByProduct.get(sale.product_id) ?? 0) + sale.quantity);
  }

  const recommendations: RestockCalculation[] = products.map((p: {
    id: string;
    sku: string;
    name: string;
    lead_time_weeks: number;
    safety_stock_units: number;
    inventory: Array<{ quantity_on_hand: number; quantity_reserved: number }>;
  }) => {
    const inv          = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
    const currentStock = inv ? inv.quantity_on_hand - inv.quantity_reserved : 0;
    const totalSold    = salesByProduct.get(p.id) ?? 0;

    return computeRestock(
      { id: p.id, sku: p.sku, name: p.name, lead_time_weeks: p.lead_time_weeks, safety_stock_units: p.safety_stock_units, current_stock: currentStock },
      totalSold,
      windowDays
    );
  });

  // Persist to Supabase (non-fatal)
  const inserts: Omit<RestockRecommendation, 'id' | 'approved_at'>[] =
    recommendations.map((r) => ({
      product_id:               r.product_id,
      current_stock:            r.current_stock,
      avg_daily_sales:          r.avg_daily_sales,
      lead_time_days:           r.lead_time_days,
      safety_stock:             r.safety_stock,
      recommended_quantity:     r.recommended_quantity,
      calculation_window_days:  windowDays,
      status:                   'pending' as const,
      calculated_at:            new Date().toISOString(),
      notes:                    null,
    }));

  if (inserts.length > 0) {
    const { error: insertError } = await db.from('restock_recommendations').insert(inserts);
    if (insertError) {
      console.error('[restockService] Failed to persist recommendations:', insertError);
    }
  }

  return { success: true, data: sortByUrgency(recommendations) };
}
