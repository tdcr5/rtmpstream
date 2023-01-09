
const rs = require('./thirdparty/media')
const heapdump = require('heapdump');
let startMem = process.memoryUsage();
const beamcoder = require('beamcoder');
const URL = require('url')
const utils = require('./utils')
const { Image, loadImage, createCanvas, ImageData, DOMMatrix, registerFont } = require('canvas');
const Text = require('./thirdparty/text')
const codec = require('./thirdparty/media').codec;
const fsExtra = require('fs-extra');
const path = require('path');
const DrawCube = require('./drawcube')
const DrawCylinder = require('./drawcylinder')
const DrawHemisphere = require('./drawhemisphere');
const { SoundTouch } = require('./thirdparty/soundtouch');
const sharp = require('sharp');
const MP4Parser = require('./mp4/mp4-parser')




let canvas, canvasCtx, canvastop, canvastopCtx, textrgba, cube, cylinder, hemisphere

let i = 0

let cwidth = 720;
let cheight = 720


function renderHemisphere(rgba, w, h) {

    if (!hemisphere) {

        hemisphere = new DrawHemisphere(cwidth, cheight);
    }

    hemisphere.updateTexture(rgba, w, h);

    return hemisphere.getRGBA();
}


function renderCylinder(rgba, w, h) {

    if (!cylinder) {

        cylinder = new DrawCylinder(cwidth, cheight);
    }

    cylinder.updateTexture(rgba, w, h);

    return cylinder.getRGBA();
}


function renderCube(rgba, w, h) {

    if (!cube) {

        cube = new DrawCube(cwidth, cheight);
    }

    cube.updateTexture(rgba, w, h);

    return cube.getRGBA();
}



function rendRGBA(rgba, w, h) {

    if (!canvas) {

        canvas = createCanvas(w, h);
        canvasCtx = canvas.getContext("2d");
    }

    if (!canvastop) {

        canvastop = createCanvas(w, h);
        canvastopCtx = canvastop.getContext("2d");
    }

    let imgd = new ImageData(Uint8ClampedArray.from(rgba), w, h);
    canvasCtx.putImageData(imgd , 0, 0);

    let m = new DOMMatrix()

    canvastopCtx.setTransform(m)
    canvastopCtx.clearRect(0, 0, w, h)
    canvastopCtx.fillStyle = "#0";
    canvastopCtx.fillRect(0, 0, w, h)

    i += 2;

    m.translateSelf(w/2, h/2, 0)
    m.rotateAxisAngleSelf(0, 0, 1, i)
 //   m.rotateAxisAngleSelf(1.0, 0, 0, i)
    m.translateSelf(-w/2, -h/2, 0)
    // m.scale3dSelf(Math.abs(Math.sin(i/2/Math.PI)*2.0), w/2, h/2, 0)
    
     canvastopCtx.setTransform(m)
     
     let deltax = w/4
     let deltay = h/4
     canvastopCtx.drawImage(canvas, deltax, deltay, w-2*deltax, h-2*deltay);

   return canvastopCtx.getImageData(0, 0, w, h).data
}

function rendText(rgba, w, h) {


    if (!canvas) {

        canvas = createCanvas(w, h);
        canvasCtx = canvas.getContext("2d");
    }

    if (!textrgba) {

        let fontFamily = "customfomt"
        registerFont('./font2.ttf', {family:fontFamily})

        let style = {
            fontSize: 46,
            fontStyle: 'italic',
            fontWeight: 'bold',
            fill: ['#ffffff', '#00ff99'],
            fontFamily,
            align:'center',
            wordWrap: true,
            breakwords:true,
            wordWrapWidth: 600,
            stroke: "blue",
            strokeThickness: 2,
        }
    
        let textobj = new Text("Are you OK? Yes, I'm very OK!", style);
        textobj.updateText()
        textrgba = textobj.canvas;
    }

    let imgd = new ImageData(Uint8ClampedArray.from(rgba), w, h);
    canvasCtx.putImageData(imgd , 0, 0);

    canvasCtx.drawImage(textrgba , w/2, h/2);

    return canvasCtx.getImageData(0, 0, w, h).data

}


