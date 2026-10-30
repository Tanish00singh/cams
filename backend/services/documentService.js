'use strict';
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

/**
 * Generate PDF Certificate for an attendee
 */
async function generateCertificatePdf({ studentName, clubName, eventTitle, eventDate, verifyCode, outputPath }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 40 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // Border & Frame
      doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).lineWidth(3).strokeColor('#15325a').stroke();
      doc.rect(26, 26, doc.page.width - 52, doc.page.height - 52).lineWidth(1).strokeColor('#caa056').stroke();

      // Header
      doc.moveDown(2);
      doc.font('Times-Bold').fontSize(26).fillColor('#0d2440').text('NATIONAL INSTITUTE OF TECHNOLOGY, TIRUCHIRAPPALLI', { align: 'center' });
      doc.moveDown(0.5);
      doc.font('Times-Roman').fontSize(14).fillColor('#b8863b').text('OFFICE OF STUDENT AFFAIRS — CLUB ACTIVITY MANAGEMENT SYSTEM', { align: 'center' });
      
      doc.moveDown(1.5);
      doc.font('Times-Italic').fontSize(18).fillColor('#1c2530').text('Certificate of Participation & Completion', { align: 'center' });
      
      doc.moveDown(1.2);
      doc.font('Times-Roman').fontSize(14).fillColor('#5b6675').text('This is proudly presented to', { align: 'center' });
      
      doc.moveDown(0.6);
      doc.font('Times-Bold').fontSize(24).fillColor('#0d2440').text(studentName, { align: 'center', underline: true });
      
      doc.moveDown(0.8);
      doc.font('Times-Roman').fontSize(13).fillColor('#1c2530').text(
        `for actively participating in and completing the event "${eventTitle}", organized by ${clubName} on ${eventDate}.`,
        { align: 'center', lineGap: 4 }
      );

      // Verification footer
      doc.moveDown(3);
      const bottomY = doc.page.height - 110;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#1c2530').text('Faculty Advisor', 80, bottomY);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#1c2530').text('Dean (Student Welfare)', doc.page.width - 220, bottomY);

      doc.font('Helvetica').fontSize(9).fillColor('#5b6675').text(`Verification ID: ${verifyCode}`, 0, doc.page.height - 60, { align: 'center' });
      doc.text(`Verify online at: /verify/${verifyCode}`, 0, doc.page.height - 48, { align: 'center' });

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate Report PDF stream
 */
function createReportPdf(title, subtitle, headers, rows) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#0d2440').text(title, { align: 'left' });
  if (subtitle) {
    doc.font('Helvetica').fontSize(11).fillColor('#5b6675').text(subtitle, { align: 'left' });
  }
  doc.moveDown(1);
  doc.font('Helvetica').fontSize(9).fillColor('#5b6675').text(`Generated on: ${new Date().toLocaleString()}`);
  doc.moveDown(1);

  // Table header
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0d2440');
  const startX = 40;
  let currentY = doc.y;
  const colWidth = (doc.page.width - 80) / headers.length;

  headers.forEach((h, i) => {
    doc.text(h, startX + i * colWidth, currentY, { width: colWidth - 5, align: 'left' });
  });

  doc.moveDown(0.5);
  doc.strokeColor('#d7dce3').lineWidth(1).moveTo(startX, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
  doc.moveDown(0.5);

  // Table rows
  doc.font('Helvetica').fontSize(9).fillColor('#1c2530');
  rows.forEach((row) => {
    if (doc.y > doc.page.height - 60) {
      doc.addPage();
    }
    currentY = doc.y;
    row.forEach((cell, i) => {
      doc.text(String(cell !== null && cell !== undefined ? cell : ''), startX + i * colWidth, currentY, { width: colWidth - 5, align: 'left' });
    });
    doc.moveDown(0.6);
  });

  return doc;
}

/**
 * Generate Excel workbook
 */
async function createReportExcel(sheetName, columns, data) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map(c => ({
    header: c.header,
    key: c.key,
    width: c.width || 20
  }));

  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0D2440' }
  };

  data.forEach(item => {
    sheet.addRow(item);
  });

  return workbook;
}

module.exports = {
  generateCertificatePdf,
  createReportPdf,
  createReportExcel
};
