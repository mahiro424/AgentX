import { useEffect, useRef, useState } from 'react';
import type { Spreadsheet, SpreadsheetCell } from '../../shared/contracts/spreadsheet';

const columnName = (index: number): string => index < 26 ? String.fromCharCode(65 + index) : columnName(Math.floor(index / 26) - 1) + columnName(index % 26);
const display = (cell: SpreadsheetCell) => cell.type === 'merged' ? `↖ ${cell.mergedInto}（合并）` : cell.type === 'formula' ? cell.cached === null ? '未计算' : String(cell.cached) : cell.value === null ? '' : String(cell.value);

export function SpreadsheetView({ value, zoom, selectedSheet, selectSheet }: { value: Spreadsheet; zoom: number; selectedSheet: string;
  selectSheet: (name: string) => void }) {
  const sheet = value.sheets.find(item => item.name === selectedSheet) ?? value.sheets[0];
  const [selected, setSelected] = useState<[number, number]>([0, 0]);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { setSelected([0, 0]); if (scroll.current) { scroll.current.scrollTop = 0; scroll.current.scrollLeft = 0; } }, [sheet?.name]);
  if (!sheet) return <p className="muted">工作簿中没有工作表。</p>;
  const cell = sheet.rows[selected[0]]?.[selected[1]], address = `${columnName(selected[1])}${selected[0] + 1}`;
  return <div className="spreadsheet-view" style={{ fontSize: `${14 * zoom / 100}px` }}>
    <p className="sheet-note" role="note">{value.format === 'xlsx' ? '公式未重算；显示的公式数值仅为文件保存的缓存，不代表当前计算结果。' : 'CSV 按文本显示；前导零和公式样式原文保留，不执行公式。'}</p>
    <div className="sheet-cell-info" aria-live="polite"><span>{address} · {cell?.type === 'formula' ? '公式' : '单元格原值'}</span>
      <code>{cell?.formula ? `=${cell.formula}` : cell ? display(cell) || '（空）' : '（空）'}</code></div>
    <div className="sheet-scroll" ref={scroll} tabIndex={0} aria-label={`滚动工作表：${sheet.name}`}>
      <table className="sheet-table" aria-label={sheet.name}>
        <thead><tr><th aria-label="行号" />{Array.from({ length: sheet.columnCount }, (_, column) => <th scope="col" key={column}>{columnName(column)}</th>)}</tr></thead>
        <tbody>{sheet.rows.map((row, rowIndex) => <tr key={rowIndex}><th scope="row">{rowIndex + 1}</th>{row.map((cell, column) =>
          <td key={column} data-selected={selected[0] === rowIndex && selected[1] === column} tabIndex={selected[0] === rowIndex && selected[1] === column ? 0 : -1}
            title={cell.formula ? `=${cell.formula}；未重算缓存：${cell.cached ?? '无'}` : display(cell)} onClick={() => setSelected([rowIndex, column])}
            onKeyDown={event => {
              if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
              event.preventDefault();
              const nextRow = Math.max(0, Math.min(sheet.rowCount - 1, rowIndex + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)));
              const nextColumn = Math.max(0, Math.min(sheet.columnCount - 1, column + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)));
              setSelected([nextRow, nextColumn]);
              scroll.current?.querySelector<HTMLTableElement>('table')?.tBodies[0].rows[nextRow]?.cells[nextColumn + 1]?.focus();
            }}>{display(cell)}{cell.formula && cell.cached !== null && <span className="sheet-cache-label"> 缓存</span>}</td>)}</tr>)}</tbody>
      </table>
      {sheet.rowCount === 0 && <p className="muted">此工作表没有单元格内容。</p>}
    </div>
    <div className="sheet-tabs" role="tablist" aria-label="工作表">{value.sheets.map((item, index) => <button key={item.name} role="tab"
      aria-selected={item.name === sheet.name} tabIndex={item.name === sheet.name ? 0 : -1} onClick={() => selectSheet(item.name)}
      title={`${item.rowCount} 行 × ${item.columnCount} 列${item.state !== 'visible' ? ' · 文件中为隐藏工作表' : ''}`}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? value.sheets.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + value.sheets.length) % value.sheets.length;
        selectSheet(value.sheets[next].name);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
      }}>{item.name}{item.state !== 'visible' ? '（隐藏）' : ''}</button>)}</div>
  </div>;
}
