import { utils, writeFile } from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';

/**
 * ExportEngine – Professional exports for the Coffee & Tea Sales Dashboard
 */
class ExportEngine {
  /**
   * Export to Excel (.xlsx)
   */
  static exportToExcel(data, fileNamePrefix = 'Export', titleName = '', subtitle = '', category = '', discount = '') {
    if (!data || !Array.isArray(data) || data.length === 0) {
      console.warn('ExportEngine: No data for Excel export');
      return;
    }

    const dateStr = new Date().toISOString().split('T')[0];
    let finalFileName = fileNamePrefix;

    if (category && category !== 'All Categories') {
      finalFileName += `_${category.replace(/\s+/g, '_')}`;
    }
    if (discount && discount !== 'All Transactions') {
      finalFileName += `_${discount.replace(/\s+/g, '_')}`;
    }
    finalFileName += `_${dateStr}.xlsx`;

    const worksheet = utils.json_to_sheet([]);
    let row = 0;

    if (titleName) utils.sheet_add_aoa(worksheet, [[titleName]], { origin: `A${++row}` });
    
    let finalSubtitle = subtitle;
    if (category && category !== 'All Categories') finalSubtitle += ` - ${category}`;
    if (discount && discount !== 'All Transactions') finalSubtitle += ` - ${discount}`;
    
    if (finalSubtitle) utils.sheet_add_aoa(worksheet, [[finalSubtitle]], { origin: `A${++row}` });
    if (row > 0) utils.sheet_add_aoa(worksheet, [[]], { origin: `A${++row}` });

    utils.sheet_add_json(worksheet, data, { origin: `A${row + 1}`, skipHeader: false });

    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Report');
    writeFile(workbook, finalFileName);
  }

  /**
   * Export to PDF
   */
  static async exportToPDF(data, fileNamePrefix = 'Sales_Report', titleName = 'Coffee & Tea Connection', subtitle = 'Sales Report', dateRangeInfo = '', category = '', discount = '') {
    if (!data || !Array.isArray(data) || data.length === 0) {
      console.warn('ExportEngine: No data for PDF export');
      return;
    }

    try {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      let y = 20;
      const margin = 15;

      // Main Title
      pdf.setFontSize(20);
      pdf.setFont('helvetica', 'bold');
      pdf.text(titleName, margin, y);
      y += 9;

      // Subtitle with Category & Discount
      let finalSubtitle = subtitle;
      if (category && category !== 'All Categories') finalSubtitle += ` - ${category}`;
      if (discount && discount !== 'All Transactions') finalSubtitle += ` - ${discount}`;

      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(80);
      pdf.text(finalSubtitle, margin, y);
      y += 8;

      // Date Range
      if (dateRangeInfo) {
        pdf.setFontSize(11);
        pdf.text(dateRangeInfo, margin, y);
        y += 8;
      }

      // Generated Date
      pdf.setFontSize(9);
      pdf.text(`Generated on: ${new Date().toLocaleDateString('en-US')} at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`, margin, y);
      y += 15;

      // Summary Section
      const totalSales = data.reduce((sum, row) => {
        const amt = row['Amount'] || row['Total'] || 0;
        return sum + (typeof amt === 'string' ? parseFloat(amt.replace(/[^0-9.-]+/g, '')) || 0 : Number(amt) || 0);
      }, 0);

      const transactionCount = data.length;

      pdf.setFontSize(13);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`Total Sales: ${totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, margin, y);
      y += 8;

      pdf.setFontSize(11);
      pdf.text(`Total Transactions: ${transactionCount}`, margin, y);
      y += 18;

      // Main Table
      const headers = Object.keys(data[0]);
      const body = data.map(row => headers.map(key => {
        const value = row[key];
        if (typeof value === 'number') {
          return value.toLocaleString('en-US', { minimumFractionDigits: 2 });
        }
        return String(value ?? '');
      }));

      autoTable(pdf, {
        startY: y,
        head: [headers],
        body: body,
        theme: 'grid',
        headStyles: { fillColor: [24, 24, 27], textColor: 255, fontSize: 9, fontStyle: 'bold', halign: 'center' },
        styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        margin: { left: margin, right: margin }
      });

      // Grand Total
      const finalY = pdf.lastAutoTable ? pdf.lastAutoTable.finalY + 10 : y + 40;
      autoTable(pdf, {
        startY: finalY,
        head: [['', '', '', '', 'GRAND TOTAL', totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 })]],
        body: [],
        theme: 'grid',
        headStyles: { fillColor: [0, 0, 0], textColor: 255, fontSize: 11, fontStyle: 'bold', halign: 'right' },
        styles: { fontSize: 10, fontStyle: 'bold', cellPadding: 6 }
      });

      const fileDate = new Date().toISOString().split('T')[0];
      let finalFileName = fileNamePrefix;
      if (category && category !== 'All Categories') finalFileName += `_${category.replace(/\s+/g, '_')}`;
      if (discount && discount !== 'All Transactions') finalFileName += `_${discount.replace(/\s+/g, '_')}`;
      
      pdf.save(`${finalFileName}_${fileDate}.pdf`);

    } catch (err) {
      console.error('ExportEngine: Failed to generate PDF', err);
      alert('Failed to generate PDF. Please try again.');
    }
  }
}

export default ExportEngine;