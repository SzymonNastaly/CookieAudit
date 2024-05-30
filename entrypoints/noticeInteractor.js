import {delay, getFullIframeIndex, awaitNoDOMChanges} from "./modules/globals.js";

export default defineUnlistedScript(async () => {
    const interaction = await storage.getItem("local:interaction");
    const selection = await storage.getItem("local:selection");
    const frameIdx = selection.iframeFullIndex;
    const selector = interaction.ie.selector;

    if (frameIdx == null) throw new Error('frameIdx in clickNotice was null.');
    if (selector == null) throw new Error('selector in clickNotice was null.');

    // if the current content script is not in the correct frame, abort
    if (frameIdx !== getFullIframeIndex(window)) return false;

    if (selector.length === 2) {
        throw new Error("TODO: query selector of depth 2");
    } else if (selector.length !== 1) {
        console.log("selector: ", selector)
        throw new Error(`malformed query selector in noticeInteractor`);
    }
    const el = document.querySelector(selector[0]);
    if (el == null) throw new Error(`Query selector for cookie notice did not work: ${selector}`);
    console.log("clicking on notice ie in interactor", el);
    el.dispatchEvent(new MouseEvent("click"));

    return selector[0];
});