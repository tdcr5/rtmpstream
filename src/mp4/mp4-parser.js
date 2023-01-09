const BufferUtils = require('./buffer-utils')




class MP4Parser {

    _source = undefined;

    constructor(source) {

        this._source = source;

    }

    parse() {

        let offset = 0;

        while (offset < this._source.length) {

                let len = BufferUtils.readUInt32BE(this._source, offset)

                offset += 4;

                let atomType = BufferUtils.readString(this._source, offset, offset + 4)

                offset += 4;

                let buf;

                if (len == 1) {

                    len =  BufferUtils.readUInt64BE(this._source, offset)

                    offset += 8;

                    buf = BufferUtils.readBuffer(this._source, offset, offset + len - 16);

                    offset += len - 16;


                } else {

                  buf = BufferUtils.readBuffer(this._source,offset, offset + len - 8);

                  offset += len - 8;

                }

                
                console.log(`parse atom type:${atomType} len:${len}`);

        }


        if (offset != this._source.length) {


            console.log(`parse mp4 error`)

        } else {

            console.log(`parse mp4 success`)
        }



    }



}

module.exports = MP4Parser;


