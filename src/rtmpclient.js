const NodeRtmpClient = require('node-media-server/src/node_rtmp_client');
const AV = require('node-media-server/src/node_core_av');
const stat = require('./statisticsdata');
const EventEmitter = require('events');
const av = require('./av');
const flv = require('./flv');
const Utils = require('./utils');





class RtmpClient {

    _streamPath = '';
    _ispublish = true;
    _noderc = undefined;
    _stat = undefined;
    _event = undefined;
    _videoinfo = undefined;
    _audioinfo = undefined;
    _sendavcseqheader = false;
    _sendaacseqheader = false;

    _firsttimestamp = 0;
    _firsttimestampset = false;

    _sendpts = -1;

    constructor(streamPath, url, ispublish) {

        this._noderc = new NodeRtmpClient(url);
        this._stat = new stat(streamPath);
        this._streamPath = streamPath;
        this._ispublish = ispublish;
        this._event = new EventEmitter();
        this._videoinfo = new av.VideoInfo();
        this._audioinfo = new av.AudioInfo();

        
        this._noderc.on('video', (videData, timeStamp) => {

            this._stat.incVideoData(videData, timeStamp);
            
            //parse video tag
            let frame_type = (videData[0] >> 4) & 0x0f; //1: key frame 2:inter frame
            let codec_id = videData[0] & 0x0f; //7:h264, 12:h265
            let avpacket_type = videData[1]; //0: avc sequence header 1: nalu
            let composetime = videData.readUIntBE(2, 3);

        //    console.log(`rtmp dts ${timeStamp} composetime ${composetime}`);
        
            if (codec_id != flv.CodecID.AVC) {
                return;
            }
            
            if (frame_type == flv.FrameType.KeyFrame) {

                if (avpacket_type === flv.AVCPacketType.AVCSequenceHeader) {

                    let avcSequenceHeader = Buffer.alloc(videData.length - 5);
                    videData.copy(avcSequenceHeader, 0, 5);
                
                    let offset = 5;
                    let spsnum = avcSequenceHeader[offset]&0x1F;
                    offset += 1;
                    let spslen = avcSequenceHeader.readUInt16BE(offset);
                    offset += 2;
                    let sps = avcSequenceHeader.slice(offset, offset + spslen);
                    offset += spslen;
        
                    let ppsnum = avcSequenceHeader[offset];
                    offset += 1;
                    let ppslen = avcSequenceHeader.readUInt16BE(offset);
                    offset += 2;
                    let pps = avcSequenceHeader.slice(offset, offset + ppslen);
                
                    console.log(`parse avc seq header,sps:${sps[0]&0x1F}  spslen:${spslen} pps:${pps[0]&0x1F} ppslen:${ppslen}`);
        
                    console.assert((offset + ppslen) === avcSequenceHeader.length, 'parse avc config record err!');
        

                    let info = AV.readAVCSpecificConfig(videData);

                    this._videoinfo.vtype = av.VideoType.H264;
                    this._videoinfo.width = info.width;
                    this._videoinfo.height = info.height

                    this._event.emit('videoinfo', this._videoinfo);

                } else if (avpacket_type === flv.AVCPacketType.AVCNalu) {

                    //I Frame

                    let buf = Buffer.alloc(videData.length-5);
                    videData.copy(buf,0,5)

                   // let buf = videData.slice(5);
                    let offset = 0;

                    let nals = [];

                    while(offset < buf.length) {
                        
                        let nallen = buf.readUInt32BE(offset);
                        buf.writeUInt32BE(1, offset);

                        nals.push(buf.slice(offset, offset + nallen + 4));
                        
                        
                        
                        offset += 4;
                        let naltype = buf[offset]&0x1F;
                        let nal = buf.slice(offset, offset + nallen);
                        offset += nallen;

                      //  console.log(`parse i frame, naltype:${naltype} nallen:${nallen}`);

                    }

                    console.assert(offset === buf.length, 'parse i frame error');

                    let packet = new av.AVPacket();
                    packet.payload = buf;
                    packet.nals = nals;
                    packet.iskeyframe = true;
                    packet.timestamp = this.adjustTimeStamp(timeStamp + composetime);
                    packet.avtype = av.AVType.Video;

                    this._event.emit('videodata', packet);
                    
                } else {

                    console.log(`unsupport frametype:${frame_type} avpackettype:${avpacket_type}`);
                }

            } else if (frame_type === flv.FrameType.InterFrame)  {

                if (avpacket_type === flv.AVCPacketType.AVCNalu) {
                //P Frame

                let buf = Buffer.alloc(videData.length-5);
                videData.copy(buf,0,5);

               // let buf = videData.slice(5);
                let offset = 0;

                let nals = [];
                while(offset < buf.length) {
                    
                    let nallen = buf.readUInt32BE(offset);
                    
                    buf.writeUInt32BE(1, offset);

                    nals.push(buf.slice(offset, offset + nallen + 4));

                    offset += 4;
                    let naltype = buf[offset]&0x1F;
                    let nal = buf.slice(offset, offset + nallen);
            
                    offset += nallen;

                 //   console.log(`parse p frame, naltype:${naltype} nallen:${nallen}`);

                }

                console.assert(offset === buf.length, 'parse p frame error');

                let packet = new av.AVPacket();
                
                packet.payload = buf;
                packet.nals = nals;
                packet.iskeyframe = false;
                packet.timestamp = this.adjustTimeStamp(timeStamp + composetime);
                packet.avtype = av.AVType.Video;

                this._event.emit('videodata', packet);

                } else {

                    console.log(`unsupport frametype:${frame_type} avpackettype:${avpacket_type}`);
                }

            } else {

                console.log(`unsupport frametype:${frame_type} avpackettype:${avpacket_type}`);
            }
    
        });


        
    
    
        this._noderc.on('audio', (audioData, timeStamp) => {
    
            this._stat.incAudioData(audioData, timeStamp);

            let soundformat = (audioData[0]>>4)&0x0F; //10: aac
            let soundrate = (audioData[0]>>2)&0x03; //0: 5.5kHz 1 :11kHz 2: 22kHz 3: 44kHz
            let soundsize = (audioData[0]>>1)&0x01; //0: 8bit 1:16bit
            let soundtype = (audioData[0])&0x01; //0: Mono 1:Sterer

            if (soundformat !== flv.SoundFormat.AAC) {
                return;
            }

            let aacpackettype = audioData[1]; //0: aac secquence header 1:aac raw

            if (aacpackettype === flv.AACPackettype.AACSequenceHeader) {

                let aacseqheader = audioData.slice(2);

                let aacinfo = AV.readAACSpecificConfig(audioData)

                this._audioinfo.atype = av.AudioType.AAC;
                this._audioinfo.profile = aacinfo.object_type;
                this._audioinfo.sample = aacinfo.sample_rate;
                this._audioinfo.channels = aacinfo.chan_config;
                this._audioinfo.depth = soundsize ? 16 : 8;

                this._event.emit('audioinfo', this._audioinfo);

                console.log(`parse aac seq header, profile:${this._audioinfo.profile} sample:${this._audioinfo.sample} channel:${this._audioinfo.channels} depth:${this._audioinfo.depth}`);

            } else if (aacpackettype === flv.AACPackettype.AACRaw) {

                let aacraw = audioData.slice(2);
                let aacbuf = Buffer.alloc(aacraw.length);
                aacraw.copy(aacbuf, 0, 0);

               // console.log(`parse aac raw, len:${aacraw.length}`);
               let packet = new av.AVPacket();
               packet.payload = aacbuf;
               packet.timestamp = this.adjustTimeStamp(timeStamp);
               packet.avtype = av.AVType.Audio;

               this._event.emit('audiodata', packet);

            } else {
                console.log(`unsupport aac packettype:${aacpackettype}`);
            }
            
        });

    
        this._noderc.on('status', (info) => {
    
            if (this._ispublish) {

                console.log(`rmtp:${this._streamPath} status: ${info.code}`);

                if (info.code === 'NetStream.Publish.Start') {

                    this.resetSeqHeader();
                    this._event.emit('pushstatus', true);

                } else {

                    this._event.emit('pushstatus', false);
                }

            } else {

                console.log(`rmtp:${this._streamPath} status: ${info.code}`);
            } 
    
        });
    
 
        this._noderc.on('close', () => {

            if (this._ispublish) {

                this._noderc.stop();

            } else {

                console.log('push close');
                this._noderc.stop();
            } 

            this._stat.stop();
         
        });
    };

