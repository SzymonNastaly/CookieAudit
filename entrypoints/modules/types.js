/**
 * Represents a single interactive object with multiple properties.
 * @typedef {Object} InteractiveObject
 * @property {string[]} selector - One selector for the interactive object, or two in case of a nested interactive object.
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
 * @property {number} current_label - The current label value.
 * @property {string} domain - The domain associated with the cookie.
 * @property {string} name - The name of the cookie.
 */

/**
 * @typedef {Object.<string, CookieData>} CookieCollection
 * A collection of cookies, where each key is a string representing the cookie identifier,
 * and the value is an object containing the cookie data.
 */