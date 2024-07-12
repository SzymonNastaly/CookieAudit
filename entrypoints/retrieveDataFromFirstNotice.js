import {getCssSelector} from 'css-selector-generator';
import {
  extract_text_from_element, get_clickable_elements, SECOND_LVL_STATUS, SELECTOR_TIME_LIMIT,
} from './modules/globals.js';

export default defineUnlistedScript(async () => {
  /**
   * @type {Selection}
   */
  try {
    const selection = await storage.getItem('local:selection');

    let sndLevelNotice;
    sndLevelNotice = document.querySelector(selection.notice.selector);
    if (sndLevelNotice == null) {
      return {status: SECOND_LVL_STATUS.NOT_FOUND};
    }
    // analyze the second leve = get text and interactive elements
    let sndLevelNoticeText = extract_text_from_element(sndLevelNotice, true).
        join('\n').
        replace(/\s+/g, ' ');
    let sndLevelClickable = get_clickable_elements(sndLevelNotice);
    /**
     * @type {InteractiveObject[]}
     */
    let interactiveObjects = [];
    const startTime = Date.now();
    for (let i = 0; i < sndLevelClickable.length; i++) {
      let boundingClientRect = sndLevelClickable[i].getBoundingClientRect();
      interactiveObjects.push({
        selector: [
          getCssSelector(sndLevelClickable[i], {
            root: sndLevelClickable[i].getRootNode(),
            maxCombinations: 100,
            selectors: ['tag', 'nthchild', 'nthoftype'],
          })],
        text: [extract_text_from_element(sndLevelClickable[i]).join(' ')],
        label: null,
        tagName: sndLevelClickable[i].tagName.toLowerCase(),
        x: [boundingClientRect.x],
        y: [boundingClientRect.y],
      });
      const currentTime = Date.now(); // Get the current time
      if (currentTime - startTime > SELECTOR_TIME_LIMIT) {
        await browser.runtime.sendMessage({
          msg: 'relay', data: {
            msg: 'popover',
            title: browser.i18n.getMessage('selector_querySelectorTimeoutTitle'),
            text: browser.i18n.getMessage('selector_querySelectorTimeoutText'),
            color: 'red',
          },
        });
        return {status: 'error', error: 'Timeout during query selection in retrieveDataFromNotice'};
      }
    }
    return {
      status: SECOND_LVL_STATUS.SUCCESS, text: sndLevelNoticeText, interactiveObjects: interactiveObjects,
    };
  } catch (e) {
    return {status: 'error', error: e};
  }
});