const beamcoder = require('../beamcoder_contextaware');
const av = require('./av');
const jpg = require('../turbo_jpeg');


function copyYUVtoFrame(yuvbuf, frame) {

    let linesize = frame.linesize;
    let [ydata, udata, vdata] = frame.data;

    if (frame.width === linesize[0]) {

      yuvbuf.copy(ydata, 0, 0, frame.width*frame.height);

    } else {

      for ( let i = 0 ; i < frame.height ; i++ ) {
            yuvbuf.copy(ydata, i*linesize[0], i*frame.width, (i+1)*frame.width);
        }
    }

    if (frame.width === (linesize[1]<<1)) {

      yuvbuf.copy(udata, 0, frame.width*frame.height, frame.width*frame.height + frame.width*frame.height/4);

    } else {

      for ( let i = 0 ; i < frame.height/2 ; i++ ) {
            yuvbuf.copy(udata, i*linesize[1], frame.width*frame.height + i*frame.width/2, frame.width*frame.height + (i+1)*frame.width/2);
        }
    }

    if (frame.width === (linesize[2]<<1)) {

      yuvbuf.copy(vdata, 0, frame.width*frame.height*5/4, frame.width*frame.height*3/2);

    } else {

      for ( let i = 0 ; i < frame.height/2 ; i++ ) {
            yuvbuf.copy(vdata, i*linesize[2], frame.width*frame.height*5/4 + i*frame.width/2, frame.width*frame.height*5/4 + (i+1)*frame.width/2);
        }
    }

}

function copyFrametoYuvbuf(frame, yuvbuf) {

    let linesize = frame.linesize;
    let [ydata, udata, vdata] = frame.data;

    if (frame.width === linesize[0]) {

        ydata.copy(yuvbuf, 0, 0, frame.width*frame.height);

    } else {

        for (let i = 0; i < frame.height; i++) {

            ydata.copy(yuvbuf, frame.width*i, linesize[0]*i, linesize[0]*i + frame.width);
        }
    }

    if (frame.width === (linesize[1]<<1)) {

        udata.copy(yuvbuf, frame.width*frame.height, 0, (frame.width*frame.height>>2));

    } else {
         
        for (let i = 0; i < frame.height/2; i++) {

            udata.copy(yuvbuf, frame.width*frame.height + i*frame.width/2, linesize[1]*i, linesize[1]*i + frame.width/2);
        }
    }

    if (frame.width === (linesize[2]<<1)) {

        vdata.copy(yuvbuf, frame.width*frame.height*5/4, 0, (frame.width*frame.height>>2));

    } else {
        
        for (let i = 0; i < frame.height/2; i++) {

            vdata.copy(yuvbuf, frame.width*frame.height*5/4 + i*frame.width/2, linesize[2]*i, linesize[2]*i + frame.width/2);
        }
    }
}

class VideoDecoder {

    _decoder = undefined;
    _vtype = 0;

    constructor(vtype = av.VideoType.H264) {

        this._vtype = vtype;

        if (this._vtype === av.VideoType.H264) {

            this._decoder = beamcoder.decoder({name:'h264'});

        } else {
            this._decoder = beamcoder.decoder({name:'hevc'});
        }
    }

    async decode(databuf, timestamp) {

        let dec_result = await this._decoder.decode(beamcoder.packet({data:databuf, size:databuf.length, pts:timestamp}));

        if (dec_result.frames.length > 0) {

            let frame = dec_result.frames[0];

            let yuvbuf = Buffer.alloc(frame.width*frame.height*3/2);

            copyFrametoYuvbuf(frame, yuvbuf);

            return {yuvbuf, timestamp:frame.pts};
        }

        return {};
    }

}


class AudioDecoder {

    _decoder = undefined;
    _atype = 0;

