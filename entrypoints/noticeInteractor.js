import {NOTICE_STATUS} from './modules/globals.js';

export default defineUnlistedScript(async () => {
  const interaction = await storage.getItem('local:interaction');
  //const frameIdx = selection.iframeFullIndex;
  const selector = interaction.ie.selector;

  //if (frameIdx == null) throw new Error('frameIdx in clickNotice was null.');
  if (selector == null) throw new Error('selector in clickNotice was null.');

  // if the current content script is not in the correct frame, abort
  // TODO: is this really necessary?
  //if (frameIdx !== getFullIframeIndex(window)) return NOTICE_STATUS.WRONG_FRAME;
  const el = document.querySelector(selector[0]);

  if (el == null) {
    return NOTICE_STATUS.WRONG_SELECTOR;
  }
  el.dispatchEvent(new MouseEvent('click'));

  return NOTICE_STATUS.SUCCESS;
});