

class ABSTimer {

    _f = undefined;
    _ms = 0;
    _lastTime = undefined;
    _taskId = undefined;
    _ready = false;

    constructor(f, ms) {

        this._f = f;
        this._ms = ms;
        this._lastTime = new Date().getTime();
        this._ready = true;

        this.triggerTask();
    }


    triggerTask() {

        if (!this._ready) {

            return;
        }

        let currTime = new Date().getTime();
        let timeToCall = Math.max(0, Math.round(this._ms - (currTime - this._lastTime)));

        this._taskId = setTimeout(() => {

            this._f();

            this.triggerTask();

        }, timeToCall);

        this._lastTime = currTime + timeToCall;

    }


    cancel() {

        this._ready = false;

        if (this._taskId) {

            clearTimeout(this._taskId);
            this._taskId = undefined
        }

    }


}

function setInterval_ABSTimer(f, ms) {

   return new ABSTimer(f, ms);

}

function clearInterval_ABSTimer(abstimer) {

   abstimer.cancel();
}


module.exports = {setInterval_ABSTimer, clearInterval_ABSTimer};