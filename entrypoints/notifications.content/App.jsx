import { useEffect, useState } from 'react'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './styles.css'
import { delay } from '../modules/globals.js'

export default () => {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')

  function closeEl (_, el, sendResponse) {
    el.close()
    sendResponse({ msg: 'ok' })
  }

  /**
   * @typedef {Object} MessageObject
   * @property {string} msg - The message string.
   */
  /**
   * start selector when a message is received
   * @param {MessageObject} message
   * @param sender
   * @param sendResponse
   */
  function handleNotificationMessage (message, sender, sendResponse) {
    const NOTIFICATION_TIME = 4000
    const { msg } = message
    if (msg === 'dialog') {
      const { title, text } = message
      setTitle(title)
      setText(text);
      (async () => {
        let el = document.querySelector('#notification-dialog')
        el.showModal()
        el.addEventListener('click', closeEl)
        await delay(NOTIFICATION_TIME)
        if (el.open) {
          el.removeEventListener('click', closeEl)
          el.close()
          sendResponse({ msg: 'ok' })
        }
      })()
      return true
    } else if (msg === 'popover') {
      const { title, text } = message
      setTitle(title)
      setText(text);
      (async () => {
        let el = document.querySelector('#notification-popover')
        el.showPopover()
        await delay(NOTIFICATION_TIME)
        el.hidePopover()
        sendResponse({ msg: 'ok' })
      })()
      return true
    }
  }

  useEffect(() => {
    browser.runtime.onMessage.addListener(handleNotificationMessage)

    return () => {
      browser.runtime.onMessage.removeListener(handleNotificationMessage)
    }
  }, [])

  return (
    <>
      <dialog id="notification-dialog">
        <div id="dialog-div">
          <p id="title">{title}</p>
          <p id="text">{text}</p>
        </div>
      </dialog>
      <div popover="manual" id="notification-popover">
        <div id="popover-div">
          <p id="title">{title}</p>
          <p id="text">{text}</p>
        </div>
      </div>
    </>
  )
};