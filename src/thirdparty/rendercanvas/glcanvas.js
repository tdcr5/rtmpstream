

    //shader里做了两次坐标转换
    //(1) 原点在左上的坐标系 转到 到原点到左下的坐标系 
    //(2) readpixel 输出的图像和实际渲染的图像是 Y轴翻转的，为了两者一至在归一化后在做一次绕着中心点Y坐标翻转 
    const vertexShaderSource = `

    attribute vec4 aPosition;
    attribute vec2 aTexcoord;
    varying   vec2 vTexcoord;
    uniform   vec2 uSize;
    uniform   vec2 uTexsize;

    void main() {


        gl_Position = vec4( (((aPosition.xy/uSize)*vec2(1.0,-1.0) + vec2(0.0, 1.0))*2.0 - 1.0)*vec2(1.0, -1.0), 0.0, 1.0) ;
        vTexcoord = ((aTexcoord/uTexsize)*vec2(1.0,-1.0) + vec2(0.0, 1.0) + vec2(0.0, -0.5))*vec2(1.0, -1.0) + vec2(0.0, 0.5);
    }`;

    const fragmentShaderSource = `
    precision mediump float;
    uniform int isRGBA; 
    uniform sampler2D uTexture; 
    uniform sampler2D uYTexture1; 
    uniform sampler2D uUVTexture1; 
    uniform sampler2D uYTexture2; 
    uniform sampler2D uUVTexture2; 
    varying vec2 vTexcoord;
    const mat3 NV12ToRGB = mat3(1.0, 1.0, 1.0, 0.0, -0.39465, 2.03211, 1.13983, -0.5806, 0.0);

    void main() {
  
        if (isRGBA > 0) {

            gl_FragColor =  texture2D(uTexture, vTexcoord);
            
        } else {

            vec3 yuv1;
            vec3 rgb1;

            yuv1.x = texture2D(uYTexture1, vTexcoord).r;
            yuv1.y = texture2D(uUVTexture1, vTexcoord).r - 0.5;
            yuv1.z = texture2D(uUVTexture1, vTexcoord).a - 0.5;
       
            rgb1 = NV12ToRGB * yuv1;

            vec3 yuv2;
            vec3 rgb2;
       
            yuv2.x = texture2D(uYTexture2, vTexcoord).r;
            yuv2.y = texture2D(uUVTexture2, vTexcoord).r - 0.5;
            yuv2.z = texture2D(uUVTexture2, vTexcoord).a - 0.5;
        
            rgb2 = NV12ToRGB * yuv2;
            gl_FragColor = vec4(rgb1, rgb2.x);


        }


    

    }`;


    function createShader(gl, type, source) {

        let shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
    
        let success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    
        if (success) {
            return shader;
        }
    
        console.log(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
    }
    
    function createProgram(gl, vertexShader, fragmentShader) {
    
        let program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
    
        let success = gl.getProgramParameter(program, gl.LINK_STATUS);
    
        if (success) {
            return program;
        }
    
        console.log(gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
    
    }


class GLCanvas {

    _gl = undefined; 
    _width = 0;
    _height = 0;

    _program = undefined;

    //gl shader param
    _apositionloc = 0;
    _atexcoordloc = 0;
    _usizeloc = 0;
    _utexsizeloc = 0;
    _utextureloc = 0;

    _texture = 0;
    _fb = 0;
    _fbtexture = 0;
    _positionBuffer = 0;
    _texcoordBuffer = 0;


    constructor(gl, width, height) {


        this._gl = gl;
        this._width = width;
        this._height = height;

        let vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
        let fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    
        let program = createProgram(gl, vertexShader, fragmentShader);
    
        this._apositionloc = gl.getAttribLocation(program, "aPosition");
        this._atexcoordloc = gl.getAttribLocation(program, "aTexcoord");
        this._usizeloc = gl.getUniformLocation(program, 'uSize');
        this._utexsizeloc = gl.getUniformLocation(program, 'uTexsize');
        this._utextureloc = gl.getUniformLocation(program, 'uTexture');

        this._isrgbaloc = gl.getUniformLocation(program, 'isRGBA');
        this._uytexture1loc = gl.getUniformLocation(program, 'uYTexture1');
        this._uuvtexture1loc = gl.getUniformLocation(program, 'uUVTexture1');
        this._uytexture2loc = gl.getUniformLocation(program, 'uYTexture2');
        this._uuvtexture2loc = gl.getUniformLocation(program, 'uUVTexture2');

        this._program = program;

        this._positionBuffer = gl.createBuffer();
        this._texcoordBuffer = gl.createBuffer();


        this._texture = this.createTexture();
        this._ytexture1 = this.createTexture();
        this._uvtexture1 = this.createTexture();
        this._ytexture2 = this.createTexture();
        this._uvtexture2 = this.createTexture();
    
    
        const fbTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, fbTexture);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,                // mip level
            gl.RGBA,          // internal format
            width,   // width
            height,  // height
            0,                // border
            gl.RGBA,          // format
            gl.UNSIGNED_BYTE, // type
            null,             // data
        )
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

        this._fbtexture = fbTexture;
        
        const depthRB = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, depthRB);
        gl.renderbufferStorage(
            gl.RENDERBUFFER,
            gl.DEPTH_COMPONENT16,  // format
            width,        // width,
            height,       // height,
        );
        
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTexture, 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRB);

        gl.viewport(0, 0, width, height);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        
        this._fb = fb;    
  
    }

    createTexture() {

        let gl = this._gl;

        let texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
    
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        return texture;

    }

    getImageData(sx, sy, sw, sh) {


        let gl = this._gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fb);

        let pixels = new Uint8Array(sw * sh * 4)

        gl.readPixels(sx,  sy, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

       gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return pixels;
    }


    putImageData(imagedata, dx, dy) {


        this.updateTexture(imagedata.data, imagedata.width, imagedata.height);

        this.draw(dx, dy, imagedata.width, imagedata.height, this._texture,
                  0, 0, imagedata.width, imagedata.height, imagedata.width, imagedata.height);

    }

    putImageDataEx(imagedata, dx, dy, dw, dh) {


        this.updateTexture(imagedata.data, imagedata.width, imagedata.height);

        this.draw(dx, dy, dw, dh, this._texture,
                  0, 0, imagedata.width, imagedata.height, imagedata.width, imagedata.height);

    }

    putNV12ImageData(nv12imagedata1, nv12imagedata2, dx, dy) {


        this.updateNV12Texture(nv12imagedata1.ybuf, nv12imagedata1.uvbuf, nv12imagedata2.ybuf, nv12imagedata2.uvbuf,nv12imagedata1.linesize, nv12imagedata1.height);
       
        this.drawnv12(dx, dy, nv12imagedata1.width, nv12imagedata1.height, this._ytexture1, this._uvtexture1, this._ytexture2, this._uvtexture2,
                    0, 0, nv12imagedata1.width, nv12imagedata1.height, nv12imagedata1.linesize, nv12imagedata1.height);

  

    }

    putNV12ImageDataEx(nv12imagedata1, nv12imagedata2, dx, dy,  dw, dh) {


        this.updateNV12Texture(nv12imagedata1.ybuf, nv12imagedata1.uvbuf, nv12imagedata2.ybuf, nv12imagedata2.uvbuf,nv12imagedata1.linesize, nv12imagedata1.height);
       
        this.drawnv12(dx, dy, dw, dh, this._ytexture1, this._uvtexture1, this._ytexture2, this._uvtexture2,
                    0, 0, nv12imagedata1.width, nv12imagedata1.height, nv12imagedata1.linesize, nv12imagedata1.height);

        
    }


    getFBOTexture() {

        return this._fbtexture;
    }
	

    drawglCanvas(glcanvs, dx, dy) {

        this.draw(dx, dy, glcanvs._width, glcanvs._height, glcanvs.getFBOTexture(),
        0, 0, glcanvs._width, glcanvs._height, glcanvs._width, glcanvs._height); 
    }

    drawglCanvasEx(glcanvs, dx, dy, dw, dh) {

        this.draw(dx, dy, dw, dh, glcanvs.getFBOTexture(),
        0, 0, glcanvs._width, glcanvs._height, glcanvs._width, glcanvs._height); 
    }

    clearColor(red, green, blue, alpha) {

        let gl = this._gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fb);

        gl.clearColor(red/255.0, green/255.0,  blue/255.0, alpha);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }


    
    updateNV12Texture(ybuf1, uvbuf1, ybuf2, uvbuf2, width, height) {

        let gl = this._gl;

        // gl.pixelStorei(gl.UNPACK_ALIGNMENT, 16);

        let textunit = 3;
        gl.activeTexture(gl.TEXTURE0 + textunit);
        gl.bindTexture(gl.TEXTURE_2D, this._ytexture1);

        gl.texImage2D(gl.TEXTURE_2D,
            0,                // mip level
            gl.LUMINANCE,          // internal format
            width,                // width
            height,                // height
            0,                // border
            gl.LUMINANCE,          // format
            gl.UNSIGNED_BYTE, // type
            ybuf1);


        textunit += 1;
        gl.activeTexture(gl.TEXTURE0 + textunit);
        gl.bindTexture(gl.TEXTURE_2D, this._uvtexture1);

        gl.texImage2D(gl.TEXTURE_2D,
            0,                // mip level
            gl.LUMINANCE_ALPHA,          // internal format
            width/2,                // width
            height/2,                // height
            0,                // border
            gl.LUMINANCE_ALPHA,          // format
            gl.UNSIGNED_BYTE, // type
            uvbuf1);    

        textunit += 1;
        gl.activeTexture(gl.TEXTURE0 + textunit);
        gl.bindTexture(gl.TEXTURE_2D, this._ytexture2);

        gl.texImage2D(gl.TEXTURE_2D,
            0,                // mip level
            gl.LUMINANCE,          // internal format
            width,                // width
            height,                // height
            0,                // border
            gl.LUMINANCE,          // format
            gl.UNSIGNED_BYTE, // type
            ybuf2);


        textunit += 1;
        gl.activeTexture(gl.TEXTURE0 + textunit);
        gl.bindTexture(gl.TEXTURE_2D, this._uvtexture2);

        gl.texImage2D(gl.TEXTURE_2D,
            0,                // mip level
            gl.LUMINANCE_ALPHA,          // internal format
            width/2,                // width
            height/2,                // height
            0,                // border
            gl.LUMINANCE_ALPHA,          // format
            gl.UNSIGNED_BYTE, // type
            uvbuf2);   
            
        // gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);    

    }


    updateTexture(rgbabuf, width, height) {

        let gl = this._gl;

        let textunit = 3;
        gl.activeTexture(gl.TEXTURE0 + textunit);
        gl.bindTexture(gl.TEXTURE_2D, this._texture);

        gl.texImage2D(gl.TEXTURE_2D,
            0,                // mip level
            gl.RGBA,          // internal format
            width,                // width
            height,                // height
            0,                // border
            gl.RGBA,          // format
            gl.UNSIGNED_BYTE, // type
            rgbabuf);

    }


    draw(posx, posy, posw, posh, texture, texx, texy, texw, texh, texsizew, texsizeh) {

        let gl = this._gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fb);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.viewport(0, 0, this._width, this._height);

        gl.useProgram(this._program);
    
        let x1 = posx;
        let x2 = posx + posw;
        let y1 = posy;
        let y2 = posy + posh;
    
        gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer);
        let positons = [x1, y1, x1, y2, x2, y1, x2, y2];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positons), gl.STATIC_DRAW);
    
        gl.bindBuffer(gl.ARRAY_BUFFER, this._texcoordBuffer);
        let colors = [texx, texy, texx, texy + texh, texx + texw, texy, texx + texw, texy + texh];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
    
        gl.enableVertexAttribArray(this._apositionloc);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer);
        gl.vertexAttribPointer(this._apositionloc, 2, gl.FLOAT, false, 0, 0);
    
        gl.enableVertexAttribArray(this._atexcoordloc);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._texcoordBuffer);
        gl.vertexAttribPointer(this._atexcoordloc, 2, gl.FLOAT, false, 0, 0);
    
        let textunit = 2;
        gl.activeTexture(gl.TEXTURE0 + textunit);
        gl.bindTexture(gl.TEXTURE_2D, texture);

        gl.uniform1i(this._isrgbaloc, 1);
        gl.uniform1i(this._utextureloc, textunit);
        gl.uniform2f(this._usizeloc, this._width, this._height);
        gl.uniform2f(this._utexsizeloc, texsizew, texsizeh);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.disable(gl.BLEND);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    }

    
    drawnv12(posx, posy, posw, posh, ytexture1, uvtexture1, ytexture2, uvtexture2, texx, texy, texw, texh, texsizew, texsizeh) {

        let gl = this._gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fb);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.viewport(0, 0, this._width, this._height);

        gl.useProgram(this._program);
    
        let x1 = posx;
        let x2 = posx + posw;
        let y1 = posy;
        let y2 = posy + posh;
    
        gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer);
        let positons = [x1, y1, x1, y2, x2, y1, x2, y2];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positons), gl.STATIC_DRAW);
    
        gl.bindBuffer(gl.ARRAY_BUFFER, this._texcoordBuffer);
        let colors = [texx, texy, texx, texy + texh, texx + texw, texy, texx + texw, texy + texh];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
    
        gl.enableVertexAttribArray(this._apositionloc);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._positionBuffer);
        gl.vertexAttribPointer(this._apositionloc, 2, gl.FLOAT, false, 0, 0);
    
        gl.enableVertexAttribArray(this._atexcoordloc);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._texcoordBuffer);
        gl.vertexAttribPointer(this._atexcoordloc, 2, gl.FLOAT, false, 0, 0);
    
        let textunit = 2;
        gl.activeTexture(gl.TEXTURE0 + textunit);
        gl.bindTexture(gl.TEXTURE_2D, ytexture1);
        gl.uniform1i(this._uytexture1loc, textunit);

        textunit += 1;
        gl.activeTexture(gl.TEXTURE0 + textunit);
        gl.bindTexture(gl.TEXTURE_2D, uvtexture1);
        gl.uniform1i(this._uuvtexture1loc, textunit);

        textunit += 1;
        gl.activeTexture(gl.TEXTURE0 + textunit);
        gl.bindTexture(gl.TEXTURE_2D, ytexture2);
        gl.uniform1i(this._uytexture2loc, textunit);

        textunit += 1;
        gl.activeTexture(gl.TEXTURE0 + textunit);
        gl.bindTexture(gl.TEXTURE_2D, uvtexture2);
        gl.uniform1i(this._uuvtexture2loc, textunit);

        gl.uniform1i(this._isrgbaloc, 0);
        gl.uniform2f(this._usizeloc, this._width, this._height);
        gl.uniform2f(this._utexsizeloc, texsizew, texsizeh);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.disable(gl.BLEND);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    }

}



module.exports = GLCanvas;