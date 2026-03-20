import { utils, writeFile } from 'xlsx';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

class ExportEngine {
  /**
   * Export an array of objects to an Excel (.xlsx) file.
   * @param {Array} data - The array of objects to export.
   * @param {String} fileNamePrefix - E.g. "Sales_Report"
   */
  static exportToExcel(data, fileNamePrefix = 'Export') {
    if (!data || data.length === 0) return;
    
    // Auto-generate timestamped filename
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `${fileNamePrefix}_${dateStr}.xlsx`;

    // SheetJS automatically parses numbers mathematically correctly vs strings
    const worksheet = utils.json_to_sheet(data);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "Report Data");
    
    // Trigger download
    writeFile(workbook, fileName);
  }

  /**
   * Captures an HTML element and saves it as a branded PDF.
   * @param {String} elementId - The ID of the DOM element to snapshot.
   * @param {String} fileNamePrefix - E.g. "Sales_Report"
   * @param {String} titleName - The branding title shown at the top of the PDF.
   */
  static async exportToPDF(elementId, fileNamePrefix = 'Export', titleName = 'Coffee & Tea: Dashboard Report') {
    const element = document.getElementById(elementId);
    if (!element) {
      console.error(`ExportEngine: Element ID ${elementId} not found.`);
      return;
    }

    try {
      const canvas = await html2canvas(element, { 
        scale: 2, // High resolution
        useCORS: true, 
        logging: false 
      });
      
      const imgData = canvas.toDataURL('image/jpeg', 1.0);
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      // Calculate dimensions to fit A4 page width with margins
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      const margin = 10;
      const contentWidth = pdfWidth - (margin * 2);
      const contentHeight = (canvas.height * contentWidth) / canvas.width;
      
      // Add Branding Header
      const dateStr = new Date().toLocaleDateString();
      const timeStr = new Date().toLocaleTimeString();
      
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "bold");
      pdf.text(titleName, margin, margin + 5);
      
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(150);
      pdf.text(`Generated on: ${dateStr} at ${timeStr}`, margin, margin + 10);
      
      // Add the snapshot image below the header
      pdf.addImage(imgData, 'JPEG', margin, margin + 15, contentWidth, contentHeight);
      
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
