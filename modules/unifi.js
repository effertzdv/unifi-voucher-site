/**
 * Import vendor modules
 */
const unifi = require('node-unifi');

/**
 * Import own modules
 */
const variables = require('./variables');
const log = require('./log');
const moment = require('moment');

/**
 * UniFi Settings
 */
const settings = {
    ip: variables.unifiIp,
    port: variables.unifiPort,
    username: variables.unifiUsername,
    password: variables.unifiPassword,
    siteID: variables.unifiSiteId
};

/**
 * Controller session
 */
let controller = null;

/**
 * Start a UniFi controller reusable session
 *
 * @return {Promise<unknown>}
 */
const startSession = () => {
    return new Promise((resolve, reject) => {
        // Check if we have a current session already
        if(controller !== null) {
            resolve();
            return;
        }

        if(settings.username.includes('@')) {
            reject('[UniFi] Incorrect username detected! UniFi Cloud credentials are not supported!');
            return;
        }

        // Create new UniFi controller object
        controller = new unifi.Controller({
            host: settings.ip,
            port: settings.port,
            site: settings.siteID,
            sslverify: false
        });

        // Login to UniFi Controller
        controller.login(settings.username, settings.password).then(() => {
            log.debug('[UniFi] Login successful!');
            resolve();
        }).catch((e) => {
            // Something went wrong so clear the current controller so a user can retry
            controller = null;
            log.error('[UniFi] Error while logging in!');
            log.debug(e);
            reject('[UniFi] Error while logging in!');
        });
    });
}

const internal_batchItemID = (item) => {
    if (item.note != "" && item.note != null) {            
        return { id: "note_" + item.note , name: item.note } ;
    }

    // use create time of no note was given
    // const myDate = new Date(item.create_time * 1000);
    const dateString = moment.unix(item.create_time).format("YYYY-MM-DD HH:mm:ss");
    return { id: "created_" + item.create_time, name: dateString};                
}

/**
 * UniFi module functions
 *
 * @type {{create: (function(*, number=, boolean=): Promise<*>), list: (function(boolean=): Promise<*>), remove: (function(*, boolean=): Promise<*>)}}
 */
