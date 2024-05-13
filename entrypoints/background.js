import {
    classIndexToString,
    classStringToIndex,
    datetimeToExpiry,
    escapeString,
    SCANSTAGE,
    urlToUniformDomain
} from "./modules/globals.js";
import {extractFeatures} from "./modules/extractor.js";
import {predictClass} from "./modules/predictor.js";
import {analyzeCMP} from "./modules/cmp.js";
import {db} from "./modules/db.js";
import {split} from 'sentence-splitter';
import {storage} from 'wxt/storage';
import {AutoModelForSequenceClassification, AutoTokenizer, env} from '@xenova/transformers';

// noinspection JSUnusedGlobalSymbols
export default defineBackground({
    type: 'module', main() {
        //browser.cookies.onChanged.addListener(cookieListener);

        // Skip initial check for local models, since we are not loading any local models.
        env.allowLocalModels = false;

        // Due to a bug in onnxruntime-web, we must disable multithreading for now.
        // See https://github.com/microsoft/onnxruntime/issues/14445 for more information.
        env.backends.onnx.wasm.numThreads = 1;

        /**
         * Classification of cookie notice sentence
         * @param {PreTrainedTokenizer} tokenizer
         * @param {PreTrainedModel} model
         * @param {string} sentence
         * @return {Promise<*>}
         */
        async function classifySentencePurpose(tokenizer, model, sentence) {
            if (tokenizer == null) throw new Error('Tokenizer has to be set');
            if (model == null) throw new Error('Model has to be set');
            if (sentence == null) throw new Error('Sentence has to be set');
            // Actually run the model on the input text
            let inputs = await tokenizer(sentence);
            return await model(inputs);
        }

        /**
         * @param {PreTrainedTokenizer} tokenizer
         * @param {PreTrainedModel} model
         * @param {string} text
         * @return {Promise<*>}
         */
        async function classifyInteractiveElement(tokenizer, model, text) {
            if (tokenizer == null) throw new Error('Tokenizer has to be set');
            if (model == null) throw new Error('Model has to be set');
            if (text == null) throw new Error('Text has to be set');
            console.log("starting classifyInteractiveElement");
            let inputs = await tokenizer(text);
            return await model(inputs);
        }

        const Purpose = Object.freeze({
            Accept: 0, Close: 1, Settings: 2, Other: 3, Reject: 4, SaveSettings: 5
        });

        /**
         * Handlers for all messages sent to the background script.
         */
        browser.runtime.onMessage.addListener(async function (request, _, sendResponse) {
            if (request === "get_cookies") {
                getCookiesFromStorage().then((cookies) => {
                    sendResponse(cookies);
                });
            } else if (request === "clear_cookies") {
                console.log("background is clearing cookies...");
                await clearCookies();
                sendResponse(true);
            } else if (request === "start_scan") {
                sendResponse("ok");
                // 0. reset old storage data
                // 1. clear cookies
                // 2. send message to content script to start selection
                // 2. translate texts from cookie banner, and buttons inside it
                // 3. run BERT on text and buttons, classifySentencePurpose

                await resetStorage();
                await clearCookies();

                // start select in the content script
                const tabs = await browser.tabs.query({active: true, currentWindow: true});
                await browser.tabs.sendMessage(tabs[0].id, "start_select");
            } else if (request === "selected_notice") {
                console.log("reacting to selected_notice");
                sendResponse("ok");
                let selection = await storage.getItem('local:selection');
                let {url} = await storage.getMeta('local:selection');

                if (selection == null) throw new Error("local:selection should be set");

                // translation of selection elements
                let translatedNoticeText = (await translateToEnglish(selection.notice.text)).resultText;
                let sentences = split(translatedNoticeText)
                    .filter(item => item.type === 'Sentence')
                    .map(item => {
                        return item.raw;
                    });
                const USE_QUANTIZED = false;

                // Skip initial check for local models, since we are not loading any local models.
                env.allowLocalModels = false;

                // Due to a bug in onnxruntime-web, we must disable multithreading for now.
                // See https://github.com/microsoft/onnxruntime/issues/14445 for more information.
                env.backends.onnx.wasm.numThreads = 1;

                const [purposeDetectionTokenizer, purposeDetectionModel] = await Promise.all([await AutoTokenizer.from_pretrained("snastal/purpose_detection_model", {
                    quantized: USE_QUANTIZED
                }), await AutoModelForSequenceClassification.from_pretrained("snastal/purpose_detection_model", {
                    quantized: USE_QUANTIZED
                })]);

                const purposeClassifications = await Promise.all(sentences.map(async sentence => {
                    let res = await classifySentencePurpose(purposeDetectionTokenizer, purposeDetectionModel, sentence);
                    return getPrediction(res);
                }));
                selection.notice.label = Math.max(...purposeClassifications);

                const [interactiveElementsTokenizer, interactiveElementsModel] = await Promise.all([await AutoTokenizer.from_pretrained("snastal/interactive_elements_model", {
                    quantized: USE_QUANTIZED
                }), await AutoModelForSequenceClassification.from_pretrained("snastal/interactive_elements_model", {
                    quantized: USE_QUANTIZED
                })]);

                await Promise.all(selection.clickableObjects.map(async obj => {
                    let translatedText = (await translateToEnglish(obj.text)).resultText;
                    let res = await classifyInteractiveElement(interactiveElementsTokenizer, interactiveElementsModel, translatedText);
                    obj.label = getIELabel(res);
                    return obj.label;
                }));

                await storage.setItem('local:selection', selection);


                let scan = {
                    'stage': SCANSTAGE[1],
                    'scanStart': Date.now(),
                    'scanEnd': null,
                    'cmp': null,
                    'url': url,
                    'nonnecessary': [],
                    'wrongcat': [],
                    'undeclared': [],
                    'multideclared': [],
                    'wrongexpiry': [],
                    'consentNotice': null,
                    'advanced': false,
                    'cmpWarnings': []
                };
                await storage.setItem('local:scan', scan);
            } else if (request === "stop_scan") {
                if (browser.cookies.onChanged.hasListener(cookieListener)) {
                    browser.cookies.onChanged.removeListener(cookieListener);
                    sendResponse("removed listener");
                } else {
                    sendResponse("no listener attached");
                }
            } else if (request === "analyze_cookies") {
                getCookiesFromStorage().then((cookies) => {
                    if (!cookies) {
                        sendResponse("no cookies to analyze");
                        return true;
                    }
                    for (let c of Object.keys(cookies)) {
                        analyzeCookie(cookies[c]);
                    }
                    sendResponse("analyzed");
                });
            } else if (request === "total_cookies") {
                getCookiesFromStorage().then((cookies) => {
                    sendResponse(Object.keys(cookies).length);
                })
            } else if (request === "store_log") {
                storeLog();
            }
            return true; // Need this to avoid 'message port closed' error
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
            await storage.setItem('local:selection', {});
            await storage.setItem('local:scan', {});
            await storage.setItem('local:cookies', {});
        }

        function getPrediction(modelRes) {
            const {data} = modelRes.logits;
            return data.reduce((maxIdx, curValue, curIdx, arr) => (curValue > arr[maxIdx] ? curIdx : maxIdx), 0);
        }

        /**
         * Converts logits into the purpose of the interactive element.
         * @param {Object} modelRes The result of the interactive_element_model
         * @return {number} Integer that corresponds to a value in the Purpose object
         */
        function getIELabel(modelRes) {
            console.log("modelRes", modelRes);
            const {data} = modelRes.logits;
            console.log("data", data);
            const maxIndex = data.reduce((maxIdx, curValue, curIdx, arr) => (curValue > arr[maxIdx] ? curIdx : maxIdx), 0);
            if (maxIndex === 0) return Purpose.Accept; else if (maxIndex === 1) return Purpose.Close; else if (maxIndex === 2) return Purpose.Settings; else if (maxIndex === 3) return Purpose.Other; else if (maxIndex === 4) return Purpose.Reject; else if (maxIndex === 5) return Purpose.SaveSettings; else throw new Error('Impossible maxIndex');
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

            //let cookies = await storageMutex.read("local:cookies");
            let cookies = await storage.getItem("local:cookies");
            //let cookies = getCookies("local:cookies");
            if (!cookies) {
                cookies = {};
            }
            cookies[ckey] = serializedCookie;
            //await storageMutex.write(cookies);
            await storage.setItem("local:cookies", cookies);
            //setCookies("local:cookies", cookies);
            return true;
        }

        /**
         * Remove a cookie from the browser and from historyDB
         */
        const clearCookies = async function () {
            // First we delete the cookies from the browser
            let removeCookie = function (cookie) {
                let url = "http" + (cookie.secure ? "s" : "") + "://" + cookie.domain + cookie.path;
                browser.cookies.remove({url: url, name: cookie.name});
            };

            browser.cookies.getAll({}).then((all_cookies) => {
                let count = all_cookies.length;
                console.log(`${count} cookies to remove from chrome`);
                for (let i = 0; i < count; i++) {
                    removeCookie(all_cookies[i]);
                }
            });

            //await storageMutex.write({"cookies": {}});
            await storage.setItem("local:cookies", {});
            console.log("cleared cookies");
            //setCookies("local:cookies", {});
        };

        /**
         * Retrieve all cookies from IndexedDB storage via a transaction.
         * @returns {Promise<Object>} Array of all cookies.
         */
        const getCookiesFromStorage = async function () {
            //let {cookies} = await storageMutex.read("cookies");
            //let cookies = getCookies("local:cookies");
            return await storage.getItem("local:cookies");
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
         * @param  {Object} feature_input   Transformed cookie data input, for the feature extraction.
         * @return {Promise<Number>}        Cookie category label as an integer, ranging from [0,3].
         */
        const classifyCookie = async function (_, feature_input) {
            // Feature extraction timing
            let features = extractFeatures(feature_input);
             // 3 from cblk_pscale default
            return await predictClass(features, 3);
        };

        /**
         * This function sets up all the analysis after it received a new cookie.
         * Right now we assume (due to removal of all cookies prior to a scan) that every cookie arrives here
         * AFTER a scan is started.
         * @param cookie  Serialized cookie
         */
        async function analyzeCookie(cookie) {
            storage.getItem("local:scan").then((scan) => {
                if (!scan || scan.stage === SCANSTAGE[0] || scan.stage === SCANSTAGE[3]) {
                    return;
                }

                // getCMP
                const cmp = analyzeCMP(cookie);
                // if (cmp && (!res.scan.cmp || !res.scan.cmp.choices)) {
                if (cmp && (!scan.cmp || cmp.choices)) {
                    scan.cmp = cmp;
                }

                // getWarnings
                if (scan.stage === SCANSTAGE[1]) {
                    if (cookie.current_label > 0 && !scan.nonnecessary.some((c) => c.name === cookie.name)) {
                        scan.nonnecessary.push(cookie);
                    }
                }

                if (scan.stage === SCANSTAGE[2]) {
                    if (!scan.consentNotice) {
                        storage.setItem("local:scan", scan);
                        return;
                    }

                    const cookieCategories = findCookieCategories(cookie.name, scan.consentNotice);

                    if (cookieCategories.length === 0 && !scan.undeclared.some((c) => c.name === cookie.name)) {
                        scan.undeclared.push(cookie);
                    } else if (cookieCategories.length > 1 && !scan.multideclared.some((c) => c.name === cookie.name)) {
                        scan.multideclared.push(cookie);
                    } else if (cookieCategories.length === 1) {
                        // cookie is present in exactly one category of the consent notice
                        const cat = cookieCategories[0];
                        if (classStringToIndex(cat) < cookie.current_label && !scan.wrongcat.some((c) => c.cookie.name === cookie.name)) {
                            scan.wrongcat.push({"cookie": cookie, "consent_label": cat});
                        }

                        // check expiry
                        if (!scan.consentNotice[cat]) {
                            storage.setItem("local:scan", scan);
                            return;
                        }
                        const declaration = scan.consentNotice[cat].find((c) => cookie.name.startsWith(c.name.replace(/x+$/, "")))
                        if (!declaration || NOCHECK_EXPIRY.includes(declaration.name) || scan.wrongexpiry.some((c) => c.cookie.name === cookie.name)) {
                            storage.setItem("local:scan", scan);
                            return;
                        }

                        if (declaration.session) {
                            if (!cookie.variable_data[cookie.variable_data.length - 1].session) {
                                scan.wrongexpiry.push({"cookie": cookie, "consent_expiry": "session"});
                                storage.setItem("local:scan", scan);
                                return;
                            }
                        }

                        if (cookie.variable_data[cookie.variable_data.length - 1].session) {
                            scan.wrongexpiry.push({"cookie": cookie, "consent_expiry": "nosession"});
                            storage.setItem("local:scan", scan);
                            return;
                        }

                        if (Number(cookie.variable_data[cookie.variable_data.length - 1].expiry) > 1.5 * declaration.expiry) {
                            scan.wrongexpiry.push({"cookie": cookie, "consent_expiry": declaration.expiry});
                        }
                    }
                }

                storage.setItem("local:scan", scan);
            });
        }

        /**
         * Find all categories of the consent notice where a cookie is present
         * @param cookieName
         * @param consentNotice
         * @returns {[]} Array with all category strings
         */
        const findCookieCategories = function (cookieName, consentNotice) {
            let categories = [];
            for (let cat of Object.keys(consentNotice)) {
                if (consentNotice[cat].find((c) => cookieName.startsWith(c.name.replace(/x+$/, "")))) {
                    categories.push(cat);
                }
            }
            return categories;
        }

        /**
         * Store the scan in the database
         */
        const storeLog = function () {
            console.log("Storing Log into Database...");

            if (!db) {
                console.log("Database connection info missing!");
                return;
            }

            storage.getItem("local:scan").then((scan) => {
                if (!scan) {
                    console.log("No scan to export to database");
                    return;
                }

                const data = {
                    "dataSource": db.dataSource, "database": db.database, "collection": db.collection, "document": scan
                }

                // request options
                const options = {
                    method: 'POST', body: JSON.stringify(data), headers: {
                        'Content-Type': 'application/json', 'Access-Control-Request-Headers': '*', 'api-key': db.apiKey
                    }
                }

                // send POST request
                fetch(db.url, options)
                    .then(scan => scan.json())
                    .then(res => console.log(res));
            });
        }

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
                return;
            }

            await analyzeCookie(serializedCookie);
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
            let body = await response.json();
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