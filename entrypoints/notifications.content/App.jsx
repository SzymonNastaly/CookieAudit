import {useEffect, useRef, useState} from 'react';
import './styles.css';
import {delay} from '../modules/globals.js';

export default () => {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [color, setColor] = useState('blue');
  const [inactionBtnText, setInactionBtnText] = useState('');
  const [actionBtnText, setActionBtnText] = useState('');
  const [time, _setTime] = useState(0);
  const timeRef = useRef(time);
  function setTime(t) {
    _setTime(t);
    timeRef.current = t;
  }

  const [showButtons, setShowButtons] = useState(false);

  const timerIdRef = useRef(null);
  const sendResponseRef = useRef(null);


  // Inline style object that uses the state for the border color
  const style = {
    borderLeft: `5px solid ${color}`
  };

  function closeEl(_, el, sendResponse) {
    el.close();
    sendResponse({msg: 'ok'});
  }

  async function notificationTime(text) {
    let settings = await storage.getItem('local:settings');
    if (settings != null && settings.fastMode) {
      return 100;
    }
    const wpm = 60;
    const wordLength = 5;
    let words = text.length / wordLength;
    const wordsTime = ((words / wpm) * 60) * 100;
    const delay = 2500;
    return wordsTime + delay;
  }

  function startTimer() {
    timerIdRef.current = setInterval(() => {
      if (timeRef.current > 0) {
        setTime(timeRef.current-1);
      } else {
        sendResponseRef.current?.({msg: 'action'});
        clearInterval(timerIdRef.current);
        let el = document.querySelector('#notification-popover');
        el.hidePopover();
      }
    }, 1000);
  }

  function handleInactionBtn() {
    clearInterval(timerIdRef.current);
    let el = document.querySelector('#notification-popover');
    el.hidePopover();
    sendResponseRef.current?.({msg: 'inaction'});
  }

  function handleActionBtn() {
    clearInterval(timerIdRef.current);
    let el = document.querySelector('#notification-popover');
    el.hidePopover();
    sendResponseRef.current?.({msg: 'action'});
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
        let time = await notificationTime(text);
        await delay(time);
        if (el.open) {
          el.removeEventListener('click', closeEl);
          el.close();
          sendResponse({msg: 'ok'});
        }
      })();
      return true;
    } else if (msg === 'popover') {
      const {title, text, color, buttons} = message;
      setTitle(title);
      setText(text);
      setColor(color);
      if (buttons != null) {
        setActionBtnText(buttons.action);
        setInactionBtnText(buttons.inaction);
        setTime(buttons.time)
        setShowButtons(true);
      } else {
        setActionBtnText('');
        setInactionBtnText('');
        setTime(0);
        setShowButtons(false);
        timerIdRef.current = null;
      }
      (async () => {
        let el = document.querySelector('#notification-popover');
        el.showPopover();
        if (buttons != null) {
          sendResponseRef.current = sendResponse;
          startTimer();
        } else {
          if (color === 'red') {
            await delay(30000);
          } else {
            let time = await notificationTime(text);
            await delay(time);
          }
          el.hidePopover();
          sendResponse({msg: 'ok'});
        }
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
      {showButtons && (<div id="button-container">
        <button onClick={handleInactionBtn}>{inactionBtnText}</button>
        <button onClick={handleActionBtn}>{actionBtnText} ( {time}s )</button>
      </div>)}
    </div>
  </>);
};