const codec = require('./codec');
const RtmpClient = require('./rtmpclient');
const Utils = require('./utils');
const gop = require('./gop');
const av = require('./av');
const EventEmitter = require('events');
const fs = require('fs');
const stat = require('./statisticsdata');



class RtmpPullStream extends EventEmitter {

    _gopCache = undefined;
    _pullClient = undefined;
    _yuvConv = undefined;
    _vdecoder = undefined;
    _adecoder = undefined;
    _pcmfltpConv = undefined;

    _h264file = undefined;
    _yuvfile = undefined;
    _rgbfile = undefined;
    _decoderstart = false;
    

    constructor(pullUrl) {

        super();

        let streamPath = 'rmtp-pull-' + Utils.GenRandomString(6);

        this._pullClient = new RtmpClient(streamPath, pullUrl, false);
        this._gopCache = new gop.GopCache();
     

        // this._h264file = fs.createWriteStream('./1.h264', {encoding:'binary'});
        // this._yuvfile = fs.createWriteStream('./2.yuv', {encoding:'binary'});
        // this._rgbfile = fs.createWriteStream('./3.rgb', {encoding:'binary'});
    
    
        this._pullClient.on('videoinfo', videoinfo => {
    
            console.log(`rtmp:${streamPath} video:${videoinfo.vtype} width:${videoinfo.width} height:${videoinfo.height}`);

            this._vdecoder = new codec.VideoDecoder(videoinfo.vtype);
            this._yuvConv = new codec.YUVConverter(videoinfo.width, videoinfo.height);

            this.emit('vinfo', videoinfo.width, videoinfo.height);
        });
    
        this._pullClient.on('videodata', packet => {
    
            this._gopCache.addPacket(packet);

            this.decord();
    
        });

        this._pullClient.on('audioinfo', audioinfo => {

            console.log(`rtmp:${streamPath} audio:${audioinfo.atype} samples:${audioinfo.sample} channels:${audioinfo.channels} depth:${audioinfo.depth} profile:${audioinfo.profile}`);

            this._adecoder = new codec.AudioDecoder(audioinfo.atype, audioinfo.sample, audioinfo.channels, audioinfo.depth, audioinfo.profile);
            this._pcmfltpConv = new codec.PCM_FLTPConverter(audioinfo.sample, audioinfo.channels, audioinfo.depth);
            this.emit('ainfo', audioinfo.sample, audioinfo.channels, audioinfo.depth);
    
        });

        this._pullClient.on('audiodata', packet => {
    
            this._gopCache.addPacket(packet);

            this.decord()
    
        });

    }

    async decord() {

        if (this._gopCache.isEmpty()) {

            return;
        }

        if (this._decoderstart) {

            return;
        }

        this._decoderstart = true;

        let avpacket = this._gopCache.getPacket();

        if (avpacket.avtype === av.AVType.Video) {

            await this.handleVideo(avpacket);

        } else {

            await this.handleAudio(avpacket);
        }

        this._decoderstart = false;

        this.decord();
    }

    
    async handleVideo(avpacket) {

           // await this._h264file.write(bp.payload);

           let {yuvbuf, timestamp: pts} = await this._vdecoder.decode(avpacket.payload, avpacket.timestamp);

           if (!yuvbuf) {

               return;
           }

          // await this._yuvfile.write(yuvbuf);

           let rgbabuf = await this._yuvConv.toRGBA(yuvbuf);

           if (!rgbabuf) {

                return;
           }

          // await this._rgbfile.write(rgbabuf);

           this.emit('rgbadata', rgbabuf, pts);

    }


    async handleAudio(avpacket) {

    
        let pcm_fltpbufs = await this._adecoder.decode(avpacket.payload);

        if (!pcm_fltpbufs) {

            return;
        }


        let pcm_s16buf = await this._pcmfltpConv.toPCMSigned(pcm_fltpbufs);

        if (!pcm_s16buf) {

            return;
        }


        this.emit('pcmdata', pcm_s16buf, avpacket.timestamp);

 }

 
    start() {

        this._pullClient.start();
 
    }


    stop() {

        this._pullClient.stop(); 
    }

}



class RtmpPushStream extends EventEmitter {

    _pushClient = undefined;

    _videoCache = undefined;
    _audioCache = undefined;

    _rgbConv = undefined;
    _vencoder = undefined;
    _aencoder = undefined;
    _pcms16Conv = undefined;
    _isready = false;
    _encodestart = false;

    _h264file = undefined;
    _yuvfile = undefined;
    _rgbfile = undefined;
    _pcmfile = undefined;
    _aacfile = undefined;
    _pcmfltpfile = undefined;

