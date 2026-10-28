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

export default (className?: string) => (
  <svg class={`icon-overlay ${className ?? ''}`} viewBox="0 0 22 22">
    <path d="M4.73,8.01L9.97,2.76C10.17,2.57,10.48,2.57,10.67,2.76L13.22,5.31C13.42,5.51,13.42,5.82,13.22,6.01L7.98,11.26C7.38,11.86,7.41,12.91,8.03,13.54C8.66,14.16,9.71,14.19,10.31,13.59L15.56,8.35C15.75,8.15,16.06,8.15,16.26,8.35L18.81,10.9C19,11.09,19,11.4,18.81,11.6L13.56,16.84C11.17,19.24,7.2,19.2,4.78,16.79C2.37,14.37,2.33,10.4,4.73,8.01ZM12.17,5.66L10.32,3.81L5.43,8.71C3.42,10.71,3.45,14.06,5.48,16.08C7.51,18.11,10.86,18.15,12.86,16.14L15.47,13.54L14.09,12.16L14.79,11.46L16.17,12.83L17.76,11.25L15.91,9.4L11.01,14.29C10.04,15.26,8.42,15.24,7.41,14.31L7.33,14.24C6.33,13.23,6.28,11.55,7.28,10.56L9.88,7.95L8.5,6.57L9.2,5.87L10.58,7.25L12.17,5.66Z" stroke-opacity="0" fill-rule="evenodd" fill-opacity="1"/>
  </svg>
)
