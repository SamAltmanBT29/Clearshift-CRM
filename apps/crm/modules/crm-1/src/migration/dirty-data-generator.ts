import type { RawRow } from './rules.js';

export const KNOWN_COMPANY_IDS = [
  'c2000001-0000-4000-8000-000000000001',
  'c2000001-0000-4000-8000-000000000002',
  'c2000001-0000-4000-8000-000000000003',
  'c2000001-0000-4000-8000-000000000004',
  'c2000001-0000-4000-8000-000000000005',
] as const;

export const companyRegistryLedger = (id: string): boolean => {
  return KNOWN_COMPANY_IDS.includes(id.toLowerCase() as (typeof KNOWN_COMPANY_IDS)[number]);
};

const FIRST_NAMES = [
  'Alice', 'Bob', 'Carol', 'David', 'Elena', 'Frank', 'Grace', 'Henry', 'Iris', 'Jack',
  'Karen', 'Leo', 'Mia', 'Noah', 'Olivia', 'Paul', 'Quinn', 'Rachel', 'Sam', 'Tara',
  'Uma', 'Victor', 'Wendy', 'Xavier', 'Yara', 'Zane', 'Arthur', 'Beatrice', 'Charles', 'Diana',
  'Edward', 'Fiona', 'George', 'Hannah', 'Ian', 'Julia', 'Kevin', 'Laura', 'Michael', 'Nora',
  'Oscar', 'Penelope', 'Quentin', 'Rose', 'Simon', 'Tina', 'Ulysses', 'Valerie', 'Walter', 'Xena',
] as const;

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
  'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts',
] as const;

const LEAD_STATUSES = ['New', 'Working', 'Qualified', 'Closed'] as const;
const CONSENT_STATUSES = ['unknown', 'granted', 'withdrawn'] as const;

