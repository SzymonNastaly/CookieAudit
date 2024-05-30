import {
    delay,
    INTERACTION_STATE,
    isAALabel,
    PAGE_COUNT, resetStorage,
    STAGE2
} from "./modules/globals.js";
import {storage} from 'wxt/storage';
import {env, pipeline} from '@xenova/transformers';
import {clearCookies, cookieListener} from "./cookieManagement.js";

/**
 * @typedef {Object} CookieData
 * @property {number} current_label - The current label value.
 * @property {string} domain - The domain associated with the cookie.
 * @property {string} name - The name of the cookie.
 */

/**
 * @typedef {Object.<string, CookieData>} CookieCollection
 * A collection of cookies, where each key is a string representing the cookie identifier
 * and the value is an object containing the cookie data.
 */

// noinspection JSUnusedGlobalSymbols
export default defineBackground({
    type: 'module', main() {
        /**
         * I don't entirely understand why. But by using this singleton we fix the problem that if the model is used many
         * times, too much memory is allocated.
         */
        class PurposePipelineSingleton {
            static instance = null;

            /**
             * @param quantized
             * @return {Promise<function>}
             */
            static async getInstance(quantized = false) {
                if (this.instance === null) {
                    this.instance = pipeline("text-classification", "snastal/purpose_detection_model", {quantized: quantized});
                }
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
                    this.instance = pipeline("text-classification", "snastal/interactive_elements_model", {quantized: quantized});
                }
                return this.instance;
            }
        }

        const Purpose = Object.freeze({
            Accept: 0, Close: 1, Settings: 2, Other: 3, Reject: 4, SaveSettings: 5
        });

        async function interactWithPage(tabs) {
            for (let i = 0; i < PAGE_COUNT; i++) {
                let pageRet = await browser.scripting.executeScript({
                    target: {tabId: tabs[0].id}, files: ['pageInteractor.js'], injectImmediately: true
                });
                let nextUrl = pageRet[0].result;
                if (nextUrl != null) {
                    await browser.tabs.update(tabs[0].id, {url: nextUrl});
                    await delay(4000);
                }
            }
        }

        /**
         * If there are further interactive elements, we start the interaction for the next one.
         * Otherwise, we finish the interaction with the case of ignoring the cookie notice.
         * @param interactionState
         * @return {Promise<void>}
         */

        async function storeCookieResults(interactionState) {
            /**
             * @type {CookieCollection}
             */
            const cookiesAfterInteraction = await storage.getItem("local:cookies");
            let aaCookies = []
            // if rejection, there should be no AA cookies
            for (const cookieKey in cookiesAfterInteraction) {
                let cookie = cookiesAfterInteraction[cookieKey];
                if (isAALabel(cookie.current_label)) aaCookies.push(cookie);
            }
            console.log("aaCookies in storeCookieResult", aaCookies);
            let scan = await storage.getItem("local:scan");
            const interaction = await storage.getItem("local:interaction");

            if (interactionState === INTERACTION_STATE.PAGE_W_NOTICE) {
                // analyze cookies after interaction with both notice and page

                if ([Purpose.Reject, Purpose.SaveSettings, Purpose.Close].includes(interaction?.ie?.label)) {
                    if (aaCookies.length > 0) {
                        const entry = {
                            ie: interaction.ie, aaCookies: aaCookies
                        }
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
            await storage.setItem("local:scan", scan);
        }

        /**
         * Handlers for all messages sent to the background script.
         */
        browser.runtime.onMessage.addListener(function (message, _, sendResponse) {
            let {msg} = message;
            if (msg === "start_scan") {
                sendResponse({msg: "ok"});
                (async () => {
                    if (!browser.cookies.onChanged.hasListener(cookieListener)) {
                        browser.cookies.onChanged.addListener(cookieListener);
                    }

                    await resetStorage();
                    await clearCookies();
                    let scan = await storage.getItem('local:scan');
                    scan.stage2 = STAGE2.NOTICE_SELECTION;
                    scan["scanStart"] = Date.now();
                    let tabs = await browser.tabs.query({active: true});
                    scan["url"] = tabs[0].url;
                    await storage.setItem('local:scan', scan);
                    const response = await browser.tabs.sendMessage(tabs[0].id, {msg: "start_select"});
                    if (response?.msg !== "ok") throw new Error("start_select not confirmed by selector");
                })();
            } else if (msg === "selected_notice") {
                sendResponse({msg: "ok"});
                let interactiveElements;
                (async () => {
                    let selection = await storage.getItem('local:selection');
                    if (selection == null) throw new Error("local:selection should be set");

                    let scan = await storage.getItem("local:scan");
                    scan["noticeDetected"] = true;
                    await storage.setItem("local:scan", scan);

                    // translation of selection elements
                    let translationResponse = await translateToEnglish(selection.notice.text);
                    let translatedNoticeText = translationResponse.resultText;

                    const segmenterEn = new Intl.Segmenter('en', {granularity: 'sentence'});
                    const segmentIter = segmenterEn.segment(translatedNoticeText);
                    const sentences = Array.from(segmentIter).map(obj => obj.segment);

                    const USE_QUANTIZED = true;
                    // Skip initial check for local models, since we are not loading any local models.
                    env.allowLocalModels = false;

                    // Due to a bug in onnxruntime-web, we must disable multithreading for now.
                    // See https://github.com/microsoft/onnxruntime/issues/14445 for more information.
                    env.backends.onnx.wasm.numThreads = 1;
                    let purposeClassifier = await PurposePipelineSingleton.getInstance(USE_QUANTIZED);
                    if (purposeClassifier == null) throw new Error("Purpose Classifier is null");
                    const purposeClassifications = (await purposeClassifier(sentences)).map(res => {
                        return parseInt(res.label);
                    });
                    purposeClassifier = null;
                    selection.notice.label = Math.max(...purposeClassifications);
                    scan = await storage.getItem("local:scan");
                    scan["purposeDeclared"] = (selection.notice.label > 0);
                    await storage.setItem("local:scan", scan);

                    let ieClassifier = await IEPipelineSingleton.getInstance(USE_QUANTIZED);
                    if (ieClassifier == null) throw new Error("IE Classifier was null");

                    const translatedTexts = await Promise.all(selection.interactiveObjects.map(async obj => {
                        let text = obj.text;
                        let res = await translateToEnglish(text);
                        return res.resultText
                    }));
                    const labels = (await ieClassifier(translatedTexts)).map(res => {
                        return getIELabel(res);
                    });
                    for (let i = 0; i < labels.length; i++) {
                        selection.interactiveObjects[i].label = labels[i];
                    }

                    ieClassifier = null;

                    await storage.setItem('local:selection', selection);

                    interactiveElements = {};
                    interactiveElements[Purpose.Accept] = []
                    interactiveElements[Purpose.Close] = []
                    interactiveElements[Purpose.Settings] = []
                    interactiveElements[Purpose.Other] = []
                    interactiveElements[Purpose.Reject] = []
                    interactiveElements[Purpose.SaveSettings] = []

                    for (let i = 0; i < selection.interactiveObjects.length; i++) {
                        let obj = selection.interactiveObjects[i];
                        interactiveElements[obj.label].push(obj);
                    }
                    
                    console.log("interactiveElements", interactiveElements);

                    scan = await storage.getItem("local:scan");
                    scan["stage2"] = STAGE2.NOTICE_INTERACTION;
                    scan["interactiveElements"] = interactiveElements;
                    scan["rejectDetected"] = (interactiveElements[Purpose.Reject].length > 0);
                    scan["closeSaveDetected"] = (interactiveElements[Purpose.Close].length > 0) || (interactiveElements[Purpose.SaveSettings].length > 0);

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

                    for (const iElement of interactiveElements[Purpose.Accept]) {
                        ieToInteract.push(iElement);
                    }
                    scan.ieToInteract = ieToInteract;
                    console.log("ieToInteract", ieToInteract);
                    await storage.setItem("local:scan", scan);

                    const tabs = await browser.tabs.query({active: true});

                    // iterate over interactive elements
                    for (let i = 0; i < scan.ieToInteract.length; i++) {
                        let interaction = await storage.getItem("local:interaction");
                        interaction.ie = scan.ieToInteract[i];
                        await storage.setItem("local:interaction", interaction);

                        await browser.scripting.executeScript({
                            target: {tabId: tabs[0].id, allFrames: true},
                            files: ['noticeInteractor.js'],
                            injectImmediately: true
                        })
                        await delay(2000);

                        await interactWithPage(tabs);
                        await storeCookieResults(INTERACTION_STATE.PAGE_W_NOTICE);

                        scan = await storage.getItem("local:scan");
                        console.log("scan", scan);

                        interaction = await storage.getItem("local:interaction");
                        interaction.visitedPages = [];
                        await storage.setItem("local:interaction", interaction);

                        let cookies = await storage.getItem("local:cookies");
                        console.log("cookies", cookies);

                        // reset cookies and reload page
                        await clearCookies();
                        await browser.tabs.update(tabs[0].id, {url: scan.url});

                        await delay(4000);
                    }

                    // interact with page, while ignoring cookie banner
                    await interactWithPage(tabs);
                    await delay(2000);
                    await storeCookieResults(INTERACTION_STATE.PAGE_WO_NOTICE);
                    await delay(2000);

                    await browser.scripting.executeScript({
                        target: {tabId: tabs[0].id},
                        files: ['reportCreator.js'],
                        injectImmediately: true
                    })
                })();
            } else if (msg === "no_notice") {
                sendResponse({msg: "ok"});
                // TODO finish this and make it jump to the same handler that interacts with the page (without cookie notice) after cookie notice interaction
                (async () => {
                    const tabs = await browser.tabs.query({active: true});
                    const response = await browser.tabs.sendMessage(tabs[0].id, {msg: "cancel_select"});
                    if (response?.msg !== "ok") throw new Error("cancel_select not confirmed");
                    let scan = await storage.getItem('local:scan');
                    scan.stage2 = STAGE2.INTERACTION_WO_NOTICE;
                    await storage.setItem('local:scan', scan);
                })();
            } else if (msg === "cancel_scan") {
                sendResponse({msg: "ok"});
                (async () => {
                    if (browser.cookies.onChanged.hasListener(cookieListener)) {
                        browser.cookies.onChanged.removeListener(cookieListener);
                    }
                    await resetStorage();
                    await clearCookies();
                    const tabs = await browser.tabs.query({active: true});
                    await browser.tabs.update(tabs[0].id, {url: tabs[0].url});
                })();
            }
        });

        /**
         * Converts logits into the purpose of the interactive element.
         * @param {Object} modelRes The result of the interactive_element_model
         * @return {number} Integer that corresponds to a value in the Purpose object
         */
        function getIELabel(modelRes) {
            let label = modelRes.label;
            if (label === "LABEL_0") {
                return Purpose.Accept;
            } else if (label === "LABEL_1") {
                return Purpose.Close;
            } else if (label === "LABEL_2") {
                return Purpose.Settings;
            } else if (label === "LABEL_3") {
                return Purpose.Other;
            } else if (label === "LABEL_4") {
                return Purpose.Reject;
            } else if (label === "LABEL_5") {
                return Purpose.SaveSettings;
            } else throw new Error('Impossible maxIndex');
        }

        async function translateToEnglish(text) {
            let response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dt=bd&dj=1&q=${encodeURIComponent(text)}`);
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
                resultText: "", sourceLanguage: "", percentage: 0, isError: false, errorMessage: ""
            };

            result.sourceLanguage = body.src;
            result.resultText = body.sentences.map(sentence => sentence.trans).join("");

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
    }
});