import React from 'react';

const paths: Record<string, React.ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  statement: (
    <>
      <path d="M8 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-3" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M8 10h8M8 14h8M8 18h5" />
    </>
  ),
  revenue: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M3 10h18m-6 5h2M7 5V3m10 2V3" />
    </>
  ),
  expense: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 7h6m-6 4h6m-6 4h3" />
    </>
  ),
  wallet: (
    <>
      <path d="M20 8V5a2 2 0 0 0-2-2L5 5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h15V8H5a2 2 0 0 1-2-2" />
      <path d="M20 12h-5v5h5m-3-2.5h.01" />
    </>
  ),
  analytics: (
    <>
      <path d="M4 3v17h17M8 15v-4m5 4V6m5 9V9" />
    </>
  ),
  budget: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 12h2m4 0h2m-8 5h2m4 0h2" />
    </>
  ),
  planning: (
    <>
      <path d="m3 17 6-6 4 4 8-10m-6 0h6v6M3 21h18" />
    </>
  ),
  operations: (
    <>
      <rect x="3" y="4" width="7" height="6" rx="1" />
      <rect x="14" y="14" width="7" height="6" rx="1" />
      <path d="M17.5 14V7H10M6.5 10v7H14" />
    </>
  ),
  receivables: (
    <>
      <path d="M3 7h18M6 3h12l3 4v13H3V7Zm6 4v13m-3-8h6" />
    </>
  ),
  workbook: (
    <>
      <path d="M4 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm16 0h-6m6 0v15h-2M7 8h3m-3 4h3" />
    </>
  ),
  masters: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3m2-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 2 4v3" />
    </>
  ),
  audit: (
    <>
      <path d="M3 11a9 9 0 1 1 3 8M3 4v7h7m2-4v5l3 2" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14m-5-5 5 5-5 5" />
    </>
  ),
  arrowUp: (
    <>
      <path d="m5 16 11-11M5 5h11v11" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 11h18m-14 4h3m4 0h3" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  logout: (
    <>
      <path d="M9 4H4v16h5m0-8h12m-4-4 4 4-4 4" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  hospital: (
    <>
      <path d="M5 21V4h14v17M2 21h20M9 8h6m-3-3v6m-3 10v-6h6v6" />
    </>
  ),
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name] ?? paths.overview}
    </svg>
  );
}

export const navigation = [
  {
    label: 'Workspace',
    pages: [
      ['Overview', 'overview'],
      ['Profit & Loss', 'statement'],
      ['Revenue & bills', 'revenue'],
      ['Expense ledger', 'expense'],
      ['Marketing wallet', 'wallet'],
      ['Receivables', 'receivables'],
    ],
  },
  {
    label: 'Planning & intelligence',
    pages: [
      ['Analytics', 'analytics'],
      ['Budget planner', 'budget'],
      ['Planning', 'planning'],
    ],
  },
  {
    label: 'Control centre',
    pages: [
      ['Operations', 'operations'],
      ['Workbook review', 'workbook'],
      ['Masters', 'masters'],
      ['Month close', 'lock'],
      ['User access', 'users'],
      ['Audit trail', 'audit'],
    ],
  },
];
