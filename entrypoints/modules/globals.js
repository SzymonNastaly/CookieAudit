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
export const Purpose = Object.freeze({
  Accept: 0, Close: 1, Settings: 2, Other: 3, Reject: 4, SaveSettings: 5,
});
export const SCANSTAGE = ['initial', 'necessary', 'all', 'finished'];
export const STAGE2 = Object.freeze({
  NOT_STARTED: 0,
  NOTICE_SELECTION: 1,
  SECOND_SELECTION: 2,
  NOTICE_INTERACTION: 3,
  INTERACTION_WO_NOTICE: 4,
  FINISHED: 5,
});

export const INITIAL_SCAN = {
  stage2: STAGE2.NOT_STARTED,
  'scanStart': null,
  'scanEnd': null,
  'url': null,
  'interactiveElements': [],
  ieToInteract: [],
  'purposeDeclared': false,
  'noticeDetected': false,
  'rejectDetected': false,
  'closeSaveDetected': false,
  'aaCookiesAfterReject': [],
  'aaCookiesAfterSave': [],
  'aaCookiesAfterClose': [],
  'aaCookiesWONoticeInteraction': [],
};
export const INTERACTION_STATE = Object.freeze({
  PAGE_W_NOTICE: 0, PAGE_WO_NOTICE: 1,
});

export const PAGE_COUNT = 1;
export const MAX_OTHER_BTN_COUNT = 2;

export const INITIAL_SELECTION = Object.freeze({
  notice: null, interactiveObjects: [], iframeFullIndex: null,
});
export const INITIAL_INTERACTION = Object.freeze({
  ie: null, visitedPages: [],
});
export const INITIAL_PROGRESS = Object.freeze({
  purpose: 0, purposeDownloading: false, ie: 0, ieDownloading: false,
});
export const NOTICE_STATUS = Object.freeze({
  WRONG_FRAME: 0,
  SUCCESS: 1,
  NOTICE_STILL_OPEN: 2,
  WRONG_SELECTOR: 3,
  NOTICE_CLOSED: 4,
});

export const SECOND_LVL_STATUS = Object.freeze({
  EXTERNAL_ANCHOR: 0, SUCCESS: 1, NEW_NOTICE: 2, SAME_NOTICE: 3,
});

// Function to await no changes being made to the DOM. ChatGPT
export async function awaitNoDOMChanges(timeout = 2000) {
  return new Promise((resolve) => {
    let timer;

    let observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        observer.disconnect();
        timer = null;
        observer = null;
        resolve('observer');
      }, timeout);
    });

    observer.observe(document.body, {
      childList: true, subtree: true,
    });

    // Set initial timer in case there are no mutations
    if (timer == null) {
      timer = setTimeout(() => {
        observer.disconnect();
        timer = null;
        observer = null;
        resolve('initial');
      }, timeout);
    }
  });
}

export async function resetStorage() {
  await Promise.all([
    await storage.setItem('local:selection', INITIAL_SELECTION),
    await storage.setItem('local:second_selections', []),
    await storage.setItem('local:interaction', INITIAL_INTERACTION),
    await storage.setItem('local:scan', INITIAL_SCAN),
    await storage.setItem('local:progress', INITIAL_PROGRESS),
    await storage.setItem('local:cookies', [])]);
}

/**
 * These fixes are displayed on the summary according to what needs to be fixed.
 */
export const FIXES = {
  'nonessential': `You must receive users' consent before you use any cookies except strictly necessary cookies. <a href="https://www.cookieaudit.app#consent" class="learn" target="_blank">Learn more</a>`,
  'undeclared': `You must declare and provide information about each cookie before consent is received. <a href="https://www.cookieaudit.app#declaration" class="learn" target="_blank">Learn more</a>`,
  'wrongcat': `We classified some cookies differently than you, make sure you put each cookie in the correct category. <a href="https://www.cookieaudit.app#categories" class="learn" target="_blank">Learn more</a>`,
  'wrongexpiry-time': `The expiration time of some cookies is much higher than declared. Lower the expiry date on the cookie or correct the declaration. <a href="https://www.cookieaudit.app#expiry" class="learn" target="_blank">Learn more</a>`,
  'wrongexpiry-session': `You declared some cookies as session-cookies but set them to be persistent.`,
  'noreject': `Add a "Reject" button to the initial consent popup. <a href="https://www.cookieaudit.app#noreject" class="learn" target="_blank">Learn more</a>`,
  'preselected': `Make sure non-essential categories are not preselected in the consent popup. <a href="https://www.cookieaudit.app#preselected" class="learn" target="_blank">Learn more</a>`,
};

