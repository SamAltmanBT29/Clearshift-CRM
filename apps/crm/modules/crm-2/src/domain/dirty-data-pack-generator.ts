import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  CRM2_DIRTY_DATA_PACK_PLAN,
  assertConservationEquation,
  buildDealExactBusinessKey,
  buildQuoteExactKey,
} from './qa-specs.js';

export interface Crm2DirtyRecord {
  sourceRow: number;
  entityType: 'deal' | 'quote';
  sourceSystem: string;
  sourceId: string;
  name: string;
  value: string;
  currency: string;
  stageName: string;
  closeDate: string;
  contactId: string;
  quoteNumber: string;
  dealId: string;
  note: string;
  expectedOutcome: 'loaded' | 'rejected' | 'merged' | 'skipped';
  category:
    | 'golden_baseline'
    | 'exact_duplicate'
    | 'malformed_syntax'
    | 'missing_required'
    | 'referential_orphan'
    | 'lifecycle_violation';
  reasonCode?: string;
  diagnostics?: string;
}

export interface Crm2ManifestEntry {
  sourceRow: number;
  entityType: 'deal' | 'quote';
  sourceId: string;
  expectedOutcome: 'loaded' | 'rejected' | 'merged' | 'skipped';
  category: string;
  reasonCode: string | null;
  businessKey: string;
  defects: Array<{
    field: string;
    reasonCode: string;
    message: string;
  }>;
}

export interface Crm2DirtyDataManifest {
  schemaVersion: number;
  module: 'crm-2';
  totalRecords: number;
  cleanRecordsCount: number;
  defectiveRecordsCount: number;
  conservationEquation: {
    source: number;
    loaded: number;
    rejected: number;
    merged: number;
    skipped: number;
    unaccounted: number;
    isBalanced: boolean;
  };
  defectCategories: Record<string, { count: number }>;
  records: Crm2ManifestEntry[];
}

export interface Crm2ExpectedProfile {
  schemaVersion: number;
  rulesetVersion: number;
  fixture: {
    file: string;
    sha256: string;
    bytes: number;
    rows: number;
  };
  outcomes: {
    loaded: number;
    rejected: number;
    merged: number;
    skipped: number;
  };
  byCategory: Record<string, number>;
  byReasonCode: Record<string, number>;
  columns: Record<
    string,
    {
      inferredType: string;
      emptyCount: number;
      invalidCount: number;
    }
  >;
}

/**
 * Deterministic pseudo-random number generator using linear congruential algorithm (Seed 42).
 */
class DeterministicPRNG {
  private seed: number;

  constructor(seed = 42) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(items: readonly T[]): T {
    const idx = Math.floor(this.next() * items.length);
    return items[idx]!;
  }
}

const CORP_PREFIXES = [
  'Acme', 'Apex', 'Beacon', 'Catalyst', 'Crestview', 'Delta', 'Echo', 'Horizon',
  'Ironclad', 'Lumina', 'Meridian', 'Nexus', 'Omni', 'Pinnacle', 'Quantum',
  'Radiant', 'Starlight', 'Summit', 'Titan', 'Vanguard', 'Vertex', 'Zephyr',
  'München', 'São Paulo', 'Zürich', 'Tokyo', 'Singapore', 'London'
];

const CORP_SUFFIXES = [
  'Cloud Infrastructure Expansion', 'Enterprise SaaS Subscription',
  'Data Platform Migration', 'Cybersecurity Defense Suite',
  'Analytics Dashboard Rollout', 'Global Multi-Region Network',
  'Digital Transformation Program', 'Core Ledger Modernization',
  'AI Integration Framework', 'Automated DevOps Pipeline'
];

const CURRENCIES = ['USD', 'EUR', 'GBP'] as const;
const STAGES = ['New', 'Qualified', 'Proposal', 'Negotiation'] as const;

/**
 * Generates the canonical 100-row synthetic CRM-2 Dirty Data Pack.
 */
