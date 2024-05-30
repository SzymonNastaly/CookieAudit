//-------------------------------------------------------------------------------
/*
Copyright (C) 2021-2022 Dino Bollinger, ETH Zürich, Information Security Group

This file is part of CookieBlock.

Released under the MIT License, see included LICENSE file.
*/
//-------------------------------------------------------------------------------

/**
 * A scan is always in one of these 4 stages.
 * - "initial": not yet started (scan can also be undefined in this stage),
 * - "necessary": started and just checking if non-essential cookies are being set by the website,
 * - "all": checking all cookie violations, a consent notice has been found if the scan is in this stage,
 * - "finished": the summary is being displayed
 */
export const SCANSTAGE = ["initial", "necessary", "all", "finished"];
export const STAGE2 = Object.freeze({
    NOT_STARTED: 0,
    NOTICE_SELECTION: 1,
    NOTICE_INTERACTION: 2,
    INTERACTION_WO_NOTICE: 3,
    FINISHED: 4
});

export const INITIAL_SCAN = {
    stage2: STAGE2.NOT_STARTED,
    'scanStart': null,
    'scanEnd': null,
    'url': null,
    'interactiveElements': [],
    ieToInteract: [],
    "purposeDeclared": false,
    "noticeDetected": false,
    "rejectDetected": false,
    "closeSaveDetected": false,
    "aaCookiesAfterReject": [],
    "aaCookiesAfterSave": [],
    "aaCookiesAfterClose": [],
    "aaCookiesWONoticeInteraction": []
};
export const INTERACTION_STATE = Object.freeze({
    PAGE_W_NOTICE: 0,
    PAGE_WO_NOTICE: 1
});

export const PAGE_COUNT = 5;

export const INITIAL_SELECTION = Object.freeze({
    notice: null, interactiveObjects: [], iframeFullIndex: null
});
export const INITIAL_INTERACTION = Object.freeze({
    ie: null, visitedPages: []
});

// Function to await no changes being made to the DOM. ChatGPT
export async function awaitNoDOMChanges(initTimeout= 4000, timeout = 1000) {
    return new Promise((resolve) => {
        let debounceTimer;
        let initialTimer = setTimeout(() => {
            // If no mutations are detected within a specific timeframe, disconnect the observer and resolve the promise
            observer.disconnect();
            resolve();
        }, initTimeout); // Set this to a reasonable timeframe depending on expected changes

        // Create a MutationObserver to observe the entire document
        const observer = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            clearTimeout(initialTimer); // Clear the initial timer as we have detected changes
            debounceTimer = setTimeout(() => {
                // Stop observing changes and resolve the promise
                observer.disconnect();
                resolve();
            }, timeout);
        });

        // Start observing changes in the entire document
        observer.observe(document.body, {
            childList: true, // Observe changes to child nodes
            subtree: true // Observe changes in all descendants
        });
    });
}

export async function resetStorage() {
    await Promise.all([await storage.setItem("local:selection", INITIAL_SELECTION), await storage.setItem("local:interaction", INITIAL_INTERACTION), await storage.setItem("local:scan", INITIAL_SCAN), await storage.setItem("local:cookies", [])]);
}

/**
 * These fixes are displayed on the summary according to what needs to be fixed.
 */
export const FIXES = {
    "nonessential": `You must receive users' consent before you use any cookies except strictly necessary cookies. <a href="https://www.cookieaudit.app#consent" class="learn" target="_blank">Learn more</a>`,
    "undeclared": `You must declare and provide information about each cookie before consent is received. <a href="https://www.cookieaudit.app#declaration" class="learn" target="_blank">Learn more</a>`,
    "wrongcat": `We classified some cookies differently than you, make sure you put each cookie in the correct category. <a href="https://www.cookieaudit.app#categories" class="learn" target="_blank">Learn more</a>`,
    "wrongexpiry-time": `The expiration time of some cookies is much higher than declared. Lower the expiry date on the cookie or correct the declaration. <a href="https://www.cookieaudit.app#expiry" class="learn" target="_blank">Learn more</a>`,
    "wrongexpiry-session": `You declared some cookies as session-cookies but set them to be persistent.`,
    "noreject": `Add a "Reject" button to the initial consent popup. <a href="https://www.cookieaudit.app#noreject" class="learn" target="_blank">Learn more</a>`,
    "preselected": `Make sure non-essential categories are not preselected in the consent popup. <a href="https://www.cookieaudit.app#preselected" class="learn" target="_blank">Learn more</a>`,
}

export function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

export function getIframeIndex(win) {
    if (win.parent !== win) {
        for (let i = 0; i < win.parent.frames.length; i++) {
            if (win.parent.frames[i] === win) { return i; }
        }
        throw Error("In a frame, but could not find myself");
    } else {
        return -1;
    }
}

// Returns a unique index in iframe hierarchy, or empty string if topmost
export function getFullIframeIndex(win) {
    if (getIframeIndex(win) < 0) {
        return "root";
    } else {
        return getFullIframeIndex(win.parent) + "." + getIframeIndex(win);
    }
}

