export interface OfficeDocument {
  format: 'docx';
  parserPid: number;
  paragraphs: string[];
  messages: string[];
}