export function generateCanonicalCrm2Records(): Crm2DirtyRecord[] {
  const prng = new DeterministicPRNG(42);
  const records: Crm2DirtyRecord[] = [];

  // =========================================================================
  // SCENARIO 1: Clean Standard Deals (55 records, Rows 1..55)
  // =========================================================================
  for (let i = 1; i <= 55; i++) {
    const prefix = CORP_PREFIXES[(i - 1) % CORP_PREFIXES.length];
    const suffix = CORP_SUFFIXES[(i - 1) % CORP_SUFFIXES.length];
    let name = `${prefix} ${suffix}`;

    // Formula injection edge case on row 10: sanitized with leading apostrophe
    if (i === 10) {
      name = "'=CMD('calc')!A1 Enterprise Cloud Migration";
    }

    const valueNum = (prng.nextInt(10, 250) * 1000).toFixed(2);
    const currency = CURRENCIES[(i - 1) % CURRENCIES.length]!;
    const stageName = STAGES[(i - 1) % STAGES.length]!;
    const month = String((i % 12) + 1).padStart(2, '0');
    const day = String((i % 28) + 1).padStart(2, '0');
    const closeDate = `2026-${month}-${day}`;
    const contactId = `a1b2c3d4-e5f6-7a8b-9c0d-${String(i).padStart(12, '0')}`;
    const sourceId = `deal_legacy_${String(i).padStart(4, '0')}`;

    records.push({
      sourceRow: i,
      entityType: 'deal',
      sourceSystem: 'pipedrive_legacy',
      sourceId,
      name,
      value: valueNum,
      currency,
      stageName,
      closeDate,
      contactId,
      quoteNumber: '',
      dealId: '',
      note: `Standard verified deal ${i}`,
      expectedOutcome: 'loaded',
      category: 'golden_baseline',
      diagnostics: 'Valid deal adhering to all domain checks',
    });
  }

  // =========================================================================
  // SCENARIO 2: Clean Orphan Deals (10 records, Rows 56..65)
  // =========================================================================
  for (let i = 56; i <= 65; i++) {
    const prefix = CORP_PREFIXES[(i - 1) % CORP_PREFIXES.length];
    const suffix = CORP_SUFFIXES[(i - 1) % CORP_SUFFIXES.length];
    const name = `${prefix} Inbound Opportunity`;
    const valueNum = (prng.nextInt(5, 50) * 1000).toFixed(2);
    const currency = 'USD';
    const stageName = 'New';
    const closeDate = `2026-12-${String(i - 55).padStart(2, '0')}`;
    const sourceId = `deal_orphan_${String(i).padStart(4, '0')}`;

    records.push({
      sourceRow: i,
      entityType: 'deal',
      sourceSystem: 'pipedrive_legacy',
      sourceId,
      name,
      value: valueNum,
      currency,
      stageName,
      closeDate,
      contactId: '', // Nullable contact reference -> Orphan deal
      quoteNumber: '',
      dealId: '',
      note: `Inbound orphan deal ${i} with null contact`,
      expectedOutcome: 'loaded',
      category: 'golden_baseline',
      diagnostics: 'Valid orphan deal permitted by SDS §4.2; flagged with UI badge',
    });
  }

  // =========================================================================
  // SCENARIO 3: Clean Quotes Linked to Deals (10 records, Rows 66..75)
  // =========================================================================
  for (let i = 66; i <= 75; i++) {
    const parentDealRow = i - 65; // references deal 1..10
    const parentDeal = records[parentDealRow - 1]!;
    const quoteNumber = `Q-2026-${String(i).padStart(4, '0')}`;
    const sourceId = `quote_legacy_${String(i).padStart(4, '0')}`;
    const valueNum = parentDeal.value;
    const closeDate = '2026-10-23';

    records.push({
      sourceRow: i,
      entityType: 'quote',
      sourceSystem: 'salesforce_quotes',
      sourceId,
      name: '',
      value: valueNum,
      currency: parentDeal.currency,
      stageName: '',
      closeDate,
      contactId: '',
      quoteNumber,
      dealId: `d1000000-0000-4000-8000-${String(parentDealRow).padStart(12, '0')}`,
      note: `Formal binding quote for deal ${parentDeal.sourceId}. Valid 30 calendar days.`,
      expectedOutcome: 'loaded',
      category: 'golden_baseline',
      diagnostics: 'Valid quote linked to parent deal UUID',
    });
  }

  // =========================================================================
  // SCENARIO 4: Exact Duplicate Deals (4 records / 2 pairs, Rows 76..79)
  // =========================================================================
  // Pair 1: Deals 76 & 77
  records.push({
    sourceRow: 76,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_dup_001_a',
    name: 'Global Logistics ERP Upgrade',
    value: '95000.00',
    currency: 'USD',
    stageName: 'Proposal',
    closeDate: '2026-11-30',
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000076',
    quoteNumber: '',
    dealId: '',
    note: 'Duplicate Deal Candidate 1A',
    expectedOutcome: 'merged',
    category: 'exact_duplicate',
    reasonCode: 'EXACT_DEAL_DUPLICATE',
    diagnostics: 'Exact duplicate deal candidate matching normalized name, stage, and contact',
  });
  records.push({
    sourceRow: 77,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_dup_001_b',
    name: '  Global Logistics ERP Upgrade  ', // Whitespace padding, normalizes identically
    value: '95000.00',
    currency: 'USD',
    stageName: 'Proposal',
    closeDate: '2026-11-30',
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000076',
    quoteNumber: '',
    dealId: '',
    note: 'Duplicate Deal Candidate 1B',
    expectedOutcome: 'merged',
    category: 'exact_duplicate',
    reasonCode: 'EXACT_DEAL_DUPLICATE',
    diagnostics: 'Exact duplicate deal candidate matching normalized name, stage, and contact',
  });

  // Pair 2: Deals 78 & 79 (Orphans)
  records.push({
    sourceRow: 78,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_dup_002_a',
    name: 'Nordic Telecom Cloud Core',
    value: '135000.00',
    currency: 'EUR',
    stageName: 'Qualified',
    closeDate: '2026-12-15',
    contactId: '',
    quoteNumber: '',
    dealId: '',
    note: 'Duplicate Deal Candidate 2A (Orphan)',
    expectedOutcome: 'merged',
    category: 'exact_duplicate',
    reasonCode: 'EXACT_DEAL_DUPLICATE',
    diagnostics: 'Exact duplicate orphan deal candidate',
  });
  records.push({
    sourceRow: 79,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_dup_002_b',
    name: 'nordic telecom cloud core', // Lowercase, normalizes identically
    value: '135000.00',
    currency: 'EUR',
    stageName: 'Qualified',
    closeDate: '2026-12-15',
    contactId: '',
    quoteNumber: '',
    dealId: '',
    note: 'Duplicate Deal Candidate 2B (Orphan)',
    expectedOutcome: 'merged',
    category: 'exact_duplicate',
    reasonCode: 'EXACT_DEAL_DUPLICATE',
    diagnostics: 'Exact duplicate orphan deal candidate',
  });

  // =========================================================================
  // SCENARIO 5: Exact Duplicate Quotes (4 records / 2 pairs, Rows 80..83)
  // =========================================================================
  // Quote Pair 1: Rows 80 & 81
  records.push({
    sourceRow: 80,
    entityType: 'quote',
    sourceSystem: 'salesforce_quotes',
    sourceId: 'quote_dup_001_a',
    name: '',
    value: '50000.00',
    currency: 'USD',
    stageName: '',
    closeDate: '2026-10-23',
    contactId: '',
    quoteNumber: 'Q-2026-0880',
    dealId: 'd1000000-0000-4000-8000-000000000001',
    note: 'Exact Quote Duplicate Candidate 1A',
    expectedOutcome: 'merged',
    category: 'exact_duplicate',
    reasonCode: 'EXACT_QUOTE_NUMBER_MATCH',
    diagnostics: 'Duplicate quote number matching Q-2026-0880',
  });
  records.push({
    sourceRow: 81,
    entityType: 'quote',
    sourceSystem: 'salesforce_quotes',
    sourceId: 'quote_dup_001_b',
    name: '',
    value: '50000.00',
    currency: 'USD',
    stageName: '',
    closeDate: '2026-10-23',
    contactId: '',
    quoteNumber: '  q-2026-0880  ', // Trims and uppercases to Q-2026-0880
    dealId: 'd1000000-0000-4000-8000-000000000001',
    note: 'Exact Quote Duplicate Candidate 1B',
    expectedOutcome: 'merged',
    category: 'exact_duplicate',
    reasonCode: 'EXACT_QUOTE_NUMBER_MATCH',
    diagnostics: 'Duplicate quote number matching Q-2026-0880 after normalization',
  });

  // Quote Pair 2: Rows 82 & 83
  records.push({
    sourceRow: 82,
    entityType: 'quote',
    sourceSystem: 'salesforce_quotes',
    sourceId: 'quote_dup_002_a',
    name: '',
    value: '82000.00',
    currency: 'EUR',
    stageName: '',
    closeDate: '2026-10-23',
    contactId: '',
    quoteNumber: 'Q-2026-0881',
    dealId: 'd1000000-0000-4000-8000-000000000002',
    note: 'Exact Quote Duplicate Candidate 2A',
    expectedOutcome: 'merged',
    category: 'exact_duplicate',
    reasonCode: 'EXACT_QUOTE_NUMBER_MATCH',
    diagnostics: 'Duplicate quote number matching Q-2026-0881',
  });
  records.push({
    sourceRow: 83,
    entityType: 'quote',
    sourceSystem: 'salesforce_quotes',
    sourceId: 'quote_dup_002_b',
    name: '',
    value: '82000.00',
    currency: 'EUR',
    stageName: '',
    closeDate: '2026-10-23',
    contactId: '',
    quoteNumber: 'Q-2026-0881',
    dealId: 'd1000000-0000-4000-8000-000000000002',
    note: 'Exact Quote Duplicate Candidate 2B',
    expectedOutcome: 'merged',
    category: 'exact_duplicate',
    reasonCode: 'EXACT_QUOTE_NUMBER_MATCH',
    diagnostics: 'Duplicate quote number matching Q-2026-0881',
  });

  // =========================================================================
  // SCENARIO 6: Negative Monetary Values (3 records, Rows 84..86)
  // =========================================================================
  records.push({
    sourceRow: 84,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_neg_001',
    name: 'Corrupted Legacy Contract A',
    value: '-1500.00',
    currency: 'USD',
    stageName: 'New',
    closeDate: '2026-11-20',
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000084',
    quoteNumber: '',
    dealId: '',
    note: 'Seeded negative value defect',
    expectedOutcome: 'rejected',
    category: 'malformed_syntax',
    reasonCode: 'NEGATIVE_VALUE',
    diagnostics: 'Deal monetary value must be a non-negative decimal quantity',
  });
  records.push({
    sourceRow: 85,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_neg_002',
    name: 'Corrupted Legacy Contract B',
    value: '-50000.50',
    currency: 'EUR',
    stageName: 'Qualified',
    closeDate: '2026-11-25',
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000085',
    quoteNumber: '',
    dealId: '',
    note: 'Seeded negative value defect',
    expectedOutcome: 'rejected',
    category: 'malformed_syntax',
    reasonCode: 'NEGATIVE_VALUE',
    diagnostics: 'Deal monetary value must be a non-negative decimal quantity',
  });
  records.push({
    sourceRow: 86,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_neg_003',
    name: 'Corrupted Legacy Contract C',
    value: '-0.01',
    currency: 'GBP',
    stageName: 'Proposal',
    closeDate: '2026-11-28',
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000086',
    quoteNumber: '',
    dealId: '',
    note: 'Seeded negative value defect',
    expectedOutcome: 'rejected',
    category: 'malformed_syntax',
    reasonCode: 'NEGATIVE_VALUE',
    diagnostics: 'Deal monetary value must be a non-negative decimal quantity',
  });

  // =========================================================================
  // SCENARIO 7: Invalid Currency Codes (3 records, Rows 87..89)
  // =========================================================================
  records.push({
    sourceRow: 87,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_curr_001',
    name: 'European Distributor Expansion',
    value: '30000.00',
    currency: 'euros', // non-3-letter
    stageName: 'Qualified',
    closeDate: '2026-12-05',
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000087',
    quoteNumber: '',
    dealId: '',
    note: 'Seeded invalid currency defect',
    expectedOutcome: 'rejected',
    category: 'malformed_syntax',
    reasonCode: 'INVALID_CURRENCY',
    diagnostics: 'Currency must be an ISO 4217 three-letter uppercase code',
  });
  records.push({
    sourceRow: 88,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_curr_002',
    name: 'North American Fleet Renewal',
    value: '75000.00',
    currency: 'US', // 2-letter
    stageName: 'Proposal',
    closeDate: '2026-12-10',
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000088',
    quoteNumber: '',
    dealId: '',
    note: 'Seeded invalid currency defect',
    expectedOutcome: 'rejected',
    category: 'malformed_syntax',
    reasonCode: 'INVALID_CURRENCY',
    diagnostics: 'Currency must be an ISO 4217 three-letter uppercase code',
  });
  records.push({
    sourceRow: 89,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_curr_003',
    name: 'Asian Logistics Hub Buildout',
    value: '120000.00',
    currency: '$$$', // symbol non-alpha
    stageName: 'Negotiation',
    closeDate: '2026-12-15',
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000089',
    quoteNumber: '',
    dealId: '',
    note: 'Seeded invalid currency defect',
    expectedOutcome: 'rejected',
    category: 'malformed_syntax',
    reasonCode: 'INVALID_CURRENCY',
    diagnostics: 'Currency must be an ISO 4217 three-letter uppercase code',
  });

  // =========================================================================
  // SCENARIO 8: Missing Mandatory Name (3 records, Rows 90..92)
  // =========================================================================
  records.push({
    sourceRow: 90,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_name_001',
    name: '', // Empty
    value: '15000.00',
    currency: 'USD',
    stageName: 'New',
    closeDate: '2026-11-20',
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000090',
    quoteNumber: '',
    dealId: '',
    note: 'Seeded empty deal name',
    expectedOutcome: 'rejected',
    category: 'missing_required',
    reasonCode: 'EMPTY_MANDATORY_FIELD',
    diagnostics: 'Mandatory deal name is required and cannot be blank',
  });
  records.push({
    sourceRow: 91,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_name_002',
    name: '   ', // Spaces only
    value: '22000.00',
    currency: 'USD',
    stageName: 'Qualified',
    closeDate: '2026-11-22',
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000091',
    quoteNumber: '',
    dealId: '',
    note: 'Seeded whitespace deal name',
    expectedOutcome: 'rejected',
    category: 'missing_required',
    reasonCode: 'EMPTY_MANDATORY_FIELD',
    diagnostics: 'Mandatory deal name is required and cannot be blank',
  });
  records.push({
    sourceRow: 92,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_name_003',
    name: '\t\t', // Tabs only
    value: '35000.00',
    currency: 'EUR',
    stageName: 'Proposal',
    closeDate: '2026-11-25',
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000092',
    quoteNumber: '',
    dealId: '',
    note: 'Seeded whitespace deal name',
    expectedOutcome: 'rejected',
    category: 'missing_required',
    reasonCode: 'EMPTY_MANDATORY_FIELD',
    diagnostics: 'Mandatory deal name is required and cannot be blank',
  });

  // =========================================================================
  // SCENARIO 9: Invalid Pipeline Stage (3 records, Rows 93..95)
  // =========================================================================
  records.push({
    sourceRow: 93,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_stage_001',
    name: 'Government Infrastructure Deal',
    value: '180000.00',
    currency: 'USD',
    stageName: 'Draft', // Illegal stage
    closeDate: '2026-12-01',
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000093',
    quoteNumber: '',
    dealId: '',
    note: 'Seeded invalid stage defect',
    expectedOutcome: 'rejected',
    category: 'lifecycle_violation',
    reasonCode: 'INVALID_STAGE',
    diagnostics: 'Specified pipeline stage does not exist in standard stage allowlist',
  });
  records.push({
    sourceRow: 94,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_stage_002',
    name: 'Healthcare Compliance System',
    value: '90000.00',
    currency: 'USD',
    stageName: 'In Review', // Illegal stage
    closeDate: '2026-12-05',
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000094',
    quoteNumber: '',
    dealId: '',
    note: 'Seeded invalid stage defect',
    expectedOutcome: 'rejected',
    category: 'lifecycle_violation',
    reasonCode: 'INVALID_STAGE',
    diagnostics: 'Specified pipeline stage does not exist in standard stage allowlist',
  });
  records.push({
    sourceRow: 95,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_stage_003',
    name: 'Retail Omnichannel Rollout',
    value: '64000.00',
    currency: 'GBP',
    stageName: 'Cancelled', // Illegal stage
    closeDate: '2026-12-10',
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000095',
    quoteNumber: '',
    dealId: '',
    note: 'Seeded invalid stage defect',
    expectedOutcome: 'rejected',
    category: 'lifecycle_violation',
    reasonCode: 'INVALID_STAGE',
    diagnostics: 'Specified pipeline stage does not exist in standard stage allowlist',
  });

  // =========================================================================
  // SCENARIO 10: Malformed Close Date (3 records, Rows 96..98)
  // =========================================================================
  records.push({
    sourceRow: 96,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_date_001',
    name: 'Supply Chain Optimization',
    value: '42000.00',
    currency: 'USD',
    stageName: 'Proposal',
    closeDate: '31/12/2026', // UK/EU slash format instead of YYYY-MM-DD
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000096',
    quoteNumber: '',
    dealId: '',
    note: 'Seeded broken date defect',
    expectedOutcome: 'rejected',
    category: 'malformed_syntax',
    reasonCode: 'INVALID_DATE_FORMAT',
    diagnostics: 'Close date must conform to ISO 8601 format (YYYY-MM-DD)',
  });
  records.push({
    sourceRow: 97,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_date_002',
    name: 'Renewable Energy Integration',
    value: '58000.00',
    currency: 'EUR',
    stageName: 'Qualified',
    closeDate: 'Q4-2026', // Non-standard quarter string
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000097',
    quoteNumber: '',
    dealId: '',
    note: 'Seeded broken date defect',
    expectedOutcome: 'rejected',
    category: 'malformed_syntax',
    reasonCode: 'INVALID_DATE_FORMAT',
    diagnostics: 'Close date must conform to ISO 8601 format (YYYY-MM-DD)',
  });
  records.push({
    sourceRow: 98,
    entityType: 'deal',
    sourceSystem: 'pipedrive_legacy',
    sourceId: 'deal_date_003',
    name: 'Smart Warehouse IoT Deployment',
    value: '71000.00',
    currency: 'USD',
    stageName: 'Negotiation',
    closeDate: 'asap', // Arbitrary text
    contactId: 'a1b2c3d4-e5f6-7a8b-9c0d-000000000098',
    quoteNumber: '',
    dealId: '',
    note: 'Seeded broken date defect',
    expectedOutcome: 'rejected',
    category: 'malformed_syntax',
    reasonCode: 'INVALID_DATE_FORMAT',
    diagnostics: 'Close date must conform to ISO 8601 format (YYYY-MM-DD)',
  });

  // =========================================================================
  // SCENARIO 11: Missing Parent Deal on Quote (2 records, Rows 99..100)
  // =========================================================================
  records.push({
    sourceRow: 99,
    entityType: 'quote',
    sourceSystem: 'salesforce_quotes',
    sourceId: 'quote_orphan_001',
    name: '',
    value: '12000.00',
    currency: 'USD',
    stageName: '',
    closeDate: '2026-10-23',
    contactId: '',
    quoteNumber: 'Q-2026-9991',
    dealId: '00000000-0000-0000-0000-000000000000', // Non-existent deal UUID
    note: 'Quote with missing parent deal link',
    expectedOutcome: 'rejected',
    category: 'referential_orphan',
    reasonCode: 'PARENT_DEAL_NOT_FOUND',
    diagnostics: 'Referenced parent deal does not exist in target database',
  });
  records.push({
    sourceRow: 100,
    entityType: 'quote',
    sourceSystem: 'salesforce_quotes',
    sourceId: 'quote_orphan_002',
    name: '',
    value: '24000.00',
    currency: 'USD',
    stageName: '',
    closeDate: '2026-10-23',
    contactId: '',
    quoteNumber: 'Q-2026-9992',
    dealId: '00000000-0000-0000-0000-999999999999', // Non-existent deal UUID
    note: 'Quote with missing parent deal link',
    expectedOutcome: 'rejected',
    category: 'referential_orphan',
    reasonCode: 'PARENT_DEAL_NOT_FOUND',
    diagnostics: 'Referenced parent deal does not exist in target database',
  });

  return records;
}

