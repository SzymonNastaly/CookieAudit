import {useEffect, useState} from 'react';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import {delay} from '../modules/globals.js';

export default () => {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [color, setColor] = useState('blue');

  // Inline style object that uses the state for the border color
  const style = {
    borderLeft: `5px solid ${color}`
  };

  function closeEl(_, el, sendResponse) {
    el.close();
    sendResponse({msg: 'ok'});
  }

  function notificationTime(text) {
    const wpm = 60;
    const wordLength = 5;
    let words = text.length / wordLength;
    const wordsTime = ((words / wpm) * 60) * 100;
    const delay = 2500;
    return wordsTime + delay;
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
  function handleNotificationMessage(message, sender, sendResponse) {
    const {msg} = message;
    if (msg === 'dialog') {
      const {title, text, color} = message;
      setTitle(title);
      setText(text);
      setColor(color);
      (async () => {
        let el = document.querySelector('#notification-dialog');
        el.showModal();
        el.addEventListener('click', closeEl);
        await delay(notificationTime(text));
        if (el.open) {
          el.removeEventListener('click', closeEl);
          el.close();
          sendResponse({msg: 'ok'});
        }
      })();
      return true;
    } else if (msg === 'popover') {
      const {title, text, color} = message;
      setTitle(title);
      setText(text);
      setColor(color);
      (async () => {
        let el = document.querySelector('#notification-popover');
        el.showPopover();
        if (color === 'red') {
          await delay(30000);
        } else {
          await delay(notificationTime(text));
        }
        el.hidePopover();
        sendResponse({msg: 'ok'});
      })();
      return true;
    }
  }

  useEffect(() => {
    browser.runtime.onMessage.addListener(handleNotificationMessage);

    return () => {
      browser.runtime.onMessage.removeListener(handleNotificationMessage);
    };
  }, []);

  return (<>
    <dialog id="notification-dialog">
      <div id="dialog-div">
        <p id="title">{title}</p>
        <p id="text" dangerouslySetInnerHTML={{__html: text}}></p>
      </div>
    </dialog>
    <div popover="manual" id="notification-popover">
      <div id="popover-div" style={style}>
        <p id="title">{title}</p>
        <p id="text" dangerouslySetInnerHTML={{__html: text}}></p>
      </div>
    </div>
  </>);
};