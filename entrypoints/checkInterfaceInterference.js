import Color from 'colorjs.io';
import {FastAverageColor} from 'fast-average-color';
import {MAX_OTHER_BTN_COUNT, IEPurpose} from './modules/globals.js';

/**
 * @param {InteractiveObject} ie
 * @returns {Element|null}
 */
function getElementFromIE(ie) {
  let el = document.querySelector(ie.selector[0]);
  if (el == null) {
    let coordinateEl = document.elementFromPoint(ie.x[0], ie.y[0]);
    if (coordinateEl != null) {
      if (coordinateEl.shadowRoot != null) {
        // the mapped element contains a shadow root
        let root = coordinateEl.shadowRoot;
        el = root.querySelector(ie.selector[0]);
      }
    }
  }
  return el;
}

/**
 *
 * @param {string} dataUrl
 * @param {DOMRect} rect
 * @param {number} devicePixelRatio
 * @returns {Promise<string>}
 * @mermaid

 */
function cropImage(dataUrl, rect, devicePixelRatio) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = rect.width * devicePixelRatio;
      canvas.height = rect.height * devicePixelRatio;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(
          img,
          (rect.x + window.scrollX) * devicePixelRatio,
          (rect.y + window.scrollY) * devicePixelRatio,
          rect.width * devicePixelRatio,
          rect.height * devicePixelRatio,
          0,
          0,
          rect.width * devicePixelRatio,
          rect.height * devicePixelRatio,
      );
      resolve(canvas.toDataURL());
    };
    img.src = dataUrl;
  });
}

/**
 * @param {HTMLElement} el1
 * @param {HTMLElement} el2
 * @returns {Promise<number>}
 */
async function calculateColorDistance(el1, el2) {
  /** @type {string} */
  const screenshot = await storage.getItem('local:screenshot');

  const devicePixelRatio = window.devicePixelRatio || 1;

  const el1Rect = el1.getBoundingClientRect();
  const el1DataUrl = await cropImage(screenshot, el1Rect, devicePixelRatio);

  const el2Rect = el2.getBoundingClientRect();
  const el2DataUrl = await cropImage(screenshot, el2Rect, devicePixelRatio);

  const fac = new FastAverageColor();
  const result1 = await fac.getColorAsync(el1DataUrl, {mode: 'precision', algorithm: 'dominant'});
  const result2 = await fac.getColorAsync(el2DataUrl, {mode: 'precision', algorithm: 'dominant'});
  let color1 = new Color(result1.hex);
  let color2 = new Color(result2.hex);
  return color1.deltaEITP(color2);
}

export default defineUnlistedScript(async () => {
  try {
    const scan = await storage.getItem('local:scan');

    /** @type {[{button1: InteractiveObject, button2: InteractiveObject, distance: number}]} */
    const colorDistances = [];
    // We iterate over all `Accept` buttons.
    // We then calculate the colorDistances of the `Accept` buttons to all `Reject`, `Settings`, `SaveSettings` buttons.
    for (let i = 0; i < scan.interactiveElements[IEPurpose.Accept].length; i++) {
      /** @type {InteractiveObject} */
      let acceptIe;
      if (scan.interactiveElements[IEPurpose.Accept][i].selector.length === 1) {
        acceptIe = scan.interactiveElements[IEPurpose.Accept][i];
      } else {
        continue;
      }

      // Given the Accept interactive object, we need to get the actual element from the DOM
      const acceptEl = getElementFromIE(acceptIe);
      if (acceptEl == null) {
        continue;
      }

      // Calculate color distances between Accept and Reject buttons of the first layer.
      for (let i = 0; i < scan.interactiveElements[IEPurpose.Reject].length; i++) {
        /** @type {InteractiveObject} */
        let rejectIe;

        // We only look at first level buttons.
        if (scan.interactiveElements[IEPurpose.Reject][i].selector.length === 1) {
          rejectIe = scan.interactiveElements[IEPurpose.Reject][i];
        } else {
          continue;
        }

        const rejectEl = getElementFromIE(rejectIe);
        if (rejectEl == null) {
          continue;
        }

        const distance = await calculateColorDistance(acceptEl, rejectEl);
        colorDistances.push({
          button1: acceptIe, button2: rejectIe, distance,
        });
      }

      // Calculate color distance between Accept and Settings buttons of the first layer.
      for (let i = 0; i < scan.interactiveElements[IEPurpose.Settings].length; i++) {
        /** @type {InteractiveObject} */
        let settingsIe;

        // We only look at first level buttons.
        if (scan.interactiveElements[IEPurpose.Settings][i].selector.length === 1) {
          settingsIe = scan.interactiveElements[IEPurpose.Settings][i];
        } else {
          continue;
        }

        const settingEl = getElementFromIE(settingsIe);
        if (settingEl == null) {
          continue;
        }

        const distance = await calculateColorDistance(acceptEl, settingEl);
        colorDistances.push({
          button1: acceptIe, button2: settingsIe, distance,
        });
      }

      // Calculate color distance between Accept and SaveSettings buttons of the first layer.
      for (let i = 0; i < scan.interactiveElements[IEPurpose.SaveSettings].length; i++) {
        /** @type {InteractiveObject} */
        let saveSettingsIe;

        // We only look at first level buttons.
        if (scan.interactiveElements[IEPurpose.SaveSettings][i].selector.length === 1) {
          saveSettingsIe = scan.interactiveElements[IEPurpose.SaveSettings][i];
        } else {
          continue;
        }

        const saveSettingsEl = getElementFromIE(saveSettingsIe);
        if (saveSettingsEl == null) {
          continue;
        }

        const distance = await calculateColorDistance(acceptEl, saveSettingsEl);
        colorDistances.push({
          button1: acceptIe, button2: saveSettingsIe, distance,
        });
      }

      // If there are no buttons except IEPurpose.Other, we calculate the distance to them.
      if (colorDistances.length === 0) {
        let sortedOther = scan.interactiveElements[IEPurpose.Other].sort((a, b) => {
          if (a.y[0] > b.y[0]) return -1;  // Sort y descending
          if (a.y[0] < b.y[0]) return 1;
          if (a.x[0] < b.x[0]) return -1;  // Sort x ascending
          if (a.x[0] > b.x[0]) return 1;
          return 0;
        });
        let otherInteractiveElements = sortedOther.slice(0, MAX_OTHER_BTN_COUNT);

        // Calculate color distance between Accept and SaveSettings buttons of the first layer.
        for (let i = 0; i < otherInteractiveElements.length; i++) {
          /** @type {InteractiveObject} */
          let otherIe;

          // We only look at first level buttons.
          if (otherInteractiveElements[i].selector.length === 1) {
            otherIe = otherInteractiveElements[i];
          } else {
            continue;
          }

          const otherEl = getElementFromIE(otherIe);
          if (otherEl == null) {
            continue;
          }

          const distance = await calculateColorDistance(acceptEl, otherEl);
          colorDistances.push({
            button1: acceptIe, button2: otherIe, distance,
          });
        }
      }

    }
    return {status: 'ok', colorDistances};
  } catch (error) {
    return {status: 'error', error: JSON.stringify(error, Object.getOwnPropertyNames(error))};
  }
});