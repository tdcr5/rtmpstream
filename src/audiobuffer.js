


class AudioBuffer {

    _curbuf = undefined;
    _splitbuflen = 0;


    constructor(splitbuflen) {

        this._splitbuflen = splitbuflen;
        this._curbuf = Buffer.alloc(0);

    }

    addBuffer(newbufer) {

        // if (newbufer.length > 48*40*2) {

        //     console.log(`it's a big audio buffer ${newbufer.length}`);
        // }

        this._curbuf = Buffer.concat([this._curbuf, newbufer]);
    }


    split(f) {

        while(this._curbuf.length >= this._splitbuflen) {

            f(this._curbuf.slice(0, this._splitbuflen));

            this._curbuf = this._curbuf.slice(this._splitbuflen);
            
        }

       // console.log(`---- audio buf left ${this._curbuf.length}`)

    }

    splitOnce(f) {

        if(this._curbuf.length >= this._splitbuflen) {

            f(this._curbuf.slice(0, this._splitbuflen));

            this._curbuf = this._curbuf.slice(this._splitbuflen); 
 
        }
    }



}


module.exports = AudioBuffer;