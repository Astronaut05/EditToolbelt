/**
 * U02's date formats, apart from the rename rules in ./rename, so the page
 * can list them without that code (it loads with the first files).
 */
export type DateFormat =
  'YYYY-MM-DD' | 'YYYYMMDD' | 'YYYY-MM-DD_HH-mm-ss' | 'YYYYMMDD_HHmmss' | 'DD-MM-YYYY';

export const DATE_FORMATS: readonly DateFormat[] = [
  'YYYY-MM-DD',
  'YYYYMMDD',
  'YYYY-MM-DD_HH-mm-ss',
  'YYYYMMDD_HHmmss',
  'DD-MM-YYYY',
];
