"use strict";

var _TextStyle = require("./TextStyle");

var _TextMetrics = require("./TextMetrics");

const {createCanvas} = require('canvas');

var TEXT_GRADIENT = {
    LINEAR_VERTICAL: 0,
    LINEAR_HORIZONTAL: 1
  };

function sign(n) {
    if (n === 0) return 0;
    return n < 0 ? -1 : 1;
  }

class Text {
  constructor(text, style) {
    this.canvas = createCanvas(3, 3);
    this.context = this.canvas.getContext("2d");
    this._text = null;
    this._style = null;
    this._styleListener = null;
    this._font = "";
    this.text = text;
    this.style = style;
    this.updateStyle(style);
    this.localStyleID = -1;
  }

  updateText() {
    var style = this._style;

    if (this.localStyleID !== style.styleID) {
      this.dirty = true;
      this.localStyleID = style.styleID;
    }

    if (!this.dirty) {
      return;
    }

    this._font = this._style.toFontString();
    var context = this.context;

    var measured = _TextMetrics.measureText(this._text, this._style, this._style.wordWrap, this.canvas);

    var width = measured.width;
    var height = measured.height;
    var lines = measured.lines;
    var lineHeight = measured.lineHeight;
    var lineWidths = measured.lineWidths;
    var maxLineWidth = measured.maxLineWidth;
    var fontProperties = measured.fontProperties;
    this.canvas.width = Math.ceil((Math.max(1, width) + style.padding * 2));
    this.canvas.height = Math.ceil((Math.max(1, height) + style.padding * 2));

    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawBackground(style);
    context.font = this._font;
    context.strokeStyle = style.stroke;
    context.lineWidth = style.strokeThickness;
    context.textBaseline = style.textBaseline;
    context.lineJoin = style.lineJoin;
    context.miterLimit = style.miterLimit;
    var linePositionX;
    var linePositionY;

    if (style.dropShadow) {
      context.fillStyle = style.dropShadowColor;
      context.globalAlpha = style.dropShadowAlpha;
      context.shadowBlur = style.dropShadowBlur;

      if (style.dropShadowBlur > 0) {
        context.shadowColor = style.dropShadowColor;
      }

      var xShadowOffset = Math.cos(style.dropShadowAngle) * style.dropShadowDistance;
      var yShadowOffset = Math.sin(style.dropShadowAngle) * style.dropShadowDistance;

      for (var i = 0; i < lines.length; i++) {
        linePositionX = style.strokeThickness / 2;
        linePositionY = style.strokeThickness / 2 + i * lineHeight + fontProperties.ascent;

        if (style.align === "right") {
          linePositionX += maxLineWidth - lineWidths[i];
        } else if (style.align === "center") {
          linePositionX += (maxLineWidth - lineWidths[i]) / 2;
        }

        if (style.fill) {
          this.drawLetterSpacing(lines[i], linePositionX + xShadowOffset + style.padding, linePositionY + yShadowOffset + style.padding);

          if (style.stroke && style.strokeThickness) {
            context.strokeStyle = style.dropShadowColor;
            this.drawLetterSpacing(lines[i], linePositionX + xShadowOffset + style.padding, linePositionY + yShadowOffset + style.padding, true);
            context.strokeStyle = style.stroke;
          }
        }
      }
    }

    context.shadowBlur = 0;
    context.globalAlpha = 1;
    context.fillStyle = this._generateFillStyle(style, lines); // draw lines line by line

    for (var _i = 0; _i < lines.length; _i++) {
      linePositionX = style.strokeThickness / 2;
      linePositionY = style.strokeThickness / 2 + _i * lineHeight + fontProperties.ascent;

      if (style.align === "right") {
        linePositionX += maxLineWidth - lineWidths[_i];
      } else if (style.align === "center") {
        linePositionX += (maxLineWidth - lineWidths[_i]) / 2;
      }

      if (style.stroke && style.strokeThickness) {
        this.drawLetterSpacing(lines[_i], linePositionX + style.padding, linePositionY + style.padding, true);
      }

      if (style.fill) {
        this.drawLetterSpacing(lines[_i], linePositionX + style.padding, linePositionY + style.padding);
      }
    }

  }

