import {useEffect, useRef, useState} from 'react';
import './App.module.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import {Button, Group, MantineProvider, px, Stack} from '@mantine/core';
import {Notifications, notifications} from '@mantine/notifications';
import {IconArrowDown, IconArrowUp, IconCheck, IconX} from '@tabler/icons-react';
import {storage} from 'wxt/storage';
import {extract_text_from_element, get_clickable_elements, getFullIframeIndex, STAGE2} from '../modules/globals.js';
//import {getSingleSelector} from './optimal_select.js';
import getSingleSelector from './optimal-select2/select.js';

export default () => {
    // function to call when the selection has been confirmed. Sends respons back to background.js
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
            '--pl': (parseInt(style.paddingLeft, 10) >= 0 ? style.paddingLeft : '0px')
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

        setHoveringDOMElement(element);
    }

    /**
     * Reset all relevant selector state to initial values.
     */
    function reset() {
        setElementHistory([]);
        setSelectedDOMElement(null);
        setHoveringDOMElement(null);
        setIsSurfing(false);
        isInactive.current = true;
        interactiveElements.current = [];
        window.removeEventListener('mousedown', handleMousedown);
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

                while (selected && parentEl && ((selectedRect.width === parentRect.width && selectedRect.height === parentRect.height) || (totalWidth(selectedRect) === totalWidth(parentRect) && totalHeight(selectedRect) === totalHeight(parentRect)))) {
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
    function handleMousedown(e) {
        if (selectedDOMElementRef.current || isInactive.current) {
            return;
        }
        let selected = document.elementFromPoint(e.clientX, e.clientY);
        selected = climbUpEquivalenceTree(selected);
        setSelectedDOMElement(selected);
        if (!selected) console.error("Error: Failed to find the Selected element. Try to fetch again.")
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
     * When a user clicks cancel button inside a selector context menu, we update the stage2 to not_started and call reset()
     */
    async function handleCancelBtn() {
        if (cancelHandled.current) return;
        cancelHandled.current = true;

        let scan = storage.getItem('local:scan');
        scan.stage2 = STAGE2.NOT_STARTED;
        await storage.setItem('local:scan', scan);
        reset();

        setTimeout(() => {
            cancelHandled.current = false;
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
        const {msg} = message;
        if (msg === "start_select") {
            setIsSurfing(true);
            isInactive.current = false;
            sendResponseRef.current = sendResponse;
            window.addEventListener('mousedown', handleMousedown, {once: true});
            return true;
        } else if (msg === "cancel_select") {
            sendResponse({msg: "ok"})
            reset();
        }
    }

    async function handleConfirm() {
        if (confirmHandled.current) return;
        confirmHandled.current = true;

        notifications.show({
            title: 'Confirmed', message: 'Cookie banner was selected'
        });

        let selected = selectedDOMElementRef.current;
        reset();
        let noticeText = extract_text_from_element(selected, true).join('\n').replace(/\s+/g, ' ');
        interactiveElements.current = get_clickable_elements(selected);
        let interactiveObjects = [];
        for (let i = 0; i < interactiveElements.current.length; i++) {
            interactiveObjects.push({
                selector: [getSingleSelector(interactiveElements.current[i])],
                text: extract_text_from_element(interactiveElements.current[i]).join(' '),
                label: null
            });
        }

        let selection = {
            notice: {selector: getSingleSelector(selected), text: noticeText, label: null},
            interactiveObjects: interactiveObjects,
            iframeFullIndex: getFullIframeIndex(window)
        };
        setTimeout(() => {
            confirmHandled.current = false;
        }, 500);

        await Promise.all([storage.setItem('local:selection', selection)]);
        if (sendResponseRef.current == null) {
            throw new Error("No response handler defined in selector content script.");
        } else {
            sendResponseRef.current({msg: "selected_notice"});
        }
    }

    /**
     * Reset selection on press of escape key.
     * @param {KeyboardEvent} event
     */
    function handleKeydown(event) {
        if (event.key === 'Escape') {
            reset();
        }
    }

    useEffect(() => {
        browser.runtime.onMessage.addListener(handleSelectorMessage);

        //window.addEventListener('mouseover', handleMouseover);
        //window.addEventListener('mouseout', handleMouseout);
        window.addEventListener('mousemove', mapE);
        window.addEventListener('scroll', handleScroll);
        window.addEventListener('keydown', handleKeydown);

        const unwatchSelection = storage.watch('local:selection', (newSelection, _) => {
            if (newSelection.notice !== null) {
                reset();
            }
        });

        return () => {
            browser.runtime.onMessage.removeListener(handleSelectorMessage);
            //window.removeEventListener('mouseover', handleMouseover);
            //window.removeEventListener('mouseout', handleMouseout);
            window.removeEventListener('mousemove', mapE);
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('mousedown', handleMousedown);
            window.addEventListener('keydown', handleKeydown);
            unwatchSelection();
        }
    }, [])

    return (<MantineProvider>
        <Notifications style={{zIndex: 999999999999999}}/>
        <Stack>
            <dom-selector
                className={`${isSurfing ? 'surfing' : 'notSurfing'} ${selectedDOMElement ? 'selected' : 'notSelected'}`}
                style={{
                    ...(selectedDOMElement ? wrapStyle(selectedDOMElement, scrollY) : wrapStyle(hoveringDOMElement, scrollY)),
                    pointerEvents: selectedDOMElement ? 'auto' : 'none',
                    userSelect: selectedDOMElement ? 'auto' : 'none'
                }}>
                <dom-selector-data style={{display: (selectedDOMElement && isSurfing) ? 'block' : 'none'}}>
                    <Group justify="center" grow style={{marginBottom: px(8)}}>
                        <Button variant="default" size="xs" leftSection={<IconArrowUp size={14}/>}
                                disabled={!selectedDOMElementRef.current || !skipZeroAreaNodes(selectedDOMElementRef.current.parentElement)}
                                className={'dom-selector-parent'} onClick={handleSelectParent}
                                onMouseDown={handleSelectParent} onMouseUp={handleSelectParent}>Outer</Button>
                        <Button variant="default" size="xs" leftSection={<IconArrowDown size={14}/>}
                                disabled={elementHistory.length === 0}
                                className={'dom-selector-parent'} onClick={handleSelectChild}
                                onMouseDown={handleSelectChild} onMouseUp={handleSelectChild}>Inner</Button>
                    </Group>
                    <Group justify="center" grow style={{marginBottom: px(8)}}>
                        <Button size="xs" variant="light" color="red" leftSection={<IconX size={14}/>}
                                className={`dom-selector-closer`} onClick={handleCancelBtn}
                                onMouseDown={handleCancelBtn} onMouseUp={handleCancelBtn}>Cancel</Button>
                    </Group>
                    <Group justify="center" grow>
                        <Button size="xs" variant="light" color="green"
                                leftSection={<IconCheck size={14}/>} onClick={handleConfirm} onMouseDown={handleConfirm}
                                onMouseUp={handleConfirm}>Confirm</Button>
                    </Group>
                </dom-selector-data>
            </dom-selector>
        </Stack>
    </MantineProvider>);
};