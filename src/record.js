const beamcoder = require('beamcoder');
const EventEmitter = require('events');
const fs = require('fs');
const av = require('./av');
const gop = require('./gop');
const codec = require('./codec');

const {
    Worker, isMainThread, parentPort, workerData
  } = require('worker_threads');


const endcode = Buffer.from([0, 0, 1, 0xb7]);

const STREAMSTATUS = {

    STOPPED:  0x0,
    RUNNING:  0x1,
    STOPPING: 0x2,

};


class AudioRecordStream {

    _aencoder = undefined;
    _pcms16Conv = undefined;

    _depth = 0;
    _channels = 0;
    _sample = 0;

    _pcm_cache = undefined;
    _pcm_cachenum = 0;
    _pcm_pts = 0;

    _astream = undefined;
}


class VideoRecordStream {

    _width = 0;
    _height = 0;
 
    _rgbConv = undefined;
    _vencoder = undefined;
    _vstream = undefined;
}

class RecordStreamInternal {

    _gopCache = undefined;
   

    _encodeStart = false;
  
    _fileurl = undefined;
    _mp4_mux = undefined;
    _vstream = undefined;
    _arecordstreams = {};
    _vrecordstreams = {};
    //_streamStatus = STREAMSTATUS.STOPPED;

    _isReady = false;

    constructor(fileurl) {

        this._gopCache = new gop.GopCache();

        this._fileurl = fileurl;
        this._mp4_mux = beamcoder.muxer({ format_name: 'mp4' });

    }

    setVideoInfo(width, height, flag) {

        let vrecordstream = new VideoRecordStream();

        vrecordstream._width = width;
        vrecordstream._height = height;
        vrecordstream._vencoder = new codec.VideoEncoder(width, height, av.VideoType.H264);
        vrecordstream._rgbConv = new codec.RGBConvert(width, height);

        vrecordstream._vstream = this._mp4_mux.newStream({
            name: 'h264',
            time_base: [1, 90000],
            interleaved: true }); // Set to false for manual interleaving, true for automatic

          Object.assign(vrecordstream._vstream.codecpar, {
            width: width,
            height: height,
            format: 'yuv420p'
          });

          console.log(`Video Stream: ${vrecordstream._vstream}`);

          this._vrecordstreams[flag] = vrecordstream
    }

    setAudioInfo(sample, channels, depth, flag) {

        let arecordstream = new AudioRecordStream();

        arecordstream._aencoder = new codec.AudioEncoder(av.AudioType.AAC, sample, channels, depth, av.AACProfile.AAC_LC);
        arecordstream._pcms16Conv = new codec.PCM_SignedConverter(sample, channels, depth);

        arecordstream._astream = this._mp4_mux.newStream({
            name: 'aac',
            time_base: [1, sample],
            interleaved: false }); // Set to false for manual interleaving, true for automatic
          Object.assign(arecordstream._astream.codecpar, { // Object.assign copies over all properties
            channels: channels,
            sample_rate: sample,
            format: 's16',
            channel_layout: (channels == 1 ? 'mono' : 'stereo'),
            bits_per_coded_sample: depth,
            block_align: 4, // Should be set for WAV
            bit_rate: sample*channels*depth/8
          });

          console.log(`Audio Stream ${flag}: ${arecordstream._astream}`);

        arecordstream._sample = sample;
        arecordstream._channels = channels;
        arecordstream._depth = depth;

        if (!arecordstream._pcm_cache) {

            arecordstream._pcm_cache = Buffer.alloc(1024*arecordstream._channels*arecordstream._depth/8);
            arecordstream._pcm_cachenum = 0;
        }

        this._arecordstreams[flag] = arecordstream

    }


    pushRGBAData(rgbabuf, timestamp, flag) {

        let apkt = new av.AVPacket();
        apkt.payload = rgbabuf;
        apkt.timestamp = timestamp;
        apkt.avtype = av.AVType.Video;
        apkt.isrgba = true;
        apkt.flag = flag


        this._gopCache.addPacket(apkt);
        this.encode();
    }

    pushI420Data(yuvbuf, timestamp, flag) {

        let apkt = new av.AVPacket();
        apkt.payload = yuvbuf;
        apkt.timestamp = timestamp;
        apkt.avtype = av.AVType.Video;
        apkt.isrgba = false;
        apkt.flag = flag

        this._gopCache.addPacket(apkt);
        this.encode();
    }

