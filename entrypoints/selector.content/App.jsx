import {useEffect, useRef, useState} from 'react';
import './App.module.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import {Button, Group, MantineProvider, px, Stack} from '@mantine/core';
import {Notifications, notifications} from '@mantine/notifications';
import {IconArrowDown, IconArrowUp, IconCheck, IconX} from '@tabler/icons-react';
import {storage} from 'wxt/storage';
import {urlToUniformDomain} from '../modules/globals.js';
import {getSingleSelector} from './optimal_select.js';

export default () => {
    const [isSurfing, _setIsSurfing] = useState(false);
    const isSurfingRef = useRef(isSurfing);

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
     * When user clicks, select the element at mouse location, sensibly.
     * Sensible means: if the element at the location has some parent(s) with the same dimensions, choose the highest
     * such parent.
     * @param {MouseEvent} e
     */
    function handleMousedown(e) {
        if (selectedDOMElementRef.current) {
            return;
        }
        if (isInactive.current) {
            console.error('Error: Another instance of \'DomSelector\' is already running. Finish it before starting another one.');
            return;
        }
        let selected = document.elementFromPoint(e.clientX, e.clientY);
        selected = climbUpEquivalenceTree(selected);
        setSelectedDOMElement(selected);
        if (!selected) console.error("Error: Failed to find the Selected element. Try to fetch again.")
    }

    /**
     * We update a state value on scroll, to force the size/position of the wrapper (which makes the blue highlight)
     * to be recalculated during scrolling. ie if selected element moves out of the screen, the selection should too.
     */
    function handleScroll() {
        setScrollY(Math.round(window.scrollY));
    }

    /**
     * Go up the DOM tree to the next sensible parent.
     * Sensible means skipping parents with no area and skipping parents if multiple parents have the same dimensions.
     */
    function handleSelectParent() {
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
    }

    /**
     * Pops the most recent element off the element history "stack"
     */
    function handleSelectChild() {
        //if (!wrap.classList.contains('selected')) return;
        if (!selectedDOMElementRef.current || elementHistoryRef.current.length === 0) return;

        setSelectedDOMElement(elementHistoryRef.current[elementHistoryRef.current.length - 1]); // set to last element in history
        setElementHistory([...elementHistoryRef.current.slice(0, -1)]); // remove last element
    }

    // start selector when message is received
    function handleSelectorMessage(message, sender, sendResponse) {
        if (message === 'start_select') {
            console.log("received start select message");
            setIsSurfing(true);
            if (!isInactive.current && !selectedDOMElementRef.current) {
                console.error('Error: Another instance of \'DomSelector\' is already running. Finish it before starting another one.');
            } else {
                if (selectedDOMElementRef.current) reset();
                isInactive.current = false;
                window.addEventListener('mousedown', handleMousedown, {once: true});
            }
            sendResponse("ok");
        }
    }

    function element_is_hidden(e) {
        let is_hidden = true;
        let height = e.offsetHeight;
        let width = e.offsetWidth;
        if (height === undefined || width === undefined) {
            return true;
        }
        try {
            let cur = e;
            while (cur) {
                if (window.getComputedStyle(cur).getPropertyValue("opacity") === "0") {
                    return true;
                }
                cur = cur.parentElement;
            }
        } catch (error) {
        }
        try {
            is_hidden = (window.getComputedStyle(e).display === "none" || window.getComputedStyle(e).visibility === "hidden" || height === 0 || width === 0);
        } catch (error) {
        }
        e.childNodes.forEach(function (item) {
            is_hidden = is_hidden && element_is_hidden(item);
        });
        return is_hidden;
    }

    function extract_text_from_element(e, exclude_links = false) {
        let text = [];
        if (element_is_hidden(e) || (exclude_links && (e.nodeName === "A" || e.nodeName === "BUTTON"))) {
            return text;
        }
        let cur_text = "";
        let prv_item_type = "";
        let children = e.childNodes;
        children.forEach(function (item) {
            if (item.textContent.trim() === "" || item.nodeName === "#comment") {
                return;
            }
            if (item.nodeName === "BUTTON" && exclude_links === true) {
                return;
            } else if (item.nodeName === "A") {
                if (exclude_links === true) {
                    return;
                }
                let link_text = extract_text_from_element(item, exclude_links);
                if (link_text.length > 1 || prv_item_type === "A") {
                    if (cur_text.trim() !== "") {
                        text.push(cur_text.trim());
                        cur_text = "";
                    }
                    text = text.concat(link_text);
                } else if (link_text.length === 1) {
                    cur_text += " " + link_text[0].trim();
                }
            } else if (["#text", "EM", "STRONG", "I", "MARK"].includes(item.nodeName)) {
                cur_text = cur_text + " " + item.textContent.trim();
            } else if (["UL", "OL"].includes(item.nodeName)) {
                let list_items = extract_text_from_element(item, exclude_links);
                if (cur_text.trim() !== "") {
                    cur_text = cur_text.trim() + " ";
                }
                text = text.concat(Array.from(list_items).map(x => cur_text + x));
                cur_text = "";
            } else {
                if (cur_text.trim() !== "") {
                    text.push(cur_text.trim());
                    cur_text = "";
                }
                text = text.concat(extract_text_from_element(item, exclude_links));
            }
            prv_item_type = item.nodeName;
        });
        if (cur_text.trim() !== "") {
            text.push(cur_text.trim());
            cur_text = "";
        }
        return text.filter(x => {
            return x !== undefined;
        });
    }

    function get_clickable_elements(parent) {
        let elements = [];
        for (let element of parent.getElementsByTagName("*")) {
            if (!element_is_hidden(element) && ["DIV", "SPAN", "A", "BUTTON", "INPUT"].includes(element.tagName) && (element.tabIndex >= 0 || element.getAttribute("role") === "button" || element.getAttribute('onclick') !== null)) {
                elements.push(element);
            }
        }
        let filtered_elements = [];
        for (let element of elements) {
            let parent_found = false;
            for (let parent of elements) {
                if (element !== parent && parent.contains(element)) {
                    parent_found = true;
                }
            }
            if (parent_found === false) {
                filtered_elements.push(element)
            }
        }
        return filtered_elements;
    }

    async function handleConfirm() {
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
                selector: getSingleSelector(interactiveElements.current[i]),
                text: extract_text_from_element(interactiveElements.current[i]).join(' '),
                label: null
            });
        }

        let selection = {
            notice: {selector: getSingleSelector(selected), text: noticeText, label: null},
            interactiveObjects: interactiveObjects
        };
        console.log("selection as created in App.jsx", selection);
        await Promise.all([storage.setItem('local:selection', selection), storage.setMeta('local:selection', {url: urlToUniformDomain(window.location.href)})]);
        await browser.runtime.sendMessage("selected_notice");
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

        return () => {
            browser.runtime.onMessage.removeListener(handleSelectorMessage);
            //window.removeEventListener('mouseover', handleMouseover);
            //window.removeEventListener('mouseout', handleMouseout);
            window.removeEventListener('mousemove', mapE);
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('mousedown', handleMousedown);
            window.addEventListener('keydown', handleKeydown);
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
                                className={'dom-selector-parent'} onClick={handleSelectParent}>Outer</Button>
                        <Button variant="default" size="xs" leftSection={<IconArrowDown size={14}/>}
                                disabled={elementHistory.length === 0}
                                className={'dom-selector-parent'} onClick={handleSelectChild}>Inner</Button>
                    </Group>
                    <Group justify="center" grow style={{marginBottom: px(8)}}>
                        <Button size="xs" variant="light" color="red" leftSection={<IconX size={14}/>}
                                className={`dom-selector-closer`} onClick={reset}>Cancel</Button>
                    </Group>
                    <Group justify="center" grow>
                        <Button size="xs" variant="light" color="green"
                                leftSection={<IconCheck size={14}/>} onClick={handleConfirm}>Confirm</Button>
                    </Group>
                </dom-selector-data>
            </dom-selector>
        </Stack>
    </MantineProvider>);
};