export function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

export function getIframeIndex(win) {
  if (win.parent !== win) {
    for (let i = 0; i < win.parent.frames.length; i++) {
      if (win.parent.frames[i] === win) {
        return i;
      }
    }
    throw Error('In a frame, but could not find myself');
  } else {
    return -1;
  }
}

export function waitStableFrames(tabId, t = 2000, pollInterval = 100) {
  return new Promise(async (resolve, reject) => {
    let currentValue = await browser.webNavigation.getAllFrames({tabId: tabId});
    let startTime = Date.now();
    let timerId;

    async function checkVariable() {
      const f = await browser.webNavigation.getAllFrames({tabId: tabId});
      if (f === currentValue) {
        if (Date.now() - startTime >= t) {
          clearInterval(timerId);
          resolve(f);
        }
      } else {
        currentValue = await browser.webNavigation.getAllFrames({tabId: tabId});
        startTime = Date.now();
      }
    }

    timerId = setInterval(checkVariable, pollInterval);

    // timeout to prevent infinite polling
    setTimeout(() => {
      clearInterval(timerId);
      resolve('frame_timeout');
    }, t * 3); // Adjust this value as needed
  });
}

export function updateTabAndWait(tabId, url) {
  return new Promise(async (resolve, reject) => {
    // Function to handle tab updates
    function handleUpdate(updatedTabId, changeInfo, tabInfo) {
      // Check if the updated tab is the one we're interested in
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        browser.tabs.onUpdated.removeListener(handleUpdate);
        resolve(tabInfo);
      }
    }

    browser.tabs.onUpdated.addListener(handleUpdate);

    try {
      await browser.tabs.update(tabId, {url: url});
    } catch (e) {
      reject(new Error(e.message));
    }
  });
}

// Returns a unique index in iframe hierarchy, or empty string if topmost
export function getFullIframeIndex(win) {
  if (getIframeIndex(win) < 0) {
    return 'root';
  } else {
    return getFullIframeIndex(win.parent) + '.' + getIframeIndex(win);
  }
}

export function extract_text_from_element(e, exclude_links = false) {
  let text = [];
  if (element_is_hidden(e) ||
      (exclude_links && (e.nodeName === 'A' || e.nodeName === 'BUTTON'))) {
    return text;
  }
  let cur_text = '';
  let prv_item_type = '';
  let children = e.childNodes;
  children.forEach(function(item) {
    if (item.textContent.trim() === '' || item.nodeName === '#comment') {
      return;
    }
    if (item.nodeName === 'BUTTON' && exclude_links === true) {
      return;
    } else if (item.nodeName === 'A') {
      if (exclude_links === true) {
        return;
      }
      let link_text = extract_text_from_element(item, exclude_links);
      if (link_text.length > 1 || prv_item_type === 'A') {
        if (cur_text.trim() !== '') {
          text.push(cur_text.trim());
          cur_text = '';
        }
        text = text.concat(link_text);
      } else if (link_text.length === 1) {
        cur_text += ' ' + link_text[0].trim();
      }
    } else if (['#text', 'EM', 'STRONG', 'I', 'MARK'].includes(item.nodeName)) {
      cur_text = cur_text + ' ' + item.textContent.trim();
    } else if (['UL', 'OL'].includes(item.nodeName)) {
      let list_items = extract_text_from_element(item, exclude_links);
      if (cur_text.trim() !== '') {
        cur_text = cur_text.trim() + ' ';
      }
      text = text.concat(Array.from(list_items).map(x => cur_text + x));
      cur_text = '';
    } else {
      if (cur_text.trim() !== '') {
        text.push(cur_text.trim());
        cur_text = '';
      }
      text = text.concat(extract_text_from_element(item, exclude_links));
    }
    prv_item_type = item.nodeName;
  });
  if (cur_text.trim() !== '') {
    text.push(cur_text.trim());
    cur_text = '';
  }
  return text.filter(x => {
    return x !== undefined;
  });
}

