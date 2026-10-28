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

// The no-op clipPath is dropped (see lock.tsx) — SC-058.
export default (className?: string) => (
  <svg class={`icon-overlay ${className ?? ''}`} viewBox="0 0 22 22">
    <path d="M19.67,3.07C19.44,2.94,19.15,3,19,3.22L17.46,5.51L16.74,3.78L13.99,7.47L13.96,7.51C13.83,7.73,13.89,8.01,14.1,8.15L14.15,8.18C14.37,8.31,14.65,8.25,14.8,8.05L16.49,5.79L17.25,7.61L19.84,3.76L19.87,3.72C19.99,3.48,19.9,3.2,19.67,3.07ZM4.8,8.46L10.12,3.25C10.31,3.06,10.63,3.06,10.83,3.25L13.41,5.78C13.61,5.98,13.61,6.29,13.41,6.48L8.09,11.69C7.49,12.28,7.52,13.33,8.15,13.95C8.79,14.58,9.85,14.6,10.46,14.01L15.78,8.8C15.97,8.61,16.29,8.61,16.49,8.8L19.07,11.33C19.27,11.52,19.27,11.83,19.07,12.03L13.75,17.24C11.33,19.62,7.3,19.58,4.86,17.18C2.41,14.78,2.37,10.84,4.8,8.46ZM12.35,6.13L10.47,4.3L5.51,9.16C3.48,11.15,3.51,14.47,5.57,16.48C7.63,18.5,11.01,18.53,13.04,16.54L15.68,13.95L14.29,12.59L15,11.89L16.39,13.26L18.01,11.68L16.13,9.84L11.17,14.7C10.19,15.67,8.54,15.65,7.51,14.72L7.44,14.65C6.42,13.65,6.38,11.98,7.38,10.99L10.02,8.41L8.62,7.04L9.34,6.34L10.74,7.71L12.35,6.13Z" stroke-opacity="0" fill-rule="evenodd" fill-opacity="1"/>
  </svg>
)
