/**
 * Represents an array of interactive objects.
 * @typedef {Array<InteractiveObject>} InteractiveObjects
 */

/**
 * Represents a single interactive object with multiple properties.
 * @typedef {Object} InteractiveObject
 * @property {string[]} selector - One selector for the interactive object, or two in case of a nested interactive object.
 * @property {string[]} text - One selector for the interactive object, or two in case of a nested interactive object.
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
 */

/**
 * @typedef {Object} Selection
 * @property {string|null} iframeFullIndex - The full index path of the iframe.
 * @property {InteractiveObjects} interactiveObjects - The interactive objects associated with this selection.
 * @property {Notice|null} notice - The notice associated with this selection.
 */
