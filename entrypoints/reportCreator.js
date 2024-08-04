import pdfMake from 'pdfmake/build/pdfmake';
import {
  classIndexToString, COLOR_DIST_THRESHOLD, DARK_PATTERN_STATUS, ieLabelToString, IEPurpose,
} from './modules/globals';
import * as pdfFonts from './modules/vfs_fonts';

export default defineUnlistedScript(async () => {
  try {
    const currentDate = new Date();
    const scan = await storage.getItem('local:scan');
    console.log('starting report creation, scan: ', scan);

    let cookiesAfterClose = [];
    if (scan.aaCookiesAfterClose.length > 0) {
      cookiesAfterClose = scan.aaCookiesAfterClose[0].aaCookies.map(entry => {
        return [
          classIndexToString(entry.current_label), entry.domain, entry.name];
      });
    }
    let aaCookiesAfterReject = [];
    if (scan.aaCookiesAfterReject.length > 0) {
      aaCookiesAfterReject = scan.aaCookiesAfterReject[0].aaCookies.map(entry => {
        return [
          classIndexToString(entry.current_label), entry.domain, entry.name];
      });
    }
    let aaCookiesAfterSave = [];
    if (scan.aaCookiesAfterSave.length > 0) {
      aaCookiesAfterSave = scan.aaCookiesAfterSave[0].aaCookies.map(entry => {
        return [
          classIndexToString(entry.current_label), entry.domain, entry.name];
      });
    }
    let aaCookiesWONoticeInteraction = [];
    if (scan.aaCookiesWONoticeInteraction.length > 0) {
      aaCookiesWONoticeInteraction = scan.aaCookiesWONoticeInteraction.map(entry => {
        return [
          classIndexToString(entry.current_label), entry.domain, entry.name];
      });
    }
    const colorDistanceTableRows = scan.colorDistances.map(cd => {
      return [
        {
          text: [
            {text: cd.button1.text[0], bold: true},
            ' ',
            {text: `(${ieLabelToString(cd.button1.label)})`, italics: true}],
        }, {
          text: [
            {text: cd.button2.text[0], bold: true},
            ' ',
            {text: `(${ieLabelToString(cd.button2.label)})`, italics: true}],
        }, {text: `${cd.distance}`}];
    });

    pdfMake.vfs = pdfFonts.default;

    let dd = {
      content: [
        {
          text: [
            {text: `Cookie Report: `, style: 'header'}, {
              text: `${scan.url}`, fontSize: 18, bold: true, italics: true,
            }],
        },
        `Date: ${currentDate.toLocaleDateString()}`,
        `A cookie notice was detected: ${scan.noticeDetected}`,
        `A reject button exists in the first layer: ${scan.rejectDetected}`,
        `A close or save button was found: ${scan.closeSaveDetected}`,
        `The purpose of analytics/advertising cookies is defined in the notice: ${scan.purposeDeclared}`,
        {
          text: 'Analytics and Advertising Cookies: Close', style: 'subheader',
        },
        {
          style: 'tableExample', table: {
            headerRows: 1, body: [
              [
                {text: 'Class', style: 'tableHeader'}, {text: 'Domain', style: 'tableHeader'}, {
                text: 'Name', style: 'tableHeader',
              }], ...cookiesAfterClose],
          }, layout: {
            fillColor: function(rowIndex, node, columnIndex) {
              return (rowIndex % 2 === 1) ? '#ced4da' : null;
            },
          },
        },
        {
          text: 'Analytics and Advertising Cookies: Reject', style: 'subheader',
        },
        {
          style: 'tableExample', table: {
            headerRows: 1, body: [
              [
                {text: 'Class', style: 'tableHeader'}, {text: 'Domain', style: 'tableHeader'}, {
                text: 'Name', style: 'tableHeader',
              }], ...aaCookiesAfterReject],
          }, layout: {
            fillColor: function(rowIndex, node, columnIndex) {
              return (rowIndex % 2 === 1) ? '#ced4da' : null;
            },
          },
        },
        {
          text: 'Analytics and Advertising Cookies: Save', style: 'subheader',
        },
        {
          style: 'tableExample', table: {
            headerRows: 1, body: [
              [
                {text: 'Class', style: 'tableHeader'}, {text: 'Domain', style: 'tableHeader'}, {
                text: 'Name', style: 'tableHeader',
              }], ...aaCookiesAfterSave],
          }, layout: {
            fillColor: function(rowIndex, node, columnIndex) {
              return (rowIndex % 2 === 1) ? '#ced4da' : null;
            },
          },
        },
        {
          text: 'Analytics and Advertising Cookies: Ignoring the Cookie Notice', style: 'subheader',
        },
        {
          style: 'tableExample', table: {
            headerRows: 1, body: [
              [
                {text: 'Class', style: 'tableHeader'}, {text: 'Domain', style: 'tableHeader'}, {
                text: 'Name', style: 'tableHeader',
              }], ...aaCookiesWONoticeInteraction],
          }, layout: {
            fillColor: function(rowIndex, node, columnIndex) {
              return (rowIndex % 2 === 1) ? '#ced4da' : null;
            },
          },
        },
        {text: 'Dark Patterns', style: 'subheader'},
        `The color differences between the Accept button and Reject/Settings/Save-Settings buttons. 
        As a metric we use E_ITP (specification can be found in ITU-R BT.2124-0).
        It is scaled such that on a perfect display a distance of 1 is barely noticeable.
        A distance of more then 25 starts to be meaningful.\n\n`,
        {
          table: {
            headerRows: 1, widths: ['*', '*', 'auto'], body: [
              [
                {text: 'Button 1', style: 'tableHeader'},
                {text: 'Button 2', style: 'tableHeader'},
                {text: 'Color Difference', style: 'tableHeader'}], ...colorDistanceTableRows],
          }, layout: {
            fillColor: function(rowIndex, node, columnIndex) {
              return (rowIndex % 2 === 1) ? '#ced4da' : null;
            },
          },
        },
        `\n The user is forced to interact with the cookie notice: ${scan.forcedActionStatus ===
        DARK_PATTERN_STATUS.HAS_FORCED_ACTION}`], styles: {
        header: {
          fontSize: 18, bold: true,
        }, subheader: {
          fontSize: 15, bold: true,
        }, tableExample: {
          margin: [0, 5, 0, 15],
        }, tableHeader: {
          bold: true, fontSize: 13, color: 'black',
        },
      },
    };
    let dataUrl = await new Promise(function(resolve, reject) {
      try {
        pdfMake.createPdf(dd).getDataUrl((dataUrl) => {
          resolve(dataUrl);
        });
      } catch (e) {
        reject(e);
      }
    });
    await storage.setItem('local:report', dataUrl);

    return 'success';
  } catch (e) {
    return JSON.stringify(e, Object.getOwnPropertyNames(e));
  }
});