


class SpliteBufferEx {

    _splitlist = [];
    _splitbuflen = 0;
    _totalLen = 0;
    _offsetperbyte = 0;
    _channels = 0;

    constructor(splitbuflen, offsetperbyte, channels) {

        this._splitbuflen = splitbuflen;
        this._offsetperbyte = offsetperbyte;
        this._channels = channels ?? 1;
    }

    canSplite() {

        return this._totalLen >= this._splitbuflen;
    }


    size() {

        return this._totalLen;
    }

    addBuffer(pts, newbufer, newbufer1) {

        let node = {pts};
        node.buf = Buffer.from(newbufer);
        
        if (this._channels > 1) {

            if (newbufer.length !== newbufer1.length) {

                return;
            }
            node.buf1 = Buffer.from(newbufer1)
        }
        
        this._splitlist.push(node);
        this._totalLen += newbufer.length;
    }


    split(f) {

        while(this._totalLen >= this._splitbuflen) {

            this.splitOnce(f);
            
        }

    }

    splitOnce(f) {

        if(this._totalLen >= this._splitbuflen) {

            let buf = Buffer.alloc(this._splitbuflen);
            let buf1 = Buffer.alloc(this._splitbuflen);

            let pts = undefined;
            let needlen = this._splitbuflen; 
            let buflen = 0;

           while(true) {

                if (needlen === 0) {

                    break;
                }

                let first = this._splitlist[0];

                if (!pts) {
                    pts = first.pts
                }

                if (needlen >= first.buf.length) {

                    first.buf.copy(buf, buflen, 0, first.buf.length);

                    if (this._channels > 1) {

                        first.buf1.copy(buf1, buflen, 0, first.buf1.length);
                    }


                    needlen -= first.buf.length
                    buflen += first.buf.length;

                    this._splitlist.shift();

                }  else {

                    first.buf.copy(buf, buflen, 0, needlen);
                    first.buf = first.buf.slice(needlen, first.buf.length);

                    if (this._channels > 1) {

                        first.buf1.copy(buf1, buflen, 0, needlen);
                        first.buf1 = first.buf1.slice(needlen, first.buf1.length);
                    }

                    first.pts += Math.floor(needlen*this._offsetperbyte); 

                    needlen = 0;
                    buflen += needlen;

                }

           }
 
           this._totalLen -= this._splitbuflen;

           f(pts, buf, buf1);
        }
    }


    async splitAsync(f) {

        while(this._totalLen >= this._splitbuflen) {

            await this.splitOnceAsync(f);
            
        }

    }

    async splitOnceAsync(f) {

        if(this._totalLen >= this._splitbuflen) {

            let buf = Buffer.alloc(this._splitbuflen);
            let buf1 = Buffer.alloc(this._splitbuflen);

            let pts = undefined;
            let needlen = this._splitbuflen; 
            let buflen = 0;

           while(true) {

                if (needlen === 0) {

                    break;
                }

                let first = this._splitlist[0];

                if (!pts) {
                    pts = first.pts
                }

                if (needlen >= first.buf.length) {

                    first.buf.copy(buf, buflen, 0, first.buf.length);

                    if (this._channels > 1) {

                        first.buf1.copy(buf1, buflen, 0, first.buf1.length);
                    }


                    needlen -= first.buf.length
                    buflen += first.buf.length;

                    this._splitlist.shift();

                }  else {

                    first.buf.copy(buf, buflen, 0, needlen);
                    first.buf = first.buf.slice(needlen, first.buf.length);

                    if (this._channels > 1) {

                        first.buf1.copy(buf1, buflen, 0, needlen);
                        first.buf1 = first.buf1.slice(needlen, first.buf1.length);
                    }

                    first.pts += Math.floor(needlen*this._offsetperbyte); 

                    needlen = 0;
                    buflen += needlen;

                }

           }
 
           this._totalLen -= this._splitbuflen;

           await f(pts, buf, buf1);
        }
    }

}


module.exports = SpliteBufferEx;