    adjustTimeStamp(f_timestamp) {

        return f_timestamp;

        if (!this._firsttimestampset) {

           // let cur = new Date().getTime();
            this._firsttimestamp = f_timestamp;
            this._firsttimestampset = true;
          //  this._offsettimestamp = new Date().getTime();
        } else if (f_timestamp < this._firsttimestamp) {

            console.log(`rtmp:${this._streamPath} ts error, reset ts`);
            this._firsttimestamp = f_timestamp;
        }

        return f_timestamp - this._firsttimestamp;
    }

    setVideoInfo(videoinfo){

        this._videoinfo.vtype = videoinfo.vtype;
        this._videoinfo.width = videoinfo.width;
        this._videoinfo.height = videoinfo.height;

    }

    setAudinInfo(audioinfo) {

        this._audioinfo.atype = audioinfo.atype;
        this._audioinfo.profile = audioinfo.profile;
        this._audioinfo.sample = audioinfo.sample;
        this._audioinfo.channels = audioinfo.channels;
        this._audioinfo.depth = audioinfo.depth;
    }

    resetSeqHeader() {

        this._sendavcseqheader = false;
        this._sendaacseqheader = false;
    }

    on(event, callback) {
        this._event.on(event, callback);
      }

    start() {

        this._firsttimestampset = false;

        if (this._ispublish) {
            this.resetSeqHeader();
            this._noderc.startPush();

        } else {

            this._noderc.startPull();
        } 

        
        this._stat.start();
    }

