// =============================================================================
// Domain Types — single source of truth for all data shapes
// =============================================================================

// ---------------------------
// Enums (mirror DB enums)
// ---------------------------

export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'batched'
  | 'in_production'
  | 'completed'
  | 'cancelled';

export type BatchStatus = 'open' | 'submitted' | 'in_production' | 'completed';

export type RestockStatus = 'pending' | 'approved' | 'ordered' | 'received';

// ---------------------------
// Database row types
// ---------------------------

export interface Factory {
  id: string;
  name: string;
  production_cycle_weeks: number;
  contact_email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  shopify_product_id: string | null;
  sku: string;
  name: string;
  factory_id: string | null;
  lead_time_weeks: number;
  safety_stock_units: number;
  is_bespoke: boolean;
  unit_cost: number | null;
  created_at: string;
  updated_at: string;
}

export interface Inventory {
  id: string;
  product_id: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  last_restocked_at: string | null;
  updated_at: string;
}

export interface InventoryWithAvailable extends Inventory {
  sku: string;
  product_name: string;
  factory_id: string | null;
  quantity_available: number;
}

export interface Order {
  id: string;
  shopify_order_id: string | null;
  shopify_order_number: string | null;
  status: OrderStatus;
  customer_email: string | null;
  customer_name: string | null;
  total_price: number | null;
  currency: string;
  is_bespoke: boolean;
  notes: string | null;
  raw_payload: ShopifyOrderPayload | Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  shopify_variant_id: string | null;
  sku: string | null;
  product_name: string | null;
  quantity: number;
  unit_price: number | null;
  customization_details: Record<string, unknown> | null;
  created_at: string;
}

export interface FactoryBatch {
  id: string;
  factory_id: string;
  batch_reference: string | null;
  cycle_start_date: string | null;
  cycle_end_date: string | null;
  status: BatchStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RestockRecommendation {
  id: string;
  product_id: string;
  current_stock: number;
  avg_daily_sales: number;
  lead_time_days: number;
  safety_stock: number;
  recommended_quantity: number;
  calculation_window_days: number;
  status: RestockStatus;
  calculated_at: string;
  approved_at: string | null;
  notes: string | null;
}

// ---------------------------
// Shopify webhook payload (simplified — extend as needed)
// ---------------------------

export interface ShopifyLineItem {
  id: number;
  variant_id: number | null;
  product_id: number | null;
  title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  price: string;
  properties: Array<{ name: string; value: string }>;
}

export interface ShopifyOrderPayload {
  id: number;
  order_number: number;
  name: string;                      // e.g., "#1001"
  email: string | null;
  total_price: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  note: string | null;
  line_items: ShopifyLineItem[];
  customer?: {
    first_name: string;
    last_name: string;
    email: string;
  };
  created_at: string;
}

// ---------------------------
// API request / response shapes
// ---------------------------

export interface IngestOrderRequest {
  /** Raw Shopify webhook payload */
  shopify?: ShopifyOrderPayload;
  /** Or a normalised order (manual / internal) */
  manual?: {
    customer_email?: string;
    customer_name?: string;
    currency?: string;
    is_bespoke?: boolean;
    notes?: string;
    items: Array<{
      sku: string;
      quantity: number;
      unit_price?: number;
      customization_details?: Record<string, unknown>;
    }>;
  };
}

export interface IngestOrderResponse {
  success: boolean;
  order_id?: string;
  duplicate?: boolean;
  errors?: InventoryDeductionError[];
  message?: string;
}

export interface InventoryDeductionError {
  sku: string;
  product_id: string;
  requested: number;
  available: number;
}

export interface InventoryQueryResponse {
  items: InventoryWithAvailable[];
  total: number;
}

// ---------------------------
// Service result types
// ---------------------------

export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; details?: unknown };
