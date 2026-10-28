import arrow from './arrow'

import circle from './circle'
import rect from './rect'
import parallelogram from './parallelogram'
import triangle from './triangle'
import fibonacciCircle from './fibonacciCircle'
import fibonacciSegment from './fibonacciSegment'
import scFibonacciLine from './fibonacciLine'
import fibonacciSpiral from './fibonacciSpiral'
import fibonacciSpeedResistanceFan from './fibonacciSpeedResistanceFan'
import fibonacciExtension from './fibonacciExtension'
import gannBox from './gannBox'
import threeWaves from './threeWaves'
import fiveWaves from './fiveWaves'
import eightWaves from './eightWaves'
import anyWaves from './anyWaves'
import abcd from './abcd'
import xabcd from './xabcd'
import { positionLong, positionShort } from './position'
import { priceRange, dateRange, priceDateRange } from './measure'
import { arrowUp, arrowDown, ellipse, pitchfork } from './tvTools'
import { fibonacciTimeZone, gannFan, schiff } from './tvTools2'
import { flag, gannSquare, curve, arc } from './tvTools3'
import { modifiedSchiff, rotatedRect, doubleCurve } from './tvTools4'
import { text, note, callout, priceLabel, signpost } from './textTools'
import { brush, highlighter } from './brush'
import { anchoredVWAP, fixedRangeVolumeProfile, regressionTrend, anchoredVolumeProfile } from './volumeTools'
import { pin, forecast, disjointChannel, fibonacciSpeedResistanceArc } from './tvTools5'
import { image } from './imageTool'

const overlays = [
  arrow,
  circle, rect, triangle, parallelogram,
  fibonacciCircle, fibonacciSegment, scFibonacciLine, fibonacciSpiral,
  fibonacciSpeedResistanceFan, fibonacciExtension, gannBox,
  threeWaves, fiveWaves, eightWaves, anyWaves, abcd, xabcd,
  positionLong, positionShort,
  priceRange, dateRange, priceDateRange,
  arrowUp, arrowDown, ellipse, pitchfork,
  fibonacciTimeZone, gannFan, schiff,
  flag, gannSquare, curve, arc,
  modifiedSchiff, rotatedRect, doubleCurve,
  text, note, callout, priceLabel, signpost,
  brush, highlighter,
  anchoredVWAP, fixedRangeVolumeProfile, regressionTrend, anchoredVolumeProfile,
  pin, forecast, disjointChannel, fibonacciSpeedResistanceArc,
  image
]

export default overlays
