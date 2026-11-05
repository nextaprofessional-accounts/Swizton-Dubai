import { businessDate, addDays } from './planning-calendar.ts';
import { randomUUID } from 'node:crypto';
import type { Dataset, Masters } from './model.ts';
const hospitals = [
  { id: 'CSH', name: 'Canadian Specialist Hospital', method: 'net-share' as const },
  { id: 'Al Garhoud', name: 'Al Garhoud Private Hospital', method: 'components' as const },
  { id: 'IMH', name: 'International Modern Hospital', method: 'net-share' as const },
];
const rates = {
  Consultation: '0.5',
  Lab: '0.2',
  Radiology: '0.2',
  Procedures: '0.45',
  Room: '0',
  'Surgeon Fee': '1',
  'OT/Anaesthesia': '0',
  Nursing: '0',
  Pharmacy: '0',
  Consumables: '0',
  Reports: '0',
};
export function demoDataset(): Dataset {
  const masters: Masters = {
    hospitals,
    doctors: ['Dr. Chinmay', 'Dr. Tahsin'],
    procedures: [
      'VenaSeal',
      'RFA',
      'UFE',
      'PAE',
      'EVLT',
      'Sclerotherapy',
      'Perforator Ligation',
      'Perforator Ligation + Sclerotherapy',
      'Varicocele',
      'PTCA',
    ],
    staff: ['Corporate Staff', 'Centre Staff'],
    expenseHeads: [
      { name: 'Corporate Staff', category: 'HR Cost' },
      { name: 'Centre Staff', category: 'HR Cost' },
      { name: 'Staff Incentive', category: 'HR Cost' },
      { name: 'Staff Welfare', category: 'HR Cost' },
      { name: 'Referral Marketing', category: 'Marketing Expense' },
      { name: 'Trade License', category: 'Administration Expense' },
      { name: 'Visas', category: 'Administration Expense' },
      { name: 'Legal Attestation', category: 'Administration Expense' },
      { name: 'Vehicle Maintenance', category: 'Administration Expense' },
      { name: 'Bank Charges', category: 'Finance & Other Expense' },
    ],
    rules: [...hospitals.map((h) => h.id), 'Admin Cost Reimbursement', 'OP Consultation'].map(
      (h) => ({
        id: randomUUID(),
        hospital: h,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
        share: '0.45',
        swizton: '0.30',
        doctorPool: '0.70',
        chinmay: '0.20',
        chinmayEligible: h === 'CSH' || h === 'IMH',
        admin: '0.05',
        refundable: '0.05',
        components: { Standard: rates, HMS: rates, 'Insurance-OP': rates },
      }),
    ),
    fx: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      inrPerAed: '25',
      aedPerUsd: '3.6725',
      source: 'SAMPLE — replace with approved RBI monthly rate',
    })),
    targets: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      cases: 20,
    })),
    comparatives: [],
  };
  masters.expenseHeads = masters.expenseHeads.map((h) => ({
    ...h,
    costBehavior: h.category === 'Marketing Expense' ? 'Variable' : 'Fixed',
  }));
  const ds: Dataset = { masters, entries: [], closes: [] };
  for (let month = 1; month <= 6; month++) {
    const date = `2026-${String(month).padStart(2, '0')}-15`;
    for (let j = 0; j < 8 + month * 2; j++)
      ds.entries.push({
        id: randomUUID(),
        date,
        version: 'Actual',
        kind: 'bill',
        hospital: j % 3 === 0 ? 'IMH' : 'CSH',
        patient: `Sample patient ${month}-${j + 1}`,
        procedure: masters.procedures[j % 5],
        doctor: 'Dr. Tahsin',
        billType: 'IP',
        payment: j % 2 ? 'Insurance' : 'Cash',
        invoice: `DEMO-${month}-${j + 1}`,
        gross: String(13000 + month * 900 + j * 100),
        consumables: '1200',
        pharmacyLab: '400',
        regime: 'Standard',
        components: {},
        visits: 1,
        vat: '0',
        tax: '0',
      });
    ds.entries.push(
      {
        id: randomUUID(),
        date,
        version: 'Actual',
        kind: 'expense',
        head: 'Corporate Staff',
        amount: '12500',
        currency: 'AED',
        basis: 'Actual',
        paid: true,
        remarks: 'Sample salary',
        coverageStart: null,
        coverageEnd: null,
      },
      {
        id: randomUUID(),
        date,
        version: 'Actual',
        kind: 'wallet',
        action: 'topup',
        amount: '5000',
        remarks: 'Sample advance',
      },
      {
        id: randomUUID(),
        date,
        version: 'Actual',
        kind: 'wallet',
        action: 'spend',
        costBehavior: 'Variable',
        amount: String(2300 + month * 100),
        remarks: 'Sample ad invoice',
      },
    );
  }
  ds.entries.push({
    id: randomUUID(),
    date: '2026-01-01',
    version: 'Actual',
    kind: 'expense',
    head: 'Trade License',
    amount: '21100',
    currency: 'AED',
    basis: 'Accrual',
    paid: true,
    remarks: 'Sample annual license',
    coverageStart: '2026-01-01',
    coverageEnd: '2026-12-31',
  });
  for (let month = 1; month <= 12; month++)
    for (let j = 0; j < 20; j++)
      ds.entries.push({
        id: randomUUID(),
        kind: 'estimate',
        date: `2026-${String(month).padStart(2, '0')}-20`,
        version: 'Approx',
        hospital: j % 2 ? 'CSH' : 'IMH',
        patient: `Prospect ${month}-${j}`,
        contact: '',
        procedure: masters.procedures[j % 5],
        leadSource: 'Sample referral',
        payment: 'Insurance',
        approval: '7000',
        consumablesRate: '0.1',
        visits: 1,
      });
  ds.operations = [
    {
      id: randomUUID(),
      kind: 'workbook_review',
      name: 'Illustrative reconciliation example — NOT the company workbook',
      sourceSha256: 'sample-only',
      storageId: 'sample',
      createdBy: '00000000-0000-4000-8000-000000000001',
      createdAt: '2026-01-01T00:00:00Z',
      inventory: [
        {
          name: 'Sample statement',
          rows: 12,
          columns: 8,
          formulas: 3,
          missingCaches: 0,
          errors: [{ address: 'H12', error: '#DIV/0!' }],
        },
      ],
      issues: [
        {
          code: 'SAMPLE_REVIEW',
          severity: 'review',
          cells: ['Sample statement!G8'],
          detail: 'Illustrative finding only: review the source before approving an adjustment.',
        },
      ],
      readiness: { matchedChecks: 1, mismatchedChecks: 1, blockedChecks: 1 },
      sourceChecks: [
        {
          kind: 'bill',
          source: 'Sample Bills!Q4',
          status: 'matched',
          expected: '3150',
          computed: '3150',
          delta: '0',
        },
        {
          kind: 'bill',
          source: 'Sample Bills!Q5',
          status: 'mismatch',
          expected: '1000',
          computed: '900',
          delta: '-100',
        },
        {
          kind: 'bill',
          source: 'Sample Bills!Q6',
          status: 'blocked',
          reason: 'Illustrative missing gross amount',
        },
      ],
      baseline: [
        {
          month: '2026-01',
          revenue: '10000',
          swizton: '3000',
          expense: '2000',
          profit: '1000',
          rawInr: '75000',
        },
      ],
      decisions: {
        preserveOriginal: true,
        fxStatus: 'Awaiting approved RBI rates',
        recognition: 'Separate invoice date and recognition month',
      },
    },
  ];
  const cutoff = businessDate();
  for (const [i, hospital] of ['CSH', 'IMH'].entries())
    ds.operations!.push({
      id: randomUUID(),
      kind: 'lead',
      createdBy: '00000000-0000-4000-8000-000000000002',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      patientReference: `Sample prospect ${i + 1}`,
      contact: '',
      hospital,
      procedure: masters.procedures[i],
      expectedDate: addDays(cutoff, 10 + i * 5),
      stage: i ? 'Approved' : 'Qualified',
      probability: i ? '0.8' : '0.5',
      approvalAmount: i ? '15000' : '12000',
      consumablesRate: '0.25',
      collectionLagDays: 15,
      owner: 'Sample Finance',
      source: 'Illustrative pipeline only',
      reason: 'Synthetic planning workspace',
    });
  return ds;
}
