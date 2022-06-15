const beamcoder = require('../beamcoder_contextaware');
const av = require('./av');
const gop = require('./gop');
const codec = require('./codec');
// const logger = require("../../logger").log4js.getLogger('rec')
const logger = require("console")

const {
    Worker, isMainThread, parentPort, workerData
  } = require('worker_threads');
const { resolve } = require('path');


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

    _encoder = undefined;

    constructor(fileurl, encoder) {

        this._gopCache = new gop.GopCache();
        this._encoder = encoder;

        this._fileurl = fileurl;
        this._mp4_mux = beamcoder.muxer({ format_name: 'mp4' });

        logger.info(`Record Stream start file:${fileurl}`);

    }

    setVideoInfo(width, height, flag) {

        let vrecordstream = new VideoRecordStream();

        vrecordstream._width = width;
        vrecordstream._height = height;
        vrecordstream._vencoder = new codec.VideoEncoder(width, height, av.VideoType.H264, this._encoder);
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

          logger.info(`Record Stream set video info width:${width} height:${height} flag:${flag}`);
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

        logger.info(`Record Stream set audio info sample:${sample} channels:${channels} depth:${depth} flag:${flag}`);

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

    async handleVideo(avpacket) {

        let vrecordstream = this._vrecordstreams[avpacket.flag];

        if (!vrecordstream) {
            logger.warn(`Record Stream video recordstream ${avpacket.flag} not found`);
            return;
        }


        let isrgba = avpacket.isrgba;
        let yuvbuf;

        if (isrgba) {

      
            let start = new Date().getTime();
            yuvbuf = await vrecordstream._rgbConv.toYUV(avpacket.payload);

            if (!yuvbuf) {
                logger.error(`Record Stream convert rgb to yuv error`);
                return;
            }

        } else {

            yuvbuf = avpacket.payload;
        }

        let start = new Date().getTime();
        let pkt = await vrecordstream._vencoder.encodePacket(yuvbuf, avpacket.timestamp);

        if (!this._isReady || !pkt) {
            logger.warn(`Record Stream H264 encoder fail, may be current frame cache`);
            return;
        }

        pkt.duration = 1;
        pkt.stream_index = vrecordstream._vstream.index;
        pkt.pts = pkt.pts * 90;
        pkt.dts = pkt.pts;
        await this._mp4_mux.writeFrame(pkt);

    }

    async handleAudio(avpacket) {

        let arecordstream = this._arecordstreams[avpacket.flag];

        if (!arecordstream) {

            logger.warn(`Record Stream audio recordstream ${avpacket.flag} not found`);
            return;
        }

        if (!arecordstream._depth || !arecordstream._channels || !arecordstream._sample) {

            logger.warn(`Record Stream audio info not set !!`)
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
        
                    logger.error(`Record Stream convert S16 to fltp error`);
                    continue;
                }

                let pkt = await arecordstream._aencoder.encodePacket(pcm_fltpbufs, arecordstream._pcm_pts);

                if (!this._isReady || !pkt || pkt.pts < 0) {

                    logger.warn(`Record Stream AAC encoder fail, may be current frame cache`);
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

       // this._streamStatus = STREAMSTATUS.RUNNING;

       this._isReady = true;

       logger.info(`Record Stream Start`);

    }

    async stop() {

        if (!this._isReady) {
            logger.info(`Record Stream Stop when not ready`);
            return
        }

        this._isReady = false;
        await this._mp4_mux.writeTrailer();
        //this._streamStatus = STREAMSTATUS.STOPPING;

        logger.info(`Record Stream Stop`);

    }

}



class RecordStream  {

    _worker = undefined
    _sessions = undefined
    
    _callbacks = undefined

    constructor(fileurl, encoder) {
        this._worker = new Worker(__filename, {workerData:{fileurl, encoder}});
        this._worker.on('error', (error) => {

            logger.error(`Record Stream work thread error occur: ${error.stack}`);
        });

        this._worker.on('exit', code => {

            if (code !== 0) {

                logger.error(`Record Stream Worker thread stopped with exit code ${code}`);

            } else {

                logger.info(`Record Stream Worker thread stopped with exit code 0`);
            }
        });

        this._callbacks = new Map();

        this._worker.on('message', msg => {
            
            let cmdtype = msg.cmdtype;

            let f = this._callbacks.get(cmdtype);

            if (!f) {
                console.log(`callback not exist:${cmdtype}`);
                return;
            }

            f(msg.params);

            this._callbacks.delete(cmdtype);
        });

        logger.info(`Record Stream Create Worker Thread Success`);

    
    }

    recvRsp(cmdtype, f) {

        this._callbacks.set(cmdtype, f);
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

    async stop() {

        return new Promise(resolve => {

            this._worker.postMessage({cmdtype:'stop'});
            this.recvRsp('stopped', () => {

                resolve();
            })

        })

        
    }

    async destroy() {

        await this._worker.terminate();
        logger.info(`Record Stream Destroy Worker Thread Success`);
    }

    

}
function WorkerThread() {


    workerData.recordstream = new RecordStreamInternal(workerData.fileurl, workerData.encoder);

    parentPort.on('message', async (msg) => {

        let cmdtype = msg.cmdtype;
        let params = msg.params;
        let recordstream = workerData.recordstream;

        switch (cmdtype) {

            case 'start': {

                recordstream.start();
                break;
            }

            case 'stop': {

                await recordstream.stop();
                parentPort.postMessage({cmdtype:'stopped', params:{}});
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


module.exports = RecordStream;