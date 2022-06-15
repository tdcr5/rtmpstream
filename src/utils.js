'use strict';

const HTTP = require('http')
const HTTPS = require('https')
const URL = require('url')
const path = require('path');

const { spawn } = require('child_process');
const { networkInterfaces } = require('os');

const fs = require('fs');
const fsExtra = require('fs-extra');
// const logger = require("./logger").log4js.getLogger('utils')
const logger = require('console')

async function downloadFileAsync(uri, dest) {

    logger.info(`downfile: ${uri} >> ${dest}`)

    let dir = path.dirname(dest)
    logger.info(`fs.ensureDir: ${dir}`)
    await fsExtra.ensureDir(dir)

    return new Promise((resolve, reject) => {

        let HTTP_PROTOCOL = uri.startsWith("http:") ? HTTP : HTTPS

        HTTP_PROTOCOL.get(uri, (res) => {

            logger.info('get', uri, res.statusCode)

            if (res.statusCode !== 200) {
                let msg = `${res.statusCode}-${res.statusMessage}`
                logger.warn('down', uri, msg)
                return reject(msg);
            }

            res.on('end', () => {
                logger.info('down end', uri)
            });

            // 确保dest路径存在
            const file = fs.createWriteStream(dest);

            // 进度、超时等
            file.on('finish', () => {
                logger.info('write finish', dest)
                file.close(resolve);

            }).on('error', (err) => {
                logger.error('write error', dest, err.message)
                logger.error(err)
                fs.unlink(dest);
                reject(err.message);
            })
            res.pipe(file);
        });

    });
}


async function downloadFileAsyncWithCancel(uri, dest, cancelget) {

    logger.info(`downfile: ${uri} >> ${dest}`)

    let dir = path.dirname(dest)
    logger.info(`fs.ensureDir: ${dir}`)
    fsExtra.ensureDirSync(dir)

    return new Promise((resolve, reject) => {

        let HTTP_PROTOCOL = uri.startsWith("http:") ? HTTP : HTTPS

        let httpReq =  HTTP_PROTOCOL.get(uri, (res) => {

            logger.info('get', uri, res.statusCode)

            if (res.statusCode !== 200) {
                let msg = `${res.statusCode}-${res.statusMessage}`
                logger.warn('down', uri, msg)
                return resolve(msg);
            }

            res.on('end', () => {
                logger.info('down end', uri)
            });

            // 确保dest路径存在
            const file = fs.createWriteStream(dest);

            // 进度、超时等
            file.on('finish', () => {
                logger.info('write finish', dest)
                file.close(resolve);

            }).on('error', (err) => {
                logger.error('write error', dest, err.message)
                logger.error(err)
                fs.unlink(dest);
                resolve(err.message);
            })
            res.pipe(file);
        });

        httpReq.on('error', (err)=>{

            logger.error(`down error(${err}) msg`, uri)
            resolve(err)
        })

        let cancelfunc = function () {

            httpReq.destroy('http request cancel')
            logger.error('http request destroy called', uri)
                  
        }

        cancelget(cancelfunc);

    });
}


function formatDate(fmt, dt) {
    dt = dt ?? new Date()
    let o = {
        "M+": dt.getMonth() + 1,                 //月份 
        "d+": dt.getDate(),                    //日 
        "h+": dt.getHours(),                   //小时 
        "m+": dt.getMinutes(),                 //分 
        "s+": dt.getSeconds(),                 //秒 
        "q+": Math.floor((dt.getMonth() + 3) / 3), //季度 
        "S": dt.getMilliseconds()             //毫秒 
    };
    if (/(y+)/.test(fmt)) {
        fmt = fmt.replace(RegExp.$1, (dt.getFullYear() + "").substr(4 - RegExp.$1.length));
    }
    for (var k in o) {
        if (new RegExp("(" + k + ")").test(fmt)) {
            fmt = fmt.replace(RegExp.$1, (RegExp.$1.length == 1) ? (o[k]) : (("00" + o[k]).substr(("" + o[k]).length)));
        }
    }
    return fmt;
}


