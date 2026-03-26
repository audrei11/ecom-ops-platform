import { getAllInventory } from '@/services/inventoryService';
import { listOrders } from '@/services/orderService';
import { calculateRestockRecommendations } from '@/services/restockService';
import { listFactoryBatches } from '@/services/factoryService';
import { isDbConfigured } from '@/lib/supabase';
import * as mockDb from '@/lib/mockDb';
import type { InventoryWithAvailable, OrderStatus, FactoryBatch } from '@/lib/types';
import type { OrderSummary } from '@/services/orderService';
import type { RestockCalculation, RestockUrgency } from '@/services/restockService';
import type { BatchSummary } from '@/lib/mockDb';
import css from './dashboard.module.css';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const dbReady = isDbConfigured();

  const [inventoryResult, ordersResult, restockResult, batchesResult] = await Promise.all([
    getAllInventory(),
    listOrders({ limit: 100 }),
    calculateRestockRecommendations([], 30),
    listFactoryBatches(),
  ]);

  const inventory = inventoryResult.success ? inventoryResult.data : [];
  const orders    = ordersResult.success    ? ordersResult.data    : [];
  const restock   = restockResult.success   ? restockResult.data   : [];
  const batches   = batchesResult.success   ? batchesResult.data   : [];

  const batchSummaries: BatchSummary[] = !isDbConfigured()
    ? mockDb.listBatchSummaries()
    : batches.map((b: FactoryBatch) => ({
        ...b,
        factory_name: b.factory_id,
        item_count:   0,
        order_count:  0,
      }));

  const totalStock    = inventory.reduce((s, i) => s + i.quantity_available, 0);
  const lowStockCount = inventory.filter((i) => i.quantity_available <= 10).length;
  const activeOrders  = orders.filter((o) => !['completed', 'cancelled'].includes(o.status)).length;
  const needsRestock  = restock.filter((r) => r.needs_restock).length;

  const now = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className={css.shell}>
      <nav className={css.nav}>
        <div className={css.navLeft}>
          <div className={css.navLogo}>E</div>
          <span className={css.navBrand}>Ecom Ops</span>
          <div className={css.navSep} />
          <span className={css.navSection}>Dashboard</span>
        </div>
        <div className={css.navRight}>
          <span className={css.navMeta}>{now}</span>
          <span className={`${css.navPill} ${dbReady ? css.navPillLive : css.navPillMock}`}>
            <span className={css.navPillDot} />
            {dbReady ? 'Live' : 'Mock DB'}
          </span>
        </div>
      </nav>

      <main className={css.main}>

        {/* ---- Page header ---- */}
        <div className={css.pageHeader}>
          <div>
            <h1 className={css.pageTitle}>Operations Dashboard</h1>
            <p className={css.pageSubtitle}>Real-time overview of inventory, orders, and production batches</p>
          </div>
        </div>

        {/* ---- Metric cards ---- */}
        <div className={css.statsGrid}>
          <div className={`${css.statCard} ${css.statCardGreen}`}>
            <div className={css.cardTop}>
              <span className={css.cardLabel}>Total stock</span>
              <div className={`${css.cardIcon} ${css.iconGreen}`}>
                <IconPackage />
              </div>
            </div>
            <div className={css.cardValue}>{totalStock.toLocaleString()}</div>
            <div className={css.cardSub}>across {inventory.length} product{inventory.length !== 1 ? 's' : ''}</div>
          </div>

          <div className={`${css.statCard} ${css.statCardRed}`}>
            <div className={css.cardTop}>
              <span className={css.cardLabel}>Low / out of stock</span>
              <div className={`${css.cardIcon} ${css.iconRed}`}>
                <IconAlertTriangle />
              </div>
            </div>
            <div className={`${css.cardValue} ${lowStockCount > 0 ? css.cardValueBad : css.cardValueGood}`}>
              {lowStockCount}
            </div>
            <div className={css.cardSub}>≤ 10 units available</div>
          </div>

          <div className={`${css.statCard} ${css.statCardBlue}`}>
            <div className={css.cardTop}>
              <span className={css.cardLabel}>Active orders</span>
              <div className={`${css.cardIcon} ${css.iconBlue}`}>
                <IconShoppingCart />
              </div>
            </div>
            <div className={css.cardValue}>{activeOrders}</div>
            <div className={css.cardSub}>{orders.length} total received</div>
          </div>

          <div className={`${css.statCard} ${css.statCardYellow}`}>
            <div className={css.cardTop}>
              <span className={css.cardLabel}>Needs restock</span>
              <div className={`${css.cardIcon} ${css.iconYellow}`}>
                <IconRefresh />
              </div>
            </div>
            <div className={`${css.cardValue} ${needsRestock > 0 ? css.cardValueWarn : css.cardValueGood}`}>
              {needsRestock}
            </div>
            <div className={css.cardSub}>below reorder point</div>
          </div>
        </div>

        <InventorySection
          inventory={inventory}
          error={inventoryResult.success ? null : inventoryResult.error}
        />
        <OrdersSection
          orders={orders}
          error={ordersResult.success ? null : ordersResult.error}
        />
        <BatchesSection
          batches={batchSummaries}
          error={batchesResult.success ? null : batchesResult.error}
        />
        <RestockSection
          restock={restock}
          error={restockResult.success ? null : restockResult.error}
        />
      </main>
    </div>
  );
}