    pushPCMData(pcmbuf, timestamp, flag) {

        let apkt = new av.AVPacket();
        apkt.payload = pcmbuf;
        apkt.timestamp = timestamp;
        apkt.avtype = av.AVType.Audio;
        apkt.flag = flag;

        this._gopCache.addPacket(apkt);
        this.encode();
    }
    async encode() {

        if (!this._isReady) {
            return;
        }

        // if (this._streamStatus === STREAMSTATUS.STOPPED) {
        //     return;
        // }

        if (this._gopCache.isEmpty()) {

            // if (this._streamStatus === STREAMSTATUS.STOPPING) {
                
            //     await this._mp4_mux.writeTrailer();
            //     this._streamStatus = STREAMSTATUS.STOPPED;
            // }

            return;
        }

        if (this._encodeStart) {

            return;
        }

        this._encodeStart = true;

        let avpacket = this._gopCache.getPacket();

        if (avpacket.avtype === av.AVType.Video) {

            await this.handleVideo(avpacket);

        } else {

            await this. handleAudio(avpacket);
        }

        this._encodeStart = false;

        this.encode();
    }

    // async videoEncode() {

    //     if (!this._isready) {
    //         return;
    //     }

    //     if (this._videoCache.isEmpty()) {
    //         return;
    //     }

    //     if (this._videoEncodeStart) {

    //         return;
    //     }

    //     this._videoEncodeStart = true;

    //     let avpacket = this._videoCache.getPacket();

    //     await this.handleVideo(avpacket);

    //     this._videoEncodeStart = false;

    //     this.videoEncode();
    // }


    // async audioEncode() {

    //     if (!this._isready) {
    //         return;
    //     }

    //     if (this._audioCache.isEmpty()) {
    //         return;
    //     }

    //     if (this._audioEncodeStart) {

    //         return;
    //     }

    //     this._audioEncodeStart = true;

    //     let avpacket = this._audioCache.getPacket();

    //     await this.handleAudio(avpacket);
        
    //     this._audioEncodeStart = false;

    //     this.audioEncode();
    // }

    async handleVideo(avpacket) {

        let vrecordstream = this._vrecordstreams[avpacket.flag];

        if (!vrecordstream) {
            console.warn(`video recordstream ${avpacket.flag} not found`);
            return;
        }


        let isrgba = avpacket.isrgba;
        let yuvbuf;

        if (isrgba) {

      
            let start = new Date().getTime();
            yuvbuf = await vrecordstream._rgbConv.toYUV(avpacket.payload);

            if (!yuvbuf) {
    
                return;
            }

        } else {

            yuvbuf = avpacket.payload;
        }

        let start = new Date().getTime();
        let pkt = await vrecordstream._vencoder.encodePacket(yuvbuf, avpacket.timestamp);

        if (!this._isReady || !pkt) {
            return;
        }

        console.log(`yuv -> h264 const ${new Date().getTime() - start} `);
      
        pkt.duration = 1;
        pkt.stream_index = vrecordstream._vstream.index;
        pkt.pts = pkt.pts * 90;
        pkt.dts = pkt.pts;
        await this._mp4_mux.writeFrame(pkt);

    }