function getDeltaT(beginTime) {
    var diff = '';
    var time_diff = new Date().getTime() - beginTime; //时间差的毫秒数 

    //计算出相差天数 
    var days = Math.floor(time_diff / (24 * 3600 * 1000));
    if (days > 0) {
        diff += days + '天';
    }
    //计算出小时数 
    var leave1 = time_diff % (24 * 3600 * 1000);
    var hours = Math.floor(leave1 / (3600 * 1000));
    if (hours > 0) {
        diff += hours + '小时';
    } else {
        if (diff !== '') {
            diff += hours + '小时';
        }
    }
    //计算相差分钟数 
    var leave2 = leave1 % (3600 * 1000);
    var minutes = Math.floor(leave2 / (60 * 1000));
    if (minutes > 0) {
        diff += minutes + '分';
    } else {
        if (diff !== '') {
            diff += minutes + '分';
        }
    }
    //计算相差秒数 
    var leave3 = leave2 % (60 * 1000);
    var seconds = Math.round(leave3 / 1000);
    if (seconds > 0) {
        diff += seconds + '秒';
    } else {
        if (diff !== '') {
            diff += seconds + '秒';
        }
    }
    return diff;
}


async function createFIFO(file) {
    return new Promise(async (resolve, reject) => {
        if (fs.existsSync(file)) {
            if (fs.statSync(file).isFIFO()) {
                resolve({ ok: true, msg: 'file exist is fifo', file })
            } else {
                resolve({ ok: false, msg: 'file exist not fifo', file })
            }
        } else {
            let proc = spawn('mkfifo', [file])
            proc.on('exit', (code, signal) => {
                if (code === 0) {
                    resolve({ ok: true, msg: 'mkfifo ret 0', file })
                }
                else {
                    resolve({ ok: true, msg: `mkfifo ret ${code}`, file })
                }
            })
            proc.on("error", err => reject(err))
        }
    })
}

/**
 * 获取本地绑定的ip地址(该方法谨慎使用，因为有可能会出现ip地址获取错误)
 * @returns {Promise<null|{ip: string, name: string}>}
 */
async function getLocalIp() {
    const nets = networkInterfaces();

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (['vEthernet', 'VMware', 'docker', 'wsl', 'veth', 'br-'].findIndex(x => name.includes(x)) >= 0) {
                continue;
            }

            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (net.family === 'IPv4' && !net.internal) {
                return { name, ip: net.address };
            }
        }
    }
    return null;
}

/**
 * get random string
 * @returns {string}
 */
function getRandomStr() {
    return Math.random().toString(36).substring(2);
}

