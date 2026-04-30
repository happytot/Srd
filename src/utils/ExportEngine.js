import { utils, writeFile } from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';

/**
 * ExportEngine – Professional exports for the Coffee & Tea Sales Dashboard
 * Fully compatible with the updated SalesReport (Cashier column + clean data)
 */
class ExportEngine {
  /**
   * Export to Excel (.xlsx)
   */
  static exportToExcel(data, fileNamePrefix = 'Export', titleName = '', subtitle = '') {
    if (!data || !Array.isArray(data) || data.length === 0) {
      console.warn('ExportEngine: No data for Excel export');
      return;
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `${fileNamePrefix}_${dateStr}.xlsx`;

    const worksheet = utils.json_to_sheet([]);
    let row = 0;

    if (titleName) utils.sheet_add_aoa(worksheet, [[titleName]], { origin: `A${++row}` });
    if (subtitle) utils.sheet_add_aoa(worksheet, [[subtitle]], { origin: `A${++row}` });
    if (row > 0) utils.sheet_add_aoa(worksheet, [[]], { origin: `A${++row}` });

    utils.sheet_add_json(worksheet, data, { origin: `A${row + 1}`, skipHeader: false });

    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Report');
    writeFile(workbook, fileName);
  }

  /**
   * Export to clean, professional PDF (landscape + smart formatting)
   */
  static async exportToPDF(data, fileNamePrefix = 'Sales_Report', titleName = 'Coffee & Tea Connection', subtitle = 'Sales Report') {
    if (!data || !Array.isArray(data) || data.length === 0) {
      console.warn('ExportEngine: No data for PDF export');
      return;
    }

    try {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      let y = 18;
      const margin = 12;

      // Header
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text(titleName, margin, y);
      y += 8;

      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(80);
      pdf.text(subtitle, margin, y);
      y += 6;

      pdf.setFontSize(9);
      pdf.text(`Generated on: ${new Date().toLocaleDateString('en-US')} at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`, margin, y);
      y += 14;

      // Table data (already cleaned by SalesReport's generateExportData)
      const headers = Object.keys(data[0]);
      const body = data.map(row => headers.map(key => {
        const value = row[key];
        if (typeof value === 'number') {
          return `₱${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        }
        return String(value ?? '');
      }));

      autoTable(pdf, {
        startY: y,
        head: [headers],
        body: body,
        theme: 'grid',
        headStyles: {
          fillColor: [24, 24, 27],
          textColor: 255,
          fontSize: 9,
          fontStyle: 'bold',
          halign: 'center'
        },
        styles: {
          fontSize: 8,
          cellPadding: 3,
          overflow: 'linebreak'
        },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        margin: { left: margin, right: margin }
      });

      const fileDate = new Date().toISOString().split('T')[0];
      pdf.save(`${fileNamePrefix}_${fileDate}.pdf`);

    } catch (err) {
      console.error('ExportEngine: Failed to generate PDF', err);
    }
  }

  /**
   * Export any DOM element as high-quality PNG
   */
  static async exportToImage(elementId, fileNamePrefix = 'Snapshot') {
    const element = document.getElementById(elementId);
    if (!element) {
      console.error(`ExportEngine: Element #${elementId} not found`);
      return;
    }

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false
      });

      const imgData = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = imgData;
      link.download = `${fileNamePrefix}_${new Date().toISOString().split('T')[0]}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('ExportEngine: Image export failed', err);
    }
  }
}

export default ExportEngine;