import {delay, getFullIframeIndex, NOTICE_STATUS} from "./modules/globals.js";

export default defineUnlistedScript(async () => {
    const interaction = await storage.getItem("local:interaction");
    const selection = await storage.getItem("local:selection");
    const frameIdx = selection.iframeFullIndex;
    const selector = interaction.ie.selector;

    if (frameIdx == null) throw new Error('frameIdx in clickNotice was null.');
    if (selector == null) throw new Error('selector in clickNotice was null.');

    // if the current content script is not in the correct frame, abort
    if (frameIdx !== getFullIframeIndex(window)) return NOTICE_STATUS.WRONG_FRAME;

    function noticeStillOpen(selector) {
        let notice = document.querySelector(selector);
        if (notice == null) return false;
        return notice.checkVisibility();
    }

    if (selector.length === 1) {
        const el = document.querySelector(selector[0]);

        if (el == null) throw new Error(`Single level query selector for cookie notice failed on first level: ${JSON.stringify(selector)}`);

        el.dispatchEvent(new MouseEvent("click"));
        await delay(2000);

        if (noticeStillOpen()) {
            return NOTICE_STATUS.NOTICE_STILL_OPEN;
        } else {
            return NOTICE_STATUS.SUCCESS;
        }
    } else if (selector.length === 2) {
        let el = document.querySelector(selector[0]);
        if (el == null) throw new Error(`Double level query selector for cookie notice failed on first level: ${JSON.stringify(selector)}`);
        el.dispatchEvent(new MouseEvent("click"));
        el = document.querySelector(selector[1]);
        if (el == null) throw new Error(`Double level query selector for cookie notice failed on second level: ${JSON.stringify(selector)}`);
        el.dispatchEvent(new MouseEvent("click"));
        await delay(2000);
        if (noticeStillOpen()) {
            return NOTICE_STATUS.NOTICE_STILL_OPEN;
        } else {
            return NOTICE_STATUS.SUCCESS;
        }
    } else {
        console.error(`malformed query selector in noticeInteractor: ${JSON.stringify(selector)}`);
        return NOTICE_STATUS.WRONG_SELECTOR;
    }
});