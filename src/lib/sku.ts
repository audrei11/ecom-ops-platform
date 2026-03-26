// =============================================================================
// Universal SKU System
//
// Format:  {TYPE}-{VARIANT}-{SIZE}
// Rules:   All uppercase · hyphens as separators · alphanumeric segments
// Min:     2 segments (type + variant)
// Max:     4 segments
//
// Examples:
//   RING-GOLD-S         → type=RING, variant=GOLD, size=S
//   CHAIR-BLK-L         → type=CHAIR, variant=BLK, size=L
//   NECK-SILVER-M       → type=NECK, variant=SILVER, size=M
//   BRACE-ENGR-L        → type=BRACE, variant=ENGR, size=L
//   LAMP-WHT            → type=LAMP, variant=WHT  (no size)
// =============================================================================

export interface SkuParts {
  /** Product type code — e.g. RING, CHAIR, NECK */
  type: string;
  /** Colour or material code — e.g. GOLD, BLK, SILVER */
  variant: string;
  /** Size code — e.g. S, M, L, XL. Undefined when product has no size. */
  size?: string;
  /** Any additional segment beyond the first three */
  extra?: string;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Parse a SKU string into its component parts.
 * Returns null if the SKU is empty, not a string, or has fewer than 2 segments.
 */
export function parseSku(sku: string): SkuParts | null {
  if (!sku || typeof sku !== 'string') return null;

  const parts = sku.trim().toUpperCase().split('-');
  if (parts.length < 2) return null;
  if (parts.some((p) => p.length === 0)) return null;

  return {
    type:    parts[0],
    variant: parts[1],
    size:    parts[2] ?? undefined,
    extra:   parts[3] ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Build a canonical SKU string from its parts.
 * Each segment is uppercased, trimmed, and stripped of non-alphanumeric characters.
 */
export function buildSku(type: string, variant: string, size?: string, extra?: string): string {
  const parts = [type, variant, size, extra]
    .filter((p): p is string => p !== undefined && p.length > 0)
    .map((p) => p.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);

  if (parts.length < 2) {
    throw new Error(`SKU requires at least a type and variant. Got: ${parts.join(', ')}`);
  }

  return parts.join('-');
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/** Regex for a valid SKU: 2–4 uppercase-alphanumeric segments joined by hyphens */
const SKU_REGEX = /^[A-Z0-9]+(-[A-Z0-9]+){1,3}$/;

/**
 * Returns true if the string is a valid SKU.
 * Valid means: uppercase, hyphen-separated, alphanumeric segments, 2–4 parts.
 */
export function validateSku(sku: string): boolean {
  if (!sku || typeof sku !== 'string') return false;
  return SKU_REGEX.test(sku.trim());
}

// ---------------------------------------------------------------------------
// Normalise
// ---------------------------------------------------------------------------

/**
 * Normalise an arbitrary SKU-like string to the canonical format.
 * Uppercases, strips non-alphanumeric from each segment, removes empty parts.
 * Returns null if fewer than 2 valid segments remain.
 */
export function normaliseSku(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;

  const parts = raw
    .toUpperCase()
    .trim()
    .split(/[-_\s]+/)
    .map((p) => p.replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);

  if (parts.length < 2) return null;
  return parts.slice(0, 4).join('-');
}

// ---------------------------------------------------------------------------
// Describe (human-readable label)
// ---------------------------------------------------------------------------

/** Maps common type codes to readable labels */
const TYPE_LABELS: Record<string, string> = {
  RING:   'Ring',
  NECK:   'Necklace',
  BRACE:  'Bracelet',
  CHAIR:  'Chair',
  LAMP:   'Lamp',
  TABLE:  'Table',
  SOFA:   'Sofa',
};

/** Maps common variant codes to readable labels */
const VARIANT_LABELS: Record<string, string> = {
  GOLD:   'Gold',
  SILVER: 'Silver',
  BLK:    'Black',
  WHT:    'White',
  ENGR:   'Engraved',
  NAT:    'Natural',
  OAK:    'Oak',
  WALNT:  'Walnut',
};

/** Maps common size codes to readable labels */
const SIZE_LABELS: Record<string, string> = {
  XS: 'Extra Small',
  S:  'Small',
  M:  'Medium',
  L:  'Large',
  XL: 'Extra Large',
};

/**
 * Convert a SKU into a human-readable product description.
 * Falls back to the raw segment when no label mapping exists.
 *
 * @example describeSku('RING-GOLD-S') → 'Gold Ring — Small'
 */
export function describeSku(sku: string): string {
  const parts = parseSku(sku);
  if (!parts) return sku;

  const type    = TYPE_LABELS[parts.type]    ?? parts.type;
  const variant = VARIANT_LABELS[parts.variant] ?? parts.variant;
  const size    = parts.size ? (SIZE_LABELS[parts.size] ?? parts.size) : null;

  return size ? `${variant} ${type} — ${size}` : `${variant} ${type}`;
}
