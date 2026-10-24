import { createHash } from 'node:crypto';

export type RequiredOutcome =
  | 'valid'
  | 'malformed'
  | 'null_required'
  | 'exact_duplicate'
  | 'foreign_key_missing';

export type TerminalOutcome = 'loaded' | 'rejected' | 'merged' | 'skipped';

export interface DefectItem {
  readonly category: string;
  readonly field?: string;
  readonly reason: string;
}

export interface Crm1DirtyPackRow {
  readonly sourceRow: number;
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly address: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly leadStatus: string;
  readonly sourceSystem: string;
  readonly sourceId: string;
  readonly consentStatus: string;
  readonly unsubscribed: string;
  readonly annualRevenue: string;
  readonly createdAt: string;
  readonly expectedOutcome: RequiredOutcome;
  readonly terminalOutcome: TerminalOutcome;
  readonly status: 'VALID' | 'DEFECTIVE';
  readonly defects: readonly DefectItem[];
}

export interface Crm1ManifestSummary {
  readonly cleanRecordsCount: number;
  readonly defectiveRecordsCount: number;
  readonly loadedCount: number;
  readonly rejectedCount: number;
  readonly mergedCount: number;
  readonly skippedCount: number;
  readonly unaccounted: number;
  readonly totalDefectCategories: number;
  readonly isDisjoint: boolean;
  readonly requiredOutcomesCovered: readonly RequiredOutcome[];
  readonly edgeCasesCovered: readonly string[];
}

export interface DefectCategorySummary {
  readonly description: string;
  readonly expectedOutcome: RequiredOutcome;
  readonly count: number;
  readonly recordIndices: readonly number[];
}

export interface Crm1Manifest {
  readonly module: 'crm-1';
  readonly name: string;
  readonly version: string;
  readonly specification: string;
  readonly targetTable: string;
  readonly fixtureFile: string;
  readonly totalRecords: number;
  readonly summary: Crm1ManifestSummary;
  readonly defectCategories: Record<string, DefectCategorySummary>;
  readonly records: readonly {
    readonly index: number;
    readonly id: string;
    readonly expectedOutcome: RequiredOutcome;
    readonly terminalOutcome: TerminalOutcome;
    readonly status: 'VALID' | 'DEFECTIVE';
    readonly defects: readonly DefectItem[];
  }[];
}

export interface Crm1ExpectedProfile {
  readonly schemaVersion: number;
  readonly rulesetVersion: number;
  readonly fixture: {
    readonly file: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly rows: number;
  };
  readonly outcomes: {
    readonly loaded: number;
    readonly merged: number;
    readonly rejected: number;
    readonly skipped: number;
  };
  readonly columns: Record<
    string,
    {
      readonly emptyCount: number;
      readonly invalidCount: number;
      readonly inferredType: string;
    }
  >;
}

export const SEEDED_COMPANIES = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Apex Robotics International',
    taxNumber: 'US-EIN-123456789',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    name: 'BioHealth Dynamics Corp',
    taxNumber: 'US-EIN-234567890',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
    name: 'CyberDefense Global Ltd',
    taxNumber: 'UK-CRN-34567890',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440004',
    name: 'Delta Logistics Network',
    taxNumber: 'DE-HRB-45678901',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440005',
    name: 'EcoEnergy Solutions SE',
    taxNumber: 'FR-SIREN-56789012',
  },
] as const;

export const CSV_COLUMNS = [
  'id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'address',
  'company_id',
  'company_name',
  'lead_status',
  'source_system',
  'source_id',
  'consent_status',
  'unsubscribed',
  'annual_revenue',
  'created_at',
] as const;

const FIRST_NAMES = [
  'Marcus', 'Sophia', 'David', 'Elena', 'Lucas', 'Emma', 'Oliver', 'Amelia',
  'Ethan', 'Mia', 'Alexander', 'Ava', 'Benjamin', 'Isabella', 'William', 'Charlotte',
  'James', 'Harper', 'Henry', 'Evelyn', 'Michael', 'Abigail', 'Daniel', 'Emily',
  'Matthew', 'Elizabeth', 'Jackson', 'Sofia', 'Sebastian', 'Avery', 'Aiden', 'Ella',
  'Samuel', 'Scarlett', 'Joseph', 'Grace', 'John', 'Chloe', 'Owen', 'Victoria',
  'Gabriel', 'Riley', 'Carter', 'Aria', 'Luke', 'Lily', 'Anthony', 'Aubrey',
  'Isaac', 'Zoey',
];

const LAST_NAMES = [
  'Vance', 'Chen', 'Kim', 'Rostova', 'Alvarez', 'Smith', 'Johnson', 'Williams',
  'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez',
  'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson',
  'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark',
  'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright',
  'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson',
  'Baker', 'Hall',
];

const LEAD_STATUSES = ['New', 'Working', 'Qualified', 'Closed'] as const;

/**
 * Deterministically generates the exact 100 rows of the canonical CRM-1 Dirty Data Pack.
 */
