//const logger = require("../../logger").log4js.getLogger('rtmp')
const logger = require("console")

class StatisticsData {

    _vFrameRate = 0;
    _vBitRate = 0;
    _aFrameRate = 0;
    _aBitRate = 0;
    _ticket = undefined;
    _sec = 30;
    _streamPath = '';

    _v_index = 0;
    _a_index = 0;

    constructor(streamPath) {

        this._streamPath = streamPath;

    }

    incVideoData(videodata, timestamp) {

        this._vFrameRate++;
        this._vBitRate += videodata.length;
    }
   
    incAudioData(audiodata, timestamp) {

        this._aFrameRate++;
        this._aBitRate += audiodata.length;
    }

    start() {

        if (this._ticket) {
            this.stop();
        }

        this._ticket = setInterval(() => {
            
            logger.info(`
*************************** RTMP Stat ********************************
steampath:${this._streamPath} 
vframerate:${Math.floor(this._vFrameRate/this._sec)} 
vbitrate:${Math.floor(this._vBitRate/this._sec*8/1024)}kbps 
aframerate:${Math.floor(this._aBitRate/this._sec)} 
abitrate:${Math.floor(this._aBitRate/this._sec)}
*******************************************************************
            `)

            this._vFrameRate = 0;
            this._vBitRate = 0;
            this._aFrameRate = 0;
            this._aBitRate = 0;
        }, this._sec*1000); 

    }

    stop() {

        if (this._ticket) {

            clearInterval(this._ticket);
            this._ticket = undefined;
        }

    }

}

module.exports = StatisticsData;