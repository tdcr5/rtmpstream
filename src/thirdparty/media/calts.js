

class CalTs {

    _srcSample = 0;
    _dstSample = 0;

    _cosumedDstSamplesNum = 0;

    _srcSampleList = undefined;
    _srcTotalSampleNum = 0;
    _removedSrcSamplesNum = 0;

    _inited = false;
    _nextTs = 0;

    constructor(srcSample, dstSample) {

        this._srcSample = srcSample;
        this._dstSample = dstSample;

        this._srcSampleList = [];
    }


    inc(srcSampleNum, ts) {

        this._srcSampleList.push({samplenum:srcSampleNum, ts});

        this._srcTotalSampleNum += srcSampleNum;

        if (!this._inited) {

            this._nextTs = ts;
            this._inited = true;
        }
    }

    getSrcSamplesNum(dstSamplesNum) {

        return Math.floor(dstSamplesNum*this._srcSample/this._dstSample);

    }


    getTs(dstSampleNum) {

        let atLeastSrcSamplesNum = this.getSrcSamplesNum(this._cosumedDstSamplesNum + dstSampleNum);

        if (atLeastSrcSamplesNum > this._srcTotalSampleNum) {

            return -2;
        }

        this._cosumedDstSamplesNum += dstSampleNum;


        while(this._srcSampleList.length > 0) {

            let node = this._srcSampleList[0];

            if (this._removedSrcSamplesNum + node.samplenum >= atLeastSrcSamplesNum) {

                let pts =  this._nextTs;

                this._nextTs = Math.floor(node.ts + (atLeastSrcSamplesNum - this._removedSrcSamplesNum)*1000/this._srcSample);

                return pts
            }

            this._removedSrcSamplesNum += node.samplenum;

            this._srcSampleList.shift()

        }

        return -1;


    }

}



module.exports = CalTs;