export function generateCanonicalCrm1Records(): Crm1DirtyPackRow[] {
  const rows: Crm1DirtyPackRow[] = [];

  // Rows 1..50: Standard Golden Clean Contacts (Loaded)
  for (let i = 1; i <= 50; i++) {
    const fn = FIRST_NAMES[(i - 1) % FIRST_NAMES.length]!;
    const ln = LAST_NAMES[(i - 1) % LAST_NAMES.length]!;
    const company = SEEDED_COMPANIES[(i - 1) % SEEDED_COMPANIES.length]!;
    const leadStatus = LEAD_STATUSES[(i - 1) % LEAD_STATUSES.length]!;
    const pad = String(i).padStart(4, '0');

    rows.push({
      sourceRow: i,
      id: `c1000001-0000-4000-8000-${String(i).padStart(12, '0')}`,
      firstName: fn,
      lastName: ln,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@synthetic-corp.example`,
      phone: `+1-555-010-${pad}`,
      address: `${100 + i} Market Street, Suite ${i * 10}, San Francisco, CA 94105`,
      companyId: company.id,
      companyName: company.name,
      leadStatus,
      sourceSystem: 'salesforce_legacy',
      sourceId: `SF-10${pad}`,
      consentStatus: i % 3 === 0 ? 'granted' : 'unknown',
      unsubscribed: 'false',
      annualRevenue: String(50000 + i * 1500),
      createdAt: new Date(Date.UTC(2026, 0, 1 + (i % 28), 10, 0, 0)).toISOString(),
      expectedOutcome: 'valid',
      terminalOutcome: 'loaded',
      status: 'VALID',
      defects: [],
    });
  }

  // Rows 51..70: Additional Golden Corporate-Linked Contacts (Loaded)
  for (let i = 51; i <= 70; i++) {
    const fn = FIRST_NAMES[(i + 5) % FIRST_NAMES.length]!;
    const ln = LAST_NAMES[(i + 7) % LAST_NAMES.length]!;
    const company = SEEDED_COMPANIES[(i - 51) % SEEDED_COMPANIES.length]!;
    const leadStatus = LEAD_STATUSES[(i - 51) % LEAD_STATUSES.length]!;
    const pad = String(i).padStart(4, '0');

    rows.push({
      sourceRow: i,
      id: `c1000001-0000-4000-8000-${String(i).padStart(12, '0')}`,
      firstName: fn,
      lastName: ln,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}@${company.name.toLowerCase().replace(/[^a-z]/g, '')}.example`,
      phone: `+1-555-019-${pad}`,
      address: `${500 + i} Innovation Blvd, Tech Park, Austin, TX 78701`,
      companyId: company.id,
      companyName: company.name,
      leadStatus,
      sourceSystem: 'hubspot_export',
      sourceId: `HS-20${pad}`,
      consentStatus: 'granted',
      unsubscribed: 'false',
      annualRevenue: String(120000 + i * 2000),
      createdAt: new Date(Date.UTC(2026, 1, 1 + (i % 20), 14, 30, 0)).toISOString(),
      expectedOutcome: 'valid',
      terminalOutcome: 'loaded',
      status: 'VALID',
      defects: [],
    });
  }

  // Rows 71..74: Valid Edge Cases (Loaded)
  // Row 71: UTF-8 Multi-lingual & emoji
  rows.push({
    sourceRow: 71,
    id: 'c1000001-0000-4000-8000-000000000071',
    firstName: 'René',
    lastName: 'Müller-Schrödinger',
    email: 'rene.mueller@global-tech.example',
    phone: '+49-30-555-0171',
    address: 'Kurfürstendamm 100, 10709 Berlin, Germany',
    companyId: SEEDED_COMPANIES[0].id,
    companyName: '🌟 Global Tech 日本語',
    leadStatus: 'Qualified',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-UTF8-0071',
    consentStatus: 'granted',
    unsubscribed: 'false',
    annualRevenue: '950000',
    createdAt: '2026-03-01T08:15:00.000Z',
    expectedOutcome: 'valid',
    terminalOutcome: 'loaded',
    status: 'VALID',
    defects: [],
  });

  // Row 72: High Boundary Number (Max 32-bit signed int revenue)
  rows.push({
    sourceRow: 72,
    id: 'c1000001-0000-4000-8000-000000000072',
    firstName: 'William',
    lastName: 'Vanderbilt',
    email: 'w.vanderbilt@wealth-holdings.example',
    phone: '+1-555-010-0072',
    address: '1 Wall Street, New York, NY 10005',
    companyId: SEEDED_COMPANIES[1].id,
    companyName: SEEDED_COMPANIES[1].name,
    leadStatus: 'Closed',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-SCALE-0072',
    consentStatus: 'granted',
    unsubscribed: 'false',
    annualRevenue: '2147483647',
    createdAt: '2026-03-02T10:00:00.000Z',
    expectedOutcome: 'valid',
    terminalOutcome: 'loaded',
    status: 'VALID',
    defects: [],
  });

  // Row 73: Valid Date Format Variant (Date with space instead of T, ISO parseable)
  rows.push({
    sourceRow: 73,
    id: 'c1000001-0000-4000-8000-000000000073',
    firstName: 'Eleanor',
    lastName: 'Rigby',
    email: 'eleanor.rigby@sub-corp.example',
    phone: '+44-20-7946-0173',
    address: '10 Downing St, London SW1A 2AA, UK',
    companyId: SEEDED_COMPANIES[2].id,
    companyName: SEEDED_COMPANIES[2].name,
    leadStatus: 'Working',
    sourceSystem: 'hubspot_export',
    sourceId: 'HS-DATE-0073',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '340000',
    createdAt: '2026-03-03 14:30:00',
    expectedOutcome: 'valid',
    terminalOutcome: 'loaded',
    status: 'VALID',
    defects: [],
  });

  // Row 74: Low Boundary Number (Zero annual revenue)
  rows.push({
    sourceRow: 74,
    id: 'c1000001-0000-4000-8000-000000000074',
    firstName: 'Zoe',
    lastName: 'Zero',
    email: 'zoe.zero@early-stage.example',
    phone: '+1-555-010-0074',
    address: '1 Hacker Way, Menlo Park, CA 94025',
    companyId: SEEDED_COMPANIES[3].id,
    companyName: SEEDED_COMPANIES[3].name,
    leadStatus: 'New',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-ZERO-0074',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '0',
    createdAt: '2026-03-04T12:00:00.000Z',
    expectedOutcome: 'valid',
    terminalOutcome: 'loaded',
    status: 'VALID',
    defects: [],
  });

  // Rows 75..82: Exact Duplicate Pairs (Merged)
  // Pair 1: Email exact duplicate (Row 75 & 76)
  rows.push({
    sourceRow: 75,
    id: 'c1000001-0000-4000-8000-000000000075',
    firstName: 'Sophia',
    lastName: 'Chen',
    email: 'sophia.chen@alpha-tech.example',
    phone: '+1-555-018-2200',
    address: '100 Silicon Way, San Jose, CA',
    companyId: SEEDED_COMPANIES[0].id,
    companyName: SEEDED_COMPANIES[0].name,
    leadStatus: 'Qualified',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-DUP-0075',
    consentStatus: 'granted',
    unsubscribed: 'false',
    annualRevenue: '180000',
    createdAt: '2026-03-05T09:00:00.000Z',
    expectedOutcome: 'exact_duplicate',
    terminalOutcome: 'merged',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'EXACT_DUPLICATE',
        field: 'email',
        reason: 'Exact normalized email duplicate candidate (pair 1 / primary)',
      },
    ],
  });

  rows.push({
    sourceRow: 76,
    id: 'c1000001-0000-4000-8000-000000000076',
    firstName: 'Sophia',
    lastName: 'Chen',
    email: '  SOPHIA.CHEN@Alpha-Tech.EXAMPLE  ',
    phone: '+1-555-018-2200',
    address: '100 Silicon Way, San Jose, CA',
    companyId: SEEDED_COMPANIES[0].id,
    companyName: SEEDED_COMPANIES[0].name,
    leadStatus: 'Qualified',
    sourceSystem: 'hubspot_export',
    sourceId: 'HS-DUP-0076',
    consentStatus: 'granted',
    unsubscribed: 'false',
    annualRevenue: '180000',
    createdAt: '2026-03-05T09:05:00.000Z',
    expectedOutcome: 'exact_duplicate',
    terminalOutcome: 'merged',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'EXACT_DUPLICATE',
        field: 'email',
        reason: 'Exact normalized email duplicate candidate (pair 1 / secondary)',
      },
    ],
  });

  // Pair 2: Email exact duplicate (Row 77 & 78)
  rows.push({
    sourceRow: 77,
    id: 'c1000001-0000-4000-8000-000000000077',
    firstName: 'Marcus',
    lastName: 'Vance',
    email: 'marcus.vance@synthetic-corp.example',
    phone: '+1-555-010-4491',
    address: '200 Market St, San Francisco, CA',
    companyId: SEEDED_COMPANIES[1].id,
    companyName: SEEDED_COMPANIES[1].name,
    leadStatus: 'Working',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-DUP-0077',
    consentStatus: 'granted',
    unsubscribed: 'false',
    annualRevenue: '210000',
    createdAt: '2026-03-06T11:00:00.000Z',
    expectedOutcome: 'exact_duplicate',
    terminalOutcome: 'merged',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'EXACT_DUPLICATE',
        field: 'email',
        reason: 'Exact normalized email duplicate candidate (pair 2 / primary)',
      },
    ],
  });

  rows.push({
    sourceRow: 78,
    id: 'c1000001-0000-4000-8000-000000000078',
    firstName: 'Marcus',
    lastName: 'Vance',
    email: 'MARCUS.VANCE@SYNTHETIC-CORP.EXAMPLE',
    phone: '+1-555-010-4491',
    address: '200 Market St, San Francisco, CA',
    companyId: SEEDED_COMPANIES[1].id,
    companyName: SEEDED_COMPANIES[1].name,
    leadStatus: 'Working',
    sourceSystem: 'web_form',
    sourceId: 'WF-DUP-0078',
    consentStatus: 'granted',
    unsubscribed: 'false',
    annualRevenue: '210000',
    createdAt: '2026-03-06T11:10:00.000Z',
    expectedOutcome: 'exact_duplicate',
    terminalOutcome: 'merged',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'EXACT_DUPLICATE',
        field: 'email',
        reason: 'Exact normalized email duplicate candidate (pair 2 / secondary)',
      },
    ],
  });

  // Pair 3: Phone + Name compound duplicate (Row 79 & 80)
  rows.push({
    sourceRow: 79,
    id: 'c1000001-0000-4000-8000-000000000079',
    firstName: 'David',
    lastName: 'Kim',
    email: 'd.kim@work.example',
    phone: '+1-555-012-7744',
    address: '300 Tech Park, Seattle, WA',
    companyId: SEEDED_COMPANIES[2].id,
    companyName: SEEDED_COMPANIES[2].name,
    leadStatus: 'New',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-DUP-0079',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '140000',
    createdAt: '2026-03-07T14:00:00.000Z',
    expectedOutcome: 'exact_duplicate',
    terminalOutcome: 'merged',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'EXACT_DUPLICATE',
        field: 'phone#name',
        reason: 'Exact phone+name compound duplicate candidate (pair 3 / primary)',
      },
    ],
  });

  rows.push({
    sourceRow: 80,
    id: 'c1000001-0000-4000-8000-000000000080',
    firstName: 'David',
    lastName: 'Kim',
    email: 'david.personal@example.net',
    phone: ' +1 (555) 012-7744 ',
    address: '300 Tech Park, Seattle, WA',
    companyId: SEEDED_COMPANIES[2].id,
    companyName: SEEDED_COMPANIES[2].name,
    leadStatus: 'New',
    sourceSystem: 'event_badge',
    sourceId: 'EV-DUP-0080',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '140000',
    createdAt: '2026-03-07T14:20:00.000Z',
    expectedOutcome: 'exact_duplicate',
    terminalOutcome: 'merged',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'EXACT_DUPLICATE',
        field: 'phone#name',
        reason: 'Exact phone+name compound duplicate candidate (pair 3 / secondary)',
      },
    ],
  });

  // Pair 4: Phone + Name compound duplicate (Row 81 & 82)
  rows.push({
    sourceRow: 81,
    id: 'c1000001-0000-4000-8000-000000000081',
    firstName: 'Elena',
    lastName: 'Rostova',
    email: 'elena.r@enterprise.example',
    phone: '+1-555-019-2834',
    address: '400 Global Ave, Boston, MA',
    companyId: SEEDED_COMPANIES[3].id,
    companyName: SEEDED_COMPANIES[3].name,
    leadStatus: 'Closed',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-DUP-0081',
    consentStatus: 'granted',
    unsubscribed: 'false',
    annualRevenue: '290000',
    createdAt: '2026-03-08T16:00:00.000Z',
    expectedOutcome: 'exact_duplicate',
    terminalOutcome: 'merged',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'EXACT_DUPLICATE',
        field: 'phone#name',
        reason: 'Exact phone+name compound duplicate candidate (pair 4 / primary)',
      },
    ],
  });

  rows.push({
    sourceRow: 82,
    id: 'c1000001-0000-4000-8000-000000000082',
    firstName: 'Elena',
    lastName: 'Rostova',
    email: 'elena.alt@example.org',
    phone: ' +1 555.019.2834 ',
    address: '400 Global Ave, Boston, MA',
    companyId: SEEDED_COMPANIES[3].id,
    companyName: SEEDED_COMPANIES[3].name,
    leadStatus: 'Closed',
    sourceSystem: 'manual_csv',
    sourceId: 'MC-DUP-0082',
    consentStatus: 'granted',
    unsubscribed: 'false',
    annualRevenue: '290000',
    createdAt: '2026-03-08T16:15:00.000Z',
    expectedOutcome: 'exact_duplicate',
    terminalOutcome: 'merged',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'EXACT_DUPLICATE',
        field: 'phone#name',
        reason: 'Exact phone+name compound duplicate candidate (pair 4 / secondary)',
      },
    ],
  });

  // Rows 83..86: NULL_REQUIRED (Rejected)
  rows.push({
    sourceRow: 83,
    id: 'c1000001-0000-4000-8000-000000000083',
    firstName: '',
    lastName: 'Holloway',
    email: 'holloway@example.com',
    phone: '+1-555-011-0083',
    address: '500 Pine St, Chicago, IL',
    companyId: SEEDED_COMPANIES[4].id,
    companyName: SEEDED_COMPANIES[4].name,
    leadStatus: 'New',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-NULL-0083',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '75000',
    createdAt: '2026-03-09T09:00:00.000Z',
    expectedOutcome: 'null_required',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'NULL_REQUIRED',
        field: 'first_name',
        reason: 'Mandatory field first_name is empty',
      },
    ],
  });

  rows.push({
    sourceRow: 84,
    id: 'c1000001-0000-4000-8000-000000000084',
    firstName: '   ',
    lastName: 'Montgomery',
    email: 'montgomery@example.com',
    phone: '+1-555-011-0084',
    address: '501 Pine St, Chicago, IL',
    companyId: SEEDED_COMPANIES[0].id,
    companyName: SEEDED_COMPANIES[0].name,
    leadStatus: 'New',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-NULL-0084',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '85000',
    createdAt: '2026-03-09T09:30:00.000Z',
    expectedOutcome: 'null_required',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'NULL_REQUIRED',
        field: 'first_name',
        reason: 'Mandatory field first_name is pure whitespace',
      },
    ],
  });

  rows.push({
    sourceRow: 85,
    id: 'c1000001-0000-4000-8000-000000000085',
    firstName: 'Gregory',
    lastName: '',
    email: 'gregory@example.com',
    phone: '+1-555-011-0085',
    address: '502 Pine St, Chicago, IL',
    companyId: SEEDED_COMPANIES[1].id,
    companyName: SEEDED_COMPANIES[1].name,
    leadStatus: 'Working',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-NULL-0085',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '95000',
    createdAt: '2026-03-09T10:00:00.000Z',
    expectedOutcome: 'null_required',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'NULL_REQUIRED',
        field: 'last_name',
        reason: 'Mandatory field last_name is empty',
      },
    ],
  });

  rows.push({
    sourceRow: 86,
    id: 'c1000001-0000-4000-8000-000000000086',
    firstName: 'Julian',
    lastName: '\t',
    email: 'julian@example.com',
    phone: '+1-555-011-0086',
    address: '503 Pine St, Chicago, IL',
    companyId: SEEDED_COMPANIES[2].id,
    companyName: SEEDED_COMPANIES[2].name,
    leadStatus: 'Working',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-NULL-0086',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '105000',
    createdAt: '2026-03-09T10:30:00.000Z',
    expectedOutcome: 'null_required',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'NULL_REQUIRED',
        field: 'last_name',
        reason: 'Mandatory field last_name is pure whitespace',
      },
    ],
  });

  // Rows 87..94: MALFORMED (Rejected)
  rows.push({
    sourceRow: 87,
    id: 'c1000001-0000-4000-8000-000000000087',
    firstName: 'Alice',
    lastName: 'Walker',
    email: 'alice.walker_at_invalid-domain',
    phone: '+1-555-011-3344',
    address: '600 Oak St, Dallas, TX',
    companyId: SEEDED_COMPANIES[3].id,
    companyName: SEEDED_COMPANIES[3].name,
    leadStatus: 'New',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-MALF-0087',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '65000',
    createdAt: '2026-03-10T08:00:00.000Z',
    expectedOutcome: 'malformed',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'MALFORMED',
        field: 'email',
        reason: 'Email missing @ delimiter violates RFC-5322',
      },
    ],
  });

  rows.push({
    sourceRow: 88,
    id: 'c1000001-0000-4000-8000-000000000088',
    firstName: 'Bob',
    lastName: 'Smith',
    email: 'bob.smith@',
    phone: '+1-555-011-3345',
    address: '601 Oak St, Dallas, TX',
    companyId: SEEDED_COMPANIES[4].id,
    companyName: SEEDED_COMPANIES[4].name,
    leadStatus: 'New',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-MALF-0088',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '70000',
    createdAt: '2026-03-10T08:30:00.000Z',
    expectedOutcome: 'malformed',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'MALFORMED',
        field: 'email',
        reason: 'Email missing domain part violates RFC-5322',
      },
    ],
  });

  rows.push({
    sourceRow: 89,
    id: 'c1000001-0000-4000-8000-000000000089',
    firstName: 'Carol',
    lastName: 'White',
    email: 'carol white@example.com',
    phone: '+1-555-011-3346',
    address: '602 Oak St, Dallas, TX',
    companyId: SEEDED_COMPANIES[0].id,
    companyName: SEEDED_COMPANIES[0].name,
    leadStatus: 'Working',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-MALF-0089',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '75000',
    createdAt: '2026-03-10T09:00:00.000Z',
    expectedOutcome: 'malformed',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'MALFORMED',
        field: 'email',
        reason: 'Email contains unquoted space violates RFC-5322',
      },
    ],
  });

  rows.push({
    sourceRow: 90,
    id: 'c1000001-0000-4000-8000-000000000090',
    firstName: 'Dave',
    lastName: 'Jones',
    email: 'dave..jones@example.com',
    phone: '+1-555-011-3347',
    address: '603 Oak St, Dallas, TX',
    companyId: SEEDED_COMPANIES[1].id,
    companyName: SEEDED_COMPANIES[1].name,
    leadStatus: 'Working',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-MALF-0090',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '80000',
    createdAt: '2026-03-10T09:30:00.000Z',
    expectedOutcome: 'malformed',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'MALFORMED',
        field: 'email',
        reason: 'Email contains consecutive dots violates RFC-5322',
      },
    ],
  });

  rows.push({
    sourceRow: 91,
    id: 'c1000001-0000-4000-8000-000000000091',
    firstName: 'Robert',
    lastName: 'Green',
    email: 'robert.green@example.org',
    phone: 'CALL-BOB-NOW-1234',
    address: '700 Cedar Ave, Denver, CO',
    companyId: SEEDED_COMPANIES[2].id,
    companyName: SEEDED_COMPANIES[2].name,
    leadStatus: 'Qualified',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-MALF-0091',
    consentStatus: 'granted',
    unsubscribed: 'false',
    annualRevenue: '110000',
    createdAt: '2026-03-10T10:00:00.000Z',
    expectedOutcome: 'malformed',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'MALFORMED',
        field: 'phone',
        reason: 'Phone contains alphabetic characters',
      },
    ],
  });

  rows.push({
    sourceRow: 92,
    id: 'c1000001-0000-4000-8000-000000000092',
    firstName: 'Samuel',
    lastName: 'Short',
    email: 'samuel.short@example.org',
    phone: '123',
    address: '701 Cedar Ave, Denver, CO',
    companyId: SEEDED_COMPANIES[3].id,
    companyName: SEEDED_COMPANIES[3].name,
    leadStatus: 'Qualified',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-MALF-0092',
    consentStatus: 'granted',
    unsubscribed: 'false',
    annualRevenue: '115000',
    createdAt: '2026-03-10T10:30:00.000Z',
    expectedOutcome: 'malformed',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'MALFORMED',
        field: 'phone',
        reason: 'Phone has insufficient digits for E.164 normalization',
      },
    ],
  });

  rows.push({
    sourceRow: 93,
    id: 'c1000001-0000-4000-8000-000000000093',
    firstName: 'Victor',
    lastName: 'Workflow',
    email: 'victor.workflow@example.org',
    phone: '+1-555-011-5566',
    address: '800 Elm St, Atlanta, GA',
    companyId: SEEDED_COMPANIES[4].id,
    companyName: SEEDED_COMPANIES[4].name,
    leadStatus: 'Reopened',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-MALF-0093',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '130000',
    createdAt: '2026-03-11T11:00:00.000Z',
    expectedOutcome: 'malformed',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'MALFORMED',
        field: 'lead_status',
        reason: "Lead status 'Reopened' violates CRM SDS allowlist ('New', 'Working', 'Qualified', 'Closed')",
      },
    ],
  });

  rows.push({
    sourceRow: 94,
    id: 'c1000001-0000-4000-8000-000000000094',
    firstName: 'Wanda',
    lastName: 'Stage',
    email: 'wanda.stage@example.org',
    phone: '+1-555-011-5567',
    address: '801 Elm St, Atlanta, GA',
    companyId: SEEDED_COMPANIES[0].id,
    companyName: SEEDED_COMPANIES[0].name,
    leadStatus: 'Archived_Legacy',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-MALF-0094',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '135000',
    createdAt: '2026-03-11T11:30:00.000Z',
    expectedOutcome: 'malformed',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'MALFORMED',
        field: 'lead_status',
        reason: "Lead status 'Archived_Legacy' violates CRM SDS allowlist",
      },
    ],
  });

  // Rows 95..96: FOREIGN_KEY_MISSING (Rejected)
  rows.push({
    sourceRow: 95,
    id: 'c1000001-0000-4000-8000-000000000095',
    firstName: 'Clara',
    lastName: 'Oswald',
    email: 'clara.oswald@example.co.uk',
    phone: '+44-20-7946-0195',
    address: '900 Thames Way, London, UK',
    companyId: '00000000-0000-0000-0000-000000000000',
    companyName: 'Non-Existent Holdings Ltd',
    leadStatus: 'Working',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-FK-0095',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '160000',
    createdAt: '2026-03-12T13:00:00.000Z',
    expectedOutcome: 'foreign_key_missing',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'FOREIGN_KEY_MISSING',
        field: 'company_id',
        reason: "Referenced company_id '00000000-0000-0000-0000-000000000000' does not exist in crm1_companies",
      },
    ],
  });

  rows.push({
    sourceRow: 96,
    id: 'c1000001-0000-4000-8000-000000000096',
    firstName: 'Frank',
    lastName: 'Orphan',
    email: 'frank.orphan@example.co.uk',
    phone: '+44-20-7946-0196',
    address: '901 Thames Way, London, UK',
    companyId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    companyName: 'Phantom Enterprises Inc',
    leadStatus: 'Working',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-FK-0096',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '165000',
    createdAt: '2026-03-12T13:30:00.000Z',
    expectedOutcome: 'foreign_key_missing',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'FOREIGN_KEY_MISSING',
        field: 'company_id',
        reason: "Referenced company_id 'ffffffff-ffff-ffff-ffff-ffffffffffff' does not exist in crm1_companies",
      },
    ],
  });

  // Rows 97..100: Edge Case Anomalies (Formula injection, boundary numbers, field length)
  // Row 97: Formula Injection vector (=)
  rows.push({
    sourceRow: 97,
    id: 'c1000001-0000-4000-8000-000000000097',
    firstName: "=cmd|'/C calc'!A0",
    lastName: 'VulnerabilityTest',
    email: 'injection.test@example.com',
    phone: '+1-555-010-0097',
    address: '1000 Security Blvd, San Jose, CA',
    companyId: SEEDED_COMPANIES[0].id,
    companyName: SEEDED_COMPANIES[0].name,
    leadStatus: 'New',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-INJ-0097',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '50000',
    createdAt: '2026-03-13T15:00:00.000Z',
    expectedOutcome: 'malformed',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'FORMULA_INJECTION_RISK',
        field: 'first_name',
        reason: "Value starts with formula execution trigger '='",
      },
    ],
  });

  // Row 98: Formula Injection vector (+)
  rows.push({
    sourceRow: 98,
    id: 'c1000001-0000-4000-8000-000000000098',
    firstName: 'Harriet',
    lastName: '+SUM(1+1)*cmd',
    email: 'formula.plus@example.com',
    phone: '+1-555-010-0098',
    address: '1001 Security Blvd, San Jose, CA',
    companyId: SEEDED_COMPANIES[1].id,
    companyName: SEEDED_COMPANIES[1].name,
    leadStatus: 'New',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-INJ-0098',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '55000',
    createdAt: '2026-03-13T15:30:00.000Z',
    expectedOutcome: 'malformed',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'FORMULA_INJECTION_RISK',
        field: 'last_name',
        reason: "Value starts with formula execution trigger '+'",
      },
    ],
  });

  // Row 99: Out-of-bounds negative number
  rows.push({
    sourceRow: 99,
    id: 'c1000001-0000-4000-8000-000000000099',
    firstName: 'Nigel',
    lastName: 'Negative',
    email: 'nigel.negative@example.com',
    phone: '+1-555-010-0099',
    address: '1100 Deficit Way, Austin, TX',
    companyId: SEEDED_COMPANIES[2].id,
    companyName: SEEDED_COMPANIES[2].name,
    leadStatus: 'New',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-NUM-0099',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '-50000',
    createdAt: '2026-03-14T16:00:00.000Z',
    expectedOutcome: 'malformed',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'BOUNDARY_NUMBERS',
        field: 'annual_revenue',
        reason: 'Annual revenue cannot be negative (-50000)',
      },
    ],
  });

  // Row 100: Excessive Field Length Boundary (>255 chars)
  rows.push({
    sourceRow: 100,
    id: 'c1000001-0000-4000-8000-000000000100',
    firstName: 'A'.repeat(500),
    lastName: 'LengthBoundaryTest',
    email: 'length.boundary@example.com',
    phone: '+1-555-010-0100',
    address: '1200 Buffer St, Portland, OR',
    companyId: SEEDED_COMPANIES[3].id,
    companyName: SEEDED_COMPANIES[3].name,
    leadStatus: 'New',
    sourceSystem: 'salesforce_legacy',
    sourceId: 'SF-LEN-0100',
    consentStatus: 'unknown',
    unsubscribed: 'false',
    annualRevenue: '60000',
    createdAt: '2026-03-14T16:30:00.000Z',
    expectedOutcome: 'malformed',
    terminalOutcome: 'rejected',
    status: 'DEFECTIVE',
    defects: [
      {
        category: 'FIELD_TOO_LONG',
        field: 'first_name',
        reason: 'Length (500) exceeds maximum allowable text column constraint (255)',
      },
    ],
  });

  return rows;
}

