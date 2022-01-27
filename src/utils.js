
const av = require('./av')
 

class Utils {

    static  GenRandomString(strlen = 32) {
        let str = 'abcdefghijklmnopqrstuvwxyz0123456789';    
        let pwd = '';
        for (let i = 0; i < strlen; i++) {
        pwd += str.charAt(Math.floor(Math.random() * str.length));
        }
    
        return pwd
    }


    static Sleep(ms) {

        return new Promise(resolve => {

            setTimeout(() => {
                resolve()
            }, ms);
        });
    }

    static SplitNals(buf) {

        let offset = 2;
        let nals = [];

        if (buf.length < 3) {

            return nals;
        }

        let lastNalStart = -1;

        while(offset < buf.length) {

            if (buf[offset] === 0) {

                offset += 1;

            } else if (buf[offset] === 1) {

                
                if (buf[offset-1] === 0 && buf[offset-2] === 0) {

                    if (lastNalStart !== -1) {

                        let end = buf[offset-3] === 0 ? offset - 3 : offset - 2;

                        nals.push(buf.slice(lastNalStart, end));
                        
                    } 
                    
                    lastNalStart = offset + 1;

                } 

                offset += 3;

            } else {

                offset += 3;
            }
        }


        if (lastNalStart !== -1) {

            nals.push(buf.slice(lastNalStart));
                        
        } 

        return nals;

    }

    static ComposeNalsWithLenHeader(nals) {

        let totallen = 0
        for (let nal of nals) {

            totallen += (nal.length + 4);

        }

        let buf = Buffer.alloc(totallen);

        let offset = 0;
        for (let nal of nals) {

            buf.writeUInt32BE(nal.length, offset);
            offset += 4;

            nal.copy(buf, offset, 0);

            offset += nal.length;
        }

        return buf;
    }

    static PackH264ToFLVAVCSequenceHeader(nals) {

        let spsnal = undefined;
        let ppsnal = undefined;


        for(let nal of nals) {

            let naltype = nal[0]&0x1F;

            if (naltype === 7) {
                spsnal = nal;
            } else if (naltype === 8) {
                ppsnal = nal;
            }
        }

        // headlen(5) + spsnum(1) + spslen(2) + sps + ppsnum(1) + ppslen(2) + pps
        let avcseqheader = Buffer.alloc(5 + 1 + 2 + spsnal.length + 1 + 2 + ppsnal.length); 

        avcseqheader[0] = 0x01; //configVersion
        avcseqheader[1] = spsnal[1]; //avcProfileIndication
        avcseqheader[2] = spsnal[2]; //profileCompatility
        avcseqheader[3] = spsnal[3]; //avcLevelIndication
        avcseqheader[4] = 0xFF; //lensizeminusone, the length of every nal is 4 bytes

        let offset = 5;

        avcseqheader[offset] = 0xE1;
        offset += 1;
        avcseqheader.writeUInt16BE(spsnal.length, offset);
        offset += 2;
        spsnal.copy(avcseqheader, offset, 0);
        offset += spsnal.length;

        avcseqheader[offset] = 0x01;
        offset += 1;
        avcseqheader.writeUInt16BE(ppsnal.length, offset);
        offset += 2;
        ppsnal.copy(avcseqheader, offset, 0);

        return avcseqheader;
    }

    static PackAACToAACSequenceHeader(aacinfo) {

        let objecttype = aacinfo.profile;
        let sampleindex = av.AAC_SAMPLE_RATE.indexOf(aacinfo.sample);
        let channel = aacinfo.channels;

        let config1 = (objecttype<<3)|((sampleindex&0xe)>>1);
        let config2 = ((sampleindex&0x1)<<7)|(channel<<3);

        let aacseqbuf = Buffer.alloc(2);
        aacseqbuf.writeUInt8(config1, 0);
        aacseqbuf.writeUInt8(config2, 1);

        return aacseqbuf;
    }

    static PackAACDataWithADTS(aacinfo, aacraw) {

        let buf = Buffer.alloc(av.ADTS_HEADER_SIZE + aacraw.length);

        buf[0] = 0xff;  
        buf[1] = 0xf1;  

        let byte = 0;  
        byte |= ((aacinfo.profile-1) & 0x03) << 6;  
        byte |= (av.AAC_SAMPLE_RATE.indexOf(aacinfo.sample) & 0x0f) << 2;  
        byte |= (aacinfo.channel & 0x07) >> 2;  
        buf[2] = byte;  

        byte = 0;  
        byte |= (aacinfo.channel & 0x07) << 6;  
        byte |= buf.length >> 11;  
        buf[3] = byte;  

        byte = 0;  
        byte |= buf.length >> 3;  
        buf[4] = byte;  

        byte = 0;  
        byte |= (buf.length & 0x7) << 5;  
        byte |= (0x7ff >> 6) & 0x1f;  
        buf[5] = byte;  

        byte = 0;  
        byte |= (0x7ff & 0x3f) << 2;  
        buf[6] = byte;    

        aacraw.copy(buf, 7, 0);
        
        return buf;  

    }
	
}






module.exports = Utils;