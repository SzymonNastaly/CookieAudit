import Color from 'colorjs.io';
import {FastAverageColor} from 'fast-average-color';
import {toPng} from 'html-to-image';
import {Purpose} from './modules/globals.js';

export default defineUnlistedScript(async () => {
  const scan = await storage.getItem('local:scan');
  /**
   * @type {InteractiveObject}
   */
  let acceptIe;
  for (let i = 0; i < scan.interactiveElements[Purpose.Accept].length; i++) {
    /**
     * @type {InteractiveObject}
     */
    let ie = scan.interactiveElements[Purpose.Accept][i];
    if (ie.selector.length === 1) {
      acceptIe = ie;
      break;
    }
  }
  /**
   * @type {InteractiveObject}
   */
  let rejectOrSettingsIe;
  // first try to find reject button in the first layer
  for (let i = 0; i < scan.interactiveElements[Purpose.Reject].length; i++) {
    /**
     * @type {InteractiveObject}
     */
    let ie = scan.interactiveElements[Purpose.Reject][i];
    if (ie.selector.length === 1) {
      rejectOrSettingsIe = ie;
      break;
    }
  }
  // otherwise, take a SaveSettings button from the first layer
  if (rejectOrSettingsIe == null) {
    for (let i = 0; i < scan.interactiveElements[Purpose.SaveSettings].length; i++) {
      /**
       * @type {InteractiveObject}
       */
      let ie = scan.interactiveElements[Purpose.SaveSettings][i];
      if (ie.selector.length === 1) {
        rejectOrSettingsIe = ie;
        break;
      }
    }
  }
  // otherwise, take a settings button from the first layer
  if (rejectOrSettingsIe == null) {
    for (let i = 0; i < scan.interactiveElements[Purpose.Settings].length; i++) {
      /**
       * @type {InteractiveObject}
       */
      let ie = scan.interactiveElements[Purpose.Settings][i];
      if (ie.selector.length === 1) {
        rejectOrSettingsIe = ie;
        break;
      }
    }
  }

  if (acceptIe == null || rejectOrSettingsIe == null) {
    // skip analysis if at least one is null
    return;
  }

  let acceptEl = document.querySelector(acceptIe.selector[0]);
  if (acceptEl == null) {
    let coordinateEl = document.elementFromPoint(acceptIe.x[0], acceptIe.y[0]);
    if (coordinateEl != null) {
      if (coordinateEl.shadowRoot != null) {
        // the mapped element contains a shadow root
        let root = coordinateEl.shadowRoot;
        acceptEl = root.querySelector(acceptIe.selector[0]);
      }
    }
  }
  let rejectEl = document.querySelector(rejectOrSettingsIe.selector[0]);
  if (rejectEl == null) {
    let coordinateEl = document.elementFromPoint(rejectOrSettingsIe.x[0], rejectOrSettingsIe.y[0]);
    if (coordinateEl != null) {
      if (coordinateEl.shadowRoot != null) {
        // the mapped element contains a shadow root
        let root = coordinateEl.shadowRoot;
        rejectEl = root.querySelector(rejectOrSettingsIe.selector[0]);
      }
    }
  }
  if (acceptEl != null && rejectEl != null) {
    try {
      const acceptDataUrl = await toPng(acceptEl);
      const rejectDataUrl = await toPng(rejectEl);
      const fac = new FastAverageColor();
      const acceptResult = await fac.getColorAsync(acceptDataUrl, {mode: 'precision', algorithm: 'dominant'});
      const rejectResult = await fac.getColorAsync(rejectDataUrl, {mode: 'precision', algorithm: 'dominant'});
      let acceptColor = new Color(acceptResult.hex);
      let rejectColor = new Color(rejectResult.hex);
      let distance = acceptColor.deltaEITP(rejectColor);
      return {colorDistance: distance};
    } catch (error) {
      console.error('oops, something went wrong!', error);
      // scripts always need to return explicitly

    }
  }
});