    async handleAudio(avpacket) {

        let arecordstream = this._arecordstreams[avpacket.flag];

        if (!arecordstream) {
            console.warn(`audio recordstream ${avpacket.flag} not found`);
            return;
        }

        if (!arecordstream._depth || !arecordstream._channels || !arecordstream._sample) {

            console.warn('audio info not set !!')
            return;
        }


        let pcmdata = avpacket.payload;
        let persamplelen = arecordstream._channels*arecordstream._depth/8;
        let totalsamplenum = avpacket.payload.length/persamplelen;
        let leftsamplenum = totalsamplenum;

        while (leftsamplenum > 0) {

            if (arecordstream._pcm_cachenum === 0) {

                arecordstream._pcm_pts = avpacket.timestamp + Math.floor((totalsamplenum - leftsamplenum)*1000/arecordstream._sample);
            }

            if (leftsamplenum + arecordstream._pcm_cachenum >= 1024) {

                let copysamplenum =  1024 - arecordstream._pcm_cachenum;

                pcmdata.copy(arecordstream._pcm_cache, 
                    arecordstream._pcm_cachenum*persamplelen, 
                             (totalsamplenum - leftsamplenum)*persamplelen,
                             (totalsamplenum - leftsamplenum + copysamplenum)*persamplelen);

                leftsamplenum -= copysamplenum;

                let pcmconvbuf = arecordstream._pcm_cache;

                arecordstream._pcm_cache = Buffer.alloc(1024*arecordstream._channels*arecordstream._depth/8);
                arecordstream._pcm_cachenum = 0;

                let pcm_fltpbufs = await arecordstream._pcms16Conv.toPCMFLTP(pcmconvbuf);

                if (!pcm_fltpbufs) {
        
                    continue;
                }

                let pkt = await arecordstream._aencoder.encodePacket(pcm_fltpbufs, arecordstream._pcm_pts);

                if (!this._isReady || !pkt || pkt.pts < 0) {

                    continue;
                }

                pkt.duration = 1;
                pkt.stream_index = arecordstream._astream.index;
                pkt.pts = pkt.pts * arecordstream._sample/1000;
                pkt.dts = pkt.pts;
                await this._mp4_mux.writeFrame(pkt);


            } else {

                pcmdata.copy(arecordstream._pcm_cache, 
                             arecordstream._pcm_cachenum*persamplelen, 
                             (totalsamplenum - leftsamplenum)*persamplelen);

                arecordstream._pcm_cachenum += leftsamplenum;
                leftsamplenum = 0;
            }

        }

        
    }


    async start() {
       
        await this._mp4_mux.openIO({
            filename: this._fileurl
          });
          
        await this._mp4_mux.writeHeader();

        this._isReady = true;

    }

    async stop() {

        await this._mp4_mux.writeTrailer();
        this._isReady = false;

    }

}



class RecordStream  {

    _worker = undefined

    constructor(fileurl) {
        this._worker = new Worker(__filename, {workerData:{fileurl}});
        this._worker.on('error', (error) => {

            console.log(`work thread error occur: ${error.stack}`);
        });

        this._worker.on('exit', code => {

            if (code !== 0) {

                console.log(`Worker stopped with exit code ${code}`);
            }
        });

    
    }

    setVideoInfo(width, height, flag) {

        this._worker.postMessage({cmdtype:'setvideoinfo', 
                                  params:{width, height, flag}});
    }

    setAudioInfo(sample, channels, depth, flag) {

        this._worker.postMessage({cmdtype:'setaudioinfo', 
                                  params:{sample, channels, depth, flag}});
    }


    pushRGBAData(rgbabuf, timestamp, flag) {

        this._worker.postMessage({cmdtype:'pushrgbadata', 
                                  params:{rgbabuf, timestamp, flag}});
    }

    pushI420Data(yuvbuf, timestamp, flag) {

        this._worker.postMessage({cmdtype:'pushi420data', 
                                  params:{yuvbuf, timestamp, flag}});
    }

    pushPCMData(pcmbuf, timestamp, flag) {

        this._worker.postMessage({cmdtype:'pushpcmdata', 
                                  params:{pcmbuf, timestamp, flag}});
    }
   
    start() {
        this._worker.postMessage({cmdtype:'start'});
    }

    stop() {

        this._worker.postMessage({cmdtype:'stop'});
    }

}

function WorkerThread() {


    workerData.recordstream = new RecordStreamInternal(workerData.fileurl);

    parentPort.on('message', msg => {

        let cmdtype = msg.cmdtype;
        let params = msg.params;
        let recordstream = workerData.recordstream;

        switch (cmdtype) {

            case 'start': {

                recordstream.start();
                break;
            }

            case 'stop': {

                recordstream.stop();
                break;
            }

            case 'setvideoinfo': {

                recordstream.setVideoInfo(params.width, params.height, params.flag);

                break;
            }

            case 'setaudioinfo': {

                recordstream.setAudioInfo(params.sample, params.channels, params.depth, params.flag);
                break;
            }

            case 'pushrgbadata': {

                recordstream.pushRGBAData(Buffer.from(params.rgbabuf), params.timestamp, params.flag);
                break;
            }

            case 'pushi420data': {

                recordstream.pushI420Data(Buffer.from(params.yuvbuf), params.timestamp, params.flag);
                break;
            }
            case 'pushpcmdata': {

                recordstream.pushPCMData(Buffer.from(params.pcmbuf), params.timestamp, params.flag);
                break;
            }

        }

    })

}


if (!isMainThread) {

    WorkerThread();

}


module.exports = {RecordStream};