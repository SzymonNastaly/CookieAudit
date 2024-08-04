import {
  element_is_hidden, extract_text_from_element, SECOND_LVL_STATUS,
} from './modules/globals.js';

function isCovered(el) {
  const rect = el.getBoundingClientRect();
  const middleX = (rect.left + rect.right) / 2;
  const middleY = (rect.top + rect.bottom) / 2;

  const topEl = document.elementFromPoint(middleX, middleY);
  /**
   * TODO: This probably doesn't handle shadow DOMs properly
   */

  return !el.contains(topEl);
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
  /**
   * @type {Selection}
   */
  const selection = await storage.getItem('local:selection');

  // find out if we _are_ on a second lvl
  // check if selector for the cookie notice returns something
  let sndLevelNotice = document.querySelector(selection.notice.selector);

  if (sndLevelNotice == null || !sndLevelNotice.checkVisibility() || element_is_hidden(sndLevelNotice) ||
      isCovered(sndLevelNotice)) {
    // the first level notice does not exist anymore, thus something else must be the sndLevelNotice
    return {
      status: SECOND_LVL_STATUS.NEW_NOTICE,
    };
  }

  let footprintBefore = await storage.getItem('local:footprintBefore');
  let footprintAfter = getFootprint(sndLevelNotice);

  if (noticeNotChanged(footprintBefore, footprintAfter)) {
    await storage.setItem('local:footprintBefore', null);
    // The first level notice still exists, but it didn't change. Thus, a new notice must have appeared (above it).
    return {
      status: SECOND_LVL_STATUS.NEW_NOTICE,
    };
  }
  await storage.setItem('local:footprintBefore', null);
  return {
    status: SECOND_LVL_STATUS.SAME_NOTICE,
  };
});