function testRtmp() {

    let pullUrl = 'rtmp://192.168.6.18:1935/live/a123456';
    let pushUrl = 'rtmp://192.168.6.18:1935/push/p654321';

    let  encoder =  {
        name: "libx264",
        bitrate: 2000000,
        params: {
            preset: "medium",
            profile: "baseline",
            level: "3.1",
            tune: "zerolatency"
        }
    }

    let pullstream = new rs.RtmpPullStream(pullUrl);
    let pushstream = new rs.RtmpPushStream(pushUrl, encoder);


    let w, h;
    pullstream.on('vinfo', (width, height) => {

        w = width;
        h = height;

        pushstream.setVideoInfo(cwidth, cheight);
        
    });

    pullstream.on('ainfo', (sample, channels, depth) => {

        let inputAudioParam = {sample, channels, depth}
        let outputAudioParam = {
            format:'aac',
            sample:48000,
            channels:1,
            depth:depth
        }

        pushstream.setAudioInfo(inputAudioParam, outputAudioParam);

    });


    let i = 0;
    let index = 0;
    
    pullstream.on('rgbadata', (rgbabuf, timestamp) => {

        i++;

        if (i > 300){

            i = 0;
            index++;
        }

         let now = index%3;

        // let now = 0;
        let adjustrgba;

        // if (now === 0) {

             adjustrgba = renderCube(rgbabuf, w, h);

        // } else if (now === 1) {

        //     adjustrgba = renderCylinder(rgbabuf, w, h);
        // } else {

      //       adjustrgba = renderHemisphere(rgbabuf, w, h);
        // }

        
   
    //     // let adjustrgba = renderCube(rgbabuf, w, h);
    //    // let adjustrgba = renderCylinder(rgbabuf, w, h);
       // let adjustrgba = renderHemisphere(rgbabuf, w, h);

    //     if (adjustrgba.length !== w*h*4) {

    //         console.log(`process image error`)
    //         return
    //     }

        pushstream.pushRGBAData(adjustrgba, timestamp);
    });

    let s = 1;

    pullstream.on('pcmdata', (pcmbuf, timestamp) => {

        s++;

        // if (s >= 20) {
        //     pullstream.stop()
        //     return
        // }

        pushstream.pushPCMData(pcmbuf, timestamp);

        // let splitsamlenum = 1024;
 
        // let tsoffset = Math.floor(splitsamlenum*1000/48000);

        // let total = 1024;
        // let left = total;

        // while(left > 0) {

        //     if (left > splitsamlenum) {

        //         pushstream.pushPCMData(pcmbuf.slice((total - left)*4,  (total - left + splitsamlenum)*4), 
        //                                             timestamp + Math.floor((total - left)*1000/4800));
        //         left -= splitsamlenum;

        //     } else {

        //         pushstream.pushPCMData(pcmbuf.slice((total - left)*4), timestamp + Math.floor((total - left)*1000/4800));

        //         left = 0;
        //     }

        // }

      });

    pullstream.start();
    pushstream.start();


}


function testRecord() {

    let pullUrl = 'rtmp://192.168.6.18:1935/live/a123456';
    let mp4file = 'rtmp://192.168.6.18:1935/push/a654321'
    let pullstream = new rs.RtmpPullStream(pullUrl);
    let mp4stream = new rs.RecordStream(mp4file);

    let isVSet = false;
    let isASet = false;
    let basets = undefined;

    pullstream.on('vinfo', (width, height) => {

     mp4stream.setVideoInfo(width, height, 'V0');
     isVSet = true;
     
     if (isVSet && isASet) {

        mp4stream.start();
     }
        
    });

    pullstream.on('ainfo', (sample, channels, depth) => {

       mp4stream.setAudioInfo(sample, channels, depth, 'A0');
       isASet = true;

       if (isVSet && isASet) {
            mp4stream.start();
       }
    });
    
    pullstream.on('rgbadata', (rgbabuf, timestamp) => {

        if (!basets) {
            basets = timestamp;
        }

        mp4stream.pushRGBAData(rgbabuf, timestamp -basets, 'V0');
    });

    pullstream.on('pcmdata', (pcmbuf, timestamp) => {

        
        if (!basets) {
            basets = timestamp;
        }

        let splitsamlenum = 1024;
 
        // let tsoffset = Math.floor(splitsamlenum*1000/48000);
 
         let total = 1024;
         let left = total;
 
         while(left > 0) {
 
             if (left > splitsamlenum) {
 
               mp4stream.pushPCMData(pcmbuf.slice((total - left)*4,  (total - left + splitsamlenum)*4), 
                                                    timestamp + Math.floor((total - left)*1000/4800) - basets, 'A0');

                left -= splitsamlenum;
 
             } else {
 
               mp4stream.pushPCMData(pcmbuf.slice((total - left)*4), timestamp + Math.floor((total - left)*1000/4800) - basets, 'A0');

                 left = 0;
             }
 
         }

    });

    pullstream.start();
    console.log('mp4 start record');

    // setTimeout(() => {
        
    //     mp4stream.stop();
    //     console.log('mp4 stop record');

    // }, 10*1000);
}