export function generateCanonicalCrm1Rows(): RawRow[] {
  const rows: Record<string, string>[] = [];

  // 1..50: Fully valid clean records (outcome: accept)
  for (let i = 1; i <= 50; i++) {
    const fn = FIRST_NAMES[i - 1]!;
    const ln = LAST_NAMES[i - 1]!;
    const compId = KNOWN_COMPANY_IDS[(i - 1) % KNOWN_COMPANY_IDS.length]!;
    const leadSt = LEAD_STATUSES[(i - 1) % LEAD_STATUSES.length]!;
    const consentSt = CONSENT_STATUSES[(i - 1) % CONSENT_STATUSES.length]!;
    const unsub = i % 7 === 0 ? 'true' : 'false';
    const pad = String(i).padStart(12, '0');

    rows.push({
      id: `c1000001-0000-4000-8000-${pad}`,
      first_name: fn,
      last_name: ln,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}@synthetic.example.com`,
      phone: `+1 (555) 010-${String(1000 + i).slice(1)}`,
      address: `${100 + i} Market Street, Suite ${i}`,
      company_id: compId,
      lead_status: leadSt,
      golden_id: `GLD-${String(i).padStart(4, '0')}`,
      source_system: i % 2 === 0 ? 'salesforce' : 'hubspot',
      source_id: `SRC-${String(1000 + i)}`,
      consent_status: consentSt,
      consent_updated_at: '2026-10-01T12:00:00.000Z',
      unsubscribed: unsub,
      unsubscribed_updated_at: '2026-10-01T12:00:00.000Z',
      created_at: '2026-09-01T08:00:00.000Z',
      updated_at: '2026-10-01T12:00:00.000Z',
    });
  }

  // 51..54: Additional valid edge cases (outcome: accept)
  // 51: Valid minimal row (all optional fields blank)
  rows.push({
    id: '',
    first_name: 'Minimal',
    last_name: 'Contact',
    email: '',
    phone: '',
    address: '',
    company_id: '',
    lead_status: '',
    golden_id: '',
    source_system: '',
    source_id: '',
    consent_status: '',
    consent_updated_at: '',
    unsubscribed: '',
    unsubscribed_updated_at: '',
    created_at: '',
    updated_at: '',
  });

  // 52: Valid with UTF-8 characters
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000052',
    first_name: 'Renée',
    last_name: 'Müller',
    email: 'renee.mueller@synthetic.example.org',
    phone: '+49 30 1234567',
    address: 'Königsallee 42, Düsseldorf',
    company_id: KNOWN_COMPANY_IDS[0]!,
    lead_status: 'Qualified',
    golden_id: 'GLD-0052',
    source_system: 'zoho',
    source_id: 'ZH-52',
    consent_status: 'granted',
    consent_updated_at: '2026-10-02T10:00:00.000Z',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-10T09:00:00.000Z',
    updated_at: '2026-10-02T10:00:00.000Z',
  });

  // 53: Valid with lead_status Closed & unsubscribed true
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000053',
    first_name: 'Marcus',
    last_name: 'Vance',
    email: 'marcus.vance@synthetic.example.net',
    phone: '+1 555 012 3456',
    address: '789 Broadway Ave',
    company_id: KNOWN_COMPANY_IDS[1]!,
    lead_status: 'Closed',
    golden_id: 'GLD-0053',
    source_system: 'salesforce',
    source_id: 'SF-53',
    consent_status: 'withdrawn',
    consent_updated_at: '2026-10-03T11:00:00.000Z',
    unsubscribed: 'true',
    unsubscribed_updated_at: '2026-10-03T11:00:00.000Z',
    created_at: '2026-09-12T08:30:00.000Z',
    updated_at: '2026-10-03T11:00:00.000Z',
  });

  // 54: Valid with lead_status New & consent_status unknown
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000054',
    first_name: 'Sophie',
    last_name: 'Dubois',
    email: 'sophie.dubois@synthetic.example.co.uk',
    phone: '+44 20 7946 0912',
    address: '10 Downing Court',
    company_id: KNOWN_COMPANY_IDS[2]!,
    lead_status: 'New',
    golden_id: 'GLD-0054',
    source_system: 'hubspot',
    source_id: 'HS-54',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-15T14:20:00.000Z',
    updated_at: '2026-09-15T14:20:00.000Z',
  });

  // 55..62 (8 rows): Normalization cases (outcome: normalize)
  // 55: Leading/trailing whitespace on names
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000055',
    first_name: '   Liam   ',
    last_name: "   O'Connor   ",
    email: 'liam.oconnor@synthetic.example.com',
    phone: '+1 (555) 018-9901',
    address: '55 Pine Lane',
    company_id: KNOWN_COMPANY_IDS[3]!,
    lead_status: 'Working',
    golden_id: 'GLD-0055',
    source_system: 'salesforce',
    source_id: 'SF-55',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-16T10:00:00.000Z',
    updated_at: '2026-09-16T10:00:00.000Z',
  });

  // 56: Whitespace & uppercase on email
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000056',
    first_name: 'Emma',
    last_name: 'Watson',
    email: '  EMMA.WATSON@SYNTHETIC.EXAMPLE.ORG  ',
    phone: '+1 (555) 018-9902',
    address: '56 Elm St',
    company_id: KNOWN_COMPANY_IDS[4]!,
    lead_status: 'Qualified',
    golden_id: 'GLD-0056',
    source_system: 'hubspot',
    source_id: 'HS-56',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-17T11:00:00.000Z',
    updated_at: '2026-09-17T11:00:00.000Z',
  });

  // 57: Whitespace in phone
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000057',
    first_name: 'Lucas',
    last_name: 'Gray',
    email: 'lucas.gray@synthetic.example.net',
    phone: '   +1 (555) 018-9903   ',
    address: '57 Cedar Ave',
    company_id: KNOWN_COMPANY_IDS[0]!,
    lead_status: 'New',
    golden_id: 'GLD-0057',
    source_system: 'zoho',
    source_id: 'ZH-57',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-18T09:15:00.000Z',
    updated_at: '2026-09-18T09:15:00.000Z',
  });

  // 58: Tabs in address
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000058',
    first_name: 'Chloe',
    last_name: 'Bennett',
    email: 'chloe.bennett@synthetic.example.com',
    phone: '+1 (555) 018-9904',
    address: '58\tMaple\tDrive',
    company_id: KNOWN_COMPANY_IDS[1]!,
    lead_status: 'Working',
    golden_id: 'GLD-0058',
    source_system: 'salesforce',
    source_id: 'SF-58',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-19T13:00:00.000Z',
    updated_at: '2026-09-19T13:00:00.000Z',
  });

  // 59: Whitespace in lead_status
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000059',
    first_name: 'Ethan',
    last_name: 'Hunt',
    email: 'ethan.hunt@synthetic.example.org',
    phone: '+1 (555) 018-9905',
    address: '59 Oak Court',
    company_id: KNOWN_COMPANY_IDS[2]!,
    lead_status: '  Qualified  ',
    golden_id: 'GLD-0059',
    source_system: 'hubspot',
    source_id: 'HS-59',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-20T15:30:00.000Z',
    updated_at: '2026-09-20T15:30:00.000Z',
  });

  // 60: Whitespace in consent_status
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000060',
    first_name: 'Mia',
    last_name: 'Lin',
    email: 'mia.lin@synthetic.example.net',
    phone: '+1 (555) 018-9906',
    address: '60 Spruce Blvd',
    company_id: KNOWN_COMPANY_IDS[3]!,
    lead_status: 'Working',
    golden_id: 'GLD-0060',
    source_system: 'zoho',
    source_id: 'ZH-60',
    consent_status: '  granted  ',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-21T08:45:00.000Z',
    updated_at: '2026-09-21T08:45:00.000Z',
  });

  // 61: Whitespace in source_system & source_id
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000061',
    first_name: 'Benjamin',
    last_name: 'Cole',
    email: 'benjamin.cole@synthetic.example.co.uk',
    phone: '+1 (555) 018-9907',
    address: '61 Walnut Way',
    company_id: KNOWN_COMPANY_IDS[4]!,
    lead_status: 'New',
    golden_id: 'GLD-0061',
    source_system: '  salesforce  ',
    source_id: '  SF-61  ',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-22T10:10:00.000Z',
    updated_at: '2026-09-22T10:10:00.000Z',
  });

  // 62: Whitespace in golden_id
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000062',
    first_name: 'Harper',
    last_name: 'Reed',
    email: 'harper.reed@synthetic.example.com',
    phone: '+1 (555) 018-9908',
    address: '62 Birch Rd',
    company_id: KNOWN_COMPANY_IDS[0]!,
    lead_status: 'Closed',
    golden_id: '  GLD-0062  ',
    source_system: 'hubspot',
    source_id: 'HS-62',
    consent_status: 'withdrawn',
    consent_updated_at: '',
    unsubscribed: 'true',
    unsubscribed_updated_at: '',
    created_at: '2026-09-23T11:20:00.000Z',
    updated_at: '2026-09-23T11:20:00.000Z',
  });

  // 63..66 (4 rows): Exact duplicate candidate occurrences (outcome: merge)
  // 63: Duplicate ID of Row 1
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000001',
    first_name: 'Alice',
    last_name: 'DuplicateId',
    email: 'alice.unique@synthetic.example.com',
    phone: '+1 (555) 019-9001',
    address: '63 Dup Id Road',
    company_id: KNOWN_COMPANY_IDS[0]!,
    lead_status: 'Working',
    golden_id: 'GLD-0063',
    source_system: 'salesforce',
    source_id: 'SF-63',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-24T12:00:00.000Z',
    updated_at: '2026-09-24T12:00:00.000Z',
  });

  // 64: Duplicate normalized Email of Row 2 (bob.johnson@synthetic.example.com)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000064',
    first_name: 'Robert',
    last_name: 'Johnson',
    email: '  BOB.JOHNSON@SYNTHETIC.EXAMPLE.COM  ',
    phone: '+1 (555) 019-9002',
    address: '64 Dup Email Road',
    company_id: KNOWN_COMPANY_IDS[1]!,
    lead_status: 'Qualified',
    golden_id: 'GLD-0064',
    source_system: 'hubspot',
    source_id: 'HS-64',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-25T14:00:00.000Z',
    updated_at: '2026-09-25T14:00:00.000Z',
  });

  // 65: Duplicate compound (Phone + Name) of Row 3 (Carol Williams, +1 (555) 010-003)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000065',
    first_name: 'Carol',
    last_name: 'Williams',
    email: 'carol.alternate@synthetic.example.org',
    phone: '+1 555 010 003',
    address: '65 Dup PhoneName Road',
    company_id: KNOWN_COMPANY_IDS[2]!,
    lead_status: 'New',
    golden_id: 'GLD-0065',
    source_system: 'zoho',
    source_id: 'ZH-65',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-26T16:00:00.000Z',
    updated_at: '2026-09-26T16:00:00.000Z',
  });

  // 66: Duplicate (source_system, source_id) of Row 4 (salesforce, SRC-1004)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000066',
    first_name: 'David',
    last_name: 'DupSource',
    email: 'david.dupsource@synthetic.example.net',
    phone: '+1 (555) 019-9004',
    address: '66 Dup Source Road',
    company_id: KNOWN_COMPANY_IDS[3]!,
    lead_status: 'Working',
    golden_id: 'GLD-0066',
    source_system: 'salesforce',
    source_id: 'SRC-1004',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-27T17:00:00.000Z',
    updated_at: '2026-09-27T17:00:00.000Z',
  });

  // 67..100 (34 rows): Rejections (outcome: reject)
  // 67, 68: CRM1-DQ-001 (missing first_name)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000067',
    first_name: '',
    last_name: 'MissingFirst1',
    email: 'missingfirst1@synthetic.example.com',
    phone: '+1 (555) 017-0001',
    address: '67 Reject St',
    company_id: KNOWN_COMPANY_IDS[0]!,
    lead_status: 'New',
    golden_id: '',
    source_system: 'salesforce',
    source_id: 'REJ-67',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-28T10:00:00.000Z',
    updated_at: '2026-09-28T10:00:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000068',
    first_name: '   ',
    last_name: 'MissingFirst2',
    email: 'missingfirst2@synthetic.example.com',
    phone: '+1 (555) 017-0002',
    address: '68 Reject St',
    company_id: KNOWN_COMPANY_IDS[1]!,
    lead_status: 'Working',
    golden_id: '',
    source_system: 'hubspot',
    source_id: 'REJ-68',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-28T10:30:00.000Z',
    updated_at: '2026-09-28T10:30:00.000Z',
  });

  // 69, 70: CRM1-DQ-002 (missing last_name)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000069',
    first_name: 'MissingLast1',
    last_name: '',
    email: 'missinglast1@synthetic.example.com',
    phone: '+1 (555) 017-0003',
    address: '69 Reject St',
    company_id: KNOWN_COMPANY_IDS[2]!,
    lead_status: 'Qualified',
    golden_id: '',
    source_system: 'zoho',
    source_id: 'REJ-69',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-28T11:00:00.000Z',
    updated_at: '2026-09-28T11:00:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000070',
    first_name: 'MissingLast2',
    last_name: '   ',
    email: 'missinglast2@synthetic.example.com',
    phone: '+1 (555) 017-0004',
    address: '70 Reject St',
    company_id: KNOWN_COMPANY_IDS[3]!,
    lead_status: 'Closed',
    golden_id: '',
    source_system: 'salesforce',
    source_id: 'REJ-70',
    consent_status: 'withdrawn',
    consent_updated_at: '',
    unsubscribed: 'true',
    unsubscribed_updated_at: '',
    created_at: '2026-09-28T11:30:00.000Z',
    updated_at: '2026-09-28T11:30:00.000Z',
  });

  // 71, 72: CRM1-DQ-003 (malformed UUID id)
  rows.push({
    id: 'not-a-uuid-71',
    first_name: 'BadId1',
    last_name: 'Reject',
    email: 'badid1@synthetic.example.org',
    phone: '+1 (555) 017-0005',
    address: '71 Reject Ave',
    company_id: KNOWN_COMPANY_IDS[4]!,
    lead_status: 'New',
    golden_id: '',
    source_system: 'hubspot',
    source_id: 'REJ-71',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-29T09:00:00.000Z',
    updated_at: '2026-09-29T09:00:00.000Z',
  });
  rows.push({
    id: '12345678-1234-1234-1234',
    first_name: 'BadId2',
    last_name: 'Reject',
    email: 'badid2@synthetic.example.org',
    phone: '+1 (555) 017-0006',
    address: '72 Reject Ave',
    company_id: KNOWN_COMPANY_IDS[0]!,
    lead_status: 'Working',
    golden_id: '',
    source_system: 'zoho',
    source_id: 'REJ-72',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-29T09:30:00.000Z',
    updated_at: '2026-09-29T09:30:00.000Z',
  });

  // 73, 74, 75: CRM1-DQ-004 (malformed email syntax)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000073',
    first_name: 'BadEmail1',
    last_name: 'Reject',
    email: 'plainaddress',
    phone: '+1 (555) 017-0007',
    address: '73 Reject Lane',
    company_id: KNOWN_COMPANY_IDS[1]!,
    lead_status: 'New',
    golden_id: '',
    source_system: 'salesforce',
    source_id: 'REJ-73',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-29T10:00:00.000Z',
    updated_at: '2026-09-29T10:00:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000074',
    first_name: 'BadEmail2',
    last_name: 'Reject',
    email: '@missinguser.example.com',
    phone: '+1 (555) 017-0008',
    address: '74 Reject Lane',
    company_id: KNOWN_COMPANY_IDS[2]!,
    lead_status: 'Working',
    golden_id: '',
    source_system: 'hubspot',
    source_id: 'REJ-74',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-29T10:30:00.000Z',
    updated_at: '2026-09-29T10:30:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000075',
    first_name: 'BadEmail3',
    last_name: 'Reject',
    email: 'user@nodomain',
    phone: '+1 (555) 017-0009',
    address: '75 Reject Lane',
    company_id: KNOWN_COMPANY_IDS[3]!,
    lead_status: 'Qualified',
    golden_id: '',
    source_system: 'zoho',
    source_id: 'REJ-75',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-29T11:00:00.000Z',
    updated_at: '2026-09-29T11:00:00.000Z',
  });

  // 76, 77: CRM1-DQ-005 (malformed phone)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000076',
    first_name: 'BadPhone1',
    last_name: 'Reject',
    email: 'badphone1@synthetic.example.net',
    phone: '123',
    address: '76 Reject Rd',
    company_id: KNOWN_COMPANY_IDS[4]!,
    lead_status: 'New',
    golden_id: '',
    source_system: 'salesforce',
    source_id: 'REJ-76',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-29T12:00:00.000Z',
    updated_at: '2026-09-29T12:00:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000077',
    first_name: 'BadPhone2',
    last_name: 'Reject',
    email: 'badphone2@synthetic.example.net',
    phone: 'invalid-call-me',
    address: '77 Reject Rd',
    company_id: KNOWN_COMPANY_IDS[0]!,
    lead_status: 'Working',
    golden_id: '',
    source_system: 'hubspot',
    source_id: 'REJ-77',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-29T12:30:00.000Z',
    updated_at: '2026-09-29T12:30:00.000Z',
  });

  // 78, 79, 80: CRM1-DQ-006 (invalid lead_status)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000078',
    first_name: 'BadStatus1',
    last_name: 'Reject',
    email: 'badstatus1@synthetic.example.co.uk',
    phone: '+1 (555) 017-0010',
    address: '78 Reject Way',
    company_id: KNOWN_COMPANY_IDS[1]!,
    lead_status: 'Won',
    golden_id: '',
    source_system: 'salesforce',
    source_id: 'REJ-78',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T09:00:00.000Z',
    updated_at: '2026-09-30T09:00:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000079',
    first_name: 'BadStatus2',
    last_name: 'Reject',
    email: 'badstatus2@synthetic.example.co.uk',
    phone: '+1 (555) 017-0011',
    address: '79 Reject Way',
    company_id: KNOWN_COMPANY_IDS[2]!,
    lead_status: 'Lost',
    golden_id: '',
    source_system: 'hubspot',
    source_id: 'REJ-79',
    consent_status: 'withdrawn',
    consent_updated_at: '',
    unsubscribed: 'true',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T09:30:00.000Z',
    updated_at: '2026-09-30T09:30:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000080',
    first_name: 'BadStatus3',
    last_name: 'Reject',
    email: 'badstatus3@synthetic.example.co.uk',
    phone: '+1 (555) 017-0012',
    address: '80 Reject Way',
    company_id: KNOWN_COMPANY_IDS[3]!,
    lead_status: 'PendingReview',
    golden_id: '',
    source_system: 'zoho',
    source_id: 'REJ-80',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T10:00:00.000Z',
    updated_at: '2026-09-30T10:00:00.000Z',
  });

  // 81, 82: CRM1-DQ-007 (malformed company_id UUID)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000081',
    first_name: 'BadCompanyId1',
    last_name: 'Reject',
    email: 'badcomp1@synthetic.example.com',
    phone: '+1 (555) 017-0013',
    address: '81 Reject Court',
    company_id: 'not-a-company-uuid',
    lead_status: 'New',
    golden_id: '',
    source_system: 'salesforce',
    source_id: 'REJ-81',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T10:30:00.000Z',
    updated_at: '2026-09-30T10:30:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000082',
    first_name: 'BadCompanyId2',
    last_name: 'Reject',
    email: 'badcomp2@synthetic.example.com',
    phone: '+1 (555) 017-0014',
    address: '82 Reject Court',
    company_id: 'c2000001-9999-bad-uuid',
    lead_status: 'Working',
    golden_id: '',
    source_system: 'hubspot',
    source_id: 'REJ-82',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T11:00:00.000Z',
    updated_at: '2026-09-30T11:00:00.000Z',
  });

  // 83, 84: CRM1-DQ-008 (foreign key missing company_id)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000083',
    first_name: 'MissingCompanyFk1',
    last_name: 'Reject',
    email: 'missingfk1@synthetic.example.org',
    phone: '+1 (555) 017-0015',
    address: '83 Reject Blvd',
    company_id: 'c2000001-0000-4000-8000-999999999991',
    lead_status: 'New',
    golden_id: '',
    source_system: 'salesforce',
    source_id: 'REJ-83',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T11:30:00.000Z',
    updated_at: '2026-09-30T11:30:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000084',
    first_name: 'MissingCompanyFk2',
    last_name: 'Reject',
    email: 'missingfk2@synthetic.example.org',
    phone: '+1 (555) 017-0016',
    address: '84 Reject Blvd',
    company_id: 'c2000001-0000-4000-8000-999999999992',
    lead_status: 'Working',
    golden_id: '',
    source_system: 'hubspot',
    source_id: 'REJ-84',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T12:00:00.000Z',
    updated_at: '2026-09-30T12:00:00.000Z',
  });

  // 85, 86, 87: CRM1-DQ-009 (formula prefix =, @, +)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000085',
    first_name: '=SUM(A1:A10)',
    last_name: 'Formula1',
    email: 'formula1@synthetic.example.net',
    phone: '+1 (555) 017-0017',
    address: '85 Formula St',
    company_id: KNOWN_COMPANY_IDS[0]!,
    lead_status: 'New',
    golden_id: '',
    source_system: 'salesforce',
    source_id: 'REJ-85',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T12:30:00.000Z',
    updated_at: '2026-09-30T12:30:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000086',
    first_name: '@CMD|calc.exe',
    last_name: 'Formula2',
    email: 'formula2@synthetic.example.net',
    phone: '+1 (555) 017-0018',
    address: '86 Formula St',
    company_id: KNOWN_COMPANY_IDS[1]!,
    lead_status: 'Working',
    golden_id: '',
    source_system: 'hubspot',
    source_id: 'REJ-86',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T13:00:00.000Z',
    updated_at: '2026-09-30T13:00:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000087',
    first_name: '+HYPERLINK("http://evil.com")',
    last_name: 'Formula3',
    email: 'formula3@synthetic.example.net',
    phone: '+1 (555) 017-0019',
    address: '87 Formula St',
    company_id: KNOWN_COMPANY_IDS[2]!,
    lead_status: 'Qualified',
    golden_id: '',
    source_system: 'zoho',
    source_id: 'REJ-87',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T13:30:00.000Z',
    updated_at: '2026-09-30T13:30:00.000Z',
  });

  // 88, 89: CRM1-DQ-010 (invalid consent_status)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000088',
    first_name: 'BadConsent1',
    last_name: 'Reject',
    email: 'badconsent1@synthetic.example.com',
    phone: '+1 (555) 017-0020',
    address: '88 Consent St',
    company_id: KNOWN_COMPANY_IDS[3]!,
    lead_status: 'New',
    golden_id: '',
    source_system: 'salesforce',
    source_id: 'REJ-88',
    consent_status: 'opt_in',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T14:00:00.000Z',
    updated_at: '2026-09-30T14:00:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000089',
    first_name: 'BadConsent2',
    last_name: 'Reject',
    email: 'badconsent2@synthetic.example.com',
    phone: '+1 (555) 017-0021',
    address: '89 Consent St',
    company_id: KNOWN_COMPANY_IDS[4]!,
    lead_status: 'Working',
    golden_id: '',
    source_system: 'hubspot',
    source_id: 'REJ-89',
    consent_status: 'declined',
    consent_updated_at: '',
    unsubscribed: 'true',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T14:30:00.000Z',
    updated_at: '2026-09-30T14:30:00.000Z',
  });

  // 90, 91: CRM1-DQ-011 (string too long > 255 chars)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000090',
    first_name: 'LongAddress1',
    last_name: 'Reject',
    email: 'longaddr1@synthetic.example.org',
    phone: '+1 (555) 017-0022',
    address: 'A'.repeat(300),
    company_id: KNOWN_COMPANY_IDS[0]!,
    lead_status: 'New',
    golden_id: '',
    source_system: 'salesforce',
    source_id: 'REJ-90',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T15:00:00.000Z',
    updated_at: '2026-09-30T15:00:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000091',
    first_name: 'B'.repeat(300),
    last_name: 'LongName2',
    email: 'longname2@synthetic.example.org',
    phone: '+1 (555) 017-0023',
    address: '91 Long St',
    company_id: KNOWN_COMPANY_IDS[1]!,
    lead_status: 'Working',
    golden_id: '',
    source_system: 'hubspot',
    source_id: 'REJ-91',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T15:30:00.000Z',
    updated_at: '2026-09-30T15:30:00.000Z',
  });

  // 92, 93: CRM1-DQ-012 (invalid created_at timestamp)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000092',
    first_name: 'BadCreated1',
    last_name: 'Reject',
    email: 'badcreated1@synthetic.example.net',
    phone: '+1 (555) 017-0024',
    address: '92 Time St',
    company_id: KNOWN_COMPANY_IDS[2]!,
    lead_status: 'New',
    golden_id: '',
    source_system: 'salesforce',
    source_id: 'REJ-92',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026/09/30 10:00',
    updated_at: '2026-09-30T16:00:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000093',
    first_name: 'BadCreated2',
    last_name: 'Reject',
    email: 'badcreated2@synthetic.example.net',
    phone: '+1 (555) 017-0025',
    address: '93 Time St',
    company_id: KNOWN_COMPANY_IDS[3]!,
    lead_status: 'Working',
    golden_id: '',
    source_system: 'hubspot',
    source_id: 'REJ-93',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: 'invalid-date',
    updated_at: '2026-09-30T16:30:00.000Z',
  });

  // 94, 95: CRM1-DQ-013 (invalid updated_at timestamp)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000094',
    first_name: 'BadUpdated1',
    last_name: 'Reject',
    email: 'badupdated1@synthetic.example.co.uk',
    phone: '+1 (555) 017-0026',
    address: '94 Time St',
    company_id: KNOWN_COMPANY_IDS[4]!,
    lead_status: 'New',
    golden_id: '',
    source_system: 'salesforce',
    source_id: 'REJ-94',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T17:00:00.000Z',
    updated_at: '1760889600000',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000095',
    first_name: 'BadUpdated2',
    last_name: 'Reject',
    email: 'badupdated2@synthetic.example.co.uk',
    phone: '+1 (555) 017-0027',
    address: '95 Time St',
    company_id: KNOWN_COMPANY_IDS[0]!,
    lead_status: 'Working',
    golden_id: '',
    source_system: 'hubspot',
    source_id: 'REJ-95',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-09-30T17:30:00.000Z',
    updated_at: 'bad-timestamp',
  });

  // 96, 97, 98: CRM1-DQ-014 (chronology violation: updated_at < created_at)
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000096',
    first_name: 'Chrono1',
    last_name: 'Reject',
    email: 'chrono1@synthetic.example.com',
    phone: '+1 (555) 017-0028',
    address: '96 Chrono Ave',
    company_id: KNOWN_COMPANY_IDS[1]!,
    lead_status: 'New',
    golden_id: '',
    source_system: 'salesforce',
    source_id: 'REJ-96',
    consent_status: 'unknown',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-10-10T10:00:00.000Z',
    updated_at: '2026-10-09T10:00:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000097',
    first_name: 'Chrono2',
    last_name: 'Reject',
    email: 'chrono2@synthetic.example.com',
    phone: '+1 (555) 017-0029',
    address: '97 Chrono Ave',
    company_id: KNOWN_COMPANY_IDS[2]!,
    lead_status: 'Working',
    golden_id: '',
    source_system: 'hubspot',
    source_id: 'REJ-97',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-10-15T12:00:00.000Z',
    updated_at: '2026-10-14T12:00:00.000Z',
  });
  rows.push({
    id: 'c1000001-0000-4000-8000-000000000098',
    first_name: 'Chrono3',
    last_name: 'Reject',
    email: 'chrono3@synthetic.example.com',
    phone: '+1 (555) 017-0030',
    address: '98 Chrono Ave',
    company_id: KNOWN_COMPANY_IDS[3]!,
    lead_status: 'Qualified',
    golden_id: '',
    source_system: 'zoho',
    source_id: 'REJ-98',
    consent_status: 'granted',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-10-20T14:00:00.000Z',
    updated_at: '2026-10-19T14:00:00.000Z',
  });

  // 99, 100: Combo defect rows
  rows.push({
    id: 'invalid-uuid-99',
    first_name: '',
    last_name: 'ComboReject1',
    email: 'bad-email-99',
    phone: '321',
    address: '99 Combo Lane',
    company_id: 'not-valid-fk',
    lead_status: 'InvalidStatus',
    golden_id: '',
    source_system: 'salesforce',
    source_id: 'REJ-99',
    consent_status: 'invalid_status',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-01T10:00:00.000Z',
  });
  rows.push({
    id: 'invalid-uuid-100',
    first_name: '=CMD|calc',
    last_name: '',
    email: 'bad-email-100',
    phone: 'phone-invalid',
    address: 'C'.repeat(300),
    company_id: 'invalid-fk',
    lead_status: 'InvalidStatus2',
    golden_id: '',
    source_system: 'hubspot',
    source_id: 'REJ-100',
    consent_status: 'invalid_status2',
    consent_updated_at: '',
    unsubscribed: 'false',
    unsubscribed_updated_at: '',
    created_at: 'invalid-time',
    updated_at: 'invalid-time',
  });

  return rows;
}

export const CANONICAL_CSV_HEADERS = [
  'id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'address',
  'company_id',
  'lead_status',
  'golden_id',
  'source_system',
  'source_id',
  'consent_status',
  'consent_updated_at',
  'unsubscribed',
  'unsubscribed_updated_at',
  'created_at',
  'updated_at',
] as const;

export function formatRowsToCsv(rows: readonly RawRow[]): string {
  function escapeCsvCell(cell: unknown): string {
    if (cell == null) return '';
    const str = String(cell);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const lines = [CANONICAL_CSV_HEADERS.join(',')];
  for (const row of rows) {
    const line = CANONICAL_CSV_HEADERS.map((h) => escapeCsvCell(row[h] ?? '')).join(',');
    lines.push(line);
  }
  return lines.join('\n') + '\n';
}