/* =============================================================================
   SVG Icons
   ============================================================================= */

function IconPackage({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.5 9.4l-9-5.19"/>
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  );
}

function IconAlertTriangle({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
}

function IconShoppingCart({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1"/>
      <circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.68 13.39a2 2 0 001.95 1.61h9.72a2 2 0 001.95-1.61L23 6H6"/>
    </svg>
  );
}

function IconRefresh({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
    </svg>
  );
}

function IconAlert({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  );
}

function IconBox({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
    </svg>
  );
}

function IconCart({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1"/>
      <circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.68 13.39a2 2 0 001.95 1.61h9.72a2 2 0 001.95-1.61L23 6H6"/>
    </svg>
  );
}

function IconFactory({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20a2 2 0 002 2h16a2 2 0 002-2V8l-7 5V8l-7 5V4a2 2 0 00-2-2H4a2 2 0 00-2 2v16z"/>
    </svg>
  );
}

function IconRestock({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
    </svg>
  );
}

/* =============================================================================
   Inventory
   ============================================================================= */

function InventorySection({
  inventory,
  error,
}: {
  inventory: InventoryWithAvailable[];
  error: string | null;
}) {
  const maxStock = Math.max(...inventory.map((i) => i.quantity_on_hand), 1);

  return (
    <section className={css.section}>
      <div className={css.sectionHead}>
        <div className={css.sectionTitleGroup}>
          <div className={css.sectionAccent} />
          <h2 className={css.sectionTitle}>Inventory</h2>
        </div>
        <span className={css.sectionMeta}>{inventory.length} product{inventory.length !== 1 ? 's' : ''}</span>
      </div>

      {error && <div className={css.errorBox}><IconAlert size={13} />{error}</div>}

      <div className={css.tableWrap}>
        <table className={css.table}>
          <thead className={css.tableHead}>
            <tr>
              <th className={css.th}>Product</th>
              <th className={css.th}>SKU</th>
              <th className={css.th}>Available</th>
              <th className={css.th}>On hand</th>
              <th className={css.th}>Reserved</th>
              <th className={css.th}>Last restocked</th>
            </tr>
          </thead>
          <tbody>
            {inventory.length === 0 && (
              <tr>
                <td className={css.td} colSpan={6}>
                  <div className={css.empty}>
                    <div className={css.emptyIcon}><IconBox /></div>
                    <div className={css.emptyText}>No inventory data yet</div>
                    <div className={css.emptySubtext}>Products will appear here once synced</div>
                  </div>
                </td>
              </tr>
            )}
            {inventory.map((item) => {
              const pct = Math.min(100, (item.quantity_available / maxStock) * 100);
              const barClass =
                item.quantity_available <= 0  ? css.barRed :
                item.quantity_available <= 10 ? css.barYellow :
                css.barGreen;

              return (
                <tr key={item.id} className={css.tr}>
                  <td className={`${css.td} ${css.tdBold}`}>{item.product_name}</td>
                  <td className={css.td}><span className={css.mono}>{item.sku}</span></td>
                  <td className={css.td}>
                    <div className={css.stockCell}>
                      <span className={`${css.stockNum} ${
                        item.quantity_available <= 0  ? css.stockZero :
                        item.quantity_available <= 10 ? css.stockLow :
                        css.stockOk
                      }`}>
                        {item.quantity_available}
                      </span>
                      <div className={css.bar}>
                        <div className={`${css.barFill} ${barClass}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className={css.td}>{item.quantity_on_hand}</td>
                  <td className={`${css.td} ${css.dim}`}>{item.quantity_reserved}</td>
                  <td className={`${css.td} ${css.dim}`}>
                    {item.last_restocked_at
                      ? new Date(item.last_restocked_at).toLocaleDateString('en-GB')
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* =============================================================================
   Orders
   ============================================================================= */

const STATUS_CSS: Record<OrderStatus, string> = {
  pending:       css.statusPending,
  processing:    css.statusProcessing,
  batched:       css.statusBatched,
  in_production: css.statusInProduction,
  completed:     css.statusCompleted,
  cancelled:     css.statusCancelled,
};

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`${css.badge} ${STATUS_CSS[status] ?? css.statusPending}`}>
      <span className={css.dot} />
      {status.replace('_', ' ')}
    </span>
  );
}

function OrdersSection({
  orders,
  error,
}: {
  orders: OrderSummary[];
  error: string | null;
}) {
  return (
    <section className={css.section}>
      <div className={css.sectionHead}>
        <div className={css.sectionTitleGroup}>
          <div className={`${css.sectionAccent} ${css.sectionAccentBlue}`} />
          <h2 className={css.sectionTitle}>Orders</h2>
        </div>
        <span className={css.sectionMeta}>{orders.length} shown</span>
      </div>

      {error && <div className={css.errorBox}><IconAlert size={13} />{error}</div>}

      <div className={css.tableWrap}>
        <table className={css.table}>
          <thead className={css.tableHead}>
            <tr>
              <th className={css.th}>Order ref</th>
              <th className={css.th}>Customer</th>
              <th className={css.th}>Items</th>
              <th className={css.th}>Total</th>
              <th className={css.th}>Status</th>
              <th className={css.th}>Received</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td className={css.td} colSpan={6}>
                  <div className={css.empty}>
                    <div className={css.emptyIcon}><IconCart /></div>
                    <div className={css.emptyText}>No orders yet</div>
                    <div className={css.emptySubtext}>POST to /api/orders to create your first order</div>
                  </div>
                </td>
              </tr>
            )}
            {orders.map((order) => {
              const ref = order.shopify_order_number ?? order.id.slice(0, 8);
              const itemCount = order.items.reduce((s, i) => s + i.quantity, 0);
              return (
                <tr key={order.id} className={css.tr}>
                  <td className={`${css.td} ${css.tdBold}`}>
                    <span className={css.mono}>{ref}</span>
                    {order.is_bespoke && <span className={css.bespoke}>bespoke</span>}
                  </td>
                  <td className={css.td}>
                    {order.customer_name ?? order.customer_email ?? <span className={css.dim}>—</span>}
                  </td>
                  <td className={css.td}>
                    <div>{itemCount} unit{itemCount !== 1 ? 's' : ''}</div>
                    <div className={css.dim} style={{ fontSize: '0.75rem', marginTop: 2 }}>
                      {order.items.map(i => `${i.sku} ×${i.quantity}`).join(', ')}
                    </div>
                  </td>
                  <td className={css.td}>
                    {order.total_price != null
                      ? `${order.currency} ${Number(order.total_price).toFixed(2)}`
                      : <span className={css.dim}>—</span>}
                  </td>
                  <td className={css.td}>
                    <StatusBadge status={order.status as OrderStatus} />
                  </td>
                  <td className={`${css.td} ${css.dim}`}>
                    {new Date(order.created_at).toLocaleDateString('en-GB')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* =============================================================================
   Restock
   ============================================================================= */

const URGENCY_BADGE: Record<RestockUrgency, string> = {
  critical: 'urgencyCritical',
  warning:  'urgencyWarning',
  ok:       'urgencyOk',
};

const URGENCY_LABEL: Record<RestockUrgency, string> = {
  critical: 'Critical',
  warning:  'Reorder',
  ok:       'OK',
};

function formatDays(days: number | null): string {
  if (days === null) return 'No usage yet';
  if (days === 0)    return 'Out of stock';
  if (days < 1)     return '< 1 day';
  return `${Math.floor(days)}d`;
}

function UrgencyBadge({ urgency }: { urgency: RestockUrgency }) {
  const cls = css[URGENCY_BADGE[urgency] as keyof typeof css];
  return (
    <span className={`${css.urgencyBadge} ${cls}`}>
      {URGENCY_LABEL[urgency]}
    </span>
  );
}

function RestockSection({
  restock,
  error,
}: {
  restock: RestockCalculation[];
  error: string | null;
}) {
  const critical  = restock.filter((r) => r.urgency === 'critical');
  const warning   = restock.filter((r) => r.urgency === 'warning');
  const needCount = critical.length + warning.length;

  return (
    <section className={css.section}>
      <div className={css.sectionHead}>
        <div className={css.sectionTitleGroup}>
          <div className={`${css.sectionAccent} ${css.sectionAccentOrange}`} />
          <h2 className={css.sectionTitle}>Restock Recommendations</h2>
        </div>
        <span className={css.sectionMeta}>
          {critical.length > 0 && <>{critical.length} critical · </>}
          {needCount} of {restock.length} need action
        </span>
      </div>

      {error && <div className={css.errorBox}><IconAlert size={13} />{error}</div>}

      {restock.length === 0 && (
        <div className={css.empty}>
          <div className={css.emptyIcon}><IconRestock /></div>
          <div className={css.emptyText}>No restock data yet</div>
          <div className={css.emptySubtext}>Recommendations are calculated from order history</div>
        </div>
      )}

      {/* ---- Critical alert strip ----------------------------------------- */}
      {critical.length > 0 && (
        <div className={css.criticalStrip}>
          <span className={css.criticalStripLabel}>Immediate action needed</span>
          <div className={css.criticalCards}>
            {critical.map((item) => (
              <div key={item.product_id} className={css.criticalCard}>
                <div className={css.criticalCardName}>{item.product_name}</div>
                <div className={css.criticalCardSku}>{item.sku}</div>
                <div className={css.criticalCardStats}>
                  <span className={css.criticalCardStock}>
                    {item.current_stock === 0 ? 'Out of stock' : `${item.current_stock} left`}
                  </span>
                  <span className={css.criticalCardDays}>
                    {item.days_until_stockout === 0
                      ? 'Already out'
                      : item.days_until_stockout === null
                        ? 'Below safety stock'
                        : `Stockout in ${formatDays(item.days_until_stockout)}`}
                  </span>
                </div>
                <div className={css.criticalCardOrder}>
                  Order <span className={css.criticalCardOrderQty}>{item.recommended_quantity}</span> units
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Full recommendations table ----------------------------------- */}
      {restock.length > 0 && (
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead className={css.tableHead}>
              <tr>
                <th className={css.th}>Product</th>
                <th className={css.th}>SKU</th>
                <th className={css.th}>Stock</th>
                <th className={css.th}>Stockout in</th>
                <th className={css.th}>Velocity</th>
                <th className={css.th}>Lead time</th>
                <th className={css.th}>Reorder qty</th>
                <th className={css.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {restock.map((item) => (
                <tr key={item.product_id} className={`${css.tr} ${item.urgency === 'critical' ? css.trCritical : ''}`}>
                  <td className={`${css.td} ${css.tdBold}`}>{item.product_name}</td>
                  <td className={css.td}><span className={css.mono}>{item.sku}</span></td>
                  <td className={css.td}>
                    <span className={
                      item.current_stock === 0 ? css.stockZero :
                      item.current_stock <= item.safety_stock ? css.stockLow :
                      css.stockOk
                    }>
                      {item.current_stock}
                    </span>
                    <span className={css.stockSafety}> / {item.safety_stock} min</span>
                  </td>
                  <td className={css.td}>
                    <span className={
                      item.days_until_stockout !== null && item.days_until_stockout <= item.lead_time_days
                        ? css.daysUrgent
                        : css.daysOk
                    }>
                      {formatDays(item.days_until_stockout)}
                    </span>
                  </td>
                  <td className={`${css.td} ${css.dim}`}>
                    {item.avg_daily_sales > 0
                      ? `${item.avg_daily_sales.toFixed(2)} / day`
                      : <span>No sales</span>}
                  </td>
                  <td className={`${css.td} ${css.dim}`}>{item.lead_time_days}d</td>
                  <td className={css.td}>
                    {item.recommended_quantity > 0
                      ? <span className={css.qtyBig}>{item.recommended_quantity}</span>
                      : <span className={css.dim}>—</span>}
                  </td>
                  <td className={css.td}>
                    <UrgencyBadge urgency={item.urgency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* =============================================================================
   Factory Batches
   ============================================================================= */

const BATCH_STATUS_CSS: Record<string, string> = {
  open:          'statusProcessing',
  submitted:     'statusBatched',
  in_production: 'statusInProduction',
  completed:     'statusCompleted',
};

function BatchesSection({
  batches,
  error,
}: {
  batches: BatchSummary[];
  error: string | null;
}) {
  const open = batches.filter((b) => b.status === 'open').length;

  return (
    <section className={css.section}>
      <div className={css.sectionHead}>
        <div className={css.sectionTitleGroup}>
          <div className={`${css.sectionAccent} ${css.sectionAccentPurple}`} />
          <h2 className={css.sectionTitle}>Factory Batches</h2>
        </div>
        <span className={css.sectionMeta}>{open} open · {batches.length} total</span>
      </div>

      {error && <div className={css.errorBox}><IconAlert size={13} />{error}</div>}

      <div className={css.tableWrap}>
        <table className={css.table}>
          <thead className={css.tableHead}>
            <tr>
              <th className={css.th}>Batch ref</th>
              <th className={css.th}>Factory</th>
              <th className={css.th}>Orders</th>
              <th className={css.th}>Items</th>
              <th className={css.th}>Status</th>
              <th className={css.th}>Cycle end</th>
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 && (
              <tr>
                <td className={css.td} colSpan={6}>
                  <div className={css.empty}>
                    <div className={css.emptyIcon}><IconFactory /></div>
                    <div className={css.emptyText}>No batches yet</div>
                    <div className={css.emptySubtext}>POST to /api/factory/batch to run the batching pass</div>
                  </div>
                </td>
              </tr>
            )}
            {batches.map((batch) => {
              const statusClass = css[BATCH_STATUS_CSS[batch.status] as keyof typeof css] ?? css.statusPending;
              return (
                <tr key={batch.id} className={css.tr}>
                  <td className={`${css.td} ${css.tdBold}`}>
                    <span className={css.mono}>{batch.batch_reference ?? batch.id.slice(0, 8)}</span>
                  </td>
                  <td className={css.td}>{batch.factory_name}</td>
                  <td className={css.td}>{batch.order_count}</td>
                  <td className={css.td}>{batch.item_count}</td>
                  <td className={css.td}>
                    <span className={`${css.badge} ${statusClass}`}>
                      <span className={css.dot} />
                      {batch.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className={`${css.td} ${css.dim}`}>
                    {batch.cycle_end_date
                      ? new Date(batch.cycle_end_date).toLocaleDateString('en-GB')
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
