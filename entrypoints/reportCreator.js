import pdfMake from 'pdfmake/build/pdfmake';
import {classIndexToString} from './modules/globals';
import * as pdfFonts from './modules/vfs_fonts';

export default defineUnlistedScript(async () => {
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
  pdfMake.vfs = pdfFonts.default;

  let dd = {
    content: [
      {
        text: [
          {text: `Cookie Report: `, style: 'header'}, {
            text: `${scan.url}`, fontSize: 18, bold: true, italics: true,
          }],
      }, `Date: ${currentDate.toLocaleDateString()}`, {
        text: 'Analytics and Advertising Cookies: Close', style: 'subheader',
      }, {
        style: 'tableExample', table: {
          headerRows: 1, body: [
            [
              {text: 'Class', style: 'tableHeader'}, {text: 'Domain', style: 'tableHeader'}, {
              text: 'Name', style: 'tableHeader',
            }], ...cookiesAfterClose],
        },
      }, {
        text: 'Analytics and Advertising Cookies: Reject', style: 'subheader',
      }, {
        style: 'tableExample', table: {
          headerRows: 1, body: [
            [
              {text: 'Class', style: 'tableHeader'}, {text: 'Domain', style: 'tableHeader'}, {
              text: 'Name', style: 'tableHeader',
            }], ...aaCookiesAfterReject],
        },
      }, {
        text: 'Analytics and Advertising Cookies: Save', style: 'subheader',
      }, {
        style: 'tableExample', table: {
          headerRows: 1, body: [
            [
              {text: 'Class', style: 'tableHeader'}, {text: 'Domain', style: 'tableHeader'}, {
              text: 'Name', style: 'tableHeader',
            }], ...aaCookiesAfterSave],
        },
      }, {
        text: 'Analytics and Advertising Cookies: Ignoring the Cookie Notice', style: 'subheader',
      }, {
        style: 'tableExample', table: {
          headerRows: 1, body: [
            [
              {text: 'Class', style: 'tableHeader'}, {text: 'Domain', style: 'tableHeader'}, {
              text: 'Name', style: 'tableHeader',
            }], ...aaCookiesWONoticeInteraction],
        },
      }], styles: {
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
  pdfMake.createPdf(dd).open();
});