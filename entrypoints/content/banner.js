// downloading EasyList and using it to find the banner

const generalUrl =
    "https://raw.githubusercontent.com/easylist/easylist/master/easylist_cookie/easylist_cookie_general_hide.txt";

export const fetchEasylist = async function () {
    let res = await fetch(generalUrl);
    return handleEasylist(await res.text());
};

const handleEasylist = function (data) {
    var easylist = [".t-consentPrompt"];
    const lines = data.split("\n");
    for (l in lines) {
        if (lines[l].slice(0, 2) === "##") {
            easylist.push(lines[l].slice(2));
        }
    }
    return easylist;
};

/**
 * Use easylist to find a selector which is potentially a cookie popup (of any kind)
 * @todo Is it necessary to go through the whole EasyList i.e. continuing after having found potential selectors.
 */
const getCMP = function (easylist) {
    let selectors = [];
    for (l in easylist) {
        const selector = document.querySelector(easylist[l]);
        if (selector) {
            selectors.push(selector);
        }
    }
    return selectors;
};

const getZIndex = function (e) {
    var z = window.getComputedStyle(e).getPropertyValue("z-index");
    return z;
};

/*
 * Finds all large z indices to find the banner which lies on top of the page
 */
const greaterZIndex = function () {
    var elements = Array.from(document.querySelectorAll("body *"));
    const cur_z_index = 0;
    var filtered_elements = [];
    elements.forEach(function (element) {
        const z = getZIndex(element);
        if (z && parseInt(z) >= parseInt(cur_z_index)) {
            filtered_elements = filtered_elements.concat(element);
        }
    });

    var results = [];
    for (let e_1 of filtered_elements) {
        var contained_in_another_element = false;
        for (let e_2 of filtered_elements) {
            if (e_1 !== e_2 && e_2.contains(e_1)) {
                contained_in_another_element = true;
            }
        }
        if (contained_in_another_element === false) {
            results = results.concat(e_1);
        }
    }
    return results;
};