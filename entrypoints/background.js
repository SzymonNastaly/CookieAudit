import {
    classIndexToString,
    datetimeToExpiry,
    delay,
    escapeString,
    INITIAL_INTERACTION,
    INITIAL_SCAN,
    INITIAL_SELECTION,
    INTERACTION_STATE,
    isAALabel,
    PAGE_COUNT,
    STAGE2,
    urlToUniformDomain
} from "./modules/globals.js";
import {extractFeatures} from "./modules/extractor.js";
import {predictClass} from "./modules/predictor.js";
import {storage} from 'wxt/storage';
import {env, pipeline} from '@xenova/transformers';

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
        const UPDATE_LIMIT = 10;
        const MINTIME = 120000;

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
         * Construct a string formatted key that uniquely identifies the given cookie object.
         * @param {Object}    cookieDat Stores the cookie data, expects attributes name, domain and path.
         * @returns {String}  string representing the cookie's key
         */
        const constructKeyFromCookie = function (cookieDat) {
            return `${cookieDat.name};${urlToUniformDomain(cookieDat.domain)};${cookieDat.path}`;
        };

        async function resetStorage() {
            await Promise.all([await storage.setItem("local:selection", INITIAL_SELECTION), await storage.setItem("local:interaction", INITIAL_INTERACTION), await storage.setItem("local:scan", INITIAL_SCAN), await storage.setItem("local:cookies", [])]);
        }

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

        /**
         * Creates a new feature extraction input object from the raw cookie data.
         * @param  {Object} cookie    Raw cookie data as received from the browser.
         * @return {Object}  Feature Extraction input object.
         */
        const createFEInput = function (cookie) {
            return {
                name: escapeString(cookie.name),
                domain: escapeString(cookie.domain),
                path: escapeString(cookie.path),
                current_label: -1,
                label_ts: 0,
                storeId: escapeString(cookie.storeId),
                variable_data: [{
                    host_only: cookie.hostOnly,
                    http_only: cookie.httpOnly,
                    secure: cookie.secure,
                    session: cookie.session,
                    expirationDate: cookie.expirationDate,
                    expiry: datetimeToExpiry(cookie),
                    value: escapeString(cookie.value),
                    same_site: escapeString(cookie.sameSite),
                    timestamp: Date.now(),
                },],
            };
        };

        /**
         * Updates the existing feature extraction object with data from the new cookie.
         * Specifically, the variable data attribute will have the new cookie's data appended to it.
         * If the update limit is reached, the oldest update will be removed.
         * @param  {Object} storedFEInput   Feature Extraction input, previously constructed.
         * @param  {Object} rawCookie       New cookie data, untransformed.
         * @return {Promise<object>}        The existing cookie object, updated with new data.
         */
        const updateFEInput = async function (storedFEInput, rawCookie) {
            let updateArray = storedFEInput["variable_data"];

            let updateStruct = {
                "host_only": rawCookie.hostOnly,
                "http_only": rawCookie.httpOnly,
                "secure": rawCookie.secure,
                "session": rawCookie.session,
                "expiry": datetimeToExpiry(rawCookie),
                "value": escapeString(rawCookie.value),
                "same_site": escapeString(rawCookie.sameSite),
                "timestamp": Date.now()
            };

            // remove head if limit reached
            if (updateArray.length >= UPDATE_LIMIT) updateArray.shift();

            updateArray.push(updateStruct);
            console.assert(updateArray.length > 1, "Error: Performed an update without appending to the cookie?");
            console.assert(updateArray.length <= UPDATE_LIMIT, "Error: cookie update limit still exceeded!");

            return storedFEInput;
        };

        /**
         * Insert serialized cookie into IndexedDB storage via a transaction.
         * @param {Object} serializedCookie Cookie to insert into storage.
         */
        const insertCookieIntoStorage = async function (serializedCookie) {
            let ckey = constructKeyFromCookie(serializedCookie);

            let cookies = await storage.getItem("local:cookies");
            if (!cookies) {
                cookies = {};
            }
            cookies[ckey] = serializedCookie;
            await storage.setItem("local:cookies", cookies);
            return true;
        }

        /**
         * Remove a cookie from the browser and from historyDB
         */
        async function clearCookies() {
            // First we delete the cookies from the browser
            async function removeCookie(cookie) {
                let url = "http" + (cookie.secure ? "s" : "") + "://" + cookie.domain + cookie.path;
                await browser.cookies.remove({url: url, name: cookie.name});
            }

            const all_cookies = await browser.cookies.getAll({});
            let promises = [];
            for (let i = 0; i < all_cookies.length; i++) {
                promises.push(removeCookie(all_cookies[i]));
            }

            const tabs = await browser.tabs.query({active: true});
            await browser.scripting.executeScript({
                target: {tabId: tabs[0].id, allFrames: true}, injectImmediately: true, func: (() => {
                    window.localStorage.clear();
                    window.sessionStorage.clear();
                })
            });

            await Promise.all(promises);

            //await storageMutex.write({"cookies": {}});
            await storage.setItem("local:cookies", {});
            //setCookies("local:cookies", {});
        }

        /**
         * Retrieve serialized cookie from IndexedDB storage via a transaction.
         * @param {Object} cookieDat Raw cookie object that provides name, domain and path.
         * @returns {Promise<Object>} Either the cookie if found, or undefined if not.
         */
        const retrieveCookieFromStorage = async function (cookieDat) {
            let ckey = constructKeyFromCookie(cookieDat);
            //let {cookies} = await storageMutex.read("cookies");
            let cookies = await storage.getItem("local:cookies");
            if (!cookies) {
                return null;
            } else if (cookies[ckey]) {
                return cookies[ckey];
            } else {
                return null;
            }
        }


        /**
         * Using the cookie input, extract features from the cookie and classifySentencePurpose it, retrieving a label.
         * @param {Object} newCookie
         * @param  {Object} feature_input   Transformed cookie data input, for the feature extraction.
         * @return {Promise<Number>}        Cookie category label as an integer, ranging from [0,3].
         */
        const classifyCookie = async function (newCookie, feature_input) {
            // Feature extraction timing
            let features = extractFeatures(feature_input);
            // 3 from cblk_pscale default
            return await predictClass(features, 3);
        };

        /**
         * Retrieve the cookie and classifySentencePurpose it.
         * @param {Object} newCookie Raw cookie object directly from the browser.
         * @param {Object} storeUpdate Whether
         * @param overrideTimeCheck
         */
        const handleCookie = async function (newCookie, storeUpdate, overrideTimeCheck) {

            // First, if consent is given, check if the cookie has already been stored.
            let serializedCookie, storedCookie;
            storedCookie = await retrieveCookieFromStorage(newCookie);
            if (storedCookie) {
                if (storeUpdate) {
                    serializedCookie = await updateFEInput(storedCookie, newCookie);
                } else {
                    serializedCookie = storedCookie;
                }

            }

            // if consent not given, or cookie not present, create a new feature extraction object
            if (serializedCookie === undefined) {
                serializedCookie = createFEInput(newCookie);
            }

            // If cookie recently classified, use previous label.
            let elapsed = Date.now() - serializedCookie["label_ts"];

            let clabel = serializedCookie["current_label"];
            console.assert(clabel !== undefined, "Stored cookie label was undefined!!");

            if (overrideTimeCheck || clabel === -1 || elapsed > MINTIME) {
                // analyzeCMP(newCookie);
                clabel = await classifyCookie(newCookie, serializedCookie);

                // Update timestamp and label of the stored cookie
                serializedCookie["current_label"] = clabel;
                serializedCookie["label_ts"] = Date.now();
                console.debug("Perform Prediction: Cookie (%s;%s;%s) receives label (%s)", newCookie.name, newCookie.domain, newCookie.path, classIndexToString(clabel));
            } else {
                console.debug("Skip Prediction: Cookie (%s;%s;%s) with label (%s)", newCookie.name, newCookie.domain, newCookie.path, classIndexToString(clabel));
            }

            // If consent is given, store the cookie again.
            const inserted = await insertCookieIntoStorage(serializedCookie);
            if (!inserted) {
                console.error("couldn't insert cookie");
            }
        }

        /**
         * Listener that is executed any time a cookie is added, updated or removed.
         * @param {Object} changeInfo  Contains the cookie itself, and cause info.
         */
        async function cookieListener(changeInfo) {
            if (!changeInfo.removed) {
                await handleCookie(changeInfo.cookie, true, false);
            }
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