    _depth = 0;
    _channels = 0;
    _sample = 0;

    _pcm_cache = undefined;
    _pcm_cachenum = 0;
    _pcm_pts = 0;

    _v_index = 0;
    _a_index = 0;

    _stat = undefined;


    constructor(pushUrl) {

        super();

        let streamPath = 'rmtp-push-' + Utils.GenRandomString(6);
        this._pushClient = new RtmpClient(streamPath, pushUrl, true);
        this._videoCache = new gop.GopCache();
        this._audioCache = new gop.GopCache();

        this._stat = new stat('encode ts')
       // this._stat.start();
        // this._h264file = fs.createWriteStream('./4.h264', {encoding:'binary'});
        // this._yuvfile = fs.createWriteStream('./5.yuv', {encoding:'binary'});
        // this._rgbfile = fs.createWriteStream('./6.rgb', {encoding:'binary'});
        // this._pcmfile = fs.createWriteStream('./7.pcm', {encoding:'binary'});
        // this._aacfile = fs.createWriteStream('./8.aac', {encoding:'binary'});
        // this._pcmfltpfile = fs.createWriteStream('./9.fltp', {encoding:'binary'});

        this._pushClient.on('pushstatus', ready => {

             this._isready = ready;

             if (this._isready) {
                this._pushClient.sendAACSequenceHeader();
            }
        })
    
    }

    setVideoInfo(width, height) {

        this._vencoder = new codec.VideoEncoder(width, height, av.VideoType.H264);
        this._rgbConv = new codec.RGBConvert(width, height);

        let vinfo = new av.VideoInfo();
        vinfo.vtype = av.VideoType.H264;
        vinfo.width = width;
        vinfo.height = height;

        this._pushClient.setVideoInfo(vinfo);

    }

    setAudioInfo(sample, channels, depth) {

        this._aencoder = new codec.AudioEncoder(av.AudioType.AAC, sample, channels, depth, av.AACProfile.AAC_LC);
        this._pcms16Conv = new codec.PCM_SignedConverter(sample, channels, depth);

        let ainfo = new av.AudioInfo();
        ainfo.atype = av.AudioType.AAC;
        ainfo.sample = sample;
        ainfo.channels = channels;
        ainfo.depth = depth;
        ainfo.profile = av.AACProfile.AAC_LC;

        this._pushClient.setAudinInfo(ainfo);

        this._sample = sample;
        this._channels = channels;
        this._depth = depth;

        if (!this._pcm_cache) {

            this._pcm_cache = Buffer.alloc(1024*this._channels*this._depth/8);
            this._pcm_cachenum = 0;
        }

        if (this._isready) {
            this._pushClient.sendAACSequenceHeader();
        }
    }


    pushRGBAData(rgbabuf, timestamp) {

        let apkt = new av.AVPacket();
        apkt.payload = rgbabuf;
        apkt.timestamp = timestamp;
        apkt.avtype = av.AVType.Video;
        apkt.isrgba = true;


        this._videoCache.addPacket(apkt);
        this.videoEncode();


    }

    pushI420Data(yuvbuf, timestamp) {

        let apkt = new av.AVPacket();
        apkt.payload = yuvbuf;
        apkt.timestamp = timestamp;
        apkt.avtype = av.AVType.Video;
        apkt.isrgba = false;

        this._videoCache.addPacket(apkt);
        this.videoEncode();
    }

    pushPCMData(pcmbuf, timestamp) {

        let apkt = new av.AVPacket();
        apkt.payload = pcmbuf;
        apkt.timestamp = timestamp;
        apkt.avtype = av.AVType.Audio;

        this._audioCache.addPacket(apkt);
        this.audioEncode();
    }


    async videoEncode() {

        if (!this._isready) {
            return;
        }

        if (this._videoCache.isEmpty()) {
            return;
        }

        if (this._videoEncodeStart) {

            return;
        }

        this._videoEncodeStart = true;

        let avpacket = this._videoCache.getPacket();

        await this.handleVideo(avpacket);

        this._videoEncodeStart = false;

        this.videoEncode();
    }


    async audioEncode() {

        if (!this._isready) {
            return;
        }

        if (this._audioCache.isEmpty()) {
            return;
        }

        if (this._audioEncodeStart) {

            return;
        }

        this._audioEncodeStart = true;

        let avpacket = this._audioCache.getPacket();

        await this.handleAudio(avpacket);
        
        this._audioEncodeStart = false;

        this.audioEncode();
    }

