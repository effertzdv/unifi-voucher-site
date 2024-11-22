/**
 * Import own modules
 */
const log = require('../modules/log');
const unifi = require('../modules/unifi');
const cache = require('../modules/cache');

/**
 * Exports all cache utils
 *
 * @type {{updateCache: (function(): Promise<*>)}}
 */
module.exports = {
    /**
     * Update the cache
     *
     * @return {Promise<*>}
     */
    updateCache: () => {
        return new Promise(async (resolve) => {
            log.debug('[Cache] Requesting UniFi Vouchers...');

            const vouchers = await unifi.list().catch(() => {
                log.error('[Cache] Error requesting vouchers!');
            });

            if(vouchers) {
                cache.vouchers = vouchers;
                cache.updated = new Date().getTime();
                cache.batches = unifi.batches(vouchers);                
                log.debug(`[Cache] Saved ${vouchers.length} voucher(s)`);
            }

            log.debug('[Cache] Requesting UniFi Guests...');

            const guests = await unifi.guests().catch(() => {
                log.error('[Cache] Error requesting guests!');
            });

            if(guests) {
                cache.guests = guests;
                cache.updated = new Date().getTime();
                log.debug(`[Cache] Saved ${guests.length} guest(s)`);
            }

            resolve();
        });
    }
};
