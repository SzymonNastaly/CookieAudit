import {element_is_hidden, NOTICE_STATUS} from './modules/globals.js';

export default defineUnlistedScript(async () => {
  const selection = await storage.getItem('local:selection');
  const secondSelections = await storage.getItem('local:second_selections');

  function noticeStillOpen(selector) {
    let notice = document.querySelector(selector);
    if (notice == null) return false;
    if (element_is_hidden(notice)) return false;
    return notice.checkVisibility();
  }

  console.log(`inside noticeStillOpen checking ${JSON.stringify(
      selection)} and ${JSON.stringify(secondSelections)}`);

  if (selection?.notice?.selector == null) throw new Error(
      'notice selector was null in noticeStillOpen.js');

  if (noticeStillOpen(
      selection.notice.selector)) return NOTICE_STATUS.NOTICE_STILL_OPEN;
  for (let i = 0; i < secondSelections.length; i++) {
    const layerSelection = secondSelections[i];
    if (noticeStillOpen(
        layerSelection.notice.selector)) return NOTICE_STATUS.NOTICE_STILL_OPEN;
  }
  return NOTICE_STATUS.NOTICE_CLOSED;
});