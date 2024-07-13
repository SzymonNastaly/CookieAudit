import {element_is_hidden, NOTICE_STATUS} from './modules/globals.js';

/**
 * @param {string} selector
 * @returns {boolean}
 */
function noticeStillOpen(selector) {
  let notice = document.querySelector(selector);
  if (notice == null) return false;
  if (element_is_hidden(notice)) return false;
  const rect = notice.getBoundingClientRect();
  const area = rect.width * rect.height;
  if (area <= 1) return false;
  return notice.checkVisibility();
}

/**
 * @returns {Promise<{status: number|string}>}
 */
async function checkIfAnyNoticeOpen() {
  try {
    /**
     * @type {Selection}
     */
    const selection = await storage.getItem('local:selection');
    const secondSelections = await storage.getItem('local:second_selections');

    if (selection?.notice?.selector == null) return {
      status: NOTICE_STATUS.ERROR, error: 'notice selector was null in noticeStillOpen.js',
    };

    if (noticeStillOpen(selection.notice.selector)) return {status: NOTICE_STATUS.NOTICE_STILL_OPEN};
    for (let i = 0; i < secondSelections.length; i++) {
      const layerSelection = secondSelections[i];
      if (layerSelection?.notice?.selector == null) return {
        status: NOTICE_STATUS.ERROR, error: 'notice selector was null in noticeStillOpen.js',
      };
      if (noticeStillOpen(layerSelection.notice.selector)) return {status: NOTICE_STATUS.NOTICE_STILL_OPEN};
    }
    return {status: NOTICE_STATUS.NOTICE_CLOSED};
  } catch (error) {
    return {status: NOTICE_STATUS.ERROR, error: JSON.stringify(error, Object.getOwnPropertyNames(error))};
  }
}

export default defineUnlistedScript(checkIfAnyNoticeOpen);