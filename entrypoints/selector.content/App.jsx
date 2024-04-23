import {useState, useEffect, useRef} from 'react';
import './App.module.css';
import '@mantine/core/styles.css';
import {MantineProvider} from '@mantine/core';
import {Stack, Group, Button, px} from '@mantine/core';
import {IconArrowUp, IconArrowDown, IconX, IconCheck} from '@tabler/icons-react';
import {storage} from 'wxt/storage';

export default () => {
    const [isSelected, _setIsSelected] = useState(false);
    const isSelectedRef = useRef(isSelected);
    function setIsSelected(isSelected) {
        isSelectedRef.current = isSelected;
        _setIsSelected(isSelected);
    }
    const [isSurfing, _setIsSurfing] = useState(false);
    const isSurfingRef = useRef(isSurfing);
    function setIsSurfing(isSurfing) {
        isSurfingRef.current = isSurfing;
        _setIsSurfing(isSurfing);
    }
    const [selectedDOMElement, _setSelectedDOMElement] = useState(null);
    const selectedDOMElementRef = useRef(selectedDOMElement);
    function setSelectedDOMElement(selectedDOMElement) {
        selectedDOMElementRef.current = selectedDOMElement;
        _setSelectedDOMElement(selectedDOMElement);
    }
    const [coordinateHistory, _setCoordinateHistory] = useState({x: 0, y: 0})
    const coordinateHistoryRef = useRef(coordinateHistory);
    function setCoordinateHistory(history) {
        coordinateHistoryRef.current = history;
        _setCoordinateHistory(history);
    }

    const isInactive = useRef(true);

    const [elementHistory, _setElementHistory] = useState([]);
    const elementHistoryRef = useRef(elementHistory);
    function setElementHistory(elHistory) {
        elementHistoryRef.current = elHistory;
        _setElementHistory(elHistory);
    }

    const wrapRef = useRef(null);
    // data is the dialog that is shown at the top left of the selected DOM element
    const dataRef = useRef(null);

    // sets size and styling properties of wrap to the properties of the selected node
    function setStyle(node) {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        wrapRef.current.style.top = rect.top + 'px';
        wrapRef.current.style.left = rect.left + 'px';
        wrapRef.current.style.width = rect.width + 'px';
        wrapRef.current.style.height = rect.height + 'px';
        wrapRef.current.style.setProperty('--bt', parseInt(style.borderTopWidth, 10) >= 0 ? style.borderTopWidth : '0px');
        wrapRef.current.style.setProperty('--br', parseInt(style.borderRightWidth, 10) >= 0 ? style.borderRightWidth : '0px');
        wrapRef.current.style.setProperty('--bb', parseInt(style.borderBottomWidth, 10) >= 0 ? style.borderBottomWidth : '0px');
        wrapRef.current.style.setProperty('--bl', parseInt(style.borderLeftWidth, 10) >= 0 ? style.borderLeftWidth : '0px');
        wrapRef.current.style.setProperty('--mt', (parseInt(style.marginTop, 10) >= 0 ? style.marginTop : '0px'));
        wrapRef.current.style.setProperty('--mr', (parseInt(style.marginRight, 10) >= 0 ? style.marginRight : '0px'));
        wrapRef.current.style.setProperty('--mb', (parseInt(style.marginBottom, 10) >= 0 ? style.marginBottom : '0px'));
        wrapRef.current.style.setProperty('--ml', (parseInt(style.marginLeft, 10) >= 0 ? style.marginLeft : '0px'));
        wrapRef.current.style.setProperty('--pt', (parseInt(style.paddingTop, 10) >= 0 ? style.paddingTop : '0px'));
        wrapRef.current.style.setProperty('--pr', (parseInt(style.paddingRight, 10) >= 0 ? style.paddingRight : '0px'));
        wrapRef.current.style.setProperty('--pb', (parseInt(style.paddingBottom, 10) >= 0 ? style.paddingBottom : '0px'));
        wrapRef.current.style.setProperty('--pl', (parseInt(style.paddingLeft, 10) >= 0 ? style.paddingLeft : '0px'));
    }

    function mapE(e) {
        // if either inactive or selected, we stop the mapping process
        //if (inactive || wrap.classList.contains('selected')) return;
        if (isInactive.current || isSelectedRef.current) return;
        //wrap.classList.remove('surfing');
        setIsSurfing(false);
        //dataRef.current.removeAttribute('class');
        // if scrolling: move history coordinates to client coordinates; if mousemove: move client coordinates to history coordinates
        if (e.type && e.type === 'scroll') {
            e.clientX = coordinateHistoryRef.current.x;
            e.clientY = coordinateHistoryRef.current.y;
        } else {
            setCoordinateHistory({x: e.clientX, y: e.clientY});
        }
        const element = document.elementFromPoint(e.clientX, e.clientY);
        if (!element) return;
        console.log("setting style on element:");
        console.log(element);
        setStyle(element);

        //if (element.id || element.getAttribute("id")) info.innerHTML += `<span id>#${element.id || element.getAttribute("id")}</span>`;
        //wrap.classList.add('surfing');
        setIsSurfing(true);

        setPosition();
    }

    function setPosition() {
        const rect = () => dataRef.current.getBoundingClientRect();
        const sect = () => wrapRef.current.getBoundingClientRect();
        if (rect().height + 20 > sect().height) dataRef.current.classList.add('outside');
        if (rect().left + rect().width + 15 > window.innerWidth) dataRef.current.classList.add('fromright');
        if (rect().top - 6 < 0) dataRef.current.classList.add('setbelow');
        if (rect().top + rect().height + 15 > window.innerHeight) dataRef.current.classList.add('scrollable');
    }

    function reset() {
        //wrap.removeAttribute("class");
        setIsSelected(false);
        setIsSurfing(false);
        //wrap.classList.add('inactive');
        isInactive.current = true;
        document.getElementsByTagName('dom-selector-data').item(0).removeAttribute('class');
        setSelectedDOMElement(null);
        //wrap.removeAttribute("style");
        document.getElementsByTagName('dom-selector').item(0).removeAttribute("style");
    }

    const selInnerElement = () => {
        //if (!wrap.classList.contains('selected')) return;
        if (!isSelectedRef.current) return;
        if (selectedDOMElementRef.current) {
            reset(); // Reset current selection
            setSelectedDOMElement(elementHistoryRef.current[elementHistoryRef.current.length - 1]); // set to last element in history
            setElementHistory(...elementHistoryRef.current.slice(0,-1)); // remove last element

            let showPreview = true; // TODO
            //if (showPreview) wrap.classList.add('selected');
            if (showPreview) setIsSelected(true);
            //wrap.classList.remove('surfing');
            setIsSurfing(false);
            if (showPreview) {
                //wrap.classList.add('surfing');
                setIsSurfing(true);
            } else {
                reset();
            }

            // Updating the UI
            setStyle(selectedDOMElementRef.current);

            //wrap.classList.add('surfing');
            setIsSurfing(true);

            setPosition();
        }
    };

    function handleMouseover() {
        //if (inactive || wrap.classList.contains('selected')) return;
        if (isInactive.current || isSelectedRef.current) return;
        //wrap.classList.add('surfing');
        setIsSurfing(true);
    }

    function handleMouseout() {
        //if (inactive || wrap.classList.contains('selected')) return;
        if (isInactive.current || isSelectedRef.current) return;
        //wrap.classList.remove('surfing');
        setIsSurfing(false);
    }

    function handleMousedown(e) {
        console.log("handle mousedown, isSelected: " + isSelectedRef.current);
        if (isSelectedRef.current) {
            return;
        }
        //if (wrap.classList.contains('inactive')) reject('Error: Another instance of \'DomSelector\' is already running. Finish it before starting another one.');
        if (isInactive.current) {
            console.error('Error: Another instance of \'DomSelector\' is already running. Finish it before starting another one.');
            return;
        }
        setIsSelected(true);
        //wrap.classList.remove('surfing');
        setIsSurfing(false);
        const selected = document.elementFromPoint(e.clientX, e.clientY);
        setSelectedDOMElement(selected);
        setElementHistory([...elementHistoryRef.current, selected]);
        //wrap.classList.add('surfing');
        setIsSurfing(true);
        if (selected) console.log(selected); else console.error("Error: Failed to find the Selected element. Try to fetch again.")
        //if (selected) resolve(selected); else reject('Error: Failed to find the Selected element. Try to fetch again.');
    }

    function handleSelectParent() {
        console.log("handleSelectParent, isSelected: " + isSelectedRef.current);
        console.log("handleSelectParent, selectedDOMElement.parentElement: ");
        console.log(selectedDOMElementRef.current.parentElement);
        //if (!wrap.classList.contains('selected')) return;
        if (!isSelectedRef.current) return;
        if (selectedDOMElementRef.current && selectedDOMElementRef.current.parentElement) {
            let parentEl = selectedDOMElementRef.current.parentElement;
            let selectedRect = selectedDOMElementRef.current.getBoundingClientRect();
            let parentRect = parentEl.getBoundingClientRect();
            while (parentRect.width === 0 || parentRect.height === 0) {
                if (!parentEl.parentElement) {
                    return;
                }
                parentEl = parentEl.parentElement;
                parentRect = parentEl.getBoundingClientRect();
            }

            setElementHistory([...elementHistoryRef.current, selectedDOMElementRef.current])

            reset(); // Reset current selection
            setSelectedDOMElement(parentEl);
            let selected = parentEl;

            parentEl = selected.parentElement;
            if (parentEl) {
                selectedRect = selected.getBoundingClientRect();
                parentRect = parentEl.getBoundingClientRect();

                while (selectedRect && parentEl && selectedRect.width === parentRect.width && selectedRect.height === parentRect.height && selectedRect.top === parentRect.top && selectedRect.left === parentRect.left) {
                    setSelectedDOMElement(selected);
                    selected = parentEl;
                    parentEl = parentEl.parentElement;
                    if (!selected || !parentEl) {
                        break;
                    }
                    selectedRect = selected.getBoundingClientRect();
                    parentRect = parentEl.getBoundingClientRect();
                }
            }

            //if (showPreview) wrap.classList.add('selected');
            setIsSelected(true);
            // for some time we first remove and then added, why?
            //wrap.classList.remove('surfing');
            //wrap.classList.add('surfing');
            setIsSurfing(true);

            // Updating the UI
            //const rect = selected.getBoundingClientRect();
            //const style = window.getComputedStyle(selected);
            setStyle(selected);
            console.log("selected parent, selected now is:");
            console.log(selected);

            //wrap.classList.add('surfing');
            setIsSurfing(true);

            setPosition();
        }
    }

    function handleCancelSelection() {
        reset();
        setElementHistory([]);
    }

    async function handleSelectorMessage(e, t, o) {
        o({status: "ok"});
        storage.getItem("local:selectorShowPreview").then(() => {
            // if selectorShowPreview is true, this results in the data (dom-selector-data) dialog remaining after an element has been selected
            if (!isInactive.current && !isSelectedRef.current) {
                console.error('Error: Another instance of \'DomSelector\' is already running. Finish it before starting another one.');
            } else {
                if (isSelectedRef.current) reset();
                isInactive.current = false;
                window.addEventListener('mousedown', handleMousedown, {once: true});
                console.log("added event listener");
            }
        });
    }

    useEffect(() => {
        isInactive.current = true;
        browser.runtime.onMessage.addListener(handleSelectorMessage);
        window.addEventListener('mouseover', handleMouseover);
        window.addEventListener('mouseout', handleMouseout);
        window.addEventListener('mousemove', mapE);
        window.addEventListener('scroll', mapE);

        return () => {
            browser.runtime.onMessage.removeListener(handleSelectorMessage);
            window.removeEventListener('mouseover', handleMouseover);
            window.removeEventListener('mouseout', handleMouseout);
            window.removeEventListener('mousemove', mapE);
            window.removeEventListener('scroll', mapE);
            window.removeEventListener('mousedown', handleMousedown);
        }
    }, [])

    return (<MantineProvider>
        <Stack>
            <dom-selector className={`${isSurfing ? 'surfing' : ''} ${isSelected ? 'selected' : ''}`} ref={wrapRef}>
                <dom-selector-data ref={dataRef}>
                    <Group justify="center" grow style={{marginBottom: px(8)}}>
                        <Button variant="default" size="xs" leftSection={<IconArrowUp size={14}/>}
                                className={'dom-selector-parent'} onClick={handleSelectParent}>Outer</Button>
                        <Button variant="default" size="xs" leftSection={<IconArrowDown size={14}/>}
                                className={'dom-selector-parent'} onClick={selInnerElement}
                        >Inner</Button>
                    </Group>
                    <Group justify="center" grow style={{marginBottom: px(8)}}>
                        <Button size="xs" variant="light" color="red" leftSection={<IconX size={14}/>}
                                className={`dom-selector-closer`} onClick={handleCancelSelection}>Cancel</Button>
                    </Group>
                    <Group justify="center" grow>
                        <Button size="xs" variant="light" color="green"
                                leftSection={<IconCheck size={14}/>}>Confirm</Button>
                    </Group>
                    <Group>
                        <dom-selector-info></dom-selector-info>
                    </Group>
                </dom-selector-data>
            </dom-selector>
        </Stack>
    </MantineProvider>);
};