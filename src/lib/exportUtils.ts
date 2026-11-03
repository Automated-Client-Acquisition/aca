export interface ExportColumn {
  key: string;
  label: string;
  exportFormat?: (value: any) => string;
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

function formatValueForExport(value: any, column: ExportColumn): string {
  if (value === null || value === undefined) return '';
  
  if (column.exportFormat) {
    return column.exportFormat(value);
  }
  
  if (Array.isArray(value)) {
    return value.join('; ');
  }
  
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  
  return String(value);
}

export function exportToCSV(data: any[], columns: ExportColumn[], filename: string): void {
  // Create CSV header
  const header = columns.map(col => `"${col.label}"`).join(',');
  
  // Create CSV rows
  const rows = data.map(row => {
    return columns.map(col => {
      const value = getNestedValue(row, col.key);
      const formatted = formatValueForExport(value, col);
      // Escape quotes and wrap in quotes
      return `"${formatted.replace(/"/g, '""')}"`;
    }).join(',');
  });
  
  const csv = [header, ...rows].join('\n');
  downloadFile(csv, filename, 'text/csv');
}

export function exportToJSON(data: any[], columns: ExportColumn[], filename: string): void {
  const exportData = data.map(row => {
    const obj: any = {};
    columns.forEach(col => {
      obj[col.label] = getNestedValue(row, col.key);
    });
    return obj;
  });
  
  const json = JSON.stringify({
    export_date: new Date().toISOString(),
    total_records: exportData.length,
    data: exportData
  }, null, 2);
  
  downloadFile(json, filename, 'application/json');
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
