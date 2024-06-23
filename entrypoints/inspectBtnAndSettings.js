import {
  delay,
  element_is_hidden,
  extract_text_from_element,
  getFullIframeIndex,
  SECOND_LVL_STATUS,
} from './modules/globals.js';

function isCovered(el) {
  const rect = el.getBoundingClientRect();
  const middleX = (rect.left + rect.right) / 2;
  const middleY = (rect.top + rect.bottom) / 2;

  const topEl = document.elementFromPoint(middleX, middleY);

  return !el.contains(topEl);
}

function isExternalAnchor(el) {
  if (el.tagName.toLowerCase() === 'a') {
    const anchorUrl = new URL(el.href);
    const currentFrameUrl = new URL(window.location.href);
    if (anchorUrl.hostname !== currentFrameUrl.hostname || anchorUrl.pathname !== currentFrameUrl.pathname) return true;
  }
  return el.getAttribute('target') === '_blank';
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
   * @type {Interaction}
   */
  const interaction = await storage.getItem('local:interaction');
  /**
   * @type {Selection}
   */
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

  if (isExternalAnchor(fstLevelNotice)) {
    return {
      status: SECOND_LVL_STATUS.EXTERNAL_ANCHOR, text: null, interactiveObjects: null,
    };
  }

  let footprintBefore = getFootprint(fstLevelNotice);

  let btn = document.querySelector(interaction.ie.selector[0]);
  btn.click();

  // TODO: maybe we could make this more dynamic
  await delay(1000);

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

  let footprintAfter = getFootprint(sndLevelNotice);

  if (noticeNotChanged(footprintBefore, footprintAfter)) {
    // The first level notice still exists, but it didn't change. Thus, a new notice must have appeared (above it).
    return {
      status: SECOND_LVL_STATUS.NEW_NOTICE,
    };
  }
  return {
    status: SECOND_LVL_STATUS.SAME_NOTICE,
  };
});