function getBuffer() {
	return new Promise(function (resolve, reject) {
		setTimeout(function () {
            let frame = beamcoder.frame({format:'yuv420p', width:1080, height:1920}).alloc();

            resolve(frame);
		}, 33);
		
	});
}


async function testMemLeak() {

	for(let i = 0 ; i < 10000000000; ++i){
        let frame = await getBuffer();
        console.log('get ' + i + ' buffer');
       // assert.strictEqual(buf.length, 3000000);
   }
}

function showMemory() {
    heapdump.writeSnapshot('./' + Date.now() + '.heapsnapshot'); 
}
 
function calc(data) {
    return Math.round((data / 1024 / 1024) * 10000) / 10000 + " MB";
  }


async function testDemux() {

    let demuxer = await beamcoder.demuxer('./1.mp4'); // Create a demuxer for a file

    let vdecoder = beamcoder.decoder({ demuxer, stream_index: 0});  // Codec asserted. Can pass in demuxer.
    let adecoder = beamcoder.decoder({ demuxer, stream_index: 1}); 

    let vtimebase = demuxer.streams[0].time_base;
    let atimebase = demuxer.streams[1].time_base;

    console.log(`demux 
                v_timebase ${demuxer.streams[0].time_base}
                v_framerate ${demuxer.streams[0].r_frame_rate}
                a_timebase ${demuxer.streams[1].time_base}
                a_samplerate ${demuxer.streams[1].sample_aspect_ratio}`)




    let packet = {};
    for ( let x = 0 ; x < 1000 && packet != null ; x++ ) {
      packet = await demuxer.read(); // Read next frame. Note: returns null for EOF
      if (packet && packet.stream_index === 0) { // Check demuxer to find index of video stream
        let frames = await vdecoder.decode(packet);
        // Do something with the frame data

        if (frames.frames.length === 0) {

            continue;
        }

        let f = frames.frames[0]
       // console.log("video", x, frames.total_time, f.pts*1000*vtimebase[0]/vtimebase[1]); // Optional log of time taken to decode each frame
      } else {

        let frames = await adecoder.decode(packet);
        // Do something with the frame data

        if (frames.frames.length === 0) {

            continue;
        }

        let f = frames.frames[0]
        console.log("audio", x, frames.total_time, f.pts*1000*atimebase[0]/atimebase[1]);
      }
    }
 //   let frames = await decoder.flush(); // Must tell the decoder when we are done
    console.log('flush', frames.total_time, frames.length);

}  