export function element_is_hidden(e) {
  let is_hidden = true;
  let height = e.offsetHeight;
  let width = e.offsetWidth;
  if (height === undefined || width === undefined) {
    return true;
  }
  try {
    let cur = e;
    while (cur) {
      if (window.getComputedStyle(cur).getPropertyValue('opacity') === '0') {
        return true;
      }
      cur = cur.parentElement;
    }
  } catch (error) {
  }
  try {
    is_hidden = (window.getComputedStyle(e).display === 'none' ||
        window.getComputedStyle(e).visibility === 'hidden' || height === 0 ||
        width === 0);
  } catch (error) {
  }
  e.childNodes.forEach(function(item) {
    is_hidden = is_hidden && element_is_hidden(item);
  });
  return is_hidden;
}

export function get_clickable_elements(parent) {
  let elements = [];
  for (let element of parent.getElementsByTagName('*')) {
    if (!element_is_hidden(element) &&
        ['DIV', 'SPAN', 'A', 'BUTTON', 'INPUT'].includes(element.tagName) &&
        (element.tabIndex >= 0 || element.getAttribute('role') === 'button' ||
            element.getAttribute('onclick') !== null)) {
      elements.push(element);
    }
  }
  let filtered_elements = [];
  for (let element of elements) {
    let parent_found = false;
    for (let parent of elements) {
      if (element !== parent && parent.contains(element)) {
        parent_found = true;
      }
    }
    if (parent_found === false) {
      filtered_elements.push(element);
    }
  }
  return filtered_elements;
}

/**
 * Retrieves the data at the given URL with the specified type.
 * Once the response arrives, a callback is executed with the response object.
 * @param {String} url          URL to send the GET request to, intended to be a local extension URL.
 * @param {String} dtype        Type of the data. Examples: "json", "text", "binary"
 * @param {Function} callback   Callback function that will be executed as soon as the data is available, receives data as first argument.
 */
export const getExtensionFile = async function(
    url, dtype, callback, errorCallback = null) {
  let res = await fetch(url);
  if (dtype === 'text') {
    callback(await res.text());
  } else if (dtype === 'json') {
    callback(await res.json());
  } else {
    console.error('Wrong dtype');
  }
};

/**
 * Remove URL encoding from the string
 * @param  {String} str   Maybe URL encoded string.
 * @return {String}       Decoded String.
 */
export const escapeString = function(str) {
  if (typeof str != 'string') {
    str = String(str);
  }
  return unescape(encodeURIComponent(str));
};

/**
 * Takes a URL or a domain string and transforms it into a uniform format.
 * Examples: {"www.example.com", "https://example.com/", ".example.com"} --> "example.com"
 * @param {String} url  Domain to clean and bring into uniform format
 * @return {String}        Cleaned domain string.
 */
export const urlToUniformDomain = function(url) {
  if (url === null) {
    return null;
  }
  let new_url = url.trim();
  new_url = new_url.replace(/^\./, ''); // cookies can start like .www.example.com
  new_url = new_url.replace(/^http(s)?:\/\//, '');
  new_url = new_url.replace(/^www([0-9])?/, '');
  new_url = new_url.replace(/^\./, '');
  new_url = new_url.replace(/\/.*$/, '');
  return new_url;
};

const domainRemoveNoise = function(url) {
  if (url === null) {
    return null;
  }
  let new_url = url.trim();
  new_url = new_url.replace(/^\./, '');
  new_url = new_url.replace(/^http(s)?:\/\//, '');
  new_url = new_url.replace(/^\./, '');
  new_url = new_url.replace(/\/.*$/, '');
  return new_url;
};

/**
 * Given a cookie expiration date, compute the expiry time in seconds,
 * starting from the current time and date.
 * @param  {Object} cookie  Cookie object that contains the attributes "session" and "expirationDate".
 * @return {Number}         Expiration time in seconds. Zero if session cookie.
 */
export const datetimeToExpiry = function(cookie) {
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
      return 'Unknown';
    case 0:
      return 'Necessary';
    case 1:
      return 'Functionality';
    case 2:
      return 'Analytical';
    case 3:
      return 'Advertising';
    case 4:
      return 'Uncategorized';
    case 5:
      return 'Social Media';
    default:
      return 'Invalid Category Index';
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
    case 'Unknown':
      return -1;
    case 'Necessary':
      return 0;
    case 'Functionality':
      return 1;
    case 'Analytical':
      return 2;
    case 'Advertising':
      return 3;
    case 'Uncategorized':
      return 4;
    case 'Social Media':
      return 5;
    default:
      return -1;
  }
};

// default configuration
var defaultConfig = undefined;
getExtensionFile(browser.runtime.getURL('ext_data/default_config.json'), 'json',
    (df) => {
      defaultConfig = df;
    });
