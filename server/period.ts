import type {Entry} from './model.ts';
// Keep original invoice/occurrence dates separate from revenue recognition.
export function recognitionMonthOf(e:Entry):string{return (e.kind==='bill'||e.kind==='receipt')&&e.recognitionMonth?e.recognitionMonth:e.date.slice(0,7)}