async function testDemux2() {

    let fliterInputParams = {
        format: 's16',
        sample: 48000,
        channels: 1,
        depth:16
    }

    let fliterOutParams = {
        format: 's16',
        sample: 44100,
        channels: 2,
        depth:16,
        sampleNumPerFrame: 1024
    }


    let audiofilter = new rs.AudioFilter(fliterInputParams, fliterOutParams);

    audiofilter.on('pcmdata', (pcmbuf, timestamp) => {

        console.log(`filter pcm, len:${pcmbuf.length} pts:${timestamp}`);

    }); 


    let inputParams = {
        url: './4.mp4',
        loop: -1,
        // options: {
        //       rtsp_transport:"tcp", 
        //     stimeout:"2000000" 
        // },
        audioEnable:true,
        videoEnable:true
    }

    let outputParams = {
        fps: 25,
        width: 1080,
        height: 608.5,
        sample: 48000,
        channels:1,
        depth:16,
        audioFrameSampleNum:1920
    }
    let fileplayer = new rs.FilePlayer(inputParams, outputParams);

    let start = new Date().getTime();

    fileplayer.on('avinfo', (videoParam, audioParam) => {

        console.log(`avinfo vformat:${videoParam.name} width:${videoParam.width} height:${videoParam.height} 
aformat:${audioParam.name} profile:${audioParam.profile} sample:${ audioParam.sample_rate} channel:${audioParam.channels} depth:${audioParam.bits_per_coded_sample}`);

    });

    fileplayer.on('playstart', () => {

        console.log(`play start`);

    });

    fileplayer.on('playstop', () => {

        console.log(`play stop normal`);

    });

    fileplayer.on('playerror', (result) => {

        console.log(`play error, reason: ${result}`);

    });

    let vframes = 0
    let aframes = 0;

    fileplayer.on('yuvdata', (yuvbuf) => {

       vframes++

       console.log(`yuvdata length ${yuvbuf.length} pts ${new Date().getTime() - start} vframes ${vframes}`)

    });


    fileplayer.on('pcmdata', (pcmdata) => {

        aframes++

        let pts = new Date().getTime() - start

      console.log(`pcmdata length ${pcmdata.length} pts ${pts} aframes ${aframes}`)

      //  audiofilter.pushPCMData(pcmdata, pts);

    });

    fileplayer.start();

    let sec = 5;

    // setInterval(()=>{

    //     console.log(`parse video fps:${vframes/sec} audio fps:${aframes/sec}`);

    //     vframes = 0;
    //     aframes = 0


    // }, sec*1000);

    // setInterval(() => {
    //     fileplayer.stop();
    //     fileplayer.start();
    // }, sec*1000);

}

async function testDownload() {

    let url = 'https://duix.guiji.ai/nfs/video-server/mp4/150905336604361113.mp4'
    let dst = './test2.mp4'

    let cancelfunc;

    // setTimeout(() => {
        
    //     if (cancelfunc) {
    //         console.log('cancelfunc is called')
    //         cancelfunc();
    //     } else {
    //         console.log('cancelfunc is null')
    //     }

    // }, 5000);



       let err = await utils.downloadFileAsyncWithCancel(url, dst, (f) => {
            cancelfunc = f;
        })

        cancelfunc = undefined;

        if (!err) {

            console.log('download success')

        } else {

            console.log('download faile', err)
        }

        

}


function testText() {

    let style = {
        color: '#0000ff',
        background:'rgba(255,255,255,0)'
    }

    let textobj = new Text("nihaoya", style);

    textobj.updateText()
    textrgba = textobj.canvas;
    
}

async function testGif() {

    let gifconv = new codec.GIFConverter('./dog2.gif', 100, 100);

    let saveDir = './convert';

    let index = 0;

   await gifconv.toPNG(jpegbuf => {
        index++;
        fsExtra.writeFile(path.join(saveDir, `${index}.png`), jpegbuf);
    });

}

function testCube() {

let s = new DrawCube(200, 200);

setInterval(()=>{

    let pixels = s.getRGBA();

    console.log(`${pixels}`);

}, 1000)


}

