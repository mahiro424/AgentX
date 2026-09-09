export interface PdfDocument {
  format: 'pdf';
  parserPid: number;
  pages: { number: number; text: string; width: number; height: number }[];
  messages: string[];
}
