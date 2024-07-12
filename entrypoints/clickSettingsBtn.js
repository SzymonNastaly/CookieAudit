import {
  extract_text_from_element,
  getFullIframeIndex,
  SECOND_LVL_STATUS,
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
  /** @type {Interaction} */
  const interaction = await storage.getItem('local:interaction');
  /** @type {Selection} */
  const selection = await storage.getItem('local:selection');

  if (selection.iframeFullIndex == null) throw new Error('frameIdx in inspectBtnAndSettings was null.');
  if (interaction.ie.selector == null) throw new Error('selector in inspectBtnAndSettings was null.');

  // if the current content script is not in the correct frame, abort
  if (selection.iframeFullIndex !== getFullIframeIndex(window)) return null;

  if (interaction.ie.selector.length !== 1) {
    return {
      status: SECOND_LVL_STATUS.ERROR, msg: `malformed query selector in inspectBtnAndSettings ${JSON.stringify(interaction.ie.selector)}`
    }
  }

  let fstLevelNotice = document.querySelector(selection.notice.selector);
  if (fstLevelNotice == null) {
    return {
      status: SECOND_LVL_STATUS.ERROR, msg: `Query selector for cookie notice did not work: ${selection.notice.selector}`
    }
  }

  let footprintBefore = getFootprint(fstLevelNotice);
  await storage.setItem('local:footprintBefore', footprintBefore);

  let btn = document.querySelector(interaction.ie.selector[0]);
  btn.click();
  return {
    status: SECOND_LVL_STATUS.SUCCESS,
  };
});