/**
 * Formats dirty pack rows as RFC-4180 CSV with header row.
 */
export function formatRecordsAsCsv(records: readonly Crm1DirtyPackRow[]): string {
  const header = CSV_COLUMNS.join(',');
  const lines = records.map((r) => {
    return [
      r.id,
      escapeCsv(r.firstName),
      escapeCsv(r.lastName),
      escapeCsv(r.email),
      escapeCsv(r.phone),
      escapeCsv(r.address),
      r.companyId,
      escapeCsv(r.companyName),
      r.leadStatus,
      r.sourceSystem,
      r.sourceId,
      r.consentStatus,
      r.unsubscribed,
      r.annualRevenue,
      escapeCsv(r.createdAt),
    ].join(',');
  });

  return [header, ...lines].join('\n') + '\n';
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Builds the canonical manifest cataloging all 100 rows with disjoint defect categories.
 */
export function buildCrm1Manifest(records: readonly Crm1DirtyPackRow[]): Crm1Manifest {
  const cleanCount = records.filter((r) => r.status === 'VALID').length;
  const defectiveCount = records.filter((r) => r.status === 'DEFECTIVE').length;
  const loadedCount = records.filter((r) => r.terminalOutcome === 'loaded').length;
  const rejectedCount = records.filter((r) => r.terminalOutcome === 'rejected').length;
  const mergedCount = records.filter((r) => r.terminalOutcome === 'merged').length;
  const skippedCount = records.filter((r) => r.terminalOutcome === 'skipped').length;

  const defectCategories: Record<string, DefectCategorySummary> = {
    EXACT_DUPLICATE: {
      description: 'Exact normalized email or compound phone+name duplicate pairs requiring human merge review',
      expectedOutcome: 'exact_duplicate',
      count: 8,
      recordIndices: [75, 76, 77, 78, 79, 80, 81, 82],
    },
    NULL_REQUIRED: {
      description: 'Missing or whitespace mandatory attributes (first_name, last_name)',
      expectedOutcome: 'null_required',
      count: 4,
      recordIndices: [83, 84, 85, 86],
    },
    MALFORMED: {
      description: 'Invalid RFC-5322 emails, non-E.164 phone numbers, and forbidden lead status transitions',
      expectedOutcome: 'malformed',
      count: 8,
      recordIndices: [87, 88, 89, 90, 91, 92, 93, 94],
    },
    FOREIGN_KEY_MISSING: {
      description: 'Non-existent parent company_id violating referential foreign key restrict rule',
      expectedOutcome: 'foreign_key_missing',
      count: 2,
      recordIndices: [95, 96],
    },
    FORMULA_INJECTION_RISK: {
      description: 'Spreadsheet formula injection vectors starting with =, +, -, or @',
      expectedOutcome: 'malformed',
      count: 2,
      recordIndices: [97, 98],
    },
    BOUNDARY_NUMBERS: {
      description: 'Out-of-range negative financial values violating domain non-negative constraints',
      expectedOutcome: 'malformed',
      count: 1,
      recordIndices: [99],
    },
    FIELD_TOO_LONG: {
      description: 'Values exceeding database text column boundary capacity (> 255 chars)',
      expectedOutcome: 'malformed',
      count: 1,
      recordIndices: [100],
    },
  };

  return {
    module: 'crm-1',
    name: 'CRM-1 Contacts, Companies and Leads Canonical Dirty Data Pack',
    version: '1.0.0',
    specification: 'ClearShift Project Plan v3.0 §17, SDS CRM v2.0 §4.11-4.12, Issue #118 [CRM1-25]',
    targetTable: 'crm1_contacts',
    fixtureFile: 'dirty-pack-100.csv',
    totalRecords: records.length,
    summary: {
      cleanRecordsCount: cleanCount,
      defectiveRecordsCount: defectiveCount,
      loadedCount,
      rejectedCount,
      mergedCount,
      skippedCount,
      unaccounted: records.length - (loadedCount + rejectedCount + mergedCount + skippedCount),
      totalDefectCategories: Object.keys(defectCategories).length,
      isDisjoint: true,
      requiredOutcomesCovered: [
        'valid',
        'malformed',
        'null_required',
        'exact_duplicate',
        'foreign_key_missing',
      ],
      edgeCasesCovered: [
        'utf8_characters',
        'whitespace_padding',
        'date_format_variants',
        'boundary_numbers',
      ],
    },
    defectCategories,
    records: records.map((r) => ({
      index: r.sourceRow,
      id: r.id,
      expectedOutcome: r.expectedOutcome,
      terminalOutcome: r.terminalOutcome,
      status: r.status,
      defects: r.defects,
    })),
  };
}

/**
 * Builds expected profile statistics matching ClearShift Profiling Baseline format.
 */
export function buildCrm1ExpectedProfile(
  csvContent: string,
  records: readonly Crm1DirtyPackRow[]
): Crm1ExpectedProfile {
  const hash = createHash('sha256').update(csvContent, 'utf8').digest('hex');
  const bytes = Buffer.byteLength(csvContent, 'utf8');

  const loaded = records.filter((r) => r.terminalOutcome === 'loaded').length;
  const merged = records.filter((r) => r.terminalOutcome === 'merged').length;
  const rejected = records.filter((r) => r.terminalOutcome === 'rejected').length;
  const skipped = records.filter((r) => r.terminalOutcome === 'skipped').length;

  return {
    schemaVersion: 1,
    rulesetVersion: 1,
    fixture: {
      file: 'dirty-pack-100.csv',
      sha256: hash,
      bytes,
      rows: records.length,
    },
    outcomes: {
      loaded,
      merged,
      rejected,
      skipped,
    },
    columns: {
      id: { emptyCount: 0, invalidCount: 0, inferredType: 'uuid' },
      first_name: { emptyCount: 2, invalidCount: 2, inferredType: 'string' },
      last_name: { emptyCount: 2, invalidCount: 1, inferredType: 'string' },
      email: { emptyCount: 0, invalidCount: 4, inferredType: 'email' },
      phone: { emptyCount: 0, invalidCount: 2, inferredType: 'phone' },
      address: { emptyCount: 0, invalidCount: 0, inferredType: 'string' },
      company_id: { emptyCount: 0, invalidCount: 2, inferredType: 'uuid' },
      company_name: { emptyCount: 0, invalidCount: 0, inferredType: 'string' },
      lead_status: { emptyCount: 0, invalidCount: 2, inferredType: 'enum' },
      source_system: { emptyCount: 0, invalidCount: 0, inferredType: 'string' },
      source_id: { emptyCount: 0, invalidCount: 0, inferredType: 'string' },
      consent_status: { emptyCount: 0, invalidCount: 0, inferredType: 'enum' },
      unsubscribed: { emptyCount: 0, invalidCount: 0, inferredType: 'boolean' },
      annual_revenue: { emptyCount: 0, invalidCount: 1, inferredType: 'decimal' },
      created_at: { emptyCount: 0, invalidCount: 0, inferredType: 'timestamp' },
    },
  };
}
