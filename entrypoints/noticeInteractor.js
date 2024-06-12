import {NOTICE_STATUS} from './modules/globals.js';

export default defineUnlistedScript(async () => {
  const interaction = await storage.getItem('local:interaction');
  //const frameIdx = selection.iframeFullIndex;
  const selector = interaction.ie.selector;

  if (selector == null) throw new Error('selector in clickNotice was null.');

  let el = document.querySelector(selector[0]);
  if (el == null) {
    let coordinateEl = document.elementFromPoint(interaction.ie.x[0], interaction.ie.y[0]);
    if (coordinateEl != null) {
      if (coordinateEl.shadowRoot != null) {
        // the mapped element contains a shadow root
        let root = coordinateEl.shadowRoot;
        el = root.querySelector(selector[0]);
      }
    }
  }

  if (el == null) {
    return NOTICE_STATUS.WRONG_SELECTOR;
  }
  el.dispatchEvent(new MouseEvent('click'));

  return NOTICE_STATUS.SUCCESS;
});