const unifiModule = {    

    /**
     * Creates a new UniFi Voucher
     *
     * @param type
     * @param amount
     * @param retry
     * @return {Promise<unknown>}
     */
    create: (type, amount = 1, retry = true, note=null) => {
        return new Promise((resolve, reject) => {
            startSession().then(() => {
                controller.createVouchers(type.expiration, amount, parseInt(type.usage) === 1 ? 1 : 0, note, typeof type.upload !== "undefined" ? type.upload : null, typeof type.download !== "undefined" ? type.download : null, typeof type.megabytes !== "undefined" ? type.megabytes : null).then((voucher_data) => {
                    if(amount > 1) {
                        log.info(`[UniFi] Created ${amount} vouchers`);
                        resolve(true);
                    } else {
                        controller.getVouchers(voucher_data[0].create_time).then((voucher_data_complete) => {
                            const voucher = `${[voucher_data_complete[0].code.slice(0, 5), '-', voucher_data_complete[0].code.slice(5)].join('')}`;
                            log.info(`[UniFi] Created voucher with code: ${voucher}`);
                            resolve(voucher);
                        }).catch((e) => {
                            log.error('[UniFi] Error while getting voucher!');
                            log.debug(e);
                            reject('[UniFi] Error while getting voucher!');
                        });
                    }
                }).catch((e) => {
                    log.error('[UniFi] Error while creating voucher!');
                    log.debug(e);

                    // Check if token expired, if true attempt login then try again
                    if (e.response) {
                        if(e.response.status === 401 && retry) {
                            log.info('[UniFi] Attempting re-authentication & retry...');

                            controller = null;
                            unifiModule.create(type, amount, false).then((e) => {
                                resolve(e);
                            }).catch((e) => {
                                reject(e);
                            });
                        } else {
                            // Something else went wrong lets clear the current controller so a user can retry
                            log.error(`[UniFi] Unexpected ${JSON.stringify({status: e.response.status, retry})} cleanup controller...`);
                            controller = null;
                            reject('[UniFi] Error while creating voucher!');
                        }
                    } else {
                        // Something else went wrong lets clear the current controller so a user can retry
                        log.error('[UniFi] Unexpected cleanup controller...');
                        controller = null;
                        reject('[UniFi] Error while creating voucher!');
                    }
                });
            }).catch((e) => {
                reject(e);
            });
        });
    },

    /**
     * Removes a UniFi Voucher
     *
     * @param id
     * @param retry
     * @return {Promise<unknown>}
     */
    remove: (id, retry = true) => {
        return new Promise((resolve, reject) => {
            startSession().then(() => {
                controller.revokeVoucher(id).then(() => {
                    resolve(true);
                }).catch((e) => {
                    log.error('[UniFi] Error while removing voucher!');
                    log.debug(e);

                    // Check if token expired, if true attempt login then try again
                    if (e.response) {
                        if(e.response.status === 401 && retry) {
                            log.info('[UniFi] Attempting re-authentication & retry...');

                            controller = null;
                            unifiModule.remove(id, false).then((e) => {
                                resolve(e);
                            }).catch((e) => {
                                reject(e);
                            });
                        } else {
                            // Something else went wrong lets clear the current controller so a user can retry
                            log.error(`[UniFi] Unexpected ${JSON.stringify({status: e.response.status, retry})} cleanup controller...`);
                            controller = null;
                            reject('[UniFi] Error while removing voucher!');
                        }
                    } else {
                        // Something else went wrong lets clear the current controller so a user can retry
                        log.error('[UniFi] Unexpected cleanup controller...');
                        controller = null;
                        reject('[UniFi] Error while removing voucher!');
                    }
                });
            }).catch((e) => {
                reject(e);
            });
        });
    },

    /**
     * Returns a list with all UniFi Vouchers
     *
     * @param retry
     * @return {Promise<unknown>}
     */
    list: (retry = true) => {
        return new Promise((resolve, reject) => {
            startSession().then(() => {
                controller.getVouchers().then((vouchers) => {
                    log.info(`[UniFi] Found ${vouchers.length} voucher(s)`);                    
                    resolve(vouchers);
                }).catch((e) => {
                    log.error('[UniFi] Error while getting vouchers!');
                    log.debug(e);

                    // Check if token expired, if true attempt login then try again
                    if (e.response) {
                        if(e.response.status === 401 && retry) {
                            log.info('[UniFi] Attempting re-authentication & retry...');

                            controller = null;
                            unifiModule.list(false).then((e) => {
                                resolve(e);
                            }).catch((e) => {
                                reject(e);
                            });
                        } else {
                            // Something else went wrong lets clear the current controller so a user can retry
                            log.error(`[UniFi] Unexpected ${JSON.stringify({status: e.response.status, retry})} cleanup controller...`);
                            controller = null;
                            reject('[UniFi] Error while getting vouchers!');
                        }
                    } else {
                        // Something else went wrong lets clear the current controller so a user can retry
                        log.error('[UniFi] Unexpected cleanup controller...');
                        controller = null;
                        reject('[UniFi] Error while getting vouchers!');
                    }
                });
            }).catch((e) => {
                reject(e);
            });
        });
    },

    /**
     * Returns a list with all UniFi Guests
     *
     * @param retry
     * @return {Promise<unknown>}
     */
    guests: (retry = true) => {
        return new Promise((resolve, reject) => {
            startSession().then(() => {
                controller.getGuests().then((guests) => {
                    log.info(`[UniFi] Found ${guests.length} guest(s)`);
                    resolve(guests);
                }).catch((e) => {
                    log.error('[UniFi] Error while getting guests!');
                    log.debug(e);

                    // Check if token expired, if true attempt login then try again
                    if (e.response) {
                        if(e.response.status === 401 && retry) {
                            log.info('[UniFi] Attempting re-authentication & retry...');

                            controller = null;
                            unifiModule.guests(false).then((e) => {
                                resolve(e);
                            }).catch((e) => {
                                reject(e);
                            });
                        } else {
                            // Something else went wrong lets clear the current controller so a user can retry
                            log.error(`[UniFi] Unexpected ${JSON.stringify({status: e.response.status, retry})} cleanup controller...`);
                            controller = null;
                            reject('[UniFi] Error while getting guests!');
                        }
                    } else {
                        // Something else went wrong lets clear the current controller so a user can retry
                        log.error('[UniFi] Unexpected cleanup controller...');
                        controller = null;
                        reject('[UniFi] Error while getting guests!');
                    }
                });
            }).catch((e) => {
                reject(e);
            });
        });
    },

    batchItemID: (item) => {
        return internal_batchItemID(item) ;        
    },

    /**
     * Returns a list with all UniFi voucher notes
     *
     * @param vouchers
     * @return Array of batch names
     */
    batches: (vouchers) => {
        let batches= [] ;        

        vouchers.forEach( (voucher) => {            
            let newBatch = internal_batchItemID(voucher) ;
            
            let found = false ;
            batches.forEach( (batch) => {
                if ( batch.id == newBatch.id ) {
                    found = true;
                    return ;
                }}
            );            

            if ( found == false) batches.push(newBatch) ;
        } ) ;        
        return batches ;
    }
}

/**
 * Exports the UniFi module functions
 */
module.exports = unifiModule;
