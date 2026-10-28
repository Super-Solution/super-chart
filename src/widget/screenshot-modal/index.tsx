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

import { Component, createSignal } from 'solid-js'

import { Modal } from '../../component'

import i18n from '../../i18n'

export interface ScreenshotModalProps {
  locale: string
  url: string
  /** The name to download as, already computed (SC-015: `${ticker}_${period}_${date}.${ext}`), e.g. from screenshotFilename(). */
  filename: string
  onClose: () => void
}

/** Solid needs `!important` for `clipboard`'s no-secure-context/no-`ClipboardItem` fallback below; this stays a plain function so it degrades to false in a headless test with a stub clipboard too. */
function canCopyImages (): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write !== undefined
}

const ScreenshotModal: Component<ScreenshotModalProps> = props => {
  const [copied, setCopied] = createSignal(false)

  const copy = (): void => {
    // Must run synchronously inside the click handler (or Safari/Chrome may
    // refuse the write as not being a direct user gesture): fetch the data
    // URL and hand the Blob promise straight to ClipboardItem.
    const blob = fetch(props.url).then(async r => await r.blob())
    void navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(
      () => { setCopied(true); setTimeout(() => { setCopied(false) }, 1500) },
      () => {}
    )
  }

  return (
    <Modal
      title={i18n('screenshot', props.locale)}
      locale={props.locale}
      width={540}
      buttons={[
        ...(canCopyImages()
          ? [{ type: 'cancel' as const, children: copied() ? i18n('confirm', props.locale) : i18n('copy_image', props.locale), onClick: copy }]
          : []),
        {
          type: 'confirm',
          children: i18n('save', props.locale),
          onClick: () => {
            const a = document.createElement('a')
            a.download = props.filename
            a.href = props.url
            document.body.appendChild(a)
            a.click()
            a.remove()
          }
        }
      ]}
      onClose={props.onClose}>
      {/* As wide as the dialog's body, so it never adds a scrollbar (SC-078, SC-071). */}
      <img class="klinecharts-pro-screenshot-image" alt={i18n('chart_screenshot', props.locale)} src={props.url}/>
    </Modal>
  )
}

export default ScreenshotModal
