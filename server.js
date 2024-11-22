/**
 * Import base packages
 */
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const locale = require('express-locale');

/**
 * Import own modules
 */
const variables = require('./modules/variables');
const log = require('./modules/log');
const cache = require('./modules/cache');
const jwt = require('./modules/jwt');
const info = require('./modules/info');
const unifi = require('./modules/unifi');
const print = require('./modules/print');
const printVoucherList = require('./modules/printvoucherlist');
const mail = require('./modules/mail');
const oidc = require('./modules/oidc');

/**
 * Import own middlewares
 */
const authorization = require('./middlewares/authorization');
const flashMessage = require('./middlewares/flashMessage');

/**
 * Import own utils
 */
const {updateCache} = require('./utils/cache');
const types = require('./utils/types');
const time = require('./utils/time');
const bytes = require('./utils/bytes');
const status = require('./utils/status');
const languages = require('./utils/languages');

/**
 * Setup Express app
 */
const app = express();

/**
 * Output info
 */
info();

/**
 * Initialize JWT
 */
if(!variables.authDisabled && variables.authInternalEnabled) {
    jwt.init();
}

/**
 * Trust proxy
 */
app.enable('trust proxy');

/**
 * Set template engine
 */
app.set('view engine', 'ejs');
app.set('views', `${__dirname}/template`);

/**
 * GET /_health - Health check page
 */
app.get('/_health', (req, res) => {
    res.json({
        status: 'UP',
        host: os.hostname(),
        load: process.cpuUsage(),
        mem: process.memoryUsage(),
        uptime: process.uptime()
    });
});

/**
 * Request logger
 */
app.use((req, res, next) => {
    log.info(`[Web]: ${req.originalUrl}`);
    next();
});

/**
 * Serve static public dir
 */
app.use(express.static(`${__dirname}/public`));

/**
 * Initialize OIDC
 */
if(!variables.authDisabled && variables.authOidcEnabled) {
    oidc.init(app);
}

/**
 * Enable locale
 */
app.use(locale({
    "priority": ["accept-language", "default"],
    "default": "en-GB"
}));

/**
 * Enable multer
 */
app.use(multer().none());

/**
 * Enable cookie-parser
 */
app.use(cookieParser());

/**
 * Enable flash-message
 */
app.use(flashMessage);

/**
 * Configure routers
 */
app.get('/', (req, res) => {
    if(variables.serviceWeb) {
        res.redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
    } else {
        res.status(501).send();
    }
});

