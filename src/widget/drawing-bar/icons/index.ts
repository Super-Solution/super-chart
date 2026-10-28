/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Component, from } from 'solid-js'

import horizontalStraightLine from './horizontalStraightLine'
import horizontalRayLine from './horizontalRayLine'
import horizontalSegment from './horizontalSegment'
import verticalStraightLine from './verticalStraightLine'
import verticalRayLine from './verticalRayLine'
import verticalSegment from './verticalSegment'
import straightLine from './straightLine'
import rayLine from './rayLine'
import segment from './segment'
import arrow from './arrow'
import priceLine from './priceLine'
import priceChannelLine from './priceChannelLine'
import parallelStraightLine from './parallelStraightLine'
import fibonacciLine from './fibonacciLine'
import fibonacciSegment from './fibonacciSegment'
import fibonacciCircle from './fibonacciCircle'
import fibonacciSpiral from './fibonacciSpiral'
import fibonacciSpeedResistanceFan from './fibonacciSpeedResistanceFan'
import fibonacciExtension from './fibonacciExtension'
import gannBox from './gannBox'
import circle from './circle'
import triangle from './triangle'
import rect from './rect'
import parallelogram from './parallelogram'
import threeWaves from './threeWaves'
import fiveWaves from './fiveWaves'
import eightWaves from './eightWaves'
import anyWaves from './anyWaves'
import abcd from './abcd'
import xabcd from './xabcd'
import positionLong from './positionLong'
import positionShort from './positionShort'
import priceRange from './priceRange'
import dateRange from './dateRange'
import priceDateRange from './priceDateRange'
import arrowUp from './arrowUp'
import arrowDown from './arrowDown'
import ellipse from './ellipse'
import pitchfork from './pitchfork'
import fibonacciTimeZone from './fibonacciTimeZone'
import gannFan from './gannFan'
import schiff from './schiff'
import flag from './flag'
import gannSquare from './gannSquare'
import curve from './curve'
import arc from './arc'
import modifiedSchiff from './modifiedSchiff'
import rotatedRect from './rotatedRect'
import doubleCurve from './doubleCurve'
import text from './text'
import note from './note'
import callout from './callout'
import priceLabel from './priceLabel'
import signpost from './signpost'
import brush from './brush'
import highlighter from './highlighter'
import anchoredVWAP from './anchoredVWAP'
import fixedRangeVolumeProfile from './fixedRangeVolumeProfile'
import regressionTrend from './regressionTrend'
import pin from './pin'
import forecast from './forecast'
import disjointChannel from './disjointChannel'
import fibonacciSpeedResistanceArc from './fibonacciSpeedResistanceArc'
import anchoredVolumeProfile from './anchoredVolumeProfile'
import image from './image'

import weakMagnet from './weakMagnet'
import strongMagnet from './strongMagnet'

import visible from './visible'
import invisible from './invisible'

import lock from './lock'
import unlock from './unlock'

import remove from './remove'

// The create*Options factories live in ./options (pure data, no JSX import),
// so a *.test.ts can use them without pulling in every icon .tsx file — see
// the comment there. Re-exported here so `from './icons'` keeps resolving
// both the Icon component and the option lists, as before.
export * from './options'

export const mapping = {
  horizontalStraightLine,
  horizontalRayLine,
  horizontalSegment,
  verticalStraightLine,
  verticalRayLine,
  verticalSegment,
  straightLine,
  rayLine,
  segment,
  arrow,
  priceLine,
  priceChannelLine,
  parallelStraightLine,
  fibonacciLine,
  fibonacciSegment,
  fibonacciCircle,
  fibonacciSpiral,
  fibonacciSpeedResistanceFan,
  fibonacciExtension,
  gannBox,
  circle,
  triangle,
  rect,
  parallelogram,
  threeWaves,
  fiveWaves,
  eightWaves,
  anyWaves,
  abcd,
  xabcd,
  positionLong,
  positionShort,
  priceRange,
  dateRange,
  priceDateRange,
  arrowUp,
  arrowDown,
  ellipse,
  pitchfork,
  fibonacciTimeZone,
  gannFan,
  schiff,
  flag,
  gannSquare,
  curve,
  arc,
  modifiedSchiff,
  rotatedRect,
  doubleCurve,
  text,
  note,
  callout,
  priceLabel,
  signpost,
  brush,
  highlighter,
  anchoredVWAP,
  fixedRangeVolumeProfile,
  regressionTrend,
  pin,
  forecast,
  disjointChannel,
  fibonacciSpeedResistanceArc,
  anchoredVolumeProfile,
  image,
  weak_magnet: weakMagnet,
  strong_magnet: strongMagnet,
  lock,
  unlock,
  visible,
  invisible,
  remove
}


interface IconProps {
  class?: string
  name: string
}

/**
 * A drawing-rail icon. Decorative: the control around it carries the name, so
 * the SVG is hidden from assistive technology.
 */
export const Icon: Component<IconProps> = props => {
  // @ts-expect-error
  const svg = mapping[props.name](props.class) as Element
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  return svg
}