    constructor(atype, sample, channels, depth, profile) {

        this._atype = atype;

        let decparams = beamcoder.codecParameters({
            name: 'aac',
            profile: profile - 1,
            bits_per_coded_sample:depth,
            sample_rate: sample,
            channels: channels
          });

        this._decoder = beamcoder.decoder({params : decparams});

    }

    async decode(databuf) {

        let dec_result = await this._decoder.decode(beamcoder.packet({data:databuf, size:databuf.length}));

        if (dec_result.frames.length > 0) {

            let frame = dec_result.frames[0];

            let pcmlenperchannel = frame.nb_samples*4; //fltp 4bytes
           
            let pcm_fltpbufs = [];

            for(let i = 0; i< frame.channels; i++) {

                let pcmbuf = Buffer.alloc(pcmlenperchannel);

                frame.data[i].copy(pcmbuf, 0, 0, pcmlenperchannel);
                pcm_fltpbufs.push(pcmbuf)
            }    

            return pcm_fltpbufs;
        }

        return undefined;
    }

}



class VideoEncoder {

    _encoder = undefined;
    _width = 0;
    _height = 0;
    _vtype = 0;

    constructor(width, height, vtype, encoder) {

        let encodername = encoder?.name ?? 'libx264';
        let fps = encoder?.fps ?? 25;
        let bitrate = encoder?.bitrate ?? 2*1024*1024;
        let privatedata = encoder?.params ?? { preset: 'medium', profile:'baseline', level:'3.1', tune:'zerolatency'};

        this._width = width;
        this._height = height;
        this._vtype = vtype;
       
        let encParams = {
            name: encodername,
            width: width,
            height: height,
            bit_rate: bitrate,
            time_base: [1, 1000],
             framerate: [fps, 1],
             gop_size: fps*2,
            max_b_frames: 0,
            pix_fmt: 'yuv420p',
            priv_data: privatedata,
            thread_count:4
          //  flags:{GLOBAL_HEADER:true}  //extradata can include sps/pps
          };
        
          this._encoder = beamcoder.encoder(encParams);

       //   console.log('Encoder', this._encoder);
          
    }

    async encodePacket(yuvbuf, timestamp) {

        let frame = beamcoder.frame({
            width: this._width,
            height: this._height,
            format: 'yuv420p',
            pts:timestamp
         }).alloc();


         copyYUVtoFrame(yuvbuf, frame);
     
         let packets = await this._encoder.encode(frame);

         if (packets.packets.length > 0) {

            return packets.packets[0];
         }

         return undefined;

    }

    async encode(yuvbuf, timestamp) {

         let pkt = await this.encodePacket(yuvbuf, timestamp);

         if (pkt) {

            let buf = Buffer.alloc(pkt.size);
            pkt.data.copy(buf, 0, 0, pkt.size);

           return {buf, keyframe:pkt.flags.KEY, timestamp:pkt.pts};

         }

        return {};
    }

}



class AudioEncoder {

    _encoder = undefined;
    _atype = 0;
    _profile;
    _depth;
    _sample;
    _channels;
    _channellayout;

    constructor(atype, sample, channels, depth, profile) {

        this._atype = atype;
        this._profile = profile - 1;
        this._sample = sample;
        this._channels = channels;
        this._depth = depth;
        this._channellayout = (channels === 1 ? 'mono' : 'stereo');

       
        let encParams = {
            name: 'aac',
            profile: this._profile,
            sample_rate: this._sample,
            channels: this._channels,
            sample_fmt:'fltp',
            channel_layout: this._channellayout,
            thread_count:4
          };
        
          this._encoder = beamcoder.encoder(encParams);
          //console.log('Encoder', this._encoder);
        
    }

