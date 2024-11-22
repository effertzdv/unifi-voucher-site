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
 * Exports the pdf module for multiple vouchers per page
 */

const colNum=3;
const rowNum=4;

const putVoucherOnPDF = require('./singlevoucheronpdf')


module.exports = {
    /**
     * Generates a (multipage) PDF with vouchers, current no language support
     *
     * @param vouchers     
     * @return {Promise<unknown>}
     */
    pdf: (vouchers) => {
        return new Promise(async (resolve) => {                        
            const doc = new PDFDocument({
                bufferPages: true,
                // A4 page size
                size: 'A4', // [595.28, 841.89],
                margins : {
                    top: 20,
                    bottom: 20,
                    left: 20,
                    right: 20
                }
            });

            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                log.info('[Printer] PDF generation completed!');
                resolve(buffers);
            });

            let row = 0
            let col = 0

            vouchers.every( (voucher) => {
                putVoucherOnPDF(doc, voucher, col, row, colNum, rowNum);
                col = col +1 ;
                if (col > colNum-1) {
                    col =0 ;
                    row = row +1;
                }

                if (row > rowNum-1) {
                    // start on new page
                    doc.addPage();
                    row = 0 ;
                    col = 0 ;
                    return true ;
                }
                return true ;
            });
                        

            doc.end();
        });
    }

    
};