// Check if web service is enabled
if(variables.serviceWeb) {
    app.get('/login', (req, res) => {
        // Check if authentication is disabled
        if (variables.authDisabled) {
            res.redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
            return;
        }

        const hour = new Date().getHours();
        const timeHeader = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';

        res.render('login', {
            baseUrl: req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : '',
            error: req.flashMessage.type === 'error',
            error_text: req.flashMessage.message || '',
            app_header: timeHeader,
            internalAuth: variables.authInternalEnabled,
            oidcAuth: variables.authOidcEnabled
        });
    });
    app.post('/login', async (req, res) => {
        // Check if internal authentication is enabled
        if(!variables.authInternalEnabled) {
            res.status(501).send();
            return;
        }

        if (typeof req.body === "undefined") {
            res.status(400).send();
            return;
        }

        const passwordCheck = req.body.password === variables.authInternalPassword;

        if (!passwordCheck) {
            res.cookie('flashMessage', JSON.stringify({type: 'error', message: 'Password Invalid!'}), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/login`);
            return;
        }

        res.cookie('authorization', jwt.sign(), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
    });
    app.get('/logout', [authorization.web], (req, res) => {
        // Check if authentication is disabled
        if (variables.authDisabled) {
            res.redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
            return;
        }

        if(req.oidc) {
            res.redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/oidc/logout`);
        } else {
            res.cookie('authorization', '', {httpOnly: true, expires: new Date(0)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/`);
        }
    });
    app.post('/voucher', [authorization.web], async (req, res) => {
        if (typeof req.body === "undefined") {
            res.status(400).send();
            return;
        }

        if(req.body['voucher-type'] !== 'custom') {
            const typeCheck = (variables.voucherTypes).split(';').includes(req.body['voucher-type']);

            if (!typeCheck) {
                res.cookie('flashMessage', JSON.stringify({type: 'error', message: 'Unknown Type!'}), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
                return;
            }
        }

        // Create voucher code        
        let note = null
        if (req.body['voucher-note']) {
            note = req.body['voucher-note'] ;
        }
        
        const voucherCode = await unifi.create(
               types(
                    req.body['voucher-type'] === 'custom' ? `${req.body['voucher-duration']},                    
                    ${req.body['voucher-usage']},
                    ${req.body['voucher-upload-limit']},
                    ${req.body['voucher-download-limit']},
                    ${req.body['voucher-data-limit']};` : req.body['voucher-type'], true
                ),
                parseInt(req.body['voucher-amount']),
                true,
                note,
               ).catch((e) => {
            res.cookie('flashMessage', JSON.stringify({type: 'error', message: e}), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
        });

        if(voucherCode) {
            log.info('[Cache] Requesting UniFi Vouchers...');

            const vouchers = await unifi.list().catch((e) => {
                log.error('[Cache] Error requesting vouchers!');
                res.cookie('flashMessage', JSON.stringify({type: 'error', message: e}), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);                
            });

            if(vouchers) {                
                cache.vouchers = vouchers;
                cache.updated = new Date().getTime();
                cache.batches = unifi.batches(vouchers);
                log.info(`[Cache] Saved ${vouchers.length} voucher(s)`);

                res.cookie('flashMessage', JSON.stringify({type: 'info', message: parseInt(req.body['voucher-amount']) > 1 ? `${req.body['voucher-amount']} Vouchers Created!` : `Voucher Created: ${voucherCode}`}), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
            }
        }
    });
    app.get('/voucher/:id/remove', [authorization.web], async (req, res) => {
        // Revoke voucher code
        const response = await unifi.remove(req.params.id).catch((e) => {
            res.cookie('flashMessage', JSON.stringify({type: 'error', message: e}), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
        });

        if(response) {
            log.info('[Cache] Requesting UniFi Vouchers...');

            const vouchers = await unifi.list().catch((e) => {
                log.error('[Cache] Error requesting vouchers!');
                res.cookie('flashMessage', JSON.stringify({type: 'error', message: e}), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
            });

            if(vouchers) {
                cache.vouchers = vouchers;
                cache.updated = new Date().getTime();
                cache.batches = unifi.batches(vouchers);
                log.info(`[Cache] Saved ${vouchers.length} voucher(s)`);

                res.cookie('flashMessage', JSON.stringify({type: 'info', message: `Voucher Removed!`}), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
            }
        }
    });
    app.get('/voucher/:id/print', [authorization.web], async (req, res) => {
        if(variables.printerType === '') {
            res.status(501).send();
            return;
        }

        const voucher = cache.vouchers.find((e) => {
            return e._id === req.params.id;
        });

        if(voucher) {            
            res.render('components/print', {
                baseUrl: req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : '',
                languages,
                voucher,
                updated: cache.updated
            });
        } else {
            res.status(404);
            res.render('404', {
                baseUrl: req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''
            });
        }
    });
    app.post('/voucher/:id/print', [authorization.web], async (req, res) => {
        if(variables.printerType === '') {
            res.status(501).send();
            return;
        }

        const voucher = cache.vouchers.find((e) => {
            return e._id === req.params.id;
        });

        if(voucher) {
            if(variables.printerType === 'pdf') {
                const buffers = await print.pdf(voucher, req.body.language);
                const pdfData = Buffer.concat(buffers);
                res.writeHead(200, {
                    'Content-Length': Buffer.byteLength(pdfData),
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': `attachment;filename=voucher_${req.params.id}.pdf`
                }).end(pdfData);
            }

            if(variables.printerType === 'escpos') {
                const printResult = await print.escpos(voucher, req.body.language).catch((e) => {
                    res.cookie('flashMessage', JSON.stringify({type: 'error', message: e}), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
                });

                if(printResult) {
                    res.cookie('flashMessage', JSON.stringify({type: 'info', message: `Voucher send to printer!`}), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
                }
            }
        } else {
            res.status(404);
            res.render('404', {
                baseUrl: req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''
            });
        }
    });


    // print multiple vouchers as PDF
    app.get('/vouchers/batch/:batch/pdf', [authorization.web], async (req, res) => {
        if(variables.printerType === '') {
            res.status(501).send();
            return;
        }

        const batchToPrint = req.params.batch ;
        // console.log('batch print filter:', batchToPrint);
        
        const vouchers = cache.vouchers.filter( (e) => {        
            return ( batchToPrint === null || batchToPrint === 'all' || unifi.batchItemID(e).id === batchToPrint ) ;            
        });        

        // console.log('printing vouchers', vouchers)

        if(vouchers) {            
            const buffers = await printVoucherList.pdf(vouchers);
            const pdfData = Buffer.concat(buffers);
            res.writeHead(200, {
                'Content-Length': Buffer.byteLength(pdfData),
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment;filename=voucher_${batchToPrint}.pdf`
            }).end(pdfData);                        
        } else {
            res.status(404);
            res.render('404', {
                baseUrl: req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''
            });
        }
    });


    app.get('/vouchers/batch/:batch/:status/:quota/pdf', [authorization.web], async (req, res) => {
        if(variables.printerType === '') {
            res.status(501).send();
            return;
        }

        const batchToPrint = req.params.batch ;
        const statusToPrint = req.params.status ;
        const quotaToPrint = req.params.quota ;
        
        const vouchers = cache.vouchers.filter((item) => {
            if(statusToPrint === 'expired') {
                return item.status ==="EXPIRED" ;
            }
            if(statusToPrint === 'available') {
                return item.used === 0;
            }

            if(statusToPrint === 'in-use') {
                return item.used > 0;
            }

            return true;
        }).filter((item) => {
            if (item.status !== "EXPIRED") {            
                if(quotaToPrint === 'multi-use') {
                    return item.quota !== 0;
                }

                if(quotaToPrint === 'single-use') {
                    return item.quota === 1;
                }
            }
            return true ;
        }).filter((item) => {
            // true for "all", otherwise compare ids
            return ( batchToPrint == null || batchToPrint =='all' || unifi.batchItemID(item).id === batchToPrint ) ;
        });        

        if(vouchers) {            
            const buffers = await printVoucherList.pdf(vouchers);
            const pdfData = Buffer.concat(buffers);
            res.writeHead(200, {
                'Content-Length': Buffer.byteLength(pdfData),
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment;filename=voucher_${batchToPrint}.pdf`
            }).end(pdfData);                        
        } else {
            res.status(404);
            res.render('404', {
                baseUrl: req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''
            });
        }
    });

    app.get('/voucher/:id/email', [authorization.web], async (req, res) => {
        if(variables.smtpFrom === '' || variables.smtpHost === '' || variables.smtpPort === '') {
            res.status(501).send();
            return;
        }

        const voucher = cache.vouchers.find((e) => {
            return e._id === req.params.id;
        });

        if(voucher) {
            res.render('components/email', {
                baseUrl: req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : '',
                languages,
                voucher,
                updated: cache.updated
            });
        } else {
            res.status(404);
            res.render('404', {
                baseUrl: req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''
            });
        }
    });
    app.post('/voucher/:id/email', [authorization.web], async (req, res) => {
        if(variables.smtpFrom === '' || variables.smtpHost === '' || variables.smtpPort === '') {
            res.status(501).send();
            return;
        }

        if (typeof req.body === "undefined") {
            res.status(400).send();
            return;
        }

        const voucher = cache.vouchers.find((e) => {
            return e._id === req.params.id;
        });

        if(voucher) {
            const emailResult = await mail.send(req.body.email, voucher, req.body.language).catch((e) => {
                res.cookie('flashMessage', JSON.stringify({type: 'error', message: e}), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
            });

            if(emailResult) {
                res.cookie('flashMessage', JSON.stringify({type: 'info', message: 'Email has been sent!'}), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
            }
        } else {
            res.status(404);
            res.render('404', {
                baseUrl: req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''
            });
        }
    });
    app.get('/vouchers', [authorization.web], async (req, res) => {
        if(req.query.refresh) {
            log.info('[Cache] Requesting UniFi Vouchers...');

            const vouchers = await unifi.list().catch((e) => {
                log.error('[Cache] Error requesting vouchers!');
                res.cookie('flashMessage', JSON.stringify({type: 'error', message: e}), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
            });

            if(!vouchers) {
                return;
            }

            log.info('[Cache] Requesting UniFi Guests...');

            const guests = await unifi.guests().catch((e) => {
                log.error('[Cache] Error requesting guests!');
                res.cookie('flashMessage', JSON.stringify({type: 'error', message: e}), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
            });

            if(vouchers && guests) {
                cache.vouchers = vouchers;
                cache.guests = guests;

                cache.batches = unifi.batches(vouchers);                
                cache.updated = new Date().getTime();
                log.info(`[Cache] Saved ${vouchers.length} voucher(s)`);
                log.info(`[Cache] Saved ${guests.length} guest(s)`);

                res.cookie('flashMessage', JSON.stringify({type: 'info', message: 'Synced Vouchers & Guests!'}), {httpOnly: true, expires: new Date(Date.now() + 24 * 60 * 60 * 1000)}).redirect(302, `${req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''}/vouchers`);
            }

            return;
        }

        const user = req.oidc ? await req.oidc.fetchUserInfo() : { email: 'admin' };

        res.render('voucher', {
            baseUrl: req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : '',
            sitename: variables.unifiSiteName,
            gitTag: variables.gitTag,
            gitBuild: variables.gitBuild,
            user: user,
            userIcon: req.oidc ? crypto.createHash('sha256').update(user.email).digest('hex') : '',
            authDisabled: variables.authDisabled,
            info: req.flashMessage.type === 'info',
            info_text: req.flashMessage.message || '',
            error: req.flashMessage.type === 'error',
            error_text: req.flashMessage.message || '',
            timeConvert: time,
            bytesConvert: bytes,
            email_enabled: variables.smtpFrom !== '' && variables.smtpHost !== '' && variables.smtpPort !== '',
            printer_enabled: variables.printerType !== '',
            voucher_types: types(variables.voucherTypes),
            voucher_custom: variables.voucherCustom,
            vouchers: cache.vouchers.filter((item) => {

                if(req.query.status === 'expired') {
                    return item.status ==="EXPIRED" ;
                }

                if(req.query.status === 'available') {
                    return item.used === 0;
                }

                if(req.query.status === 'in-use') {
                    return (item.used > 0) && (item.status!="EXPIRED");
                }

                return true;
            }).filter((item) => {
                if(req.query.quota === 'multi-use') {
                    return item.quota === 0;
                }

                if(req.query.quota === 'single-use') {
                    return item.quota !== 0;
                }

                return true ;
            }).filter((item) => {
                // true for "all", otherwise compare ids
                return ( req.query.batch == null || req.query.batch =='all' || unifi.batchItemID(item).id === req.query.batch ) ;
                
            }).sort((a, b) => {
                if(req.query.sort === 'code') {
                    if (a.code > b.code) return -1;
                    if (a.code < b.code) return 1;
                }

                if(req.query.sort === 'duration') {
                    if (a.duration > b.duration) return -1;
                    if (a.duration < b.duration) return 1;
                }

                if(req.query.sort === 'status') {
                    if (a.used > b.used) return -1;
                    if (a.used < b.used) return 1;
                }
            }),
            updated: cache.updated,
            filters: {
                status: req.query.status,
                quota: req.query.quota,
                batch: req.query.batch,
                batches: cache.batches,
            },
            sort: req.query.sort            
        });
    });
    app.get('/voucher/:id', [authorization.web], async (req, res) => {
        const voucher = cache.vouchers.find((e) => {
            return e._id === req.params.id;
        });
        const guests = cache.guests.filter((e) => {
            return e.voucher_id === req.params.id;
        });

        if(voucher) {
            res.render('components/details', {
                baseUrl: req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : '',
                timeConvert: time,
                bytesConvert: bytes,
                voucher,
                guests,
                updated: cache.updated
            });
        } else {
            res.status(404);
            res.render('404', {
                baseUrl: req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''
            });
        }
    });
    app.get('/status', [authorization.web], async (req, res) => {
        const user = req.oidc ? await req.oidc.fetchUserInfo() : { email: 'admin' };

        res.render('status', {
            baseUrl: req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : '',
            gitTag: variables.gitTag,
            gitBuild: variables.gitBuild,
            user: user,
            userIcon: req.oidc ? crypto.createHash('sha256').update(user.email).digest('hex') : '',
            authDisabled: variables.authDisabled,
            status: status()
        });
    });
}

if(variables.serviceApi) {
    app.get('/api', (req, res) => {
        res.json({
            error: null,
            data: {
                message: 'OK',
                endpoints: [
                    '/api',
                    '/api/types',
                    '/api/voucher/:type',
                    '/api/vouchers'
                ]
            }
        });
    });
    app.get('/api/types', (req, res) => {
        res.json({
            error: null,
            data: {
                message: 'OK',
                types: types(variables.voucherTypes)
            }
        });
    });
    app.get('/api/voucher/:type', [authorization.api], async (req, res) => {
        const typeCheck = (variables.voucherTypes).split(';').includes(req.params.type);

        if(!typeCheck) {
            res.json({
                error: 'Unknown Type!',
                data: {}
            });
            return;
        }

        // Create voucher code
        const voucherCode = await unifi.create(types(req.params.type, true)).catch((e) => {
            res.json({
                error: e,
                data: {}
            });
        });

        await updateCache();

        if(voucherCode) {
            res.json({
                error: null,
                data: {
                    message: 'OK',
                    voucher: voucherCode
                }
            });
        }
    });
    app.get('/api/vouchers', [authorization.api], async (req, res) => {
        res.json({
            error: null,
            data: {
                message: 'OK',
                vouchers: cache.vouchers.map((voucher) => {
                    return {
                        code: `${voucher.code.slice(0, 5)}-${voucher.code.slice(5)}`,
                        type: voucher.quota === 0 ? 'multi' : 'single',
                        duration: voucher.duration,
                        data_limit: voucher.qos_usage_quota ? voucher.qos_usage_quota : null,
                        download_limit: voucher.qos_rate_max_down ? voucher.qos_rate_max_down : null,
                        upload_limit: voucher.qos_rate_max_up ? voucher.qos_rate_max_up : null
                    };
                }),
                updated: cache.updated
            }
        });
    });
}

/**
 * Setup default 404 message
 */
app.use((req, res) => {
    res.status(404);
    res.render('404', {
        baseUrl: req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : ''
    });
});

/**
 * Setup default 500 message
 */
app.use((err, req, res, next) => {
    log.error(err.stack);
    res.status(500);
    res.render('500', {
        baseUrl: req.headers['x-ingress-path'] ? req.headers['x-ingress-path'] : '',
        error: err.stack
    });
});

/**
 * Disable powered by header for security reasons
 */
app.disable('x-powered-by');

/**
 * Start listening on port
 */
app.listen(3000, '0.0.0.0', async () => {
    log.info(`[App] Running on: 0.0.0.0:3000`);
    await updateCache();

    // Run auto sync every 15 minutes
    setInterval(async () => {
        log.info('[Auto Sync] Starting Sync...');
        await updateCache();
    }, 900000);
});
