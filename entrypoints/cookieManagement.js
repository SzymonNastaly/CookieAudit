import {extractFeatures} from './modules/extractor.js';
import {
  classIndexToString,
  datetimeToExpiry,
  escapeString,
  INTERACTION_STATE,
  isAALabel,
  IEPurpose,
  urlToUniformDomain,
} from './modules/globals.js';
import {predictClass} from './modules/predictor.js';

export default defineUnlistedScript(async () => {
});

const UPDATE_LIMIT = 10;
const MINTIME = 120000;

/**
 * Construct a string formatted key that uniquely identifies the given cookie object.
 * @param {Cookie|CookieData} cookieDat - Stores the cookie data, expects attribute's name, domain and path.
 * @returns {String} - the cookie's key
 */
export function constructKeyFromCookie(cookieDat) {
  return `${cookieDat.name};${urlToUniformDomain(cookieDat.domain)};${cookieDat.path}`;
}

/**
 * Creates a new feature extraction input object from the raw cookie data.
 * @param  {Cookie} cookie - Raw cookie data as received from the browser.
 * @return {CookieData} - Feature Extraction input object.
 */
function createFEInput(cookie) {
  return {
    name: escapeString(cookie.name),
    domain: escapeString(cookie.domain),
    path: escapeString(cookie.path),
    current_label: -1,
    label_ts: 0,
    storeId: escapeString(cookie.storeId),
    variable_data: [
      {
        host_only: cookie.hostOnly,
        http_only: cookie.httpOnly,
        secure: cookie.secure,
        session: cookie.session,
        expirationDate: cookie.expirationDate,
        expiry: datetimeToExpiry(cookie),
        value: escapeString(cookie.value),
        same_site: escapeString(cookie.sameSite),
        timestamp: Date.now(),
      }],
  };
}

/**
 * Updates the existing feature extraction object with data from the new cookie.
 * Specifically, the variable data attribute will have the new cookie's data appended to it.
 * If the update limit is reached, the oldest update will be removed.
 * @param  {Object} storedFEInput   Feature Extraction input, previously constructed.
 * @param  {Object} rawCookie       New cookie data, untransformed.
 * @return {Promise<object>}        The existing cookie object, updated with new data.
 */
async function updateFEInput(storedFEInput, rawCookie) {
  let updateArray = storedFEInput['variable_data'];

  /** @type {VariableData} */
  let updateStruct = {
    'host_only': rawCookie.hostOnly,
    'http_only': rawCookie.httpOnly,
    'secure': rawCookie.secure,
    'session': rawCookie.session,
    'expirationDate': rawCookie.expirationDate,
    'expiry': datetimeToExpiry(rawCookie),
    'value': escapeString(rawCookie.value),
    'same_site': escapeString(rawCookie.sameSite),
    'timestamp': Date.now(),
  };

  // remove head if limit reached
  if (updateArray.length >= UPDATE_LIMIT) updateArray.shift();

  updateArray.push(updateStruct);
  console.assert(updateArray.length > 1, 'Error: Performed an update without appending to the cookie?');
  console.assert(updateArray.length <= UPDATE_LIMIT, 'Error: cookie update limit still exceeded!');

  return storedFEInput;
}

/**
 * Insert serialized cookie into IndexedDB storage via a transaction.
 * @param {CookieData} serializedCookie Cookie to insert into storage.
 */
async function insertCookieIntoStorage(serializedCookie) {
  let ckey = constructKeyFromCookie(serializedCookie);

  let cookies = await storage.getItem('local:cookies');
  if (!cookies) {
    cookies = {};
  }
  cookies[ckey] = serializedCookie;
  await storage.setItem('local:cookies', cookies);
  return true;
}

/**
 * Retrieve serialized cookie from IndexedDB storage via a transaction.
 * @param {Cookie} cookieDat Raw cookie object that provides name, domain and path.
 * @returns {Promise<CookieData>} Either the cookie if found, or undefined if not.
 */
async function retrieveCookieFromStorage(cookieDat) {
  let ckey = constructKeyFromCookie(cookieDat);
  //let {cookies} = await storageMutex.read("cookies");
  let cookies = await storage.getItem('local:cookies');
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
 * @param {Cookie} newCookie
 * @param  {CookieData} feature_input   Transformed cookie data input, for the feature extraction.
 * @return {Promise<Number>}        Cookie category label as an integer, ranging from [0,3].
 */
async function classifyCookie(newCookie, feature_input) {
  // Feature extraction timing
  let features = extractFeatures(feature_input);
  // 3 from cblk_pscale default
  return await predictClass(features, 3);
}

/**
 * Retrieve the cookie and classifySentencePurpose it.
 * @param {Cookie} newCookie Raw cookie object directly from the browser.
 * @param {boolean} storeUpdate Whether
 * @param {boolean} overrideTimeCheck
 */
export async function handleCookie(newCookie, storeUpdate, overrideTimeCheck) {
  // First, if consent is given, check if the cookie has already been stored.
  /** @type {CookieData} */
  let serializedCookie
  let storedCookie;
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

  // If cookie recently classified, use the previous label.
  let elapsed = Date.now() - serializedCookie['label_ts'];

  let clabel = serializedCookie['current_label'];
  console.assert(clabel !== undefined, 'Stored cookie label was undefined!!');

  if (overrideTimeCheck || clabel === -1 || elapsed > MINTIME) {
    // analyzeCMP(newCookie);
    clabel = await classifyCookie(newCookie, serializedCookie);

    // Update timestamp and label of the stored cookie
    serializedCookie['current_label'] = clabel;
    serializedCookie['label_ts'] = Date.now();
    console.debug('Perform Prediction: Cookie (%s;%s;%s) receives label (%s)', newCookie.name, newCookie.domain,
        newCookie.path, classIndexToString(clabel));
  } else {
    console.debug('Skip Prediction: Cookie (%s;%s;%s) with label (%s)', newCookie.name, newCookie.domain,
        newCookie.path, classIndexToString(clabel));
  }

  // If consent is given, store the cookie again.
  const inserted = await insertCookieIntoStorage(serializedCookie);
  if (!inserted) {
    console.error('couldn\'t insert cookie');
  }
}