    async encodePacket(pcm_fltpbufs, timestamp) {

        let samplenum = pcm_fltpbufs[0].length/4;

        if (samplenum < 1024) {

            return {};
        }

        let frame = beamcoder.frame({
             format: 'fltp',
             sample_rate: this._sample,
             time_base: [1, 1000],
             channels: this._channels,
             channel_layout: this._channellayout,
             nb_samples:1024,
             pts:timestamp
       
          }).alloc();

        let pcmlenperchannel = samplenum*4;

        for(let i = 0; i < this._channels; i++) {

            pcm_fltpbufs[i].copy(frame.data[i], 0, 0, pcmlenperchannel);
    
        }
     
        let packets = await this._encoder.encode(frame);

        if (packets.packets.length > 0) {

            return packets.packets[0];
        }
 
        return undefined;
    }


    async encode(pcm_fltpbufs, timestamp) {

        let pkt = await this.encodePacket(pcm_fltpbufs, timestamp);

        if (pkt) {

            let buf = Buffer.alloc(pkt.size);
            pkt.data.copy(buf, 0, 0, pkt.size);
    
           return {buf, timestamp:pkt.pts};
        }

        return {};
    }

}

class YUVConverter {

    _yuvfilter = undefined;
    _width = 0;
    _height = 0;

    constructor(width, height) {

        this._width = width;
        this._height = height;
    }

    async toRGBA(yuvbuf) {

        if (!this._yuvfilter) {

            this._yuvfilter = 
                await beamcoder.filterer({ filterType: 'video',
                                           inputParams: [{ width: this._width,
                                                           height: this._height,
                                                           pixelFormat: 'yuv420p',
                                                           timeBase: [1, 25],
                                                           pixelAspect:[this._width, this._height] }],
                                          outputParams: [{ pixelFormat: 'rgba' }],
                                          filterSpec: `scale=${this._width}:${this._height}`
                });
        }



        let frame = beamcoder.frame({format:'yuv420p', width:this._width, height:this._height}).alloc();

         copyYUVtoFrame(yuvbuf, frame);

        let filter_result = await this._yuvfilter.filter([frame]);

        if (filter_result.length > 0 && filter_result[0].frames.length > 0) {

            let rgbabuf = Buffer.alloc(this._width*this._height*4);

            let rgbaframe =  filter_result[0].frames[0];

            if (rgbaframe.linesize[0] === this._width*4) {

                rgbaframe.data[0].copy(rgbabuf, 0, 0, this._width*this._height*4); 

            } else {

                for (let i = 0; i < this._height; i++) {

                    rgbaframe.data[0].copy(rgbabuf, i*this._width*4, i*rgbaframe.linesize[0], i*rgbaframe.linesize[0] + this._width*4);
                }

            }

           return rgbabuf;
        }

        return undefined;
    }
}


class RGBConvert {

    _rgbfilter = undefined;
    _width = 0;
    _height = 0;

    constructor(width, height) {

        this._width = width;
        this._height = height;
    }

    async toYUV(rgbabuf) {

        if (!this._rgbfilter) {

            this._rgbfilter = 
                await beamcoder.filterer({ filterType: 'video',
                                           inputParams: [{ width: this._width,
                                                           height: this._height,
                                                           pixelFormat: 'rgba',
                                                           timeBase: [1, 25],
                                                           pixelAspect:[this._width, this._height] }],
                                          outputParams: [{ pixelFormat: 'yuv420p' }],
                                          filterSpec: `scale=${this._width}:${this._height}`
                });
        }

        let rgbframe = beamcoder.frame({format:'rgba', width:this._width, height:this._height}).alloc();

        if (rgbframe.linesize[0] === this._width*4) {

            rgbabuf.copy(rgbframe.data[0], 0, 0); 

        } else {

            for (let i = 0; i < this._height; i++) {

                rgbabuf.copy(rgbframe.data[0], i*rgbframe.linesize[0], i*this._width*4, (i+1)*this._width*4);
            }
        }

        let start = new Date().getTime();
        let filter_result = await this._rgbfilter.filter([rgbframe]);

        if (filter_result.length > 0 && filter_result[0].frames.length > 0) {

            let yuvbuf = Buffer.alloc(this._width*this._height*3/2);
            let frame = filter_result[0].frames[0];

            //console.log(`---------- not copy rgba->yuv ${new Date().getTime() - start}`)

            copyFrametoYuvbuf(frame, yuvbuf);
           return yuvbuf;
        }

        return undefined;
    }

}


