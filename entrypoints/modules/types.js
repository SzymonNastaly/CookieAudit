/**
 * Represents a single interactive object with multiple properties.
 * @typedef {Object} InteractiveObject
 * @property {string[]} selector - One selector for the interactive object, or two in case of a nested interactive object.
 * @property {string[]} relativeSelector - One (relative = no id or classes) selector for the interactive object, or two in case of a nested interactive object.
 * @property {string[]} text - One text for the interactive object, or two in case of a nested interactive object.
 * @property {string} tagName - The tag name of the HTML element.
 * @property {number[]} x - x-coordinates of the first (and second, if nested) element on the page.
 * @property {number[]} y - x-coordinates of the first (and second, if nested) element on the page.
 * @property {number|null} label - Classification of the interactive object according to the interactive_elements_model
 */

/**
 * @typedef {Object} Notice
 * @property {string} selector - The CSS selector for the notice.
 * @property {string} text - The textual content of the notice.
 * @property {number|null} label - Classification of the notice according to the purpose_detection_model
 * @property {{top: number, bottom: number, left: number, right:number}} rect - Bounding coordinates
 */

/**
 * @typedef {Object} Selection
 * @property {string|null} iframeFullIndex - The full index path of the iframe.
 * @property {InteractiveObject[]} interactiveObjects - The interactive objects associated with this selection.
 * @property {Notice|null} notice - The notice associated with this selection.
 */

/**
 * @typedef {Object} Interaction
 * @property {InteractiveObject|null} ie interactive element
 * @property {string[]} visitedPages
 */

/**
 * @typedef {Object} CookieData
 * @property {string} name - The name of the cookie.
 * @property {string} domain - The domain of the cookie (e.g., "example.com")
 * @property {string} path - The path of the cookie.
 * @property {number} current_label - The current label value.
 * @property {number} label_ts
 * @property {string} storeId The ID of the cookie store containing this cookie, as provided in getAllCookieStores().
 * @property {VariableData[]} variable_data
 */

/**
 * @typedef {Object} VariableData
 * @property {boolean} host_only - True if the cookie is a host-only cookie (i.e., a request's host must exactly match the domain of the cookie).
 * @property {boolean} http_only - True if the cookie is marked as HttpOnly (i.e., the cookie is inaccessible to client-side scripts).
 * @property {boolean} secure - True if the cookie is marked as Secure (i.e., its scope is limited to secure channels, typically HTTPS).
 * @property {boolean} session - True if the cookie is a session cookie, as opposed to a persistent cookie with an expiration date.
 * @property {number} expirationDate - The expiration date of the cookie as the number of seconds since the UNIX epoch.
 * Not provided for session cookies.
 * Optional.
 * @property {number} expiry -
 * The expiration data of the cookie as the number of seconds since the creation of the VariableData object.
 * @property {string} value - The value of the cookie.
 * @property {string} same_site - The cookie's same-site status (i.e., whether the cookie is sent with cross-site requests).
 * @property {number} timestamp
 */

/**
 * @typedef {Object.<string, CookieData>} CookieCollection
 * A collection of cookies, where each key is a string representing the cookie identifier,
 * and the value is an object containing the cookie data.
 */