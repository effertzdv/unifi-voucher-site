/**
 * Import base packages
 */
const PDFDocument = require('pdfkit');
const ThermalPrinter = require('node-thermal-printer').printer;
const PrinterTypes = require('node-thermal-printer').types;

/**
 * Import own modules
 */
const variables = require('./variables');
const log = require('./log');
const qr = require('./qr');
const translation = require('./translation');

/**
 * Import own utils
 */
const time = require('../utils/time');
const bytes = require('../utils/bytes');
const size = require('../utils/size');

/**
 * Exports a module to add a single voucher an a PDF
 * Build for A4
 */


const logoPath='public/images/logo_grayscale_dark.png' ;
// const logoPath='public/images/voucher-logo.png' ; // add your own logo here

module.exports = (doc, voucher, x,y, colNum, rowNum) => {            
    const a4width= 550 ;
    const a4height= 800 ;
    
    const colWidth=a4width/colNum ;
    const colHeight=a4height/rowNum ;
    const rectLeft=colWidth*x + 10;
    const rectTop=colHeight*y +10 ;
    
    // rectangle around each voucher
    doc.rect( rectLeft, rectTop,  colWidth, colHeight)
    .dash(1, {space: 2})
    .stroke();    

    // add logo in upper right corner
    // note: add 2units from top and right to avoid overlapping the dotted rectange (rectTop+2 and fit width -2)
    doc.image(logoPath, rectLeft + colWidth/2, rectTop+2, {fit: [colWidth/2-2, 75], align: 'left', valign: 'top'});
    
    // we do not show any quotas here (we don't use that)

    // Valdity
    doc.font('Helvetica')
        .dash(1)
        .fontSize(10)
        .text("Valid for " + time(voucher.duration), rectLeft + 10, rectTop+60, { width: colWidth-20 , align: 'center' , underline: true} ) ;
    
    // Code
    doc.font('Helvetica-Bold')
        .fontSize(16)
        .text(`${voucher.code.slice(0, 5)}-${voucher.code.slice(5)}` , rectLeft + 10, rectTop+80, { width: colWidth-20 , align: 'center' } ) ;        

    // SSID
    doc.font('Helvetica')        
        .fontSize(10)
        .text("Connect to WIFI network", rectLeft + 10, rectTop+120, { width: colWidth-20 , align: 'center' }) ;
            
    doc.font('Helvetica-Bold')
        .fontSize(16)
        .text(`${variables.unifiSsid}` , rectLeft + 10, rectTop+135, { width: colWidth-20 , align: 'center' } ) ;        


    doc.font('Helvetica-Oblique')        
        .fontSize(10)
        .text("Enter voucher code and press connect", rectLeft + 10, rectTop+170, { width: colWidth-20 , align: 'center' }) ;            
}
