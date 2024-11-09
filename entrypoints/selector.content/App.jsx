import {IconArrowDown, IconArrowUp, IconCheck, IconX} from '@tabler/icons-react';
import {useEffect, useRef, useState} from 'react';
import './App.module.css';
import {storage} from 'wxt/storage';
import {debug} from '../debug.js';
import {get_clickable_elements, selectionFromSelectedNotice, STAGE} from '../modules/globals.js';

export default () => {
  const unwatchMousemoveRef = useRef(null);

  // Function to call when the selection has been confirmed. Sends response back to background.js
  const sendResponseRef = useRef(null);

  const [isSurfing, _setIsSurfing] = useState(false);
  const isSurfingRef = useRef(isSurfing);

  // refs to handle if click/mousedown/mouseup was handled.
  // reason: some websites capture and stop propagation of click events (but e.g., not mousedown)
  // thus we try to react to any of the three events, in case some are not propagated through the DOM
  const selectParentHandled = useRef(false);
  const selectChildHandled = useRef(false);
  const cancelHandled = useRef(false);
  const confirmHandled = useRef(false);

  function setIsSurfing(isSurfing) {
    isSurfingRef.current = isSurfing;
    _setIsSurfing(isSurfing);
  }

  const [selectedDOMElement, _setSelectedDOMElement] = useState(null);
  const selectedDOMElementRef = useRef(selectedDOMElement);

  const [scrollY, setScrollY] = useState(0);

  function setSelectedDOMElement(selectedDOMElement) {
    selectedDOMElementRef.current = selectedDOMElement;
    _setSelectedDOMElement(selectedDOMElement);
  }

  const interactiveElements = useRef([]);

  const [hoveringDOMElement, setHoveringDOMElement] = useState(null);

  const isInactive = useRef(true);

  const [elementHistory, _setElementHistory] = useState([]);
  const elementHistoryRef = useRef(elementHistory);

  function setElementHistory(elHistory) {
    elementHistoryRef.current = elHistory;
    _setElementHistory(elHistory);
  }

  /**
   * sets size and styling properties of wrap to the properties of the selected node
   * @param {Element} node
   * @param {number} _
   * @return {Object<string, string>}
   */
  function wrapStyle(node, _) {
    if (!node) return {display: 'none'};
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return {
      display: 'block',
      top: (rect.top >= 0) ? rect.top + 'px' : '0px',
      left: (rect.left >= 0) ? rect.left + 'px' : '0px',
      bottom: (rect.bottom >= 0) ? rect.bottom + 'px' : '0px',
      width: rect.width + 'px',
      height: (rect.top >= 0) ? rect.height + 'px' : Math.max(0, rect.height - Math.abs(Number(rect.top))),
      '--bt': parseInt(style.borderTopWidth, 10) >= 0 ? style.borderTopWidth : '0px',
      '--br': parseInt(style.borderRightWidth, 10) >= 0 ? style.borderRightWidth : '0px',
      '--bb': parseInt(style.borderBottomWidth, 10) >= 0 ? style.borderBottomWidth : '0px',
      '--bl': parseInt(style.borderBottomWidth, 10) >= 0 ? style.borderBottomWidth : '0px',
      '--mt': (parseInt(style.marginTop, 10) >= 0 ? style.marginTop : '0px'),
      '--mr': (parseInt(style.marginRight, 10) >= 0 ? style.marginRight : '0px'),
      '--mb': (parseInt(style.marginBottom, 10) >= 0 ? style.marginBottom : '0px'),
      '--ml': (parseInt(style.marginLeft, 10) >= 0 ? style.marginLeft : '0px'),
      '--pt': (parseInt(style.paddingTop, 10) >= 0 ? style.paddingTop : '0px'),
      '--pr': (parseInt(style.paddingRight, 10) >= 0 ? style.paddingRight : '0px'),
      '--pb': (parseInt(style.paddingBottom, 10) >= 0 ? style.paddingBottom : '0px'),
      '--pl': (parseInt(style.paddingLeft, 10) >= 0 ? style.paddingLeft : '0px'),
    };
  }

  /**
   * Maps mouse movement to the currently hovered element, such that it can be highlighted in realtime.
   * @param {MouseEvent} e
   */
  function mapE(e) {
    if (isInactive.current || selectedDOMElementRef.current) return;
    const element = document.elementFromPoint(e.clientX, e.clientY);
    if (!element) return;
    if (element.shadowRoot != null) {
      // the mapped element contains a shadow root
      let root = element.shadowRoot;
      if (root.elementFromPoint(e.clientX, e.clientY) == null) return;
      setHoveringDOMElement(root.elementFromPoint(e.clientX, e.clientY));
    } else {
      setHoveringDOMElement(element);
    }
  }

  /**
   * Reset all relevant selector state to initial values.
   */
  async function reset() {
    await storage.setItem('local:mousemoveListenerActive', false);
    window.removeEventListener('mousemove', mapE);
    window.removeEventListener('mousedown', handleMousedown);
    window.removeEventListener('scroll', handleScroll);
    window.removeEventListener('keydown', handleKeydown);
    let domSelectorData = document.querySelector('#dom-selector-data');
    domSelectorData.close();
    setElementHistory([]);
    setSelectedDOMElement(null);
    setHoveringDOMElement(null);
    setIsSurfing(false);
    isInactive.current = true;
    interactiveElements.current = [];
  }

  function totalWidth(rect) {
    return rect.width + rect.paddingLeft + rect.paddingRight;
  }

  function totalHeight(rect) {
    return rect.height + rect.paddingTop + rect.paddingBottom;
  }

  /**
   * @param {HTMLElement} node - If non-zero area, return it. Otherwise, climb up the tree to find nodes first parent has a non-zero area.
   * @returns {HTMLElement}
   */
  function skipZeroAreaNodes(node) {
    if (node && node.parentElement) {
      let nodeRect = node.getBoundingClientRect();
      while (nodeRect.width === 0 || nodeRect.height === 0) {
        if (!node.parentElement) return null;
        node = node.parentElement;
        nodeRect = node.getBoundingClientRect();
      }
      return node;
    }
  }

  /**
   * Given an element, climb up as long as the parents have the same dimensions (height and width).
   * @param {HTMLElement} startElement
   * @return {HTMLElement}
   */
  function climbUpEquivalenceTree(startElement) {
    if (startElement) {
      let selected = startElement;
      if (selected && skipZeroAreaNodes(selected.parentElement)) {
        let parentEl = skipZeroAreaNodes(selected.parentElement);
        let selectedRect = selected.getBoundingClientRect();
        let parentRect = parentEl.getBoundingClientRect();

        while (selected && parentEl &&
        ((selectedRect.width === parentRect.width && selectedRect.height === parentRect.height) ||
            (totalWidth(selectedRect) === totalWidth(parentRect) && totalHeight(selectedRect) ===
                totalHeight(parentRect)))) {
          selected = parentEl;
          parentEl = skipZeroAreaNodes(parentEl.parentElement);
          if (!parentEl) {
            break;
          }
          selectedRect = selected.getBoundingClientRect();
          parentRect = parentEl.getBoundingClientRect();
        }
      }
      return selected;
    }
  }

  /**
   * When a user clicks, select the element at mouse location, sensibly.
   * Sensible means: if the element at the location has some parent(s) with the same dimensions, choose the highest
   * such parent.
   * @param {MouseEvent} e
   */
  async function handleMousedown(e) {
    if (selectedDOMElementRef.current || isInactive.current) {
      return;
    }
    await storage.setItem('local:mousemoveListenerActive', false);
    window.removeEventListener('mousemove', mapE);
    let selected = document.elementFromPoint(e.clientX, e.clientY);
    if (!selected) return;
    if (selected.shadowRoot != null) {
      // the mapped element contains a shadow root
      let root = selected.shadowRoot;
      selected = root.elementFromPoint(e.clientX, e.clientY);
      if (selected == null) return;
    }

    selected = climbUpEquivalenceTree(selected);
    setSelectedDOMElement(selected);
    if (!selected) console.error('Error: Failed to find the Selected element. Try to fetch again.');

    let domSelectorData = document.querySelector('#dom-selector-data');
    domSelectorData.showModal();
  }

  /**
   * We update a state value on scroll, to force the size/position of the wrapper (which makes the blue highlight)
   * to be recalculated during scrolling.
   * i.e., if a selected element moves out of the screen, the selection should too.
   */
  function handleScroll() {
    setScrollY(Math.round(window.scrollY));
  }

  /**
   * Go up the DOM tree to the next sensible parent.
   * Sensible means skipping parents with no area and skipping parents if multiple parents have the same dimensions.
   */
  function handleSelectParent() {
    if (selectParentHandled.current) return;
    selectParentHandled.current = true;

    let startParent = skipZeroAreaNodes(selectedDOMElementRef.current.parentElement);
    let selected = climbUpEquivalenceTree(startParent);
    if (selected) {
      setElementHistory([...elementHistoryRef.current, selectedDOMElementRef.current]);
      //reset();
      setSelectedDOMElement(selected);
      // Updating the UI
      //setStyle(selected);
      //setPosition();
    }
    setTimeout(() => {
      selectParentHandled.current = false;
    }, 500);
  }

  /**
   * Pops the most recent element off the element history "stack"
   */
  function handleSelectChild() {
    if (selectChildHandled.current) return;
    selectChildHandled.current = true;

    //if (!wrap.classList.contains('selected')) return;
    if (!selectedDOMElementRef.current || elementHistoryRef.current.length === 0) return;

    setSelectedDOMElement(elementHistoryRef.current[elementHistoryRef.current.length - 1]); // set to last element in history
    setElementHistory([...elementHistoryRef.current.slice(0, -1)]); // remove last element

    setTimeout(() => {
      selectChildHandled.current = false;
    }, 500);
  }

  /**
   * When a user clicks the cancel button inside a selector context menu, we update the stage to not_started and reset all relevant data such that the user can select something new
   */
  async function handleCancelBtn() {
    if (cancelHandled.current) return;
    cancelHandled.current = true;

    let domSelectorData = document.querySelector('#dom-selector-data');
    domSelectorData.close();
    setElementHistory([]);
    setSelectedDOMElement(null);
    setHoveringDOMElement(null);
    interactiveElements.current = [];

    setIsSurfing(true);
    isInactive.current = false;
    await storage.setItem('local:mousemoveListenerActive', true);
    window.addEventListener('mousemove', mapE);
    window.addEventListener('scroll', handleScroll);
    window.addEventListener('keydown', handleKeydown);

    setTimeout(() => {
      cancelHandled.current = false;
      window.addEventListener('mousedown', handleMousedown, {once: true});
    }, 500);
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
  function handleSelectorMessage(message, sender, sendResponse) {
    debug.log("Received message in selector:", message);
    const {msg} = message;
    if (msg === 'start_select') {
      debug.log("Starting storage watch connection");
      (async () => {
        await storage.setItem('local:mousemoveListenerActive', true);

        let domSelector = document.querySelector('dom-selector');
        domSelector.showPopover();

        setIsSurfing(true);
        isInactive.current = false;
        sendResponseRef.current = sendResponse;
        window.addEventListener('mousedown', handleMousedown, {once: true});
        window.addEventListener('mousemove', mapE);
        unwatchMousemoveRef.current = storage.watch('local:mousemoveListenerActive', (newValue, oldValue) => {
          debug.log("Storage mousemove listener status changed:", {new: newValue, old: oldValue});
          if (newValue === true && oldValue === false) {
            window.addEventListener('mousemove', mapE);
          } else if (newValue === false && oldValue === true) {
            window.removeEventListener('mousemove', mapE);
          }
        });
        window.addEventListener('scroll', handleScroll);
        window.addEventListener('keydown', handleKeydown);
      })();
      return true;
    } else if (msg === 'cancel_select') {
      (async () => {
        await reset();
        sendResponse({msg: 'ok'});
      })();
      return true;
    }
  }

  async function handleConfirm() {
    if (confirmHandled.current) return;
    confirmHandled.current = true;

    await storage.setItem('local:mousemoveListenerActive', false);
    window.removeEventListener('mousemove', mapE);

    setIsSurfing(false);
    let domSelectorData = document.querySelector('#dom-selector-data');
    domSelectorData.close();

    await browser.runtime.sendMessage({
      msg: 'relay', data: {
        msg: 'popover',
        title: browser.i18n.getMessage('selector_selectedBannerTitle'),
        text: browser.i18n.getMessage('selector_selectedBannerText'),
        color: 'blue',
      },
    });

    let selected = selectedDOMElementRef.current;
    interactiveElements.current = get_clickable_elements(selected);
    await reset();

    /**
     * @type {Selection}
     */
    let selection = await selectionFromSelectedNotice(selected);

    setTimeout(() => {
      confirmHandled.current = false;
    }, 500);

    const scan = await storage.getItem('local:scan');
    if (scan.stage === STAGE.NOTICE_SELECTION) {
      await storage.setItem('local:selection', selection);
    } else if (scan.stage === STAGE.SECOND_SELECTION) {
      /**
       * @type {Selection[]}
       */
      let secondSelections = await storage.getItem('local:second_selections');
      secondSelections.push(selection);
      await storage.setItem('local:second_selections', secondSelections);
    }

    if (sendResponseRef.current == null) {
      throw new Error('No response handler defined in selector content script.');
    } else {
      sendResponseRef.current?.({msg: 'selected_notice'});
    }
  }

  /**
   * Reset selection on press of escape key.
   * @param {KeyboardEvent} event
   */
  async function handleKeydown(event) {
    if (event.key === 'Escape') {
      await handleCancelBtn();
    }
  }

  useEffect(() => {
    debug.log("Initializing message listener");
    browser.runtime.onMessage.addListener(handleSelectorMessage);

    const unwatchSelection = storage.watch('local:selection', async (newSelection, _) => {
      debug.log("Storage watch connection established");
      if (newSelection.notice !== null) {
        await reset();
      }
    });

    return () => {
      debug.log("Cleaning up message and storage connections");
      browser.runtime.onMessage.removeListener(handleSelectorMessage);
      //window.removeEventListener('mouseover', handleMouseover);
      //window.removeEventListener('mouseout', handleMouseout);
      window.removeEventListener('mousemove', mapE);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('mousedown', handleMousedown);
      window.removeEventListener('keydown', handleKeydown);
      unwatchSelection();
      unwatchMousemoveRef.current?.();
    };
  }, []);

  return (<>
    <dialog id="dom-selector-data" style={{
      display: (selectedDOMElement && isSurfing) ? 'flex' : 'none',
    }}>
      <div className="button-row">
        <button
            disabled={!selectedDOMElementRef.current || !skipZeroAreaNodes(selectedDOMElementRef.current.parentElement)}
            className={'dom-selector-parent'}
            onClick={handleSelectParent}
            onMouseDown={handleSelectParent}
            onMouseUp={handleSelectParent}><IconArrowUp size={14}/></button>
        <button
            disabled={elementHistory.length === 0}
            className={'dom-selector-parent'}
            onClick={handleSelectChild}
            onMouseDown={handleSelectChild}
            onMouseUp={handleSelectChild}><IconArrowDown size={14}/></button>
      </div>
      <button id="cancelBtn"
              onClick={handleCancelBtn}
              onMouseDown={handleCancelBtn}
              onMouseUp={handleCancelBtn}><IconX size={14}/>{browser.i18n.getMessage('selector_cancelBtn')}</button>
      <button id="confirmBtn"
              onClick={handleConfirm}
              onMouseDown={handleConfirm}
              onMouseUp={handleConfirm}><IconCheck size={14}/>{browser.i18n.getMessage('selector_confirmBtn')}
      </button>
    </dialog>
    <dom-selector
        popover="manual"
        className={`${isSurfing ? 'surfing' : 'notSurfing'} ${selectedDOMElement ? 'selected' : 'notSelected'}`}
        style={{
          ...(selectedDOMElement ? wrapStyle(selectedDOMElement, scrollY) : wrapStyle(hoveringDOMElement, scrollY)),
          pointerEvents: selectedDOMElement ? 'auto' : 'none',
          userSelect: selectedDOMElement ? 'auto' : 'none',
        }}>
    </dom-selector>
  </>);
};