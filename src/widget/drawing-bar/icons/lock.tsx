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

// The no-op clipPath (a rect exactly covering the 0..22 viewBox) is dropped:
// it changed nothing visually and its fixed id collided with any other rail
// icon sharing the same id on the page — SC-058.
export default () => (
  <svg class="icon-overlay" viewBox="0 0 22 22">
    <path d="M14.54,9.77L15.65,9.77C16.65,9.77,17.46,10.58,17.46,11.58L17.46,17.19C17.46,18.19,16.65,19,15.65,19L5.81,19C4.81,19,4,18.19,4,17.19L4,11.58C4,10.58,4.81,9.77,5.81,9.77L7.23,9.77L7.23,7.58C7.23,5.62,8.88,4,10.88,4C12.88,4,14.54,5.62,14.54,7.58L14.54,9.77ZM10.88,5.15C9.5,5.15,8.38,6.23,8.38,7.58L8.38,9.77L13.38,9.77L13.38,7.58C13.38,6.23,12.27,5.15,10.88,5.15ZM15.65,17.85C16,17.85,16.31,17.54,16.31,17.19L16.31,11.58C16.31,11.23,16,10.92,15.65,10.92L5.81,10.92C5.46,10.92,5.15,11.23,5.15,11.58L5.15,17.19C5.15,17.54,5.46,17.85,5.81,17.85L15.65,17.85ZM10.15,12.65C10.15,12.35,10.42,12.08,10.73,12.08C11.04,12.08,11.31,12.35,11.31,12.65L11.31,14.58C11.31,14.88,11.04,15.15,10.73,15.15C10.42,15.15,10.15,14.88,10.15,14.58L10.15,12.65Z" stroke-opacity="0" fill-rule="evenodd" fill-opacity="1"/>
  </svg>
)