function testSoundTouch() {

    let pullUrl = 'rtmp://192.168.6.18:1935/live/a123456';
    let pushUrl = 'rtmp://192.168.6.18:1935/push/p654321';

    let pullstream = new rs.RtmpPullStream(pullUrl);
    let pushstream = new rs.RtmpPushStream(pushUrl);

    let st = new SoundTouch()
     st.rate = 1;
    st.tempo = 1;
    st.pitch = 1.3;

    let achannls = 0;

    pullstream.on('vinfo', (width, height) => {

        pushstream.setVideoInfo(width, height);
        
    });

    let start = new Date().getTime();

    pullstream.on('ainfo', (sample, channels, depth) => {

        achannls = channels

        let inputAudioParam = {sample, channels, depth}
        let outputAudioParam = {
            format:'aac',
            sample:48000,
            channels:1,
            depth:depth
        }

        pushstream.setAudioInfo(inputAudioParam, outputAudioParam);

    });


    pullstream.on('rgbadata', (rgbabuf, timestamp) => {


        pts =  new Date().getTime() - start; 

       pushstream.pushRGBAData(rgbabuf, pts);
    });

    pullstream.on('pcmdata', (pcmbuf, timestamp) => {

        let pcm16 = new Int16Array(pcmbuf)

        let numFrames = pcm16.length/achannls;

        let samples = new Float32Array(numFrames * 2);


        if (achannls === 2) {

            for(let i = 0; i < numFrames; i++) {

                samples[2*i] = pcm16[2*i]/32767.0;
                samples[2*i+1] = pcm16[2*i+1]/32767.0;
            }
    
        } else {

            for(let i = 0; i < numFrames; i++) {

                samples[2*i] = pcm16[i]/32767.0;
                samples[2*i+1] = pcm16[i]/32767.0;
    
            }

        }

        st._inputBuffer.putSamples(samples, 0, numFrames);
        st.process()

        console.log(`st._outputBuffer.frameCount = ${st._outputBuffer.frameCount}`)

        if(st._outputBuffer.frameCount > 0) {

             let dstFrames = st._outputBuffer.frameCount;
            let dessamples = new Float32Array(dstFrames * 2);

            let dstpcm16 = new Int16Array(dstFrames*achannls)

            st._outputBuffer.receiveSamples(dessamples, dstFrames);


            if (achannls === 2) {

                for (let i = 0; i < dstFrames; i++) {

                    dstpcm16[2*i] = Math.floor(dessamples[2*i]*32767)
                    dstpcm16[2*i+1] = Math.floor(dessamples[2*i+1]*32767)
                }

            }else {

                dstpcm16[i] = Math.floor(dessamples[2*i]*32767)

            }

            pts =  new Date().getTime() - start; 

            pushstream.pushPCMData(dstpcm16.buffer, pts);

        }

      });

    pullstream.start();
    pushstream.start();




}

function startMemRecord() {

    const format = function (bytes) {

        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    };
    
    let second = 5;
    
    this.memrecordinterval = setInterval(() => {
    
    const memoryUsage = process.memoryUsage();
    
    console.log(JSON.stringify({

        rss: format(memoryUsage.rss), // 常驻内存
        heapTotal: format(memoryUsage.heapTotal), // 总的堆空间
        heapUsed: format(memoryUsage.heapUsed), // 已使用的堆空间
        external: format(memoryUsage.external), // C++ 对象相关的空间
        }, null, 2));
    
    }, second*1000);
    
    
    
}

async function sleep(ms) {


    return new Promise((resolve) => {


        setTimeout(() => {

            resolve();
            
        }, ms);


    })

}

async function doJob() {

   // console.log(`----- start do job`)


    await sleep(1);

    //console.log(`----------sleep a while`)


    doJob();

}



function testTailRecurtion() {


    doJob();
    startMemRecord();

}



async function testFacePic() {


    let faceImage = await loadImage('77.png');
    let bodyImage = await loadImage('219.png');

    let slienceImage = await loadImage('220.png');

    console.log(`faceimage len ${faceImage.width}`);



    let faceCanvas = createCanvas(1080, 1920);
    let faceCtx = faceCanvas.getContext('2d');

    let x = 392
    let y = 169
    let w = 240
    let h = 241


    faceCtx.drawImage(bodyImage, 0, 0, 1080, 1920);
    faceCtx.drawImage(faceImage, x, y, w, h);
    
    let faceBodyImageData = faceCtx.getImageData(0, 0, 1080, 1920)



    let slienceCanvas = createCanvas(1080, 1920);
    let slienceCtx = slienceCanvas.getContext('2d');
    slienceCtx.drawImage(slienceImage, 0, 0, 1080, 1920);

    let slienceImageData = slienceCtx.getImageData(0, 0, 1080, 1920)


    let pushUrl = 'rtmp://192.168.6.18:1935/push/p654321';

    let pushstream = new rs.RtmpPushStream(pushUrl);

    pushstream.start();

 

    pushstream.setVideoInfo(1080, 1920);
        

    let inputAudioParam = {sample:48000, channels:1, depth:16}
    let outputAudioParam = {
        format:'aac',
        sample:48000,
        channels:1,
        depth:16
    }

    pushstream.setAudioInfo(inputAudioParam, outputAudioParam);

 
    let ts = 0;

    let i = 0;

    setInterval(()=>{

        if (i%12 > 0) {

            pushstream.pushRGBAData(faceBodyImageData.data, ts);

        } else {

            pushstream.pushRGBAData(slienceImageData.data, ts);
        }

        
        i++;
        ts += 40;


    }, 40)


}


