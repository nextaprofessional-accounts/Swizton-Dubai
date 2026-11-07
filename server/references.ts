/** Preserve source text; normalise identity only for duplicate checks. */
export const canonicalReference = (v: string) =>
  v.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
export const invoiceKey = (hospital: string, invoice: string) =>
  `${hospital}:${canonicalReference(invoice)}`;
