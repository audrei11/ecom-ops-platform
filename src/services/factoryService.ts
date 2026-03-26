import { tryGetDb } from '@/lib/supabase';
import * as mockDb from '@/lib/mockDb';
import type { FactoryBatch, ServiceResult } from '@/lib/types';

// =============================================================================
// Factory Batching Service
// Groups order items by factory and production cycle.
// =============================================================================

export interface BatchOrdersRequest {
  /** Only batch orders in these statuses (default: ['processing']) */
  order_statuses?: string[];
  /** If set, only batch orders for a specific factory */
  factory_id?: string;
}

export interface BatchDetail {
  batch_id: string;
  batch_reference: string;
  factory_name: string;
  items_count: number;
  cycle_end_date: string;
}

export interface BatchResult {
  batches_created: number;
  batches_updated: number;
  items_batched: number;
  details: BatchDetail[];
}

// =============================================================================
// Core batching logic (shared between mock and Supabase paths)
// =============================================================================

function buildBatchReference(factoryName: string, today: Date): string {
  const week = mockDb.getISOWeek(today);
  return `${factoryName.replace(/\s+/g, '-').toUpperCase()}-${today.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function cycleEndDate(today: Date, cycleWeeks: number): string {
  const end = new Date(today);
  end.setDate(end.getDate() + cycleWeeks * 7);
  return end.toISOString().split('T')[0];
}

/**
 * Groups unbatched order items into factory batches.
 *
 * Flow:
 *  1. Collect items from orders in eligible statuses (default: 'processing')
 *  2. Filter out items already assigned to a batch
 *  3. Group remaining items by factory
 *  4. For each factory: find the current open batch or create a new one
 *  5. Assign items → batch; advance order statuses to 'batched'
 */
export async function batchOrdersByFactory(
  request: BatchOrdersRequest = {}
): Promise<ServiceResult<BatchResult>> {
  const db = tryGetDb();
  const orderStatuses = request.order_statuses ?? ['processing'];

  // ---- Mock DB path ----------------------------------------------------------
  if (!db) {
    console.log('[factoryService] Using MOCK DB');

    const unbatched = mockDb.getUnbatchedItems(orderStatuses);

    // Optionally filter to a single factory
    const eligible = request.factory_id
      ? unbatched.filter((i) => i.factory_id === request.factory_id)
      : unbatched;

    if (eligible.length === 0) {
      return {
        success: true,
        data: { batches_created: 0, batches_updated: 0, items_batched: 0, details: [] },
      };
    }

    // Group items by factory
    const byFactory = new Map<
      string,
      { factory_name: string; production_cycle_weeks: number; items: typeof eligible }
    >();

    for (const item of eligible) {
      const existing = byFactory.get(item.factory_id);
      if (existing) {
        existing.items.push(item);
      } else {
        byFactory.set(item.factory_id, {
          factory_name:            item.factory_name,
          production_cycle_weeks:  item.production_cycle_weeks,
          items:                   [item],
        });
      }
    }

    const today = new Date();
    const details: BatchDetail[] = [];
    let batchesCreated = 0;
    let batchesUpdated = 0;
    let totalItemsBatched = 0;

    for (const [factoryId, group] of byFactory) {
      // Find or create an open batch for this factory
      const openBatch = mockDb.getOpenBatch(factoryId);

      let batchId: string;
      let batchRef: string;
      let cycleEnd: string;

      if (openBatch) {
        batchId   = openBatch.id;
        batchRef  = openBatch.batch_reference ?? `BATCH-${openBatch.id.slice(0, 8)}`;
        cycleEnd  = openBatch.cycle_end_date ?? '';
        batchesUpdated++;
      } else {
        batchRef  = buildBatchReference(group.factory_name, today);
        cycleEnd  = cycleEndDate(today, group.production_cycle_weeks);

        const newBatch = mockDb.createBatch({
          factory_id:        factoryId,
          batch_reference:   batchRef,
          cycle_start_date:  today.toISOString().split('T')[0],
          cycle_end_date:    cycleEnd,
          status:            'open',
        });

        batchId = newBatch.id;
        batchesCreated++;
      }

      // Assign items to the batch (idempotent)
      mockDb.addItemsToBatch(
        group.items.map((i) => ({ batch_id: batchId, order_item_id: i.id }))
      );

      totalItemsBatched += group.items.length;

      details.push({
        batch_id:        batchId,
        batch_reference: batchRef,
        factory_name:    group.factory_name,
        items_count:     group.items.length,
        cycle_end_date:  cycleEnd,
      });
    }

    // Advance order statuses to 'batched'
    if (totalItemsBatched > 0) {
      const batchedOrderIds = [...new Set(eligible.map((i) => i.order_id))];
      for (const orderId of batchedOrderIds) {
        mockDb.updateOrderStatus(orderId, 'batched');
      }
    }

    return {
      success: true,
      data: { batches_created: batchesCreated, batches_updated: batchesUpdated, items_batched: totalItemsBatched, details },
    };
  }

  // ---- Supabase path ---------------------------------------------------------

  const { data: eligibleItems, error: itemsError } = await db
    .from('order_items')
    .select(`
      id,
      order_id,
      product_id,
      sku,
      quantity,
      orders!inner (
        id,
        status
      ),
      products (
        id,
        factory_id,
        lead_time_weeks,
        factories (
          id,
          name,
          production_cycle_weeks
        )
      )
    `)
    .in('orders.status', orderStatuses)
    .not('product_id', 'is', null);

  if (itemsError) {
    return { success: false, error: itemsError.message };
  }

  if (!eligibleItems || eligibleItems.length === 0) {
    return {
      success: true,
      data: { batches_created: 0, batches_updated: 0, items_batched: 0, details: [] },
    };
  }

  // Filter out items already in a batch
  const { data: alreadyBatched } = await db
    .from('batch_order_items')
    .select('order_item_id')
    .in('order_item_id', eligibleItems.map((i: { id: string }) => i.id));

  const alreadyBatchedIds = new Set(
    (alreadyBatched ?? []).map((b: { order_item_id: string }) => b.order_item_id)
  );

  const unbatchedItems = eligibleItems.filter(
    (i: { id: string }) => !alreadyBatchedIds.has(i.id)
  );

  if (unbatchedItems.length === 0) {
    return {
      success: true,
      data: { batches_created: 0, batches_updated: 0, items_batched: 0, details: [] },
    };
  }

  // Group by factory
  const byFactory = new Map<
    string,
    {
      factory_id: string;
      factory_name: string;
      cycle_weeks: number;
      items: typeof unbatchedItems;
    }
  >();

  for (const item of unbatchedItems) {
    const product = (item.products as unknown) as {
      factory_id: string | null;
      factories: { id: string; name: string; production_cycle_weeks: number } | null;
    } | null;

    if (!product?.factory_id || !product.factories) continue;

    if (request.factory_id && product.factory_id !== request.factory_id) continue;

    const existing = byFactory.get(product.factory_id);
    if (existing) {
      existing.items.push(item);
    } else {
      byFactory.set(product.factory_id, {
        factory_id:   product.factory_id,
        factory_name: product.factories.name,
        cycle_weeks:  product.factories.production_cycle_weeks,
        items:        [item],
      });
    }
  }

  const batchDetails: BatchDetail[] = [];
  let batchesCreated = 0;
  let batchesUpdated = 0;
  let totalItemsBatched = 0;
  const today = new Date();

  for (const [factoryId, group] of byFactory) {
    const { data: openBatch } = await db
      .from('factory_batches')
      .select('id, batch_reference, cycle_end_date')
      .eq('factory_id', factoryId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let batchId: string;
    let batchRef: string;
    let cycleEnd: string;

    if (openBatch) {
      batchId   = openBatch.id;
      batchRef  = openBatch.batch_reference ?? `BATCH-${openBatch.id.slice(0, 8)}`;
      cycleEnd  = openBatch.cycle_end_date ?? '';
      batchesUpdated++;
    } else {
      batchRef = buildBatchReference(group.factory_name, today);
      cycleEnd = cycleEndDate(today, group.cycle_weeks);

      const { data: newBatch, error: batchError } = await db
        .from('factory_batches')
        .insert({
          factory_id:        factoryId,
          batch_reference:   batchRef,
          cycle_start_date:  today.toISOString().split('T')[0],
          cycle_end_date:    cycleEnd,
          status:            'open',
        })
        .select('id')
        .single();

      if (batchError || !newBatch) {
        console.error('[factoryService] Failed to create batch:', batchError);
        continue;
      }

      batchId = newBatch.id;
      batchesCreated++;
    }

    const batchItemInserts = group.items.map((item: { id: string }) => ({
      batch_id:       batchId,
      order_item_id:  item.id,
    }));

    const { error: insertError } = await db
      .from('batch_order_items')
      .insert(batchItemInserts)
      .select();

    if (insertError) {
      console.error('[factoryService] Failed to insert batch items:', insertError);
      continue;
    }

    totalItemsBatched += group.items.length;
    batchDetails.push({
      batch_id:        batchId,
      batch_reference: batchRef,
      factory_name:    group.factory_name,
      items_count:     group.items.length,
      cycle_end_date:  cycleEnd,
    });
  }

  if (totalItemsBatched > 0) {
    const batchedOrderIds = [
      ...new Set(unbatchedItems.map((i: { order_id: string }) => i.order_id)),
    ];
    await db
      .from('orders')
      .update({ status: 'batched' })
      .in('id', batchedOrderIds);
  }

  return {
    success: true,
    data: {
      batches_created: batchesCreated,
      batches_updated: batchesUpdated,
      items_batched:   totalItemsBatched,
      details:         batchDetails,
    },
  };
}

// =============================================================================
// List batches
// =============================================================================

export async function listFactoryBatches(
  factoryId?: string
): Promise<ServiceResult<FactoryBatch[]>> {
  const db = tryGetDb();

  if (!db) {
    console.log('[factoryService] Using MOCK DB');
    return { success: true, data: mockDb.listBatches(factoryId) };
  }

  let query = db
    .from('factory_batches')
    .select('*')
    .order('created_at', { ascending: false });

  if (factoryId) {
    query = query.eq('factory_id', factoryId);
  }

  const { data, error } = await query;

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: (data ?? []) as FactoryBatch[] };
}
