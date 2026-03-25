import { utils, writeFile } from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';

class ExportEngine {
  /**
   * Export an array of objects to an Excel (.xlsx) file with a title.
   * @param {Array} data - The array of objects to export.
   * @param {String} fileNamePrefix - E.g. "Sales_Report"
   * @param {String} titleName - Optional global shop title for the export
   * @param {String} subtitle - Optional specific report title
   */
  static exportToExcel(data, fileNamePrefix = 'Export', titleName = '', subtitle = '') {
    if (!data || data.length === 0) return;
    
    // Auto-generate timestamped filename
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `${fileNamePrefix}_${dateStr}.xlsx`;

    // Initialize worksheet
    const worksheet = utils.json_to_sheet([]);
    
    let currentRow = 0;
    if (titleName) {
      utils.sheet_add_aoa(worksheet, [[titleName]], { origin: `A${currentRow + 1}` });
      currentRow += 1;
    }
    
    if (subtitle) {
      utils.sheet_add_aoa(worksheet, [[subtitle]], { origin: `A${currentRow + 1}` });
      currentRow += 1;
    }
    
    if (currentRow > 0) {
      utils.sheet_add_aoa(worksheet, [[]], { origin: `A${currentRow + 1}` });
      currentRow += 1;
    }

    // SheetJS automatically parses numbers mathematically correctly vs strings
    utils.sheet_add_json(worksheet, data, { origin: `A${currentRow + 1}`, skipHeader: false });
    
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "Report Data");
    
    // Trigger download
    writeFile(workbook, fileName);
  }

  /**
   * Exports an array of objects straight to PDF using jsPDF-AutoTable.
   * Prevents html2canvas CSS parsing errors like unsupported 'oklch' colors.
   */
  static async exportToPDF(data, fileNamePrefix = 'Export', titleName = 'Coffee and Tea Connection', subtitle = 'Sales Report') {
    if (!data || data.length === 0) return;

    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      const dateStr = new Date().toLocaleDateString('en-US');
      const timeStr = new Date().toLocaleTimeString('en-US');
      
      const margin = 14;
      let currentY = 20;

      // Add Title
      if (titleName) {
        pdf.setFontSize(16);
        pdf.setFont("helvetica", "bold");
        pdf.text(titleName, margin, currentY);
        currentY += 8;
      }

      // Add Subtitle & Timestamp
      if (subtitle) {
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(100);
        pdf.text(subtitle, margin, currentY);
        currentY += 6;
      }
      
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(150);
      pdf.text(`Generated on: ${dateStr} at ${timeStr}`, margin, currentY);
      currentY += 8;

      // Generate Table
      const headers = Object.keys(data[0]);
      const body = data.map(obj => Object.values(obj).map(v => typeof v === 'number' ? `PHP ${v.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : String(v)));

      autoTable(pdf, {
        startY: currentY,
        head: [headers],
        body: body,
        theme: 'grid',
        headStyles: { fillColor: [24, 24, 27] }, // zinc-900 like
        styles: { fontSize: 8 }
      });

      // Download the PDF
      const formattedDateStr = new Date().toISOString().split('T')[0];
      pdf.save(`${fileNamePrefix}_${formattedDateStr}.pdf`);
    } catch (err) {
      console.error("Failed to generate PDF:", err);
    }
  }

  /**
   * Captures an HTML element and downloads it as a PNG image.
   * Useful for single charts / KPIs.
   * @param {String} elementId - The ID of the DOM element to snapshot.
   * @param {String} fileNamePrefix - E.g. "Sales_Chart"
   */
  static async exportToImage(elementId, fileNamePrefix = 'Snapshot') {
    const element = document.getElementById(elementId);
    if (!element) return;

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: '#ffffff'
      });
      
      const imgData = canvas.toDataURL('image/png');
      const formattedDateStr = new Date().toISOString().split('T')[0];
      const fileName = `${fileNamePrefix}_${formattedDateStr}.png`;
      
      const link = document.createElement('a');
      link.href = imgData;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Failed to generate Image:", err);
    }
  }
}

export default ExportEngine;