    stop() {

        this._noderc.stop();
        this._stat.stop();
    }

    getPTS() {


        if (this._sendpts < 0) {
            this._sendpts = new Date().getTime();
            return 0;
        }

        return new Date().getTime() - this._sendpts;
    }

    sendAACSequenceHeader() {

        if (this._audioinfo?.atype !== av.AudioType.AAC) {

            return;
        }

        if (!this._sendaacseqheader) {

            let aacsequenceheader = Utils.PackAACToAACSequenceHeader(this._audioinfo);
            let atag = new flv.FLV_AudioTag(flv.SoundFormat.AAC, 
                                            flv.SoundRate.E44HZ, 
                                            this._audioinfo.depth === 8 ? flv.SoundSize.E8BITS : flv.SoundSize.E16BITS,
                                            this._audioinfo.channels === 1 ? flv.SoundType.Mono : flv.SoundType.Stereo,
                                            flv.AACPackettype.AACSequenceHeader,
                                            aacsequenceheader);

            let payload = atag.encode();
            this._noderc.pushAudio(payload, 0);

            this._sendaacseqheader = true;
        }

    }

    pushAudio(audiobuf, f_timestamp) {

        if (this._audioinfo.atype !== av.AudioType.AAC) {

            return;
        }

        this.sendAACSequenceHeader();

        let timestamp = this.adjustTimeStamp(f_timestamp);

       // console.log(`---push rtmp audio ${audiobuf.length} ts:${timestamp}`);
        this.__curaudiopts = timestamp;

      // 

     //   let atdsbuf = Utils.PackAACDataWithADTS(this._audioinfo, audiobuf);

        let atag = new flv.FLV_AudioTag(flv.SoundFormat.AAC, 
                                        flv.SoundRate.E44HZ, 
                                        this._audioinfo.depth === 8 ? flv.SoundSize.E8BITS : flv.SoundSize.E16BITS,
                                        this._audioinfo.channels === 1 ? flv.SoundType.Mono : flv.SoundType.Stereo,
                                        flv.AACPackettype.AACRaw,
                                        audiobuf);

            let payload = atag.encode();
            this._noderc.pushAudio(payload, timestamp);

            this._stat.incAudioData(payload, timestamp);

    }

    pushVideo(videobuf, keyframe, f_timestamp) {

        if (this._videoinfo.vtype !== av.VideoType.H264) {

            return;
        }

        let timestamp = this.adjustTimeStamp(f_timestamp);

      //  console.log(`---push rtmp vide ${videobuf.length} key:${keyframe} ts:${timestamp}`);

        this.__curvideopts = timestamp;

        if (this.__curaudiopts) {

            if (this.__curaudiopts - this.__curvideopts > 300) {

                console.log(`audio diff video pts too large, ${this.__curaudiopts - this.__curvideopts}`);
            }

        }

      

        if (!this._sendavcseqheader) {

            if (!keyframe) {

                return;
            }

            let nals = Utils.SplitNals(videobuf);
            let avcsequenceheader = Utils.PackH264ToFLVAVCSequenceHeader(nals);

            let vtag =  new flv.FLV_VideoTag(flv.FrameType.KeyFrame, 
                                             flv.CodecID.AVC, 
                                             flv.AVCPacketType.AVCSequenceHeader, 
                                             0, 
                                             avcsequenceheader);

            let payload = vtag.encode();
            
            this._noderc.pushVideo(payload, timestamp);

            //to do send seq
            this._sendavcseqheader = true;
        }

        

        let nals = Utils.SplitNals(videobuf);
        let nalsbuf = Utils.ComposeNalsWithLenHeader(nals);
        let frametype = keyframe ? flv.FrameType.KeyFrame : flv.FrameType.InterFrame;

        let vtag =  new flv.FLV_VideoTag(frametype, 
                                         flv.CodecID.AVC, 
                                         flv.AVCPacketType.AVCNalu, 
                                         0, 
                                         nalsbuf);
        let payload = vtag.encode();
        
        this._noderc.pushVideo(payload, timestamp);

        this._stat.incVideoData(payload, timestamp);

    }

}



module.exports = RtmpClient;

