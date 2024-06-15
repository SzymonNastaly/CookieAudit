import {env, pipeline} from '@xenova/transformers';
import {storage} from 'wxt/storage';
import {clearCookies, cookieListener, storeCookieResults} from './cookieManagement.js';
import {
  awaitNoDOMChanges,
  DARK_PATTERN_STATUS,
  INTERACTION_STATE,
  MAX_OTHER_BTN_COUNT,
  NOTICE_STATUS,
  openNotification,
  PAGE_COUNT,
  Purpose,
  resetStorage,
  SECOND_LVL_STATUS,
  STAGE2,
  updateTab,
  waitStableFrames,
} from './modules/globals.js';

/**
 * @typedef {Object} CookieData
 * @property {number} current_label - The current label value.
 * @property {string} domain - The domain associated with the cookie.
 * @property {string} name - The name of the cookie.
 */

/**
 * @typedef {Object.<string, CookieData>} CookieCollection
 * A collection of cookies, where each key is a string representing the cookie identifier,
 * and the value is an object containing the cookie data.
 */

// noinspection JSUnusedGlobalSymbols
export default defineBackground({
  type: 'module', main() {
    /**
     * I don't entirely understand why.
     * But by using this singleton, we fix the problem that if the model is used many times, too much memory is allocated.
     */
    class PurposePipelineSingleton {
      static instance = null;

      /**
       * @param quantized
       * @return {Promise<function>}
       */
      static async getInstance(quantized = false) {
        if (this.instance === null) {
          this.instance = pipeline('text-classification', 'snastal/purpose_detection_model', {
            quantized: quantized, progress_callback: purposeProgress,
          });
        }
        let progress = await storage.getItem('local:progress');
        progress.purpose = 100;
        progress.purposeDownloading = false;
        await storage.setItem('local:progress', progress);
        return this.instance;
      }
    }

    /**
     * Same explanation as for the PurposePipelineSingleton. You probably want to continue using the models in this form.
     */
    class IEPipelineSingleton {
      static instance = null;

      /**
       * @param {boolean} quantized
       * @return {Promise<function>}
       */
      static async getInstance(quantized = false) {
        if (this.instance === null) {
          this.instance = pipeline('text-classification', 'snastal/interactive_elements_model',
              {quantized: quantized, progress_callback: ieProgress});
        }
        let progress = await storage.getItem('local:progress');
        progress.ie = 100;
        progress.ieDownloading = false;
        await storage.setItem('local:progress', progress);
        return this.instance;
      }
    }

    async function interactWithPageAndWait(tabs) {
      for (let i = 0; i < PAGE_COUNT; i++) {
        let pageRet = await browser.scripting.executeScript({
          target: {tabId: tabs[0].id}, files: ['pageInteractor.js'], injectImmediately: true,
        });
        let nextUrl = pageRet[0].result;
        if (nextUrl != null) {
          await updateTab(tabs[0].id, nextUrl);
          await waitStableFrames(tabs[0].id);
          await browser.scripting.executeScript({
            target: {tabId: tabs[0].id, allFrames: true}, func: awaitNoDOMChanges, injectImmediately: true,
          });
        }
      }
    }

    /**
     * Handlers for all messages sent to the background script.
     */
    browser.runtime.onMessage.addListener(function(message, _, sendResponse) {
      let {msg} = message;
      if (msg === 'start_scan') {
        sendResponse({msg: 'ok'});
        let interactiveElements;
        const USE_QUANTIZED = true;
        (async () => {
          await resetStorage();
          await clearCookies();

          if (!browser.cookies.onChanged.hasListener(cookieListener)) {
            browser.cookies.onChanged.addListener(cookieListener);
          }

          let scan = await storage.getItem('local:scan');
          scan.stage2 = STAGE2.NOTICE_SELECTION;
          scan['scanStart'] = Date.now();
          const tabs = await browser.tabs.query({active: true});
          scan['url'] = tabs[0].url;
          await storage.setItem('local:scan', scan);
          scan = null;
          const mountResponse = await browser.tabs.sendMessage(tabs[0].id, {msg: 'mount_select'});
          console.log('mountResponse', mountResponse);
          if (mountResponse?.msg !== 'ok') throw new Error('mount_select not confirmed by content script');
          const response = await browser.tabs.sendMessage(tabs[0].id, {msg: 'start_select'});
          if (response?.msg !== 'selected_notice') throw new Error('start_select not confirmed by selector');

          // getting first layer notice selection
          /**
           * @type {Selection}
           */
          let selection = await storage.getItem('local:selection');
          if (selection == null) throw new Error('local:selection should be set');

          scan = await storage.getItem('local:scan');
          scan['noticeDetected'] = true;
          await storage.setItem('local:scan', scan);
          scan = null;

          // Skip initial check for local models, since we are not loading any local models.
          env.allowLocalModels = false;
          // Due to a bug in onnxruntime-web, we must disable multithreading for now.
          // See https://github.com/microsoft/onnxruntime/issues/14445 for more information.
          env.backends.onnx.wasm.numThreads = 1;

          await waitStableFrames(tabs[0].id);
          await browser.scripting.executeScript({
            target: {tabId: tabs[0].id, allFrames: true}, func: awaitNoDOMChanges, injectImmediately: true,
          });
          await openNotification(tabs[0].id, browser.i18n.getMessage('background_downloadingModelsTitle'),
              browser.i18n.getMessage('background_downloadingModelsText'), 'blue');
          await PurposePipelineSingleton.getInstance(USE_QUANTIZED);
          await IEPipelineSingleton.getInstance(USE_QUANTIZED);

          await openNotification(tabs[0].id, browser.i18n.getMessage('background_startingClassificationTitle'),
              browser.i18n.getMessage('background_startingClassificationText'), 'blue');

          let purposeClassifier = await PurposePipelineSingleton.getInstance(USE_QUANTIZED);
          let purposeDeclared = await translateAndGetPurposeDeclared(purposeClassifier, selection.notice.text);
          if (purposeDeclared) {
            selection.notice.label = 1;
          } else {
            selection.notice.label = 0;
          }
          scan = await storage.getItem('local:scan');
          scan['purposeDeclared'] = purposeDeclared;
          await storage.setItem('local:scan', scan);
          scan = null;

          let ieClassifier = await IEPipelineSingleton.getInstance(USE_QUANTIZED);
          if (ieClassifier == null) throw new Error('IE Classifier was null');

          const translatedTexts = await Promise.all(selection.interactiveObjects.map(async obj => {
            let text = obj.text;
            let res = await translateToEnglish(text);
            return res.resultText;
          }));
          const labels = (await ieClassifier(translatedTexts)).map(res => {
            return getIELabel(res);
          });
          for (let i = 0; i < labels.length; i++) {
            selection.interactiveObjects[i].label = labels[i];
          }

          await storage.setItem('local:selection', selection);

          interactiveElements = {};
          interactiveElements[Purpose.Accept] = [];
          interactiveElements[Purpose.Close] = [];
          interactiveElements[Purpose.Settings] = [];
          interactiveElements[Purpose.Other] = [];
          interactiveElements[Purpose.Reject] = [];
          interactiveElements[Purpose.SaveSettings] = [];

          for (let i = 0; i < selection.interactiveObjects.length; i++) {
            let obj = selection.interactiveObjects[i];
            interactiveElements[obj.label].push(obj);
          }
          console.log('interactiveElements on first layer: ', interactiveElements);

          scan = await storage.getItem('local:scan');
          scan['stage2'] = STAGE2.NOTICE_INTERACTION;
          scan['interactiveElements'] = interactiveElements;
          scan['rejectDetected'] = (interactiveElements[Purpose.Reject].length > 0);
          scan['closeSaveDetected'] = (interactiveElements[Purpose.Close].length > 0) ||
              (interactiveElements[Purpose.SaveSettings].length > 0);
          await storage.setItem('local:scan', scan);
          scan = null;

          // add interactive elements that have to be interacted with, on the first level
          let ieToInteract = [];
          for (const iElement of interactiveElements[Purpose.Reject]) {
            ieToInteract.push(iElement);
          }
          for (const iElement of interactiveElements[Purpose.Close]) {
            ieToInteract.push(iElement);
          }
          for (const iElement of interactiveElements[Purpose.SaveSettings]) {
            ieToInteract.push(iElement);
          }

          console.log('interactiveElements[Purpose.Settings]', interactiveElements[Purpose.Settings]);
          // if there are one or multiple setting buttons,
          // we have to inspect if there is a relevant second level
          let twoLevelInteractiveElements = {};
          twoLevelInteractiveElements[Purpose.Accept] = [];
          twoLevelInteractiveElements[Purpose.Close] = [];
          twoLevelInteractiveElements[Purpose.Settings] = [];
          twoLevelInteractiveElements[Purpose.Other] = [];
          twoLevelInteractiveElements[Purpose.Reject] = [];
          twoLevelInteractiveElements[Purpose.SaveSettings] = [];

          // if Purpose.Settings interactive elements were detected, we only inspect them
          // otherwise, we have to inspect Purpose.Other buttons interactive elements
          let ieToSndLevel;
          if (interactiveElements[Purpose.Settings].length > 0) {
            ieToSndLevel = interactiveElements[Purpose.Settings];
          } else {
            // we remove anchor tags as they often open a new page
            let filteredOther = interactiveElements[Purpose.Other].filter(obj => obj.tagName.toLowerCase() !== 'a');
            // we sort such
            // that the buttons on the bottom left are first in the list
            let sortedOther = filteredOther.sort((a, b) => {
              if (a.y[0] > b.y[0]) return -1;  // Sort y descending
              if (a.y[0] < b.y[0]) return 1;
              if (a.x[0] < b.x[0]) return -1;  // Sort x ascending
              if (a.x[0] > b.x[0]) return 1;
              return 0;
            });
            ieToSndLevel = sortedOther.slice(0, MAX_OTHER_BTN_COUNT);
          }
          for (const iElement of ieToSndLevel) {
            let interaction = await storage.getItem('local:interaction');
            interaction.ie = iElement;
            await storage.setItem('local:interaction', interaction);

            console.log(`FIRST time before awaitNoDOMChanges ${new Date().getTime() / 1000}`);
            await browser.scripting.executeScript({
              target: {tabId: tabs[0].id, allFrames: true}, func: awaitNoDOMChanges, injectImmediately: true,
            });
            console.log(`SECOND time before awaitNoDOMChanges ${new Date().getTime() / 1000}`);

            const inspectRet = await browser.scripting.executeScript({
              target: {tabId: tabs[0].id, allFrames: true},
              files: ['inspectBtnAndSettings.js'],
              injectImmediately: true,
            });
            console.log(`inspectRet after ${iElement.text}`, inspectRet);
            let sndLevelNoticeText, sndLevelIntObjs;
            for (let frameRet of inspectRet) {
              let inspectResult = frameRet.result;
              if (inspectResult != null && inspectResult.status === SECOND_LVL_STATUS.SAME_NOTICE) {
                console.log('determined SAME_NOTICE');
                ({
                  sndLevelNoticeText, sndLevelIntObjs,
                } = await processSelectedSettings(tabs, frameRet, ieClassifier, twoLevelInteractiveElements, iElement,
                    USE_QUANTIZED, true));
                break;
              } else if (inspectResult != null && inspectResult.status === SECOND_LVL_STATUS.EXTERNAL_ANCHOR) {
                console.log('determined EXTERNAL_ANCHOR');
                console.log('skipping a link in first layer that leads to external site');
                break;
              } else if (inspectResult != null && inspectResult.status === SECOND_LVL_STATUS.NEW_NOTICE) {
                console.log('determined NEW_NOTICE');
                let scan = await storage.getItem('local:scan');
                scan.stage2 = STAGE2.SECOND_SELECTION;
                await storage.setItem('local:scan', scan);
                const mountResponse = await browser.tabs.sendMessage(tabs[0].id, {msg: 'mount_select'});
                if (mountResponse?.msg !== 'ok') throw new Error('mount_select not confirmed by content script');

                const response = await browser.tabs.sendMessage(tabs[0].id, {msg: 'start_select'});
                if (response?.msg !== 'selected_notice') throw new Error('start_select not confirmed by selector');

                /**
                 * @type {Selection[]}
                 */
                let secondSelections = await storage.getItem('local:second_selections');
                if (secondSelections == null || secondSelections.length === 0) throw new Error(
                    'local:second_selections should be set');
                ({
                  sndLevelNoticeText, sndLevelIntObjs,
                } = await processSelectedSettings(tabs, frameRet, ieClassifier, twoLevelInteractiveElements, iElement,
                    USE_QUANTIZED, false));
                break;
              }
            }
            // reset cookies and reload page
            await clearCookies();
            let scan = await storage.getItem('local:scan');
            await updateTab(tabs[0].id, scan.url);
            scan = null;
            //await delay(4000);

          }
          // ieClassifier is not needed anymore
          ieClassifier = null;

          // add the relevant twoLevelInteractiveElements to the list of ieToInteract
          for (const iElement of twoLevelInteractiveElements[Purpose.Reject]) {
            ieToInteract.push(iElement);
          }
          for (const iElement of twoLevelInteractiveElements[Purpose.Close]) {
            ieToInteract.push(iElement);
          }
          for (const iElement of twoLevelInteractiveElements[Purpose.SaveSettings]) {
            ieToInteract.push(iElement);
          }

          console.log('ieToInteract, in both levels combined:', ieToInteract);
          scan = await storage.getItem('local:scan');
          scan.ieToInteract = ieToInteract;
          await storage.setItem('local:scan', scan);
          let ieToInteractLength = scan.ieToInteract.length;
          scan = null;

          // iterate over interactive elements
          for (let i = 0; i < ieToInteractLength; i++) {
            let interaction = await storage.getItem('local:interaction');
            scan = await storage.getItem('local:scan');
            interaction.ie = scan.ieToInteract[i];
            scan = null;
            await storage.setItem('local:interaction', interaction);

            console.log('interaction is: ', interaction);

            let text;
            if (interaction.ie.selector.length === 1) {
              text = browser.i18n.getMessage('background_singleInteractionText', [interaction.ie.text[0]]);
            } else if (interaction.ie.selector.length === 2) {
              text = browser.i18n.getMessage('background_doubleInteractionText',
                  [interaction.ie.text[0], interaction.ie.text[1]]);
            }

            await waitStableFrames(tabs[0].id);
            await browser.scripting.executeScript({
              target: {tabId: tabs[0].id, allFrames: true}, func: awaitNoDOMChanges, injectImmediately: true,
            });

            await openNotification(tabs[0].id, browser.i18n.getMessage('background_interactionTitle'), text, 'blue');
            console.log('starting noticeInteractor for interaction: ', interaction);

            await browser.scripting.executeScript({
              target: {tabId: tabs[0].id, allFrames: true}, func: awaitNoDOMChanges, injectImmediately: true,
            });

            let wasSuccess = await noticeInteractAndWait(tabs[0].id);

            if (interaction.ie.selector.length === 2 && wasSuccess) {
              interaction.ie.selector.shift();
              interaction.ie.x.shift();
              interaction.ie.y.shift();
              await storage.setItem('local:interaction', interaction);

              wasSuccess = noticeInteractAndWait(tabs[0].id);
            }

            if (wasSuccess) {
              await openNotification(tabs[0].id, browser.i18n.getMessage('background_ieSuccessTitle'),
                  browser.i18n.getMessage('background_ieSuccessText'), 'blue');

              console.log('interacting with page');
              await interactWithPageAndWait(tabs);
              await storeCookieResults(INTERACTION_STATE.PAGE_W_NOTICE);

              interaction = await storage.getItem('local:interaction');
              interaction.visitedPages = [];
              await storage.setItem('local:interaction', interaction);

              // reset cookies and reload page
              await clearCookies();
              let scan = await storage.getItem('local:scan');
              await updateTab(tabs[0].id, scan.url);
              scan = null;
            } else if (!wasSuccess) {
              await openNotification(tabs[0].id, browser.i18n.getMessage('background_ieErrorTitle'),
                  browser.i18n.getMessage('background_ieErrorText'), 'red');

              // reset cookies and reload page
              await clearCookies();
              let scan = await storage.getItem('local:scan');
              await updateTab(tabs[0].id, scan.url);
              scan = null;
            }
          }

          await waitStableFrames(tabs[0].id);
          await browser.scripting.executeScript({
            target: {tabId: tabs[0].id, allFrames: true}, func: awaitNoDOMChanges, injectImmediately: true,
          });

          // checking dark patterns
          await openNotification(tabs[0].id, browser.i18n.getMessage('background_darkPatternDetectionTitle'),
              browser.i18n.getMessage('background_darkPatternDetectionText'), 'blue');

          // check for interfaceInterference
          const interferenceRet = await browser.scripting.executeScript({
            target: {tabId: tabs[0].id, allFrames: true},
            files: ['checkInterfaceInterference.js'],
            injectImmediately: true,
          });
          const interferenceRes = interferenceRet.map(obj => obj.result);
          const colorDistance = interferenceRes.find(item => item && item.colorDistance != null)?.colorDistance;
          console.log('colorDistance of accept and reject', colorDistance);
          if (colorDistance != null) {
            scan = await storage.getItem('local:scan');
            scan.colorDistance = colorDistance;
            await storage.setItem('local:scan', scan);
            scan = null;
          }

          // check for forced action - dark pattern
          const forcedActionRet = await browser.scripting.executeScript({
            target: {tabId: tabs[0].id}, files: ['checkForcedAction.js'], injectImmediately: true,
          });
          /**
           * @type {string[]}
           */
          let nonReachable = forcedActionRet[0].result.nonReachable;

          // click on accept button and wait
          /**
           * @type {Interaction}
           */
          let interaction = await storage.getItem('local:interaction');
          interaction.ie = interactiveElements[Purpose.Accept][0];
          await storage.setItem('local:interaction', interaction);
          await noticeInteractAndWait(tabs[0].id);

          // check if nonReachable are now reachable
          const availableRet = await browser.scripting.executeScript({
            target: {tabId: tabs[0].id}, func: (nonReachable, DARK_PATTERN_STATUS) => {
              for (let sel of nonReachable) {
                const el = document.querySelector(sel);
                const rect = el.getBoundingClientRect();
                const midX = (rect.left + rect.right) / 2;
                const midY = (rect.top + rect.bottom) / 2;
                if (midX < window.innerWidth && midY < window.innerHeight) {
                  const coordEl = document.elementFromPoint(midX, midY);
                  if (el.contains(coordEl)) return {status: DARK_PATTERN_STATUS.HAS_FORCED_ACTION};
                }
              }

              return {status: DARK_PATTERN_STATUS.NO_FORCED_ACTION};
            }, injectImmediately: true, args: [nonReachable, DARK_PATTERN_STATUS],
          });

          /**
           * @type {number}
           */
          const forcedActionStatus = availableRet[0].result.status;
          if (forcedActionStatus === DARK_PATTERN_STATUS.HAS_FORCED_ACTION) {
            scan = await storage.getItem('local:scan');
            scan.forcedActionStatus = forcedActionStatus;
            await storage.setItem('local:scan', scan);
            scan = null;
          }
          console.log('forcedActionStatus: ', forcedActionStatus);

          // reset cookies and reload page
          await clearCookies();
          scan = await storage.getItem('local:scan');
          await updateTab(tabs[0].id, scan.url);
          scan = null;

          await waitStableFrames(tabs[0].id);
          await browser.scripting.executeScript({
            target: {tabId: tabs[0].id, allFrames: true}, func: awaitNoDOMChanges, injectImmediately: true,
          });

          await openNotification(tabs[0].id, browser.i18n.getMessage('background_interactWoBannerTitle'),
              browser.i18n.getMessage('background_interactWoBannerText'), 'blue');

          // interact with page, while ignoring cookie banner
          await interactWithPageAndWait(tabs);

          await storeCookieResults(INTERACTION_STATE.PAGE_WO_NOTICE);
          // await delay(2000);
          await browser.scripting.executeScript({
            target: {tabId: tabs[0].id, allFrames: true}, func: awaitNoDOMChanges, injectImmediately: true,
          });

          scan = await storage.getItem('local:scan');
          console.log('scan in the end: ', scan);
          scan = null;

          let reportRet = await browser.scripting.executeScript({
            target: {tabId: tabs[0].id}, files: ['reportCreator.js'], injectImmediately: true,
          });
          if (reportRet[0].result !== 'success') {
            throw new Error('Report creation did not succeed.', {cause: reportRet[0].result});
          }

        })();
      } else if (msg === 'no_notice') {
        sendResponse({msg: 'ok'});
        // TODO finish this and make it jump to the same handler that interacts with the page (without cookie notice) after cookie notice interaction
        (async () => {
          const tabs = await browser.tabs.query({active: true});
          const response = await browser.tabs.sendMessage(tabs[0].id, {msg: 'cancel_select'});
          if (response?.msg !== 'ok') throw new Error('cancel_select not confirmed');
          let scan = await storage.getItem('local:scan');
          scan.stage2 = STAGE2.INTERACTION_WO_NOTICE;
          await storage.setItem('local:scan', scan);
          scan = null;
        })();
      } else if (msg === 'cancel_scan') {
        (async () => {
          if (browser.cookies.onChanged.hasListener(cookieListener)) {
            browser.cookies.onChanged.removeListener(cookieListener);
          }
          await resetStorage();
          await clearCookies();
          const tabs = await browser.tabs.query({active: true});
          await updateTab(tabs[0].id, tabs[0].url);
          sendResponse({msg: 'ok'});
        })();
        return true;
      } else if (msg === 'relay') {
        (async () => {
          const {data} = message;
          const tabs = await browser.tabs.query({active: true});
          const res = await browser.tabs.sendMessage(tabs[0].id, data);
          sendResponse({msg: res.msg});
        })();
        return true;
      }
    });

    /**
     * Converts logits into the purpose of the interactive element.
     * @param {Object} modelRes The result of the interactive_element_model
     * @return {number} Integer that corresponds to a value in the Purpose object
     */
    function getIELabel(modelRes) {
      let label = modelRes.label;
      if (label === 'LABEL_0') {
        return Purpose.Accept;
      } else if (label === 'LABEL_1') {
        return Purpose.Close;
      } else if (label === 'LABEL_2') {
        return Purpose.Settings;
      } else if (label === 'LABEL_3') {
        return Purpose.Other;
      } else if (label === 'LABEL_4') {
        return Purpose.Reject;
      } else if (label === 'LABEL_5') {
        return Purpose.SaveSettings;
      } else throw new Error('Impossible maxIndex');
    }

    async function translateToEnglish(text) {
      let response = await fetch(
          `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dt=bd&dj=1&q=${encodeURIComponent(
              text)}`);
      /**
       * @typedef {Object} Sentence
       * @property {string} trans - The translated text.
       */
      /**
       * @typedef {Object} TranslationResponse
       * @property {Sentence[]} sentences - The sentences in the translation response.
       * @property {string} src - The source language detected.
       */
      /** @type {TranslationResponse} */
      const body = await response.json();
      const result = {
        resultText: '', sourceLanguage: '', percentage: 0, isError: false, errorMessage: '',
      };

      result.sourceLanguage = body.src;
      result.resultText = body.sentences.map(sentence => sentence.trans).
          join('');

      return result;

      /*
      if (!result || result?.status !== 200) {
          resultData.isError = true;

          if (!result || result.status === 0) resultData.errorMessage = "There was a network error while translating.";
          else if (result.status === 429 || result.status === 503) resultData.errorMessage = "The translation service is unaivalable.";
          else resultData.errorMessage = `Unknown error while translating: [${result?.status} ${result?.statusText}]`;

          return resultData;
      }

      // resultData.sourceLanguage = result.data.src;
      // resultData.percentage = result.data.ld_result.srclangs_confidences[0];
      // resultData.resultText = result.data.sentences.map(sentence => sentence.trans).join("");
      // if (result.data.dict) {
      //     resultData.candidateText = result.data.dict
      //         .map(dict => `${dict.pos}${dict.pos != "" ? ": " : ""}${dict.terms !== undefined?dict.terms.join(", "):""}\n`)
      //         .join("");
      // }

      return resultData;*/
    }

    async function translateAndGetPurposeDeclared(purposeClassifier, untranslatedText) {
      // translation of selection elements
      let translationResponse = await translateToEnglish(untranslatedText);
      let translatedNoticeText = translationResponse.resultText;

      const segmenterEn = new Intl.Segmenter('en', {granularity: 'sentence'});
      const segmentIter = segmenterEn.segment(translatedNoticeText);
      const sentences = Array.from(segmentIter).map(obj => obj.segment);

      if (purposeClassifier == null) throw new Error('Purpose Classifier is null');
      const purposeClassifications = (await purposeClassifier(sentences)).map(res => {
        return parseInt(res.label);
      });
      purposeClassifier = null;
      return Math.max(...purposeClassifications) > 0;
    }

    /**
     *
     * @param {Tab[]} tabs
     * @param {InjectionResult} frameRet
     * @param {Function} ieClassifier
     * @param twoLevelInteractiveElements
     * @param iElement
     * @param {boolean} useQuantized
     * @param {boolean} sameNotice True if the settings notice has the same selector as the first cookie notice.
     * @return {Promise<{sndLevelIntObjs: (*|[]|null), sndLevelNoticeText: *}>}
     */
    async function processSelectedSettings(tabs, frameRet, ieClassifier, twoLevelInteractiveElements, iElement,
        useQuantized, sameNotice) {
      /**
       * @type {Selection[]}
       */
      const secondSelections = await storage.getItem('local:second_selections');
      let result = {text: null, interactiveObjects: null};
      if (sameNotice) {
        // need to get data from the notice with the selector in local:selection
        let ret = await browser.scripting.executeScript({
          target: {tabId: tabs[0].id, allFrames: true},
          files: ['retrieveDataFromFirstNotice.js'],
          injectImmediately: true,
        });
        for (const frameRet of ret) {
          const frameRes = frameRet.result;
          if (frameRes.status === SECOND_LVL_STATUS.SUCCESS) {
            result.text = frameRes.text;
            result.interactiveObjects = frameRes.interactiveObjects;
            break;
          }
        }
        console.log('result of same notice case: ', result);
      } else if (!sameNotice && secondSelections.length > 0) {
        // getting the data from the most recent addition to secondSelections
        result.text = secondSelections[secondSelections.length - 1].notice.text;
        result.interactiveObjects = secondSelections[secondSelections.length - 1].interactiveObjects;
      }

      let sndLevelNoticeText = result.text;
      let sndLevelIntObjs = result.interactiveObjects;

      // run analysis on sndLevelNoticeText, probably best to do create a new function
      let purposeClassifier = await PurposePipelineSingleton.getInstance(useQuantized);
      let purposeDeclared = await translateAndGetPurposeDeclared(purposeClassifier, sndLevelNoticeText);
      console.log(`purposeDeclared on second level: ${purposeDeclared}`);
      if (purposeDeclared) {
        /**
         * @type {Selection}
         */
        let selection = await storage.getItem('local:selection');
        if (selection.notice.label === 0) {
          // TODO: maybe store the info somewhere that purpose was only declared on second level
          selection.notice.label = 1;
        }
        await storage.setItem('local:selection', selection);
      }

      // run analysis on sndLevelIntObjs
      let sndLevelTranslatedTexts = await Promise.all(sndLevelIntObjs.map(async obj => {
        let text = obj.text;
        let res = await translateToEnglish(text);
        return res.resultText;
      }));
      const labels = (await ieClassifier(sndLevelTranslatedTexts)).map(res => {
        return getIELabel(res);
      });
      for (let i = 0; i < labels.length; i++) {
        sndLevelIntObjs[i].text = [iElement.text[0], sndLevelIntObjs[i].text[0]];
        sndLevelIntObjs[i].selector = [
          iElement.selector[0], sndLevelIntObjs[i].selector[0]];
        sndLevelIntObjs[i].x = [iElement.x[0], sndLevelIntObjs[i].x[0]];
        sndLevelIntObjs[i].y = [iElement.y[0], sndLevelIntObjs[i].y[0]];
        sndLevelIntObjs[i].label = labels[i];

        twoLevelInteractiveElements[labels[i]].push(sndLevelIntObjs[i]);
      }
      return {sndLevelNoticeText, sndLevelIntObjs};
    }

    /**
     * Clicks on the current first selector in local:interaction and waits for the DOM changes to finish.
     * @param {number} tabId
     * @return {Promise<boolean>} - True, if the button click happened without problems.
     */
    async function noticeInteractAndWait(tabId) {
      let statusCodes, wasSuccess;
      let ret = await browser.scripting.executeScript({
        target: {tabId: tabId, allFrames: true}, files: ['noticeInteractor.js'], injectImmediately: true,
      });
      statusCodes = ret.map(obj => obj.result);
      await waitStableFrames(tabId);
      await browser.scripting.executeScript({
        target: {tabId: tabId, allFrames: true}, func: awaitNoDOMChanges, injectImmediately: true,
      });

      if (statusCodes.some(code => code === NOTICE_STATUS.SUCCESS)) {
        wasSuccess = true;
      } else if (statusCodes.some(code => code === NOTICE_STATUS.WRONG_SELECTOR)) {
        console.log('WRONG_SELECTOR');
        wasSuccess = false;
        // get the user to select the different cookie notice
      }

      // TODO: this is currently not working,
      //  but something similar should be added
      //  to check if the notice has actually disappeared.
      /*ret = await browser.scripting.executeScript({
          target: {tabId: tabId, allFrames: true}, files: ['noticeStillOpen.js'], injectImmediately: true
      });
      statusCodes = ret.map(obj => obj.result);
      if (statusCodes.some(code => code === NOTICE_STATUS.NOTICE_STILL_OPEN)) {
          let selection = await storage.getItem("local:selection");
          let secondSelection = await storage.getItem("local:second_selection");
          console.log(`NOTICE_STILL_OPEN sel: ${JSON.stringify(selection)} secSel: ${JSON.stringify(secondSelection)}`);
          wasSuccess = false;
      } else if (statusCodes.some(code => code === NOTICE_STATUS.NOTICE_CLOSED)) {
          console.log("NOTICE_CLOSED");
          wasSuccess = true;
      }*/

      return wasSuccess;
    }

    async function purposeProgress(args) {
      if (args.status !== 'progress') return;
      let progress = await storage.getItem('local:progress');
      progress.purpose = Math.trunc(args.progress);
      progress.purposeDownloading = true;
      await storage.setItem('local:progress', progress);
    }

    async function ieProgress(args) {
      if (args.status !== 'progress') return;
      let progress = await storage.getItem('local:progress');
      progress.ie = Math.trunc(args.progress);
      progress.ieDownloading = true;
      await storage.setItem('local:progress', progress);
    }
  },
});