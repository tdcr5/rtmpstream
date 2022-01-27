const CodecID = {

    AVC : 7, //h264
    HEVC : 12 //h265

}

const FrameType = {

    KeyFrame : 1,
    InterFrame : 2

}

const AVCPacketType = {

    AVCSequenceHeader : 0,
    AVCNalu : 1,
    
}


const SoundFormat = {

    G711A : 7,
    G711U : 8,
    AAC : 10
}

const SoundRate = {

    E5_5HZ : 0,
    E11HZ : 1,
    E22HZ : 2,
    E44HZ : 3

}

const SoundSize = {

    E8BITS : 0,
    E16BITS : 1

}

const SoundType = {

    Mono : 0,
    Stereo : 1

}

const AACPackettype = {

    AACSequenceHeader : 0,
    AACRaw : 1

}

class FLV_VideoTag {

    frametype;
    codecid;
    avcpackettype;
    compositiontime;
    data;

    constructor(frametype, codecid, avcpackettype, compositiontime, data) {

        this.frametype = frametype;
        this.codecid = codecid;
        this.avcpackettype = avcpackettype;
        this.compositiontime = compositiontime;
        this.data = data;

    }


    encode() {

        let buf = Buffer.alloc(5 + this.data.length);

        buf.writeUInt8((this.frametype<<4) + this.codecid, 0);
        buf.writeUInt8(this.avcpackettype, 1);
        buf.writeUIntBE(this.compositiontime, 2, 3);

        this.data.copy(buf, 5, 0);

        return buf;
    }

}

class FLV_AudioTag {

    soundformat;
    soundrate;
    soundsize;
    soundtype;
    aacpackettype;
    data;

    constructor(soundformat, soundrate, soundsize, soundtype, aacpackettype, data) {

        this.soundformat = soundformat;
        this.soundrate = soundrate;
        this.soundsize = soundsize;
        this.soundtype = soundtype;
        this.aacpackettype = aacpackettype;
        this.data = data;

    } 

    encode() {

        let buf;

        if (this.soundformat === SoundFormat.AAC) {

            buf = Buffer.alloc(2 + this.data.length);

        } else {

            buf = Buffer.alloc(1 + this.data.length);
        }

        buf.writeUInt8((this.soundformat<<4) + (this.soundrate<<2) + (this.soundsize<<1) + this.soundtype, 0);

        let offset = 1;
        if (this.soundformat === SoundFormat.AAC) {

            buf.writeUInt8(this.aacpackettype, offset);
            offset += 1;
        }

        this.data.copy(buf, offset, 0);

        return buf;
    }


}

module.exports = {CodecID, FrameType, AVCPacketType, SoundFormat, SoundRate, SoundSize, SoundType, AACPackettype, FLV_VideoTag, FLV_AudioTag};