    async handleVideo(avpacket) {

        let isrgba = avpacket.isrgba;
        let yuvbuf;

     //   console.log(`--------------- rtmp push rgba: ${avpacket.payload.length} ts:${avpacket.timestamp} vindex:${this._v_index++}`)

        if (isrgba) {

            //await this._rgbfile.write(avpacket.payload);
            let start = new Date().getTime();
            yuvbuf = await this._rgbConv.toYUV(avpacket.payload);

            if (!yuvbuf) {
    
                return;
            }

          //  console.log(`rgba->yuv cost ${new Date().getTime() - start} ms`);

        } else {

            yuvbuf = avpacket.payload;
        }

       // await this._yuvfile.write(yuvbuf);

        let start = new Date().getTime();
 
        let {buf, keyframe, timestamp:pts} = await this._vencoder.encode(yuvbuf, avpacket.timestamp);

        if (!buf) {
            return;
        }
      
      //  console.log(`yuv->h264 cost ${new Date().getTime() - start} ms`);

      //  await this._h264file.write(buf);

        this._pushClient.pushVideo(buf, keyframe, pts);
        this._stat.incVideoData(buf, pts);

    }

    async handleAudio(avpacket) {

        if (!this._depth || !this._channels || !this._sample) {

            console.warn('audio info not set !!')
            return;
        }

      ///  console.log(`----- audio timestamp ${avpacket.timestamp}`);

      //console.log(`--------------- rtmp push pcm: ${avpacket.payload.length} ts:${avpacket.timestamp} aindex:${this._a_index++}`)

        let pcmdata = avpacket.payload;
        let persamplelen = this._channels*this._depth/8;
        let totalsamplenum = avpacket.payload.length/persamplelen;
        let leftsamplenum = totalsamplenum;


       // console.log(`----- no cache ts ${avpacket.timestamp} totalsample ${totalsamplenum} cache ${this._pcm_cachenum} curpts ${this._pcm_pts}`)

        while (leftsamplenum > 0) {

            if (this._pcm_cachenum === 0) {

                this._pcm_pts = avpacket.timestamp + Math.floor((totalsamplenum - leftsamplenum)*1000/this._sample);
            }

            if (leftsamplenum + this._pcm_cachenum >= 1024) {

                let copysamplenum =  1024 - this._pcm_cachenum;

                pcmdata.copy(this._pcm_cache, 
                             this._pcm_cachenum*persamplelen, 
                             (totalsamplenum - leftsamplenum)*persamplelen,
                             (totalsamplenum - leftsamplenum + copysamplenum)*persamplelen);

                leftsamplenum -= copysamplenum;

                let pcmconvbuf = this._pcm_cache;

                this._pcm_cache = Buffer.alloc(1024*this._channels*this._depth/8);
                this._pcm_cachenum = 0;

                // if (pcmconvbuf[0] === 0 && pcmconvbuf[1] === 0 && pcmconvbuf[2] === 0 && pcmconvbuf[3] === 0)  {

                //     continue;
                // }

                // await this._pcmfile.write(pcmconvbuf);

                let pcm_fltpbufs = await this._pcms16Conv.toPCMFLTP(pcmconvbuf);

                if (!pcm_fltpbufs) {
        
                    continue;
                }

             //   await this._pcmfltpfile.write(pcm_fltpbufs[0]);

             //   console.log(`----- aac timestamp ${this._pcm_pts}`);
                let {buf, timestamp:pts} = await this._aencoder.encode(pcm_fltpbufs, this._pcm_pts);

                if (!buf) {

                    continue;
                }

                // let ainfo = new av.AudioInfo();
                // ainfo.atype = av.AudioType.AAC;
                // ainfo.sample = 48000;
                // ainfo.channels = 1;
                // ainfo.depth = 16;
                // ainfo.profile = av.AACProfile.AAC_LC;

                // let adtsbuf = Utils.PackAACDataWithADTS(ainfo, buf);
                // await this._aacfile.write(adtsbuf);
                

            //    console.log(`--- aac pts ${pts}`)
                this._pushClient.pushAudio(buf, pts);
                this._stat.incAudioData(buf, pts);


            } else {

                pcmdata.copy(this._pcm_cache, 
                             this._pcm_cachenum*persamplelen, 
                             (totalsamplenum - leftsamplenum)*persamplelen);

                this._pcm_cachenum += leftsamplenum;
                leftsamplenum = 0;
            }

        }

        
    }


    start() {
        this._pushClient.start();
    }

    stop() {

        this._pushClient.stop(); 
        this._isready = false;
    }

}

module.exports = {RtmpPullStream, RtmpPushStream};