async function  testSharpLib() {


    let image = sharp('77.png');

    let meta = await image.metadata()


    let rgba = await image.raw().toBuffer()


    console.log(`rgba lenth ${rgba.length}`)


}

function testMP4() {

    let source = fsExtra.readFileSync('city.mp4');

    let parser =  new MP4Parser(source);

    parser.parse()



}


const pngdir = '/workSpace/project/pic/785479866391998601.png_248';
const pngcount = 248;

async function testSyncLoadPng() {



    let i = 1;

    let loop = 1;
    let curloop = loop

    let start = new Date().getTime()

  
    while (curloop > 0) {

        let pngpath = path.join(pngdir, `${i}.png`)

        let pngData =  fsExtra.readFileSync(pngpath)

        let nowindex = i

        let {data, info} = await sharp(pngData).raw().toBuffer({ resolveWithObject: true })

      //  console.log(` ${i} png, width ${info.width} height ${info.height} `)

        if (i%pngcount == 0) {
            i = 1;
            curloop--;
        } else {
            i++;
        }

    }

    let end  = new Date().getTime()

    console.log(`Sync Decode, decode ${pngcount*loop} png, cost ${end-start} ms, ${(end-start)/(pngcount*loop)} ms per png, ${1000*pngcount*loop/(end-start)} png ps`)


}


async function testAsyncLoadPng() {


    let i = 1;

    let loop = 1;
    let curloop = loop

    let start = new Date().getTime()

    let tasks = []

    while (curloop > 0) {

        let pngpath = path.join(pngdir, `${i}.png`)

        let pngData =  fsExtra.readFileSync(pngpath)

        let nowindex = i

        let oneTask = sharp(pngData).raw().toBuffer({ resolveWithObject: true }).then(({data, info}) => {

            //console.log(` ${nowindex} png, width ${info.width} height ${info.height} `)
        })
        tasks.push(oneTask)

      //  console.log(` ${i} png, width ${info.width} height ${info.height} `)

        if (i%pngcount == 0) {
            i = 1;
            curloop--;
        } else {
            i++;
        }

    }


   await Promise.all(tasks)

    let end  = new Date().getTime()

    console.log(`Async Decode, decode ${pngcount*loop} png, cost ${end-start} ms, ${(end-start)/(pngcount*loop)} ms per png, ${1000*pngcount*loop/(end-start)} png ps`)


}

function main() {


    testAsyncLoadPng()
    testSyncLoadPng()
  //  testMP4();

    //testTailRecurtion();
    // testSoundTouch()
  //  testCube();

  //  testGif();

  //  testDownload()

   // testRecord();

  // testFacePic();
   //  testRtmp();

  // testDemux2();


    // let index = 0;
    // setInterval(()=>{
    //     let frame = beamcoder.frame({format:'yuv420p', width:1080, height:1920, pts:++index})//.alloc();
    //     console.log(`frame length ${frame}`)
    // }, 30);
    //testMemLeak();
    //setInterval(showMemory, 30*1000);
//     setInterval(()=>{

//         let mem = process.memoryUsage();
//         console.debug("memory before", calc(startMem.rss), "memory now:", calc(mem.rss), "diff increase", calc(mem.rss - startMem.rss));

//     }, 5*1000);
}


main();