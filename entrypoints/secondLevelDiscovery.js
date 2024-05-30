import {extract_text_from_element, get_clickable_elements, getFullIframeIndex} from "./modules/globals.js";
import {getSingleSelector} from "./selector.content/optimal_select.js";

export default defineUnlistedScript(async () => {
    const interaction = await storage.getItem("local:interaction");
    const selection = await storage.getItem("local:selection");
    const frameIdx = selection.iframeFullIndex;
    const selector = interaction.ie.selector;

    if (frameIdx == null) throw new Error('frameIdx in clickNotice was null.');
    if (selector == null) throw new Error('selector in clickNotice was null.');


    // if the current content script is not in the correct frame, abort
    if (frameIdx !== getFullIframeIndex(window)) return false;

    if (selector.length !== 1) {
        throw new Error(`malformed query selector in secondLevelDiscovery ${JSON.stringify(selector)}`);
    }

    const el = document.querySelector(selector[0]);
    if (el == null) throw new Error(`Query selector for cookie notice did not work: ${selector}`);
    el.dispatchEvent(new MouseEvent("click"));

    // find out if we _are_ on a second lvl
    // check if selector for the cookie notice returns something
    const sndLevelNotice = document.querySelector(selection.notice.selector);
    if (sndLevelNotice == null) {
        // ask the user for help
    }

    // analyze the second leve = get text and interactive elements
    let sndLevelNoticeText = extract_text_from_element(sndLevelNotice, true).join('\n').replace(/\s+/g, ' ');
    let sndLevelClickable = get_clickable_elements(sndLevelNotice);
    let interactiveObjects = [];
    for (let i = 0; i < sndLevelClickable.length; i++) {
        interactiveObjects.push({
            selector: [getSingleSelector(sndLevelClickable[i])],
            text: extract_text_from_element(sndLevelClickable[i]).join(' '),
            label: null
        });
    }
    return [sndLevelNoticeText, interactiveObjects];
})