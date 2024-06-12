import {
  extract_text_from_element,
  get_clickable_elements,
  SECOND_LVL_STATUS,
} from './modules/globals.js';
import getSingleSelector from './modules/optimal-select2/select.js';

export default defineUnlistedScript(async () => {
  const selection = await storage.getItem('local:selection');
  const secondSelections = await storage.getItem('local:second_selections');

  let sndLevelNotice;
  if (secondSelections.length > 0) {
    const secondSelection = secondSelections[secondSelections.length - 1];
    sndLevelNotice = document.querySelector(secondSelection.notice.selector);
  } else {
    sndLevelNotice = document.querySelector(selection.notice.selector);
  }
  // analyze the second leve = get text and interactive elements
  let sndLevelNoticeText = extract_text_from_element(sndLevelNotice, true).
      join('\n').
      replace(/\s+/g, ' ');
  let sndLevelClickable = get_clickable_elements(sndLevelNotice);
  let interactiveObjects = [];
  for (let i = 0; i < sndLevelClickable.length; i++) {
    interactiveObjects.push({
      selector: [getSingleSelector(sndLevelClickable[i])],
      text: extract_text_from_element(sndLevelClickable[i]).join(' '),
      label: null,
    });
  }
  return {
    status: SECOND_LVL_STATUS.SUCCESS,
    text: sndLevelNoticeText,
    interactiveObjects: interactiveObjects,
  };
});