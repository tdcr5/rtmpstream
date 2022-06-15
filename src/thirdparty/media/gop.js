// const logger = require("../../logger").log4js.getLogger('default')
const logger = require("console")

class GopCache {

    _cache = [];

    _highwaterlevel = 0;
    _lowwaterlevel = 0;

    _isctrlwaterlevel = false;

    constructor(highwaterlevel = 300, lowwaterlevel = 20) {

        this._highwaterlevel = highwaterlevel;
        this._lowwaterlevel = lowwaterlevel;

    }


    addPacket(avpacket) {


        if (this._isctrlwaterlevel) {


            if (this._cache.length >= this._lowwaterlevel) {


                if (this._cache.length%50 === 0) {
                    logger.warn(`gop cache water level in control, so give up new packet,  ${this._cache.length} packet left`);
                }
                
                return;

            } else {

                this._isctrlwaterlevel = false;
                logger.warn(`gop cache water level back to safeline, so release control`);
            }


        } else {

            if (this._cache.length > this._highwaterlevel) {

                logger.warn(`gop cache is too large, ${this._cache.length} packet left, so start control water level`);
                
                this._isctrlwaterlevel = true;
                return;
            }
        }



        this._cache.push(avpacket);
    }

    isEmpty() {

        return this._cache.length === 0;
    }

    getPacket() {

        return this._cache.shift();
    }

    size() {

        return this._cache.length;
    }

    clear() {

        this._cache.length = 0;
    }

}


module.exports = {GopCache};