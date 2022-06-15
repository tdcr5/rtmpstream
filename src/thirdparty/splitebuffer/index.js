


class SpliteBuffer {

    _curbuf = undefined;
    _splitbuflen = 0;


    constructor(splitbuflen) {

        this._splitbuflen = splitbuflen;
        this._curbuf = Buffer.alloc(0);

    }

    canSplite() {

        return this._curbuf.length >= this._splitbuflen;
    }


    size() {

        return this._curbuf.length;
    }

    addBuffer(newbufer) {

        this._curbuf = Buffer.concat([this._curbuf, newbufer]);
    }

    async splitAsync(f) {

        while(this._curbuf.length >= this._splitbuflen) {

           await f(this._curbuf.slice(0, this._splitbuflen));

            this._curbuf = this._curbuf.slice(this._splitbuflen);
            
        }

    }

    async splitOnceAsync(f) {

        if(this._curbuf.length >= this._splitbuflen) {

            await f(this._curbuf.slice(0, this._splitbuflen));

            this._curbuf = this._curbuf.slice(this._splitbuflen); 
 
        }
    }



    split(f) {

        while(this._curbuf.length >= this._splitbuflen) {

            f(this._curbuf.slice(0, this._splitbuflen));

            this._curbuf = this._curbuf.slice(this._splitbuflen);
            
        }

    }

    splitOnce(f) {

        if(this._curbuf.length >= this._splitbuflen) {

            f(this._curbuf.slice(0, this._splitbuflen));

            this._curbuf = this._curbuf.slice(this._splitbuflen); 
 
        }
    }



}


module.exports = SpliteBuffer;