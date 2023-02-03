const creategl = require('../gl');

let gobalGL = undefined;
let useGLFlag = !!process.env.DISPLAY;

function setUseGLFlag(flag) {

    useGLFlag = flag;
}

function getUseGLFlag() {
    return useGLFlag;
}


function getGobalGL() {

    if (!gobalGL) {

        let gl = creategl(1, 1, { preserveDrawingBuffer: true });
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

        gobalGL = gl
    }

    return gobalGL;

}

function destroyGolbalGL() {

    if (gobalGL) {

        let ext = gobalGL.getExtension('STACKGL_destroy_context');
        ext.destroy();
        gobalGL = undefined;
    }

}

module.exports = {getGobalGL, destroyGolbalGL, setUseGLFlag, getUseGLFlag};