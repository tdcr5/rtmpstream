const {getGobalGL, destroyGolbalGL, setUseGLFlag, getUseGLFlag} = require('./mangergl');
const { Image, loadImage, createCanvas, createImageData } = require('canvas');
const GLCanvas = require('./glcanvas');

class RenderCanvas {

    width = 0;
    height = 0;

    _useGLFlag = false;

    _canvas = undefined;
    _canvasContext = undefined;

    _glcanvas = undefined;


    constructor(width, height) {

        this.width = width;
        this.height = height;

        this._useGLFlag = getUseGLFlag();

        if (this._useGLFlag) {

            this._glcanvas = new GLCanvas(getGobalGL(), width, height);

        } else {

            this._canvas = createCanvas(width, height);
            this._canvasContext = this._canvas.getContext('2d');
        }
  
    }

    getImageData(sx, sy, sw, sh) {
        
        let imagedata = null;
        if (this._useGLFlag) {

            let pixels = this._glcanvas.getImageData(sx, sy, sw, sh);

            imagedata = createImageData(Uint8ClampedArray.from(pixels), sw, sh)

        } else {

            imagedata = this._canvasContext.getImageData(sx, sy, sw, sh);

        }

        return imagedata;
    }


    putImageData(imagedata, dx, dy) {

        if (this._useGLFlag) {

            this._glcanvas.putImageData(imagedata, dx, dy);

        } else {

            this._canvasContext.putImageData(imagedata, dx, dy);

        }
     
    }

    putImageDataEx(imagedata, dx, dy, dw, dh) {

        if (this._useGLFlag) {

            this._glcanvas.putImageDataEx(imagedata, dx, dy, dw, dh);

        } else {

            this._canvasContext.putImageData(imagedata, dx, dy);

        } 

    }

    putNV12ImageData(nv12imagedata1, nv12imagedata2, dx, dy) {

        if (this._useGLFlag) {

            this._glcanvas.putNV12ImageData(nv12imagedata1, nv12imagedata2, dx, dy);

        } else {



        }
     
    }

    putNV12ImageDataEx(nv12imagedata1, nv12imagedata2, dx, dy, dw, dh) {

        if (this._useGLFlag) {

            this._glcanvas.putNV12ImageDataEx(nv12imagedata1, nv12imagedata2, dx, dy, dw, dh);

        } else {



        } 

    }

    drawRenderCanvas(rendercanvs, dx, dy) {

        if (this._useGLFlag) {

            this._glcanvas.drawglCanvas(rendercanvs._glcanvas, dx, dy);

        } else {

            this._canvasContext.drawImage(rendercanvs._canvas, dx, dy);

        }

    }


    drawRenderCanvasEx(rendercanvs, dx, dy, dw, dh) {

        if (this._useGLFlag) {

            this._glcanvas.drawglCanvasEx(rendercanvs._glcanvas, dx, dy, dw, dh);

        } else {

            this._canvasContext.drawImage(rendercanvs._canvas, dx, dy, dw, dh);

        }

    }

    
    clearColor(red, green, blue, alpha) {

        if (this._useGLFlag) {

            this._glcanvas.clearColor(red, green, blue, alpha);

        } else {

            this._canvasContext.clearRect(0, 0, this.width, this.height);
            this._canvasContext.fillStyle = `#${red.toString(16).toUpperCase().padStart(2, '0')}${green.toString(16).toUpperCase().padStart(2, '0')}${blue.toString(16).toUpperCase().padStart(2, '0')}`;
            this._canvasContext.fillRect(0, 0, this.width, this.height);

        }


    }




}


module.exports = RenderCanvas;


