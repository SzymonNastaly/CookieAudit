import {
    delay,
    extract_text_from_element,
    get_clickable_elements,
    getFullIframeIndex,
    SECOND_LVL_STATUS
} from "./modules/globals.js";
import getSingleSelector from './modules/optimal-select2/select.js';

function isExternalAnchor(el) {
    if (el.tagName.toLowerCase() === "a") {
        const anchorUrl = new URL(el.href);
        const currentFrameUrl = new URL(window.location.href);
        if (anchorUrl.hostname !== currentFrameUrl.hostname || anchorUrl.pathname !== currentFrameUrl.pathname) return true
    }
    return el.getAttribute("target") === "_blank";
}

/**
 * @typedef {Object} ElementFootprint
 * @property {string[]} texts
 * @property {[number, number]} dimensions
 */

/**
 * Creates an identifier (consisting of some contents and dimensions of the notice)
 * to help determine if the cookie notice changed after click.
 * @param {HTMLElement} el
 * @return ElementFootprint
 */
function getFootprint(el) {
    let texts = extract_text_from_element(el);
    let dimensions = [el.clientWidth, el.clientHeight];
    return {texts, dimensions};
}

/**
 * Check if notices have not changed (at least the interactive elements)
 * @param {ElementFootprint} fp1
 * @param {ElementFootprint} fp2
 * @return {boolean}
 */
function noticeNotChanged(fp1, fp2) {
    if (fp1.texts.length !== fp2.texts.length) {
        return false;
    }

    if (fp1.dimensions[0] !== fp2.dimensions[0] || fp1.dimensions[1] !== fp2.dimensions[1]) {
        return false;
    }

    const sortedTexts1 = fp1.texts.slice().sort();
    const sortedTexts2 = fp2.texts.slice().sort();

    for (let i = 0; i < sortedTexts1.length; i++) {
        if (sortedTexts1[i] !== sortedTexts2[i]) {
            return false;
        }
    }
    // it appears that the notices are the same
    return true;
}

export default defineUnlistedScript(async () => {
    const interaction = await storage.getItem("local:interaction");
    const selection = await storage.getItem("local:selection");
    const frameIdx = selection.iframeFullIndex;
    const selector = interaction.ie.selector;

    if (frameIdx == null) throw new Error('frameIdx in clickNotice was null.');
    if (selector == null) throw new Error('selector in clickNotice was null.');

    // if the current content script is not in the correct frame, abort
    if (frameIdx !== getFullIframeIndex(window)) return null;

    if (selector.length !== 1) {
        throw new Error(`malformed query selector in secondLevelDiscovery ${JSON.stringify(selector)}`);
    }

    let fstLevelNotice = document.querySelector(selector[0]);
    if (fstLevelNotice == null) throw new Error(`Query selector for cookie notice did not work: ${selector}`);

    if (isExternalAnchor(fstLevelNotice)) {
        return {
            status: SECOND_LVL_STATUS.EXTERNAL_ANCHOR, text: null, interactiveObjects: null
        };
    }

    let footprintBefore = getFootprint(fstLevelNotice);

    fstLevelNotice.dispatchEvent(new MouseEvent("click"));

    await delay(1000);

    // find out if we _are_ on a second lvl
    // check if selector for the cookie notice returns something
    let sndLevelNotice = document.querySelector(selection.notice.selector);

    if (sndLevelNotice == null || !sndLevelNotice.checkVisibility()) {
        // the first level notice does not exist anymore, thus something else must be the sndLevelNotice
        console.log("starting selector inside secondLevelDiscovery.js");
        return {
            status: SECOND_LVL_STATUS.NEW_NOTICE
        };
        /*const tabs = await browser.tabs.query({active: true});
        let response = await browser.tabs.sendMessage(tabs[0].id, {msg: "start_snd_select"});
        if (response.msg !== "ok") throw new Error("Error from start_snd_select");*/
    }

    let footprintAfter = getFootprint(sndLevelNotice);
    if (noticeNotChanged(footprintBefore, footprintAfter)) {
        // The first level notice still exists, but it didn't change. Thus, a new notice must have appeared (above it).
        console.log("starting selector inside secondLevelDiscovery.js");
        return {
            status: SECOND_LVL_STATUS.NEW_NOTICE
        };
        /*const tabs = await browser.tabs.query({active: true});
        let response = await browser.tabs.sendMessage(tabs[0].id, {msg: "start_snd_select"});
        if (response.msg !== "ok") throw new Error("Error from start_snd_select");*/
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
    return {
        status: SECOND_LVL_STATUS.SUCCESS, text: sndLevelNoticeText, interactiveObjects: interactiveObjects
    };
})