  drawBackground(style) {
    var background = style.background || style.backgroundColor;
    if (!background) return;
    var {
      context,
      canvas,
      text
    } = this;
    var ftext = String(text).trim();

    if (ftext) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  drawLetterSpacing(text, x, y, isStroke) {
    if (isStroke === void 0) {
      isStroke = false;
    }

    var style = this._style; // letterSpacing of 0 means normal

    var letterSpacing = style.letterSpacing;

    if (letterSpacing === 0) {
      if (isStroke) {
        this.context.strokeText(text, x, y);
      } else {
        this.context.fillText(text, x, y);
      }

      return;
    }

    var characters = String.prototype.split.call(text, "");
    var currentPosition = x;
    var index = 0;
    var current = "";
    var previousWidth = this.context.measureText(text).width;
    var currentWidth = 0;

    while (index < text.length) {
      current = characters[index++];

      if (isStroke) {
        this.context.strokeText(current, currentPosition, y);
      } else {
        this.context.fillText(current, currentPosition, y);
      }

      currentWidth = this.context.measureText(text.substring(index)).width;
      currentPosition += previousWidth - currentWidth + letterSpacing;
      previousWidth = currentWidth;
    }
  }

  updateStyle(style) {
    for (var key in style) {
      var newKey = this.camelCase(key);
      if (newKey === "color") newKey = "fill";
      this.style[newKey] = style[key];
    }
  }

  camelCase(name) {
    var SPECIAL_CHARS_REGEXP = /([\:\-\_]+(.))/g;
    var MOZ_HACK_REGEXP = /^moz([A-Z])/;
    return name.replace(SPECIAL_CHARS_REGEXP, function (_, separator, letter, offset) {
      return offset ? letter.toUpperCase() : letter;
    }).replace(MOZ_HACK_REGEXP, "Moz$1");
  }


  _generateFillStyle(style, lines) {
    if (!Array.isArray(style.fill)) {
      return style.fill;
    }

    var gradient;
    var totalIterations;
    var currentIteration;
    var stop;
    var width = this.canvas.width;
    var height = this.canvas.height;
    var fill = style.fill.slice();
    var fillGradientStops = style.fillGradientStops.slice();

    if (!fillGradientStops.length) {
      var lengthPlus1 = fill.length + 1;

      for (var i = 1; i < lengthPlus1; ++i) {
        fillGradientStops.push(i / lengthPlus1);
      }
    }

    fill.unshift(style.fill[0]);
    fillGradientStops.unshift(0);
    fill.push(style.fill[style.fill.length - 1]);
    fillGradientStops.push(1);

    if (style.fillGradientType === TEXT_GRADIENT.LINEAR_VERTICAL) {
      gradient = this.context.createLinearGradient(width / 2, 0, width / 2, height);
      totalIterations = (fill.length + 1) * lines.length;
      currentIteration = 0;

      for (var _i2 = 0; _i2 < lines.length; _i2++) {
        currentIteration += 1;

        for (var j = 0; j < fill.length; j++) {
          if (typeof fillGradientStops[j] === "number") {
            stop = fillGradientStops[j] / lines.length + _i2 / lines.length;
          } else {
            stop = currentIteration / totalIterations;
          }

          gradient.addColorStop(stop, fill[j]);
          currentIteration++;
        }
      }
    } else {
      gradient = this.context.createLinearGradient(0, height / 2, width, height / 2);
      totalIterations = fill.length + 1;
      currentIteration = 1;

      for (var _i3 = 0; _i3 < fill.length; _i3++) {
        if (typeof fillGradientStops[_i3] === "number") {
          stop = fillGradientStops[_i3];
        } else {
          stop = currentIteration / totalIterations;
        }

        gradient.addColorStop(stop, fill[_i3]);
        currentIteration++;
      }
    }

    return gradient;
  }

  destroy(options) {
    if (this.destroyed) return;

    if (typeof options === "boolean") {
      options = {
        children: options
      };
    }

    this.context = null;
    this.canvas = null;
    this._style = null;
  }

  get font() {
    return this._font;
  }

  get style() {
    return this._style;
  }

  set style(style) {
    style = style || {};

    if (style instanceof _TextStyle) {
      this._style = style;
    } else {
      this._style = new _TextStyle(style);
    }

    this.localStyleID = -1;
    this.dirty = true;
  }

  get text() {
    return this._text;
  }

  set text(text) {
    text = String(text === "" || text === null || text === undefined ? " " : text);
    if (this._text === text) return;
    this._text = text;
    this.dirty = true;
  }

}

module.exports = Text;
//# sourceMappingURL=Text.js.map