/**
 * Converts records into canonical RFC 4180 CSV string.
 */
export function formatRecordsAsCsv(records: Crm2DirtyRecord[]): string {
  const headers = [
    'source_row',
    'entity_type',
    'source_system',
    'source_id',
    'name',
    'value',
    'currency',
    'stage_name',
    'close_date',
    'contact_id',
    'quote_number',
    'deal_id',
    'note',
  ];

  const escapeCsv = (val: string | number | undefined | null): string => {
    if (val === undefined || val === null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.join(',')];
  for (const r of records) {
    const row = [
      r.sourceRow,
      r.entityType,
      r.sourceSystem,
      r.sourceId,
      escapeCsv(r.name),
      r.value,
      r.currency,
      r.stageName,
      r.closeDate,
      r.contactId,
      r.quoteNumber,
      r.dealId,
      escapeCsv(r.note),
    ];
    lines.push(row.join(','));
  }

  return lines.join('\n') + '\n';
}

/**
 * Builds the canonical manifest documenting per-row expected outcomes and defect classifications.
 */
export function buildCrm2Manifest(records: Crm2DirtyRecord[]): Crm2DirtyDataManifest {
  const defectCategories: Record<string, { count: number }> = {};
  let loadedCount = 0;
  let rejectedCount = 0;
  let mergedCount = 0;
  let skippedCount = 0;

  const manifestRecords: Crm2ManifestEntry[] = [];

  for (const r of records) {
    if (r.expectedOutcome === 'loaded') loadedCount++;
    else if (r.expectedOutcome === 'rejected') rejectedCount++;
    else if (r.expectedOutcome === 'merged') mergedCount++;
    else if (r.expectedOutcome === 'skipped') skippedCount++;

    if (r.reasonCode) {
      if (!defectCategories[r.reasonCode]) {
        defectCategories[r.reasonCode] = { count: 0 };
      }
      defectCategories[r.reasonCode]!.count++;
    }

    let businessKey = '';
    if (r.entityType === 'deal') {
      businessKey = buildDealExactBusinessKey({
        name: r.name || 'empty_name',
        stageId: r.stageName || 'empty_stage',
        contactId: r.contactId,
      });
    } else {
      businessKey = buildQuoteExactKey(r.quoteNumber || 'empty_quote');
    }

    const defects: Array<{ field: string; reasonCode: string; message: string }> = [];
    if (r.reasonCode) {
      let field = 'unknown';
      if (r.reasonCode === 'NEGATIVE_VALUE') field = 'value';
      else if (r.reasonCode === 'INVALID_CURRENCY') field = 'currency';
      else if (r.reasonCode === 'EMPTY_MANDATORY_FIELD') field = 'name';
      else if (r.reasonCode === 'INVALID_STAGE') field = 'stage_name';
      else if (r.reasonCode === 'INVALID_DATE_FORMAT') field = 'close_date';
      else if (r.reasonCode === 'PARENT_DEAL_NOT_FOUND') field = 'deal_id';
      else if (r.reasonCode === 'EXACT_DEAL_DUPLICATE') field = 'name';
      else if (r.reasonCode === 'EXACT_QUOTE_NUMBER_MATCH') field = 'quote_number';

      defects.push({
        field,
        reasonCode: r.reasonCode,
        message: r.diagnostics || 'Seeded defect scenario',
      });
    }

    manifestRecords.push({
      sourceRow: r.sourceRow,
      entityType: r.entityType,
      sourceId: r.sourceId,
      expectedOutcome: r.expectedOutcome,
      category: r.category,
      reasonCode: r.reasonCode || null,
      businessKey,
      defects,
    });
  }

  const conservation = assertConservationEquation({
    sourceCount: records.length,
    loadedCount,
    rejectedCount,
    mergedCount,
    skippedCount,
  });

  return {
    schemaVersion: 1,
    module: 'crm-2',
    totalRecords: records.length,
    cleanRecordsCount: loadedCount,
    defectiveRecordsCount: rejectedCount + mergedCount,
    conservationEquation: {
      source: records.length,
      loaded: loadedCount,
      rejected: rejectedCount,
      merged: mergedCount,
      skipped: skippedCount,
      unaccounted: conservation.unaccounted,
      isBalanced: conservation.valid,
    },
    defectCategories,
    records: manifestRecords,
  };
}

/**
 * Builds the expected profile metadata baseline.
 */
export function buildCrm2ExpectedProfile(
  csvContent: string,
  records: Crm2DirtyRecord[]
): Crm2ExpectedProfile {
  const sha256 = createHash('sha256').update(csvContent, 'utf-8').digest('hex');
  const bytes = Buffer.byteLength(csvContent, 'utf-8');

  let loaded = 0;
  let rejected = 0;
  let merged = 0;
  let skipped = 0;
  const byCategory: Record<string, number> = {};
  const byReasonCode: Record<string, number> = {};

  for (const r of records) {
    if (r.expectedOutcome === 'loaded') loaded++;
    else if (r.expectedOutcome === 'rejected') rejected++;
    else if (r.expectedOutcome === 'merged') merged++;
    else if (r.expectedOutcome === 'skipped') skipped++;

    byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    if (r.reasonCode) {
      byReasonCode[r.reasonCode] = (byReasonCode[r.reasonCode] || 0) + 1;
    }
  }

  return {
    schemaVersion: 1,
    rulesetVersion: 1,
    fixture: {
      file: 'dirty-data-v1.csv',
      sha256,
      bytes,
      rows: records.length,
    },
    outcomes: {
      loaded,
      rejected,
      merged,
      skipped,
    },
    byCategory,
    byReasonCode,
    columns: {
      source_row: { inferredType: 'integer', emptyCount: 0, invalidCount: 0 },
      entity_type: { inferredType: 'string', emptyCount: 0, invalidCount: 0 },
      source_system: { inferredType: 'string', emptyCount: 0, invalidCount: 0 },
      source_id: { inferredType: 'string', emptyCount: 0, invalidCount: 0 },
      name: { inferredType: 'string', emptyCount: 19, invalidCount: 3 }, // 16 quotes + 3 missing names
      value: { inferredType: 'decimal', emptyCount: 0, invalidCount: 3 }, // 3 negative
      currency: { inferredType: 'string', emptyCount: 0, invalidCount: 3 }, // 3 invalid currency
      stage_name: { inferredType: 'string', emptyCount: 16, invalidCount: 3 }, // 16 quotes + 3 invalid stage
      close_date: { inferredType: 'date', emptyCount: 0, invalidCount: 3 }, // 3 invalid dates
      contact_id: { inferredType: 'uuid', emptyCount: 28, invalidCount: 0 }, // orphan deals + quotes
      quote_number: { inferredType: 'string', emptyCount: 84, invalidCount: 0 }, // 84 deals
      deal_id: { inferredType: 'uuid', emptyCount: 84, invalidCount: 2 }, // 2 non-existent parent deals
      note: { inferredType: 'string', emptyCount: 0, invalidCount: 0 },
    },
  };
}

/**
 * Writes canonical CSV, manifest, and expected profile files to sample-data/crm-2/
 */
export function writeCanonicalDirtyDataPackFiles(targetDir?: string): {
  csvPath: string;
  manifestPath: string;
  profilePath: string;
  sha256: string;
  bytes: number;
} {
  const dir = targetDir || path.resolve(process.cwd(), 'sample-data/crm-2');

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const records = generateCanonicalCrm2Records();
  const csvContent = formatRecordsAsCsv(records);
  const manifest = buildCrm2Manifest(records);
  const profile = buildCrm2ExpectedProfile(csvContent, records);

  const csvPath = path.join(dir, 'dirty-data-v1.csv');
  const manifestPath = path.join(dir, 'manifest.json');
  const profilePath = path.join(dir, 'expected-profile.json');

  fs.writeFileSync(csvPath, csvContent, 'utf-8');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n', 'utf-8');

  return {
    csvPath,
    manifestPath,
    profilePath,
    sha256: profile.fixture.sha256,
    bytes: profile.fixture.bytes,
  };
}

if (process.argv[1] && process.argv[1].includes('dirty-data-pack-generator')) {
  const result = writeCanonicalDirtyDataPackFiles();
  console.log('Generated CRM-2 Dirty Data Pack:', result);
}