/**
 * Helper used to transform the local.storage.get callback into an async function.
 * @param {String} key Key of the storage to retrieve.
 * @returns {Promise} A promise which will eventually contain the retrieved value.
 */
function chromeWorkaround(stType, key) {
    return new Promise((resolve, reject) => {
        stType.get([key], function (result) {
            if (browser.runtime.lastError) {
                reject("Failed to retrieve data from storage: " + browser.runtime.lastError);
            } else {
                resolve(result[key]);
            }
        });
    });
}

/**
 * Helper function for storing content in sync or local storage.
 * @param {*} newValue New value to store.
 * @param {Object} stType  Sync or Local Storage Object
 * @param {String} key Unique storage key identifier
 * @param {Boolean} override If true, will override the existing value.
 */
const setStorageValue = async function (newValue, stType, key, override = true) {
    let obj;
    if (override) {
        obj = {};
        obj[key] = newValue;
        stType.set(obj);
    } else {
        try {
            let cValue = await chromeWorkaround(stType, key);
            if (cValue === undefined) {
                obj = {};
                obj[key] = newValue;
                stType.set(obj);
            }
        } catch (err) {
            throw err;
        }
    }
};

/**
 * Retrieves the data at the given URL with the specified type.
 * Once the response arrives, a callback is executed with the response object.
 * @param {String} url          URL to send the GET request to, intended to be a local extension URL.
 * @param {String} dtype        Type of the data. Examples: "json", "text", "binary"
 * @param {Function} callback   Callback function that will be executed as soon as the data is available, receives data as first argument.
 */
export const getExtensionFile = async function (url, dtype, callback, errorCallback = null) {
    let res = await fetch(url)
    if (dtype === "text") {
        callback(await res.text());
    } else if (dtype === "json") {
        callback(await res.json());
    } else {
        console.error("Wrong dtype");
    }
};

/**
 * Remove URL encoding from the string
 * @param  {String} str   Maybe URL encoded string.
 * @return {String}       Decoded String.
 */
export const escapeString = function (str) {
    if (typeof str != "string") {
        str = String(str);
    }
    return unescape(encodeURIComponent(str));
};

/**
 * Takes a URL or a domain string and transforms it into a uniform format.
 * Examples: {"www.example.com", "https://example.com/", ".example.com"} --> "example.com"
 * @param {String} domain  Domain to clean and bring into uniform format
 * @return {String}        Cleaned domain string.
 */
export const urlToUniformDomain = function (url) {
    if (url === null) {
        return null;
    }
    let new_url = url.trim();
    new_url = new_url.replace(/^\./, ""); // cookies can start like .www.example.com
    new_url = new_url.replace(/^http(s)?:\/\//, "");
    new_url = new_url.replace(/^www([0-9])?/, "");
    new_url = new_url.replace(/^\./, "");
    new_url = new_url.replace(/\/.*$/, "");
    return new_url;
};

const domainRemoveNoise = function (url) {
    if (url === null) {
        return null;
    }
    let new_url = url.trim();
    new_url = new_url.replace(/^\./, "");
    new_url = new_url.replace(/^http(s)?:\/\//, "");
    new_url = new_url.replace(/^\./, "");
    new_url = new_url.replace(/\/.*$/, "");
    return new_url;
};

/**
 * Given a cookie expiration date, compute the expiry time in seconds,
 * starting from the current time and date.
 * @param  {Object} cookie  Cookie object that contains the attributes "session" and "expirationDate".
 * @return {Number}         Expiration time in seconds. Zero if session cookie.
 */
export const datetimeToExpiry = function (cookie) {
    let curTS = Math.floor(Date.now() / 1000);
    return cookie.session ? 0 : cookie.expirationDate - curTS;
};

/**
 * Transform class index to human-readable meaning.
 * @param {Number} idx class label index
 * @returns {String} human-readable string
 */
export const classIndexToString = (idx) => {
    switch (idx) {
        case -1:
            return "Unknown";
        case 0:
            return "Necessary";
        case 1:
            return "Functionality";
        case 2:
            return "Analytical";
        case 3:
            return "Advertising";
        case 4:
            return "Uncategorized";
        case 5:
            return "Social Media";
        default:
            return "Invalid Category Index";
    }
};

export function isAALabel(idx) {
    return idx === 2 || idx === 3 || idx === 5;
}

/**
 * Transform class string to index. Inverse of above
 * @returns {Number} idx class label index
 * @param classStr
 */
export const classStringToIndex = (classStr) => {
    switch (classStr) {
        case "Unknown":
            return -1;
        case "Necessary":
            return 0;
        case "Functionality":
            return 1;
        case "Analytical":
            return 2;
        case "Advertising":
            return 3;
        case "Uncategorized":
            return 4;
        case "Social Media":
            return 5;
        default:
            return -1;
    }
};

// default configuration
var defaultConfig = undefined;
getExtensionFile(browser.runtime.getURL("ext_data/default_config.json"), "json", (df) => {
    defaultConfig = df;
});