let MD5_func = function (d) { var r = M(V(Y(X(d), 8 * d.length))); return r.toLowerCase() }; function M(d) { for (var _, m = "0123456789ABCDEF", f = "", r = 0; r < d.length; r++)_ = d.charCodeAt(r), f += m.charAt(_ >>> 4 & 15) + m.charAt(15 & _); return f } function X(d) { for (var _ = Array(d.length >> 2), m = 0; m < _.length; m++)_[m] = 0; for (m = 0; m < 8 * d.length; m += 8)_[m >> 5] |= (255 & d.charCodeAt(m / 8)) << m % 32; return _ } function V(d) { for (var _ = "", m = 0; m < 32 * d.length; m += 8)_ += String.fromCharCode(d[m >> 5] >>> m % 32 & 255); return _ } function Y(d, _) { d[_ >> 5] |= 128 << _ % 32, d[14 + (_ + 64 >>> 9 << 4)] = _; for (var m = 1732584193, f = -271733879, r = -1732584194, i = 271733878, n = 0; n < d.length; n += 16) { var h = m, t = f, g = r, e = i; f = md5_ii(f = md5_ii(f = md5_ii(f = md5_ii(f = md5_hh(f = md5_hh(f = md5_hh(f = md5_hh(f = md5_gg(f = md5_gg(f = md5_gg(f = md5_gg(f = md5_ff(f = md5_ff(f = md5_ff(f = md5_ff(f, r = md5_ff(r, i = md5_ff(i, m = md5_ff(m, f, r, i, d[n + 0], 7, -680876936), f, r, d[n + 1], 12, -389564586), m, f, d[n + 2], 17, 606105819), i, m, d[n + 3], 22, -1044525330), r = md5_ff(r, i = md5_ff(i, m = md5_ff(m, f, r, i, d[n + 4], 7, -176418897), f, r, d[n + 5], 12, 1200080426), m, f, d[n + 6], 17, -1473231341), i, m, d[n + 7], 22, -45705983), r = md5_ff(r, i = md5_ff(i, m = md5_ff(m, f, r, i, d[n + 8], 7, 1770035416), f, r, d[n + 9], 12, -1958414417), m, f, d[n + 10], 17, -42063), i, m, d[n + 11], 22, -1990404162), r = md5_ff(r, i = md5_ff(i, m = md5_ff(m, f, r, i, d[n + 12], 7, 1804603682), f, r, d[n + 13], 12, -40341101), m, f, d[n + 14], 17, -1502002290), i, m, d[n + 15], 22, 1236535329), r = md5_gg(r, i = md5_gg(i, m = md5_gg(m, f, r, i, d[n + 1], 5, -165796510), f, r, d[n + 6], 9, -1069501632), m, f, d[n + 11], 14, 643717713), i, m, d[n + 0], 20, -373897302), r = md5_gg(r, i = md5_gg(i, m = md5_gg(m, f, r, i, d[n + 5], 5, -701558691), f, r, d[n + 10], 9, 38016083), m, f, d[n + 15], 14, -660478335), i, m, d[n + 4], 20, -405537848), r = md5_gg(r, i = md5_gg(i, m = md5_gg(m, f, r, i, d[n + 9], 5, 568446438), f, r, d[n + 14], 9, -1019803690), m, f, d[n + 3], 14, -187363961), i, m, d[n + 8], 20, 1163531501), r = md5_gg(r, i = md5_gg(i, m = md5_gg(m, f, r, i, d[n + 13], 5, -1444681467), f, r, d[n + 2], 9, -51403784), m, f, d[n + 7], 14, 1735328473), i, m, d[n + 12], 20, -1926607734), r = md5_hh(r, i = md5_hh(i, m = md5_hh(m, f, r, i, d[n + 5], 4, -378558), f, r, d[n + 8], 11, -2022574463), m, f, d[n + 11], 16, 1839030562), i, m, d[n + 14], 23, -35309556), r = md5_hh(r, i = md5_hh(i, m = md5_hh(m, f, r, i, d[n + 1], 4, -1530992060), f, r, d[n + 4], 11, 1272893353), m, f, d[n + 7], 16, -155497632), i, m, d[n + 10], 23, -1094730640), r = md5_hh(r, i = md5_hh(i, m = md5_hh(m, f, r, i, d[n + 13], 4, 681279174), f, r, d[n + 0], 11, -358537222), m, f, d[n + 3], 16, -722521979), i, m, d[n + 6], 23, 76029189), r = md5_hh(r, i = md5_hh(i, m = md5_hh(m, f, r, i, d[n + 9], 4, -640364487), f, r, d[n + 12], 11, -421815835), m, f, d[n + 15], 16, 530742520), i, m, d[n + 2], 23, -995338651), r = md5_ii(r, i = md5_ii(i, m = md5_ii(m, f, r, i, d[n + 0], 6, -198630844), f, r, d[n + 7], 10, 1126891415), m, f, d[n + 14], 15, -1416354905), i, m, d[n + 5], 21, -57434055), r = md5_ii(r, i = md5_ii(i, m = md5_ii(m, f, r, i, d[n + 12], 6, 1700485571), f, r, d[n + 3], 10, -1894986606), m, f, d[n + 10], 15, -1051523), i, m, d[n + 1], 21, -2054922799), r = md5_ii(r, i = md5_ii(i, m = md5_ii(m, f, r, i, d[n + 8], 6, 1873313359), f, r, d[n + 15], 10, -30611744), m, f, d[n + 6], 15, -1560198380), i, m, d[n + 13], 21, 1309151649), r = md5_ii(r, i = md5_ii(i, m = md5_ii(m, f, r, i, d[n + 4], 6, -145523070), f, r, d[n + 11], 10, -1120210379), m, f, d[n + 2], 15, 718787259), i, m, d[n + 9], 21, -343485551), m = safe_add(m, h), f = safe_add(f, t), r = safe_add(r, g), i = safe_add(i, e) } return Array(m, f, r, i) } function md5_cmn(d, _, m, f, r, i) { return safe_add(bit_rol(safe_add(safe_add(_, d), safe_add(f, i)), r), m) } function md5_ff(d, _, m, f, r, i, n) { return md5_cmn(_ & m | ~_ & f, d, _, r, i, n) } function md5_gg(d, _, m, f, r, i, n) { return md5_cmn(_ & f | m & ~f, d, _, r, i, n) } function md5_hh(d, _, m, f, r, i, n) { return md5_cmn(_ ^ m ^ f, d, _, r, i, n) } function md5_ii(d, _, m, f, r, i, n) { return md5_cmn(m ^ (_ | ~f), d, _, r, i, n) } function safe_add(d, _) { var m = (65535 & d) + (65535 & _); return (d >> 16) + (_ >> 16) + (m >> 16) << 16 | 65535 & m } function bit_rol(d, _) { return d << _ | d >>> 32 - _ }
function md5(resStr) {
    return MD5_func(resStr);
}

module.exports = { downloadFileAsync, downloadFileAsyncWithCancel, formatDate, getDeltaT, createFIFO, getLocalIp, getRandomStr, md5 }