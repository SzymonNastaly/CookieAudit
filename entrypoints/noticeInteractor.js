import {NOTICE_STATUS} from './modules/globals.js';

export default defineUnlistedScript(async () => {
  const interaction = await storage.getItem('local:interaction');

  if (interaction.ie.selector == null) throw new Error('selector in clickNotice was null.');

  let el = document.querySelector(interaction.ie.selector[0]);
  if (el == null) {
    el = document.querySelector(interaction.ie.relativeSelector[0]);
  }
  if (el == null) {
    let coordinateEl = document.elementFromPoint(interaction.ie.x[0], interaction.ie.y[0]);
    if (coordinateEl != null) {
      if (coordinateEl.shadowRoot != null) {
        // the mapped element contains a shadow root
        let root = coordinateEl.shadowRoot;
        el = root.querySelector(interaction.ie.selector[0]);
        if (el == null) {
          el = root.querySelector(interaction.ie.relativeSelector[0]);
        }
      }
    }
  }

  if (el == null) {
    return NOTICE_STATUS.WRONG_SELECTOR;
  }
  el.click();

  return NOTICE_STATUS.SUCCESS;
});