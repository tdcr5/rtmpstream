'use strict';

const VAL32 = 0xFFFFFFFF;

class BufferUtils {

    static readUInt32BE(buffer, offset) {

        let value = buffer.readUInt32BE(offset);
        return value;
    }

    static readString(buffer, offset, end) {

        let value = buffer.slice(offset, end);
        
        return value.toString();
    }

    static readBuffer(buffer, offset, end) {

        let value = buffer.slice(offset, end);
        
        return value;
    }

    static readUInt64BE(buffer, offset) {
        let hi = buffer.readUInt32BE(offset);
        let value = buffer.readUInt32BE(offset + 4);
        if (hi > 0) {
            value += hi * (VAL32 + 1);
        }
        return value;
    }


    static writeUInt32BE(buffer, value, offset) {

        buffer.writeUInt32BE(value, offset);
    }


    static writeUInt64BE(buffer, value, offset) {
        let hi = 0;
        let lo = value;
        if (value > VAL32) {
            hi = (value / (VAL32 + 1)) << 0;
            lo = value % (VAL32 + 1);
        }
        buffer.writeUInt32BE(hi, offset);
        buffer.writeUInt32BE(lo, offset + 4);
    }

}

module.exports = BufferUtils;
