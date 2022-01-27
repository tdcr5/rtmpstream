
class StatisticsData {

    _vFrameRate = 0;
    _vBitRate = 0;
    _aFrameRate = 0;
    _aBitRate = 0;
    _ticket = undefined;
    _sec = 5;
    _streamPath = '';

    _v_index = 0;
    _a_index = 0;

    constructor(streamPath) {

        this._streamPath = streamPath;

    }

    incVideoData(videodata, timestamp) {

      // console.log(`--- rtmp video h264 ${videodata.length} ts ${timestamp} vindex ${this._v_index++}`)

        this._vFrameRate++;
        this._vBitRate += videodata.length;
    }
   
    incAudioData(audiodata, timestamp) {

       // console.log(`-- rtmp audio aac ${audiodata.length} ts ${timestamp} aindex ${this._a_index++}`)

        this._aFrameRate++;
        this._aBitRate += audiodata.length;
    }

    start() {

        if (this._ticket) {
            this.stop();
        }

        this._ticket = setInterval(() => {
            
            console.log(`${this._streamPath} vframerate:${Math.floor(this._vFrameRate/this._sec)} \
            vbitrate:${Math.floor(this._vBitRate/this._sec*8/1024/1024)}mbps \
            aframerate:${Math.floor(this._aBitRate/this._sec)} \
            abitrate:${Math.floor(this._aBitRate/this._sec)}`);

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