class PCM_FLTPConverter {

    _fltpfilter = undefined;
    _sample = 0;
    _channels = 0;
    _depth = 0;
    _sformat = 's16';
    _channellayout = 'mono';

    constructor(sample, channels, depth) {

        this._sample = sample;
        this._channels = channels;
        this._depth = depth;
        this._channellayout = (this._channels === 1 ? 'mono' : 'stereo');
        
        if (depth === 8) {
            this._sformat = 's8';

        } else if (depth === 16) {

            this._sformat = 's16';

        } else {
            this._sformat = 's32';
        }
    }

    async toPCMSigned(pcm_fltpbufs) {

        if (!this._fltpfilter) {

            

            this._fltpfilter = await beamcoder.filterer({ filterType: 'audio',
                                                        inputParams: [
                                                        {
                                                            sampleRate: this._sample,
                                                            sampleFormat: 'fltp',
                                                            channelLayout: this._channellayout,
                                                            timeBase: [1, 1000]
                                                        }
                                                        ],
                                                        outputParams: [
                                                        {
                                                            sampleRate: this._sample,
                                                            sampleFormat: this._sformat,
                                                            channelLayout: this._channellayout
                                                        }
                                                        ],
                                                        filterSpec: `aresample=${this._sample}, aformat=sample_fmts=${this._sformat}:channel_layouts=${this._channellayout}`
                                                    });

        }

        let samplenum = pcm_fltpbufs[0].length/4;


        let frame = beamcoder.frame({
             format: 'fltp',
             sample_rate: this._sample,
             time_base: [1, 1000],
             channels: this._channels,
             nb_samples:samplenum,
             channel_layout:this._channellayout
          }).alloc();


        let pcmlenperchannel = samplenum*4;

        for(let i = 0; i < this._channels; i++) {

            pcm_fltpbufs[i].copy(frame.data[i], 0, 0, pcmlenperchannel);
    
        }

        let filter_result = await this._fltpfilter.filter([frame]);

        if (filter_result.length > 0 && filter_result[0].frames.length > 0) {

            let pcm_sbuf = Buffer.alloc(samplenum*this._channels*this._depth/8);
            filter_result[0].frames[0].data[0].copy(pcm_sbuf, 0, 0, samplenum*this._channels*this._depth/8); 

           return pcm_sbuf;
        }

        return undefined;
    }
}


class PCM_SignedConverter {

    _fltpfilter = undefined;
    _sample = 0;
    _channels = 0;
    _depth = 0;
    _sformat = 's16';
    _channellayout = 'mono';

    constructor(sample, channels, depth) {

        this._sample = sample;
        this._channels = channels;
        this._depth = depth;
        this._channellayout = (this._channels === 1 ? 'mono' : 'stereo');

        if (depth === 8) {
            this._sformat = 's8';

        } else if (depth === 16) {

            this._sformat = 's16';

        } else {
            this._sformat = 's32';
        }
 
    }

