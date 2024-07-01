import {env, pipeline} from '@xenova/transformers';
import {Mutex} from 'async-mutex';
import {storage} from 'wxt/storage';
import {constructKeyFromCookie, handleCookie} from './cookieManagement.js';
import {
  awaitNoDOMChanges,
  DARK_PATTERN_STATUS, delay,
  INTERACTION_STATE,
  isAALabel,
  MAX_OTHER_BTN_COUNT,
  NOTICE_STATUS,
  openNotification,
  PAGE_COUNT,
  Purpose,
  resetStorage,
  SECOND_LVL_STATUS,
  STAGE2,
  updateTab,
  urlWoQueryOrFragment,
  waitStableFrames,
} from './modules/globals.js';

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
       * @return {Promise<function(string): Promise<Array<{label: string}>>>}
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

    // Whenever CookieAudit is installed or updated to a new version, we open the onboarding page.
    browser.runtime.onInstalled.addListener(async function(object) {
      await resetStorage();
      await storage.setItem('local:stoppingScan', false);
      if (object.previousVersion !== browser.runtime.getManifest().version) {
        let url = browser.runtime.getURL('/onboarding.html');
        if (object.reason === browser.runtime.OnInstalledReason.INSTALL || object.reason ===
            browser.runtime.OnInstalledReason.UPDATE) {
          await browser.tabs.create({url});
        }
      }
    });

    // whenever the browser is started, we reset all data of the extension
    browser.runtime.onStartup.addListener(async function() {
      await resetStorage();
      await storage.setItem('local:stoppingScan', false);
    });

    // If the user goes to a different website while the scan is running, we have to stop the scan
    browser.tabs.onUpdated.addListener(async function(tabId, changeInfo) {
      const scan = await storage.getItem('local:scan');
      if (scan == null) {
        await resetStorage();
        await storage.setItem('local:stoppingScan', false);
      } else if (URL.canParse(scan.url) && URL.canParse(changeInfo.url)) {
        let scanUrl = (new URL(scan.url)).hostname;
        let changeUrl = (new URL(changeInfo.url)).hostname;
        if (scanUrl !== changeUrl) {
          // user has gone to some different url, resetting scan
          if (await scanIsRunning() && (await storage.getItem('local:stoppingScan')) === false) {
            await storage.setItem('local:stoppingScan', true);
          } else {
            // when scan ist already FINISHED
            await resetStorage();
            await clearCookies();
          }
        }
      }
    });

    const mutex = new Mutex();
    /** @type {Object<string,Mutex>} */
    const cookieMutexes = {};
    // Handlers for all messages sent to the background script.
    browser.runtime.onMessage.addListener(function(message, _, sendResponse) {
      let {msg} = message;
      if (msg === 'start_scan') {
        sendResponse({msg: 'ok'});
        let interactiveElements;
        const USE_QUANTIZED = true;
        (async () => {
          /**
           * the promise is resolved if either the scan is complete or the scan is stopped by the user during execution
           * (e.g., by going to a different webpage, or clicking the reset button)
           * it is rejected, if some exception occurs
           */
          const result = await new Promise(async (resolve, reject) => {
            const unwatch = storage.watch('local:stoppingScan', async (isStopping, wasStopping) => {
              if (wasStopping === false && isStopping === true) {
                unwatch();
                resolve('scan_stop');
              }
            });
            if ((await storage.getItem('local:stoppingScan')) === true) {
              unwatch();
              resolve('scan_stop');
            }

            let tabs = await browser.tabs.query({active: true});
            await updateTab(tabs[0].id, urlWoQueryOrFragment(tabs[0].url));
            await resetStorage();
            await clearCookies();
            browser.cookies.onChanged.removeListener(cookieListener);

            let scan = await storage.getItem('local:scan');
            scan.stage2 = STAGE2.NOTICE_SELECTION;
            scan['scanStart'] = Date.now();
            tabs = await browser.tabs.query({active: true});
            scan['url'] = urlWoQueryOrFragment(tabs[0].url);
            await storage.setItem('local:scan', scan);

            await waitStableFrames(tabs[0].id);
            let frames = await browser.webNavigation.getAllFrames({tabId: tabs[0].id});
            let promises = [];
            for (let frame of frames.values()) {
              if (frame.url !== 'about:blank') {
                promises.push(browser.tabs.sendMessage(tabs[0].id, {msg: 'mount_select'}, {frameId: frame.frameId}));
              }
            }

            const mountResponses = await Promise.allSettled(promises);
            if (mountResponses.some(res => res.status === 'fulfilled' && res.value.msg !== 'ok')) {
              throw new Error('mount_select not confirmed by content script');
            }

            await showSelectorNotification();
            const response = await browser.tabs.sendMessage(tabs[0].id, {msg: 'start_select'});
            if (response?.msg !== 'selected_notice') {
              reject(new Error('start_select not confirmed by selector'));
            }

            // getting first layer notice selection
            /**
             * @type {Selection}
             */
            let selection = await storage.getItem('local:selection');
            if (selection == null) reject(new Error('local:selection should be set'));

            scan = await storage.getItem('local:scan');
            scan.stage2 = STAGE2.NOTICE_ANALYSIS;
            scan['noticeDetected'] = true;
            await storage.setItem('local:scan', scan);

            // Skip initial check for local models, since we are not loading any local models.
            env.allowLocalModels = false;
            // Due to a bug in onnxruntime-web, we must disable multithreading for now.
            // See https://github.com/microsoft/onnxruntime/issues/14445 for more information.
            env.backends.onnx.wasm.numThreads = 1;

            await waitStableFrames(tabs[0].id);
            let frameIds = await nonBlankFrameIds(tabs[0].id);
            await browser.scripting.executeScript({
              target: {tabId: tabs[0].id, frameIds}, func: awaitNoDOMChanges, injectImmediately: true,
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

            let ieClassifier = await IEPipelineSingleton.getInstance(USE_QUANTIZED);
            if (ieClassifier == null) reject(new Error('IE Classifier was null'));

            const translatedTexts = await Promise.all(selection.interactiveObjects.map(async obj => {
              if (obj.text.length !== 1 && obj.text.length !== 2) {
                throw new Error('Interactive object has illegal text array length.');
              }
              let text = obj.text[obj.text.length - 1];
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
            console.log('ieToSndLevel', ieToSndLevel);
            for (const iElement of ieToSndLevel) {
              let interaction = await storage.getItem('local:interaction');
              interaction.ie = iElement;
              await storage.setItem('local:interaction', interaction);
              console.log('interaction now: ', interaction);

              await waitStableFrames(tabs[0].id);
              let frameIds = await nonBlankFrameIds(tabs[0].id);
              await browser.scripting.executeScript({
                target: {tabId: tabs[0].id, frameIds}, func: awaitNoDOMChanges, injectImmediately: true,
              });

              tabs = await browser.tabs.query({active: true});
              const urlBeforeClick = tabs[0].url;
              const clickRet = await browser.scripting.executeScript({
                target: {tabId: tabs[0].id, allFrames: true}, files: ['clickSettingsBtn.js'], injectImmediately: true,
              });

              // there should only be one non-null value, which from the frame where the actual notice is
              const clickRetFrame = clickRet.find(ret => ret.result != null);
              if (clickRetFrame == null) {
                reject(new Error('clickResult of clickSettingsBtn was null'));
              }
              const clickResult = clickRetFrame.result;
              if (clickResult.status === SECOND_LVL_STATUS.ERROR) {
                reject(new Error(clickResult.msg));
                return;
              } else if (clickResult.status === SECOND_LVL_STATUS.SUCCESS) {
                await waitStableFrames(tabs[0].id);
                let frameIds = await nonBlankFrameIds(tabs[0].id);
                await browser.scripting.executeScript({
                  target: {tabId: tabs[0].id, frameIds}, func: awaitNoDOMChanges, injectImmediately: true,
                });
                tabs = await browser.tabs.query({active: true});
                const urlAfterClick = tabs[0].url;
                let url1 = new URL(urlBeforeClick);
                url1.hash = '';
                let url2 = new URL(urlAfterClick);
                url2.hash = '';
                let sndLevelNoticeText, sndLevelIntObjs;
                if (url1.href !== url2.href) {
                  ({
                    sndLevelNoticeText, sndLevelIntObjs,
                  } = await handleNewNotice(ieClassifier, twoLevelInteractiveElements, iElement, USE_QUANTIZED));
                } else {
                  const checkRet = await browser.scripting.executeScript({
                    target: {tabId: tabs[0].id, allFrames: true},
                    files: ['checkIfSameNotice.js'],
                    injectImmediately: true,
                  });
                  if (checkRet == null) {
                    return reject(new Error('checkRet was null.'));
                  }
                  const checkRetFrame = checkRet.find(ret => ret != null);
                  if (checkRetFrame == null) {
                    return reject(new Error('checkRet was null.'));
                  }
                  const checkResult = checkRetFrame.result;
                  if (checkResult == null) {
                    return reject(new Error('checkResult was null'));
                  }
                  if (checkResult.status === SECOND_LVL_STATUS.ERROR) {
                    return reject(new Error(checkResult.msg));
                  } else if (checkResult.status === SECOND_LVL_STATUS.SAME_NOTICE) {
                    console.log('determined SAME_NOTICE');
                    ({
                      sndLevelNoticeText, sndLevelIntObjs,
                    } = await processSelectedSettings(tabs, ieClassifier, twoLevelInteractiveElements, iElement,
                        USE_QUANTIZED, true));
                  } else if (checkResult.status === SECOND_LVL_STATUS.NEW_NOTICE) {
                    console.log('determined NEW_NOTICE');
                    ({
                      sndLevelNoticeText, sndLevelIntObjs,
                    } = await handleNewNotice(ieClassifier, twoLevelInteractiveElements, iElement, USE_QUANTIZED));
                  }
                }
              }

              // reset cookies and reload page
              await clearCookies();
              let scan = await storage.getItem('local:scan');
              await updateTab(tabs[0].id, urlWoQueryOrFragment(scan.url));
              scan = null;
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
            scan.stage2 = STAGE2.PAGE_INTERACTION;
            await storage.setItem('local:scan', scan);
            let ieToInteractLength = scan.ieToInteract.length;
            scan = null;

            await clearCookies();
            // iterate over interactive elements
            for (let i = 0; i < ieToInteractLength; i++) {
              browser.cookies.onChanged.addListener(cookieListener);

              let interaction = await storage.getItem('local:interaction');
              scan = await storage.getItem('local:scan');
              interaction.ie = scan.ieToInteract[i];
              scan = null;
              await storage.setItem('local:interaction', interaction);

              let text;
              if (interaction.ie.selector.length === 1) {
                text = browser.i18n.getMessage('background_singleInteractionText', [interaction.ie.text[0]]);
              } else if (interaction.ie.selector.length === 2) {
                text = browser.i18n.getMessage('background_doubleInteractionText',
                    [interaction.ie.text[0], interaction.ie.text[1]]);
              }

              await waitStableFrames(tabs[0].id);
              let frameIds = await nonBlankFrameIds(tabs[0].id);
              await browser.scripting.executeScript({
                target: {tabId: tabs[0].id, frameIds}, func: awaitNoDOMChanges, injectImmediately: true,
              });

              await openNotification(tabs[0].id, browser.i18n.getMessage('background_interactionTitle'), text, 'blue');

              frameIds = await nonBlankFrameIds(tabs[0].id);
              await browser.scripting.executeScript({
                target: {tabId: tabs[0].id, frameIds}, func: awaitNoDOMChanges, injectImmediately: true,
              });

              /**
               * @type {boolean}
               */
              let wasSuccess = await noticeInteractAndWait(tabs[0].id);

              if (interaction.ie.selector.length === 2 && wasSuccess) {
                interaction.ie.selector.shift();
                interaction.ie.x.shift();
                interaction.ie.y.shift();
                await storage.setItem('local:interaction', interaction);

                wasSuccess = await noticeInteractAndWait(tabs[0].id);
              }

              if (wasSuccess) {
                await openNotification(tabs[0].id, browser.i18n.getMessage('background_ieSuccessTitle'),
                    browser.i18n.getMessage('background_ieSuccessText'), 'blue');

                await interactWithPageAndWait(tabs);
                browser.cookies.onChanged.removeListener(cookieListener);
                await storeCookieResults(INTERACTION_STATE.PAGE_W_NOTICE);

                interaction = await storage.getItem('local:interaction');
                interaction.visitedPages = [];
                await storage.setItem('local:interaction', interaction);

                // reset cookies and reload page
                await clearCookies();
                let scan = await storage.getItem('local:scan');

                await updateTab(tabs[0].id, urlWoQueryOrFragment(scan.url));
                scan = null;
              } else if (!wasSuccess) {
                await openNotification(tabs[0].id, browser.i18n.getMessage('background_ieErrorTitle'),
                    browser.i18n.getMessage('background_ieErrorText'), 'red');

                browser.cookies.onChanged.removeListener(cookieListener);
                // reset cookies and reload page
                await clearCookies();
                let scan = await storage.getItem('local:scan');

                await updateTab(tabs[0].id, urlWoQueryOrFragment(scan.url));
                scan = null;
              }
            }
            await waitStableFrames(tabs[0].id);
            frameIds = await nonBlankFrameIds(tabs[0].id);
            await browser.scripting.executeScript({
              target: {tabId: tabs[0].id, frameIds}, func: awaitNoDOMChanges, injectImmediately: true,
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
            for (let res of interferenceRes) {
              if (res.status === 'error') {
                throw new Error('Error while checking interface interference.', {cause: res.error});
              } else if (res.status === 'ok' && res.colorDistances.length > 0) {
                scan = await storage.getItem('local:scan');
                scan.colorDistances = res.colorDistances;
                await storage.setItem('local:scan', scan);
                scan = null;
                break;
              }
            }

            // check for forced action - dark pattern
            const forcedActionRet = await browser.scripting.executeScript({
              target: {tabId: tabs[0].id}, files: ['checkForcedAction.js'], injectImmediately: true,
            });

            /**  @type {string[]} */
            let nonReachable = forcedActionRet[0].result.nonReachable;

            // click the accept button and wait
            /**
             * @type {Interaction}
             */
            let interaction = await storage.getItem('local:interaction');
            interaction.ie = interactiveElements[Purpose.Accept][0];
            await storage.setItem('local:interaction', interaction);

            tabs = await browser.tabs.query({active: true});
            await noticeInteractAndWait(tabs[0].id);

            // check if nonReachable are now reachable
            const availableRet = await browser.scripting.executeScript({
              target: {tabId: tabs[0].id}, func: (nonReachable, DARK_PATTERN_STATUS) => {
                for (let sel of nonReachable) {
                  const el = document.querySelector(sel);
                  if (el != null) {
                    const rect = el.getBoundingClientRect();
                    const midX = (rect.left + rect.right) / 2;
                    const midY = (rect.top + rect.bottom) / 2;
                    if (midX < window.innerWidth && midY < window.innerHeight) {
                      const coordEl = document.elementFromPoint(midX, midY);
                      if (el.contains(coordEl)) return {status: DARK_PATTERN_STATUS.HAS_FORCED_ACTION};
                    }
                  }
                }

                return {status: DARK_PATTERN_STATUS.NO_FORCED_ACTION};
              }, injectImmediately: true, args: [nonReachable, DARK_PATTERN_STATUS],
            });

            /** @type {number} */
            const forcedActionStatus = availableRet[0].result.status;
            if (forcedActionStatus === DARK_PATTERN_STATUS.HAS_FORCED_ACTION) {
              scan = await storage.getItem('local:scan');
              scan.forcedActionStatus = forcedActionStatus;
              await storage.setItem('local:scan', scan);
              scan = null;
            }

            // reset cookies and reload page
            await clearCookies();
            scan = await storage.getItem('local:scan');
            await updateTab(tabs[0].id, urlWoQueryOrFragment(scan.url));
            scan = null;

            await waitStableFrames(tabs[0].id);
            frameIds = await nonBlankFrameIds(tabs[0].id);
            await browser.scripting.executeScript({
              target: {tabId: tabs[0].id, frameIds}, func: awaitNoDOMChanges, injectImmediately: true,
            });

            await openNotification(tabs[0].id, browser.i18n.getMessage('background_interactWoBannerTitle'),
                browser.i18n.getMessage('background_interactWoBannerText'), 'blue');

            await clearCookies();
            browser.cookies.onChanged.addListener(cookieListener);

            // interact with page, while ignoring cookie banner
            await interactWithPageAndWait(tabs);
            browser.cookies.onChanged.removeListener(cookieListener);
            await storeCookieResults(INTERACTION_STATE.PAGE_WO_NOTICE);

            frameIds = await nonBlankFrameIds(tabs[0].id);
            await browser.scripting.executeScript({
              target: {tabId: tabs[0].id, frameIds}, func: awaitNoDOMChanges, injectImmediately: true,
            });

            let reportRet = await browser.scripting.executeScript({
              target: {tabId: tabs[0].id}, files: ['reportCreator.js'], injectImmediately: true,
            });
            if (reportRet[0].result === 'success') {
              scan = await storage.getItem('local:scan');
              scan.stage2 = STAGE2.FINISHED;
              await storage.setItem('local:scan', scan);
              scan = null;
              await openNotification(tabs[0].id, browser.i18n.getMessage('background_finishedReportTitle'),
                  browser.i18n.getMessage('background_finishedReportText'), 'blue');
            } else {
              reject(new Error('Report creation did not succeed.', {cause: reportRet[0].result}));
            }
            unwatch();
            resolve();
          }).catch(e => {
            console.log('Error during scan: ', e);
          });

          if (result === 'scan_stop') {
            // The `background.js` has stopped. We can now reset and reload
            if (browser.cookies.onChanged.hasListener(cookieListener)) {
              browser.cookies.onChanged.removeListener(cookieListener);
            }

            let tabs = await browser.tabs.query({active: true});
            await updateTab(tabs[0].id, urlWoQueryOrFragment(tabs[0].url));
            await resetStorage();
            await clearCookies();
            await storage.setItem('local:stoppingScan', false);
            browser.runtime.reload();
          }
        })();
      } else if (msg === 'no_notice') {
        sendResponse({msg: 'ok'});
        // TODO finish this and make it jump to the same handler that interacts with the page (without cookie notice) after cookie notice interaction
        (async () => {
          const tabs = await browser.tabs.query({active: true});
          const response = await browser.tabs.sendMessage(tabs[0].id, {msg: 'cancel_select'});
          if (response?.msg !== 'ok') throw new Error('cancel_select not confirmed');

          await openNotification(tabs[0].id, browser.i18n.getMessage('background_noNoticeTitle'),
              browser.i18n.getMessage('background_noNoticeText'), 'red');

          if (browser.cookies.onChanged.hasListener(cookieListener)) {
            browser.cookies.onChanged.removeListener(cookieListener);
          }
          await resetStorage();
          await clearCookies();

          await updateTab(tabs[0].id, urlWoQueryOrFragment(tabs[0].url));
          sendResponse({msg: 'ok'});
        })();
      } else if (msg === 'cancel_scan') {
        // this is run whenever the user clicks on the Reset button in the popup
        (async () => {
          if (browser.cookies.onChanged.hasListener(cookieListener)) {
            browser.cookies.onChanged.removeListener(cookieListener);
          }
          if (await scanIsRunning() && await storage.getItem('local:stoppingScan') === false) {
            // If the scan is running, we have to stop it gracefully.
            // Please inspect the Promise inside the start_scan case above.
            await storage.setItem('local:stoppingScan', true);
          } else {
            // the scan wasn't started, or has already finished
            // we can just reset all data and reload the tab.
            await resetStorage();
            await clearCookies();
            const tabs = await browser.tabs.query({active: true});
            await updateTab(tabs[0].id, urlWoQueryOrFragment(tabs[0].url));
          }
          sendResponse({msg: 'ok'});
        })();
        return true;
      } else if (msg === 'relay') {
        // this enables content scripts (particularly selector.content) to also display notifications via the notifications.content
        (async () => {
          const {data} = message;
          const tabs = await browser.tabs.query({active: true});
          const res = await browser.tabs.sendMessage(tabs[0].id, data);
          sendResponse({msg: res.msg});
        })();
        return true;
      }
    });

    async function scanIsRunning() {
      const scan = await storage.getItem('local:scan');
      if (scan == null || scan.stage2 == null || scan.stage2 === STAGE2.NOT_STARTED || scan.stage2 ===
          STAGE2.FINISHED) {
        return false;
      } else {
        return true;
      }
    }

    /**
     * Handles the case where the settings notice is not the same as the first level notice.
     * Also works for settings that are opened on a separate URL.
     * @param {Function} ieClassifier
     * @param twoLevelInteractiveElements
     * @param iElement
     * @param {boolean} USE_QUANTIZED
     * @returns {Promise<{sndLevelIntObjs: (any | [] | null), sndLevelNoticeText: any}>}
     */
    async function handleNewNotice(ieClassifier, twoLevelInteractiveElements, iElement, USE_QUANTIZED) {
      let scan = await storage.getItem('local:scan');
      scan.stage2 = STAGE2.SECOND_SELECTION;
      await storage.setItem('local:scan', scan);

      let tabs = await browser.tabs.query({active: true});
      await waitStableFrames(tabs[0].id);
      let frameIds = await nonBlankFrameIds(tabs[0].id);
      await browser.scripting.executeScript({
        target: {tabId: tabs[0].id, frameIds}, func: awaitNoDOMChanges, injectImmediately: true,
      });

      let frames = await browser.webNavigation.getAllFrames({tabId: tabs[0].id});
      let promises = [];
      for (let frame of frames.values()) {
        if (frame.url !== 'about:blank') {
          promises.push(browser.tabs.sendMessage(tabs[0].id, {msg: 'mount_select'}, {frameId: frame.frameId}));
        }
      }

      const mountResponses = await Promise.allSettled(promises);

      if (mountResponses.some(res => res.status === 'fulfilled' && res.value.msg !== 'ok')) {
        throw new Error('mount_select not confirmed by content script');
      }

      const selectorNotificationRes = await showSelectorNotification();
      let sndLevelNoticeText, sndLevelIntObjs;
      if (selectorNotificationRes?.msg === 'action') {
        const response = await browser.tabs.sendMessage(tabs[0].id, {msg: 'start_select'});

        if (response?.msg !== 'selected_notice' && response !== 'stopped') {
          throw new Error('start_select not confirmed by selector');
        }

        scan = await storage.getItem('local:scan');
        scan.stage2 = STAGE2.NOTICE_ANALYSIS;
        await storage.setItem('local:scan', scan);
        scan = null;

        /**
         * @type {Selection[]}
         */
        let secondSelections = await storage.getItem('local:second_selections');
        if (secondSelections == null || secondSelections.length === 0) {
          throw new Error('local:second_selections should be set');
        }
        tabs = await browser.tabs.query({active: true});
        ({
          sndLevelNoticeText, sndLevelIntObjs,
        } = await processSelectedSettings(tabs, ieClassifier, twoLevelInteractiveElements, iElement, USE_QUANTIZED,
            false));
      }
      return {sndLevelNoticeText, sndLevelIntObjs};
    }

    async function showSelectorNotification() {
      // Show notification about selector to user
      const scan = await storage.getItem('local:scan');

      const tabs = await browser.tabs.query({active: true});
      let text, title, action, inaction;
      if (scan.stage2 === STAGE2.NOTICE_SELECTION) {
        title = browser.i18n.getMessage('selector_selectNoticeTitle');
        text = browser.i18n.getMessage('selector_selectNoticeText');
        return await browser.tabs.sendMessage(tabs[0].id, {
          msg: 'popover', title, text, color: 'orange',
        });
      } else if (scan.stage2 === STAGE2.SECOND_SELECTION) {
        title = browser.i18n.getMessage('selector_selectNewNoticeTitle');
        text = browser.i18n.getMessage('selector_selectNewNoticeText');
        action = browser.i18n.getMessage('selector_startNewNoticeSelectBtn');
        inaction = browser.i18n.getMessage('selector_skipNewNoticeSelectBtn');
        return await browser.tabs.sendMessage(tabs[0].id, {
          msg: 'popover', title, text, color: 'orange', buttons: {
            time: 10, action, inaction,
          },
        });
      }
    }

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

    /**
     * @param {string} text
     * @returns {Promise<{resultText: string, isError: boolean, percentage: number, errorMessage: string, sourceLanguage: string}>}
     */
    async function translateToEnglish(text) {
      if (text instanceof Array) throw new Error('The input into translateToEnglish is an Array');
      let sentences;
      // From some testing, I have found
      // that the upper limit that the translation endpoint accepts is around 11k characters.
      if (text.length > 9000) {
        /*
         * We need to split up long text into shorter chunks to be able to translate it.
         * 1) detect language
         * 2) split up the text into individual sentences
         * 3) iterate over the individual sentences and always join SENTENCE_COUNT sentences back together to one string.
         * Result: the variable `sentences` contains an array of strings.
         * Each element (except the last) of `sentences` contains SENTENCE_COUNT sentences.
         */

        const languageDetectionResult = await browser.i18n.detectLanguage(text);
        languageDetectionResult.languages.sort((a, b) => b.percentage - a.percentage);
        const language = languageDetectionResult.languages[0].language;
        const segmenter = new Intl.Segmenter(language, {granularity: 'sentence'});
        const segmentIter = segmenter.segment(text);
        let singleSentences = Array.from(segmentIter).map(obj => obj.segment);
        sentences = [];
        const SENTENCE_COUNT = 10;
        for (let i = 0; i < singleSentences.length; i += SENTENCE_COUNT) {
          // Slice out up to 4 elements and join them with a space
          const chunk = singleSentences.slice(i, i + SENTENCE_COUNT).join(' ');
          sentences.push(chunk);
        }
      } else {
        sentences = [text];
      }

      const result = {
        resultText: '', sourceLanguage: '', percentage: 0, isError: false, errorMessage: '',
      };

      // It's a conscious decision to await in every loop iteration,
      // to minimize the risk of sending too many requests too quickly.
      for (const sentence of sentences) {
        let response = await fetch(
            `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dt=bd&dj=1&q=${encodeURIComponent(
                sentence)}`);

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
        result.sourceLanguage = body.src;
        result.resultText = result.resultText.concat(' ', body.sentences.map(sentence => sentence.trans).
            join(''));
      }
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

    /**
     * Translates the cookie notice text, and checks if analytics/advertisement purposes are declared.
     * As soon as a sentence is classified as declaring such a purpose, it returns true.
     * @param {function(string): Promise<Array<{label: string}>>} purposeClassifier
     * @param {string} untranslatedText
     * @returns {Promise<boolean>}
     */
    async function translateAndGetPurposeDeclared(purposeClassifier, untranslatedText) {
      // translation of selection elements
      let translationResponse = await translateToEnglish(untranslatedText);
      let translatedNoticeText = translationResponse.resultText;

      const segmenterEn = new Intl.Segmenter('en', {granularity: 'sentence'});
      const segmentIter = segmenterEn.segment(translatedNoticeText);
      const sentences = Array.from(segmentIter).map(obj => obj.segment);

      if (purposeClassifier == null) throw new Error('Purpose Classifier is null');
      for (let sentence of sentences) {
        const res = await purposeClassifier(sentence);
        const classification = parseInt(res[0].label);
        if (classification > 0) {
          purposeClassifier = null;
          return true;
        }
      }
      purposeClassifier = null;
      return false;
    }

    /**
     *
     * @param {Tab[]} tabs
     * @param {Function} ieClassifier
     * @param twoLevelInteractiveElements
     * @param iElement
     * @param {boolean} useQuantized
     * @param {boolean} sameNotice True if the settings notice has the same selector as the first cookie notice.
     * @return {Promise<{sndLevelIntObjs: (*|[]|null), sndLevelNoticeText: *}>}
     */
    async function processSelectedSettings(tabs, ieClassifier, twoLevelInteractiveElements, iElement, useQuantized,
        sameNotice) {
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
          } else if (frameRes.status === 'error') {
            throw new Error('Error in retrieveDataFromFirstNotice', {cause: frameRes.error});
          }
        }
      } else if (!sameNotice && secondSelections.length > 0) {
        // getting the data from the most recent addition to secondSelections
        result.text = secondSelections[secondSelections.length - 1].notice.text;
        result.interactiveObjects = secondSelections[secondSelections.length - 1].interactiveObjects;
      }

      if (result.text == null) {
        throw new Error('Text of second level notice is null');
      }
      /**
       * @type {string}
       */
      let sndLevelNoticeText = result.text;
      /**
       * @type {InteractiveObject[]}
       */
      let sndLevelIntObjs = result.interactiveObjects;

      // run analysis on sndLevelNoticeText, probably best to do create a new function
      let purposeClassifier = await PurposePipelineSingleton.getInstance(useQuantized);
      let purposeDeclared = await translateAndGetPurposeDeclared(purposeClassifier, sndLevelNoticeText);
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
        let text;
        if (obj.text.length === 1) {
          text = obj.text[0];
        } else {
          throw new Error(`sndLevelIntObj has length ${obj.text.length}`);
        }
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

      /**
       * Timeout expresses how long to wait for a new status of the url.
       * The lower bound is the longest time that any website needs to:
       * a) after clicking `Settings` in the cookie notice -> open a new URL with the settings page
       * b) after clicking `Save` (or similar) in a settings page that is located on a separate URL -> go back to the main URL
       * @type {number}
       */
      let timeout = 3000;
      await new Promise((resolve) => {
        let timeoutId;

        const handleUpdate = (updatedTabId, changeInfo, tab) => {
          if (updatedTabId === tabId) {
            if (tab.status === 'loading') {
              // If we see a loading status, we know that the website is being updated.
              // Thus, we even double the timeout value.
              clearTimeout(timeoutId);
              timeoutId = setTimeout(() => {
                browser.tabs.onUpdated.removeListener(handleUpdate);
                clearTimeout(timeoutId);
                resolve('no_complete');
              }, 2 * timeout);
            } else if (tab.status === 'complete') {
              clearTimeout(timeoutId);
              timeoutId = setTimeout(() => {
                browser.tabs.onUpdated.removeListener(handleUpdate);
                clearTimeout(timeoutId);
                resolve('complete');
              }, timeout);
            }
          }
        };

        browser.tabs.onUpdated.addListener(handleUpdate);

        timeoutId = setTimeout(() => {
          browser.tabs.onUpdated.removeListener(handleUpdate);
          resolve('no_update');
        }, timeout);
      });

      let tabs = await browser.tabs.query({active: true});
      tabId = tabs[0].id;
      await waitStableFrames(tabId);

      let frameIds = await nonBlankFrameIds(tabId);
      await browser.scripting.executeScript({
        target: {tabId: tabId, frameIds}, func: awaitNoDOMChanges, injectImmediately: true,
      });

      if (statusCodes.some(code => code === NOTICE_STATUS.SUCCESS)) {
        wasSuccess = true;
      } else if (statusCodes.some(code => code === NOTICE_STATUS.WRONG_SELECTOR)) {
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

    async function interactWithPageAndWait(tabs) {
      for (let i = 0; i < PAGE_COUNT; i++) {
        let pageRet = await browser.scripting.executeScript({
          target: {tabId: tabs[0].id}, files: ['pageInteractor.js'], injectImmediately: true,
        });
        let nextUrl = pageRet[0].result;
        if (nextUrl != null) {
          await updateTab(tabs[0].id, nextUrl);
          await waitStableFrames(tabs[0].id);
          let frameIds = await nonBlankFrameIds(tabs[0].id);
          await browser.scripting.executeScript({
            target: {tabId: tabs[0].id, frameIds}, func: awaitNoDOMChanges, injectImmediately: true,
          });
        }
        await delay(3000);
      }
    }

    /**
     * Returns all frameIds where the url is not about:blank
     * @param tabId
     * @returns {Promise<number[]>}
     */
    async function nonBlankFrameIds(tabId) {
      /** @type {GetAllFramesCallbackDetailsItemType[] | null} */
      let frames = await browser.webNavigation.getAllFrames({tabId: tabId});
      frames = frames.filter(frame => frame.url !== 'about:blank');
      return frames.map(frame => frame.frameId);
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

    async function removeCookie(cookie) {
      let url = 'http' + (cookie.secure ? 's' : '') + '://' + cookie.domain + cookie.path;
      await browser.cookies.remove({url: url, name: cookie.name});
    }

    /**
     * Remove a cookie from the browser and from historyDB
     */
    async function clearCookies() {
      await mutex.runExclusive(async () => {
        const all_cookies = await browser.cookies.getAll({});
        let promises = [];
        for (let i = 0; i < all_cookies.length; i++) {
          promises.push(removeCookie(all_cookies[i]));
        }

        const tabs = await browser.tabs.query({active: true});
        let ret = await browser.scripting.executeScript({
          target: {tabId: tabs[0].id}, injectImmediately: true, func: (() => {
            try {
              window.localStorage.clear();
              window.sessionStorage.clear();
              return 'success';
            } catch (e) {
              return `${e.name}: ${e.message}`;
            }
          }),
        });
        if (ret[0].result !== 'success') {
          throw new Error('Clearing of local/session storage not successful.', {cause: ret[0].result});
        }

        await Promise.all(promises);

        //await storageMutex.write({"cookies": {}});
        await storage.setItem('local:cookies', {});
        //setCookies("local:cookies", {});
      });
    }

    /**
     * Listener that is executed any time a cookie is added, updated or removed.
     * @param {OnChangedChangeInfoType} changeInfo  Contains the cookie itself, and cause info.
     */
    async function cookieListener(changeInfo) {
      if (!changeInfo.removed) {
        let cookie = changeInfo.cookie;
        let ckey = constructKeyFromCookie(cookie);
        let cookieMutex;
        await mutex.runExclusive(async () => {
          cookieMutex = cookieMutexes[ckey];
          if (cookieMutex == null) {
            cookieMutexes[ckey] = new Mutex();
            cookieMutex = cookieMutexes[ckey];
          }
        });
        await cookieMutex.runExclusive(async () => {
          await handleCookie(changeInfo.cookie, true, false);
        });
      }
    }

    /**
     * After an interaction, store the interesting (analytics and advertising) in the scan results.
     * @param {INTERACTION_STATE} interactionState
     * @return {Promise<void>}
     */
    async function storeCookieResults(interactionState) {
      /**
       * @type {CookieCollection}
       */
      let cookiesAfterInteraction;
      let promises = [];
      for (let cookieMutex of Object.values(cookieMutexes)) {
        promises.push(cookieMutex.acquire());
      }
      await Promise.all(promises);

      cookiesAfterInteraction = await storage.getItem('local:cookies');

      for (let cookieMutex of Object.values(cookieMutexes)) {
        cookieMutex.release();
      }

      let aaCookies = [];
      // if rejection, there should be no AA cookies
      console.log('cookiesAfterInteraction', cookiesAfterInteraction);
      for (const cookieKey in cookiesAfterInteraction) {
        let cookie = cookiesAfterInteraction[cookieKey];
        if (isAALabel(cookie.current_label)) aaCookies.push(cookie);
      }
      let scan = await storage.getItem('local:scan');
      const interaction = await storage.getItem('local:interaction');

      if (interactionState === INTERACTION_STATE.PAGE_W_NOTICE) {
        // analyze cookies after interaction with both notice and page

        if ([Purpose.Reject, Purpose.SaveSettings, Purpose.Close].includes(interaction?.ie?.label)) {
          if (aaCookies.length > 0) {
            const entry = {
              ie: interaction.ie, aaCookies: aaCookies,
            };
            if (interaction.ie.label === Purpose.Reject) {
              scan.aaCookiesAfterReject.push(entry);
            } else if (interaction.ie.label === Purpose.SaveSettings) {
              scan.aaCookiesAfterSave.push(entry);
            } else if (interaction.ie.label === Purpose.Close) {
              scan.aaCookiesAfterClose.push(entry);
            }

          }
        }
      } else if (interactionState === INTERACTION_STATE.PAGE_WO_NOTICE) {
        // analyze cookies after interaction with only page and ignoring notice
        if (aaCookies.length > 0) { // AA cookies after reject
          scan.aaCookiesWONoticeInteraction = aaCookies;
        }
      }
      await storage.setItem('local:scan', scan);
    }

  },
});