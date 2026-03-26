import { tryGetDb } from '@/lib/supabase';
import * as mockDb from '@/lib/mockDb';
import type {
  InventoryWithAvailable,
  InventoryDeductionError,
  ServiceResult,
} from '@/lib/types';

// =============================================================================
// Inventory Service
// =============================================================================

export async function getAllInventory(): Promise<ServiceResult<InventoryWithAvailable[]>> {
  const db = tryGetDb();

  if (!db) {
    console.log('[inventoryService] Using MOCK DB');
    return { success: true, data: mockDb.getAllInventoryWithAvailable() };
  }

  const { data, error } = await db
    .from('inventory_with_available')
    .select('*')
    .order('product_name', { ascending: true });

  if (error) {
    console.error('[inventoryService] getAllInventory error:', error);
    return { success: false, error: error.message };
  }

  return { success: true, data: data as InventoryWithAvailable[] };
}

export async function getInventoryByProductId(
  productId: string
): Promise<ServiceResult<InventoryWithAvailable>> {
  const db = tryGetDb();

  if (!db) {
    console.log('[inventoryService] Using MOCK DB');
    const item = mockDb.getInventoryByProductId(productId);
    if (!item) return { success: false, error: 'Product not found in inventory' };
    return { success: true, data: item };
  }

  const { data, error } = await db
    .from('inventory_with_available')
    .select('*')
    .eq('product_id', productId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return { success: false, error: 'Product not found in inventory' };
    }
    return { success: false, error: error.message };
  }

  return { success: true, data: data as InventoryWithAvailable };
}

// ---------------------------
// Bulk operations
// ---------------------------

interface DeductionItem {
  product_id: string;
  sku: string;
  quantity: number;
}

export interface BulkDeductionResult {
  allSucceeded: boolean;
  errors: InventoryDeductionError[];
}

export async function bulkDeductInventory(
  items: DeductionItem[]
): Promise<ServiceResult<BulkDeductionResult>> {
  const db = tryGetDb();

  if (!db) {
    console.log('[inventoryService] Using MOCK DB');
    const errors: InventoryDeductionError[] = [];
    for (const item of items) {
      const result = mockDb.deductInventory(item.product_id, item.quantity);
      if (!result.success) {
        errors.push({
          sku: item.sku,
          product_id: item.product_id,
          requested: item.quantity,
          available: result.available ?? 0,
        });
      }
    }
    return { success: true, data: { allSucceeded: errors.length === 0, errors } };
  }

  const errors: InventoryDeductionError[] = [];

  for (const item of items) {
    const { data, error } = await db.rpc('deduct_inventory', {
      p_product_id: item.product_id,
      p_quantity: item.quantity,
    });

    if (error) {
      console.error('[inventoryService] RPC deduct_inventory error:', error);
      return { success: false, error: error.message };
    }

    const result = data as { success: boolean; error?: string; available?: number };
    if (!result.success) {
      errors.push({
        sku: item.sku,
        product_id: item.product_id,
        requested: item.quantity,
        available: result.available ?? 0,
      });
    }
  }

  return { success: true, data: { allSucceeded: errors.length === 0, errors } };
}

export async function bulkReserveInventory(
  items: DeductionItem[]
): Promise<ServiceResult<BulkDeductionResult>> {
  const db = tryGetDb();

  if (!db) {
    console.log('[inventoryService] Using MOCK DB');
    const errors: InventoryDeductionError[] = [];
    for (const item of items) {
      const result = mockDb.reserveInventory(item.product_id, item.quantity);
      if (!result.success) {
        errors.push({
          sku: item.sku,
          product_id: item.product_id,
          requested: item.quantity,
          available: result.available ?? 0,
        });
      }
    }
    return { success: true, data: { allSucceeded: errors.length === 0, errors } };
  }

  const errors: InventoryDeductionError[] = [];

  for (const item of items) {
    const { data, error } = await db.rpc('reserve_inventory', {
      p_product_id: item.product_id,
      p_quantity: item.quantity,
    });

    if (error) {
      console.error('[inventoryService] RPC reserve_inventory error:', error);
      return { success: false, error: error.message };
    }

    const result = data as { success: boolean; error?: string; available?: number };
    if (!result.success) {
      errors.push({
        sku: item.sku,
        product_id: item.product_id,
        requested: item.quantity,
        available: result.available ?? 0,
      });
    }
  }

  return { success: true, data: { allSucceeded: errors.length === 0, errors } };
}

export async function resolveProductsBySku(
  skus: string[]
): Promise<ServiceResult<Map<string, { id: string; sku: string }>>> {
  const db = tryGetDb();

  if (!db) {
    return { success: true, data: mockDb.getProductsBySku(skus) };
  }

  const { data, error } = await db
    .from('products')
    .select('id, sku')
    .in('sku', skus);

  if (error) return { success: false, error: error.message };

  const map = new Map<string, { id: string; sku: string }>();
  for (const row of data ?? []) map.set(row.sku, row);

  return { success: true, data: map };
}
