export interface SpreadsheetCell {
  type: 'empty' | 'text' | 'number' | 'boolean' | 'date' | 'error' | 'formula' | 'merged';
  mergedInto?: string;
  value: string | number | boolean | null;
  formula: string | null;
  cached: string | number | boolean | null;
}
export interface Spreadsheet {
  format: 'csv' | 'xlsx';
  parserPid: number;
  formulaStatus: 'not-recalculated';
  sheets: { name: string; state: string; rowCount: number; columnCount: number; rows: SpreadsheetCell[][] }[];
}