    async toPCMFLTP(pcm_sbuf) {

        if (!this._fltpfilter) {

            this._fltpfilter = await beamcoder.filterer({ filterType: 'audio',
                                                        inputParams: [
                                                        {
                                                            sampleRate: this._sample,
                                                            sampleFormat: this._sformat,
                                                            channelLayout: this._channellayout,
                                                            timeBase: [1, 1000]
                                                        }
                                                        ],
                                                        outputParams: [
                                                        {
                                                            sampleRate: this._sample,
                                                            sampleFormat: 'fltp',
                                                            channelLayout: this._channellayout
                                                        }
                                                        ],
                                                        filterSpec: `aformat=sample_fmts=fltp:channel_layouts=${this._channellayout}`
                                                    });

        }


        let samplenum = pcm_sbuf.length/this._channels*8/this._depth;

        let frame = beamcoder.frame({
             format: this._sformat,
             sample_rate: this._sample,
             time_base: [1, 1000],
             channels: this._channels,
             channel_layout:this._channellayout,
             nb_samples:samplenum
          }).alloc();

          pcm_sbuf.copy(frame.data[0], 0, 0);
    
        
        let filter_result = await this._fltpfilter.filter([frame]);

        if (filter_result.length > 0 && filter_result[0].frames.length > 0) {

            let pcmlenperchannel = samplenum*4;
           
            let frame =  filter_result[0].frames[0];
            let pcm_fltpbufs = [];
            
            for(let i = 0; i < this._channels; i++) {

               // console.log(`${frame.data[i][pcmlenperchannel-3]} ${frame.data[i][pcmlenperchannel-2]} ${frame.data[i][pcmlenperchannel-1]} ${frame.data[i][pcmlenperchannel]} ${frame.data[i][pcmlenperchannel+1]} ${frame.data[i][pcmlenperchannel+2]}`)

                let pcm_fltpbuf = Buffer.alloc(pcmlenperchannel);
                frame.data[i].copy(pcm_fltpbuf, 0, 0, pcmlenperchannel);
                pcm_fltpbufs.push(pcm_fltpbuf);
            }

           return pcm_fltpbufs;
        }

        return undefined;
    }
}



class GIFConverter {

   _fileurl;
   _twidth = 0;
   _theight = 0;
   _tfps = 0;

    constructor(fileurl, twidth, theight, tfps) {

        this._fileurl = fileurl;
        this._twidth = twidth;
        this._theight = theight;
        this._tfps = tfps;

    }

    async toPNG(cbfun) {

        let dm = await beamcoder.demuxer('file:' + this._fileurl); 
        let framerate =  dm.streams[0].avg_frame_rate;
        let dec = beamcoder.decoder({ demuxer: dm, stream_index: 0}); 

        this._twidth = this._twidth ?? dec.width ;
        this._height = this._theight ?? dec.height;
        this._tfps = this._tfps ?? Math.floor(framerate[0]/framerate[1]);
        
        let rgbfilter = 
        await beamcoder.filterer({ filterType: 'video',
                                   inputParams: [{ width: dec.width,
                                                   height: dec.height,
                                                   pixelFormat: dec.pix_fmt,
                                                   timeBase: dm.streams[0].time_base,
                                                   pixelAspect:[dec.width, dec.height] }],
                                  outputParams: [{ pixelFormat: 'rgba'}],
                                  filterSpec: `fps=fps=${this._tfps},scale=${this._twidth}:${this._theight}` });



        let encParams = {
        name: 'png',
        width: this._twidth,
        height: this._theight,
        pix_fmt: 'rgba',
        time_base: dm.streams[0].time_base,
        };
    
        this._encoder = beamcoder.encoder(encParams);                         

       while(true) {
    
            let packet = await dm.read(); 

            if (!packet) {
    
                break;
            }
           
            let decResult = await dec.decode(packet); 
    
            if (decResult.frames.length <= 0) {
                continue;
            }

    
            let filter_result = await rgbfilter.filter(decResult.frames);

            if (filter_result?.length <= 0 || filter_result[0]?.frames?.length <= 0) {
                 continue;
            }

            let packets = await this._encoder.encode(filter_result[0].frames);

            for (let pkt of packets.packets) {

                let buf = Buffer.alloc(pkt.size);
                pkt.data.copy(buf, 0, 0, pkt.size);

                cbfun(buf)
            }
   
        }

    }
}


module.exports = {VideoDecoder, AudioDecoder, VideoEncoder, AudioEncoder, YUVConverter, RGBConvert, PCM_FLTPConverter, PCM_SignedConverter, GIFConverter, copyFrametoYuvbuf};
