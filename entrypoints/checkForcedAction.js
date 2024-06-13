import {element_is_hidden, get_clickable_elements} from './modules/globals.js';
import getSingleSelector from './modules/optimal-select2/select.js';

export default defineUnlistedScript(async () => {
  /**
   * @type {Selection}
   */
  const selection = await storage.getItem('local:selection');
  let noticeRect = selection.notice.rect;
  const clickableInBody = get_clickable_elements(document.body);

  const MIN_CLICKABLE_COUNT = 20;
  let checkedClickables = 0;
  /**
   * @type {string[]}
   */
  let nonReachable = [];
  for (let i = 0; i < clickableInBody.length; i++) {
    const rect = clickableInBody[i].getBoundingClientRect();
    const midX = (rect.left + rect.right) / 2;
    const midY = (rect.top + rect.bottom) / 2;

    const area = rect.width * rect.height;
    // skip (basically) empty elements, or hidden elements
    if (area <= 1 || element_is_hidden(clickableInBody[i])) {
      continue;
    }
    // skip elements outside of viewport
    if (midX > window.innerWidth || midY > window.innerHeight) {
      continue;
    }
    // skip elements that are under the actual cookie notice.
    if (noticeRect.left <= midX && midX <= noticeRect.right && noticeRect.top <= midY && midY <= noticeRect.bottom) {
      continue;
    }
    checkedClickables += 1;
    // a clickable element is outside the notice, coordinate-wise
    const el = document.elementFromPoint(midX, midY);

    if (!clickableInBody[i].contains(el)) {
      // case: cannot access the actual element at the coordinates
      nonReachable.push(getSingleSelector(clickableInBody[i]));
    }
    if (checkedClickables >= MIN_CLICKABLE_COUNT) {
      break;
    }

  }
  return {nonReachable};
});