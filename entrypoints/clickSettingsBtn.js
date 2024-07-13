import {
  extract_text_from_element, getFullIframeIndex, CLICK_BTN_STATUS,
} from './modules/globals.js';

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

export default defineUnlistedScript(async () => {
  try {
    /** @type {Interaction} */
    const interaction = await storage.getItem('local:interaction');
    /** @type {Selection} */
    const selection = await storage.getItem('local:selection');

    if (selection.iframeFullIndex == null) {
      return {status: CLICK_BTN_STATUS.ERROR, data: 'frameIdx in inspectBtnAndSettings was null.'};
    }

    if (interaction.ie.selector == null) {
      return {status: CLICK_BTN_STATUS.ERROR, data: 'selector in inspectBtnAndSettings was null.'};
    }

    if (interaction.ie.selector.length !== 1) {
      return {
        status: CLICK_BTN_STATUS.ERROR,
        data: `malformed query selector in inspectBtnAndSettings ${JSON.stringify(interaction.ie.selector)}`,
      };
    }

    let fstLevelNotice = document.querySelector(selection.notice.selector);
    if (fstLevelNotice == null) {
      let btn = document.querySelector(interaction.ie.selector[0]);
      return {
        status: CLICK_BTN_STATUS.ERROR, //data: `Query selector for cookie notice did not work: ${selection.notice.selector}`,
        data: `Query selector for fstLevelNotice was null, btn was null: ${btn == null}`,
      };
    }

    let footprintBefore = getFootprint(fstLevelNotice);
    await storage.setItem('local:footprintBefore', footprintBefore);

    let btn = document.querySelector(interaction.ie.selector[0]);
    if (btn == null) {
      btn = document.querySelector(interaction.ie.relativeSelector[0]);
    }
    if (btn == null) {
      return {status: CLICK_BTN_STATUS.WRONG_SELECTOR, data: `selector was ${interaction.ie.selector[0]}`};
    }
    btn.click();
    return {
      status: CLICK_BTN_STATUS.SUCCESS,
    };
  } catch (error) {
    return {
      status: CLICK_BTN_STATUS.ERROR, data: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    };
  }

});