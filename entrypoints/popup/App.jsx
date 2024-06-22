import {Anchor, Button, Center, Divider, Group, MantineProvider, Progress, Stack, Text} from '@mantine/core';
import {useEffect, useRef, useState} from 'react';
import './App.css';
import '@mantine/core/styles.css';
import {storage} from 'wxt/storage';
import {
  classIndexToString, DARK_PATTERN_STATUS, openNotification, Purpose, STAGE2, urlToUniformDomain, urlWoQueryOrFragment,
} from '../modules/globals.js';

/**
 * Retrieve a clean (without query parameters or a #fragement) url of the active tab.
 * @returns {Promise<String|null>} Url.
 */
async function getURL() {
  let queryOptions = {active: true};
  // `tab` will either be a `tabs.Tab` instance or `undefined`.
  let [tab] = await browser.tabs.query(queryOptions);
  if (!tab || !tab.url) {
    return null;
  }
  return urlWoQueryOrFragment(tab.url);
}

export default function App() {
  // User needs to reset the scan before doing the first scan.
  const [resetBeforeScan, setResetBeforeScan] = useState(false);
  // Scan is not possible in e.g., the browser settings.
  const [illegalUrl, setIllegalUrl] = useState(false);
  // Wait before starting scan while the website is (re)loading.
  const [isLoading, setIsLoading] = useState(false);
  // user has instructed extension to stop scan
  const [stoppingScan, setStoppingScan] = useState(false);

  const [ieProgress, setIeProgress] = useState({isDownloading: false, value: 0});
  const [purposeProgress, setPurposeProgress] = useState({isDownloading: false, value: 0});

  const [scan, _setScan] = useState(null);
  const scanRef = useRef(null);

  // Once finished, contains a dataUrl of the pdf scan report
  const [report, setReport] = useState(null);

  function setScan(s) {
    _setScan(s);
    scanRef.current = s;
  }

  const modelsAreDownloading = !(purposeProgress.value === 0 && ieProgress.value === 0) &&
      !(purposeProgress.value === 100 && ieProgress.value === 100);
  // user should not be able to start a scan if e.g., a chrome:// page is open, the BERT models are downloading, or a previous scan is currently being stopped
  const startDisabled = !resetBeforeScan || illegalUrl || isLoading || modelsAreDownloading || stoppingScan;

  useEffect(() => {
    storage.getItem('local:scan').then((localScan) => {
      console.log('getting local:scan', localScan);
      if (localScan != null) {
        setScan(localScan);
      }
    });
    storage.getItem('local:progress').then((progress) => {
      if (progress != null) {
        setIeProgress({
          isDownloading: progress.ieDownloading, value: progress.ie,
        });
        setPurposeProgress({
          isDownloading: progress.purposeDownloading, value: progress.purpose,
        });
      }
    });
    storage.getItem('local:resetBeforeScan').then((wasReset) => {
      if (wasReset == null) {
        setResetBeforeScan(false);
      }
      setResetBeforeScan(wasReset);
    });
    // contains the dataUrl for a PDF report
    storage.getItem('local:report').then((v) => {
      setReport(v);
    });
    // stoppingScan is true while the scan abort is not yet finished
    storage.getItem('local:stoppingScan').then((v) => {
      setStoppingScan(v);
    });

    (async () => {
      const url = await getURL();
      // catches cases like about:blank, chrome:// and makes it impossible to start a scan on those pages
      if (url == null || !url.startsWith('http')) {
        setIllegalUrl(true);
      }
    })();

    // important: the created watchers have to be stopped later
    const unwatchScan = storage.watch('local:scan', (newScan, _) => {
      setScan(newScan);
    });
    const unwatchProgress = storage.watch('local:progress', (newProgress, _) => {
      if (newProgress != null) {
        setIeProgress({
          isDownloading: newProgress.ieDownloading, value: newProgress.ie,
        });
        setPurposeProgress({
          isDownloading: newProgress.purposeDownloading, value: newProgress.purpose,
        });
      }
    });
    const unwatchReset = storage.watch('local:resetBeforeScan', (newWasReset, _) => {
      if (newWasReset == null) {
        setResetBeforeScan(false);
      }
      setResetBeforeScan(newWasReset);
    });
    const unwatchReport = storage.watch('local:report', (newReport, _) => {
      setReport(newReport);
    });
    const unwatchStopping = storage.watch('local:stoppingScan', (newStopping, _) => {
      setStoppingScan(newStopping);
    });

    return () => {
      unwatchScan();
      unwatchProgress();
      unwatchReset();
      unwatchReport();
      unwatchStopping();
    };
  }, []);

  function isStage(scanState, stage) {
    if (stage === STAGE2.NOT_STARTED) {
      return scanState == null || scanState['stage2'] === stage;
    } else {
      return scanState && scanState['stage2'] === stage;
    }
  }

  /**
   * The next functions are handlers for when the user clicks one of the buttons on the popup.
   * This function is called when a user clicks the start button. It creates a new empty scan object and stores it in the chrome storage.
   */
  async function startScan() {
    const tabs = await browser.tabs.query({});
    let windows = new Set(tabs.map(tab => tab.windowId));

    if (windows.size > 1) {
      await openNotification(tabs[0].id, browser.i18n.getMessage('popup_errorTitle'),
          browser.i18n.getMessage('popup_tooManyWindowsText'), 'red');
      return;
    } else if (tabs.length > 1) {
      await openNotification(tabs[0].id, browser.i18n.getMessage('popup_errorTitle'),
          browser.i18n.getMessage('popup_tooManyTabsText'), 'red');
      return;
    }

    console.log('Starting scan...');
    const {msg} = await browser.runtime.sendMessage({msg: 'start_scan'});
    if (msg !== 'ok') throw new Error('start_scan was not confirmed by background.js');

    // close popup
    window.close();
  }

  async function noNotice() {
    const {msg} = await browser.runtime.sendMessage({msg: 'no_notice'});
    if (msg !== 'ok') throw new Error('no_notice was not confirmed by background.js');
  }

  async function cancelScan() {
    setIsLoading(true);
    const response = await browser.runtime.sendMessage({msg: 'cancel_scan'});
    console.log('response after cancel_scan', response);
    if (response.msg !== 'ok') throw new Error('cancel_scan was not confirmed by background.js');
    setIsLoading(false);
    // close popup
    window.close();
  }

  function createJsonReport(scan) {
    return {
      url: scan.url,
      startTime: scan.scanStart,
      interactiveElements: {
        accept: scan.interactiveElements[Purpose.Accept],
        close: scan.interactiveElements[Purpose.Close],
        settings: scan.interactiveElements[Purpose.Settings],
        other: scan.interactiveElements[Purpose.Other],
        reject: scan.interactiveElements[Purpose.Reject],
        saveSettings: scan.interactiveElements[Purpose.SaveSettings],
      },
      purposeDeclared: scan.purposeDeclared,
      noticeDetected: scan.noticeDetected,
      rejectDetected: scan.rejectDetected,
      closeSaveDetected: scan.closeSaveDetected,
      aaCookiesAfterReject: scan['aaCookiesAfterReject'].map(entry => {
        entry.aaCookies = entry.aaCookies.map(cookie => {
          cookie.textLabel = classIndexToString(cookie.current_label);
          return cookie;
        });
        return entry;
      }),
      aaCookiesAfterSave: scan.aaCookiesAfterSave.map(entry => {
        entry.aaCookies = entry.aaCookies.map(cookie => {
          cookie.textLabel = classIndexToString(cookie.current_label);
          return cookie;
        });
        return entry;
      }),
      aaCookiesAfterClose: scan.aaCookiesAfterClose.map(entry => {
        entry.aaCookies = entry.aaCookies.map(cookie => {
          cookie.textLabel = classIndexToString(cookie.current_label);
          return cookie;
        });
        return entry;
      }),
      aaCookiesWONoticeInteraction: scan.aaCookiesWONoticeInteraction.map(cookie => {
        cookie.textLabel = classIndexToString(cookie.current_label);
        return cookie;
      }),
      forcedActionStatus: (() => {
        if (scan.forcedActionStatus === DARK_PATTERN_STATUS.HAS_FORCED_ACTION) {
          return 'has_forced_action';
        } else if (scan.forcedActionStatus === DARK_PATTERN_STATUS.NO_FORCED_ACTION) {
          return 'no_forced_action';
        } else {
          return false;
        }
      })(),
      colorDistance: scan.colorDistance,
    };
  }

  /**
   * Provides the user with information about what the extension is currently doing (e.g., interacting with the page),
   * or instructions for the user (e.g., select the cookie notice)
   * @param scan
   * @param {boolean} resetBeforeScan
   * @param {boolean} illegalUrl
   * @param {boolean} isLoading
   * @param {boolean} modelsAreDownloading
   * @param {boolean} stoppingScan
   * @returns {JSX.Element}
   * @constructor
   */
  function InstructionText({scan, resetBeforeScan, illegalUrl, isLoading, modelsAreDownloading, stoppingScan}) {
    if (modelsAreDownloading) {
      return (<Text>{browser.i18n.getMessage('popup_waitForModels')}</Text>);
    } else if (stoppingScan) {
      return (<Text>{browser.i18n.getMessage('popup_stoppingScan')}</Text>);
    } else if (isLoading) {
      return (<Text>{browser.i18n.getMessage('popup_waitForLoad')}</Text>);
    } else if (scan != null) {
      if (isStage(scan, STAGE2.NOT_STARTED)) {
        if (!resetBeforeScan) {
          return (<Text>{browser.i18n.getMessage('popup_pleaseResetScan')}</Text>);
        } else if (illegalUrl) {
          return (<Text>{browser.i18n.getMessage('popup_invalidWebsite')}</Text>);
        } else {
          return (<Text>{browser.i18n.getMessage('popup_initialInstruction')}</Text>);
        }
      } else if (isStage(scan, STAGE2.NOTICE_SELECTION)) {
        return (<Text>{browser.i18n.getMessage('popup_skipSelection')}</Text>);
      } else if (isStage(scan, STAGE2.SECOND_SELECTION)) {
        return (<Text>{browser.i18n.getMessage('popup_secondSelection')}</Text>);
      } else if (isStage(scan, STAGE2.NOTICE_ANALYSIS)) {
        return (<Text>{browser.i18n.getMessage('popup_waitForAnalysis')}</Text>);
      } else if (isStage(scan, STAGE2.NOTICE_INTERACTION)) {
        return (<Text>{browser.i18n.getMessage('popup_noticeInteraction')}</Text>);
      } else if (isStage(scan, STAGE2.PAGE_INTERACTION)) {
        return (<Text>{browser.i18n.getMessage('popup_pageInteraction')}</Text>);
      } else if (isStage(scan, STAGE2.FINISHED)) {
        return (<Text>{browser.i18n.getMessage('popup_finishedScan')}</Text>);
      }
    } else if (!resetBeforeScan) {
      return (<Text>{browser.i18n.getMessage('popup_pleaseResetScan')}</Text>);
    } else if (illegalUrl) {
      return (<Text>{browser.i18n.getMessage('popup_invalidWebsite')}</Text>);
    }
  }

  /**
   * Contains the buttons that are relevant at any point in time, e.g., to start a scan, or to download the PDF & JSON report
   * @param scan
   * @param report
   * @returns {JSX.Element}
   * @constructor
   */
  function CurrentInteraction({scan, report}) {
    if (scan == null) {
      return (<></>);
    }
    if (isStage(scan, STAGE2.NOT_STARTED)) {
      return (<Button variant="light" color="green"
                      onClick={startScan}
                      disabled={startDisabled}>{browser.i18n.getMessage('popup_startScanBtn')}</Button>);
    } else if (isStage(scan, STAGE2.NOTICE_SELECTION)) {
      return (<Button variant="light" color="orange"
                      onClick={noNotice}>{browser.i18n.getMessage('popup_noNoticeBtn')}</Button>);
    } else if (isStage(scan, STAGE2.FINISHED)) {
      const dataUrl = report;
      let today = new Date();
      let uniformDomain = urlToUniformDomain(scan.url);
      let jsonReport = createJsonReport(scan);
      let jsonDataUrl = 'data:application/json;base64,' + window.btoa(JSON.stringify(jsonReport, null, 2));
      let dateString = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(today);
      return (<Stack>
        <Button variant="light" component="a" href={dataUrl}
                download={`${dateString}_${uniformDomain}_report.pdf`}>{browser.i18n.getMessage(
            'popup_downloadPdfBtn')}</Button>
        <Button variant="light" color="grape" component="a" href={jsonDataUrl}
                download={`${dateString}_${uniformDomain}_report.json`}>{browser.i18n.getMessage(
            'popup_downloadJsonBtn')}</Button>
      </Stack>);
    }
  }

  /**
   * @param scan
   * @param {boolean} illegalUrl
   * @param {boolean} isLoading
   * @param {boolean} resetBeforeScan
   * @param report
   * @param {boolean} modelsAreDownloading
   * @param {boolean} stoppingScan
   * @returns {JSX.Element}
   * @constructor
   */
  function CurrentScan({scan, illegalUrl, isLoading, resetBeforeScan, report, modelsAreDownloading, stoppingScan}) {
    return (<Stack justify="flex-start" align="stretch">
      <InstructionText scan={scan} illegalUrl={illegalUrl} isLoading={isLoading} resetBeforeScan={resetBeforeScan}
                       report={report} modelsAreDownloading={modelsAreDownloading} stoppingScan={stoppingScan}/>
      <CurrentInteraction scan={scan} report={report}/>
      <Divider my="xs"/>
    </Stack>);
  }

  return (<MantineProvider>
    <Center maw={800} p={20}>
      <Stack align="stretch"
             justify="space-around"
             gap="xs">
        <Text fw={700} ta="center">CookieAudit</Text>
        <CurrentScan scan={scan} illegalUrl={illegalUrl} isLoading={isLoading} resetBeforeScan={resetBeforeScan}
                     report={report} modelsAreDownloading={modelsAreDownloading} stoppingScan={stoppingScan}/>
        <Group justify="center">
          {modelsAreDownloading && (<Stack justify="flex-start" align="stretch">
            <Text>{browser.i18n.getMessage('popup_download')}</Text>
            <Progress
                value={(purposeProgress.value + ieProgress.value) / 2}/>
            <Divider my="xs"/>
          </Stack>)}
        </Group>
        <Button variant="light" color="red" disabled={stoppingScan}
                onClick={cancelScan}>{browser.i18n.getMessage('popup_cancelScanBtn')}</Button>
        <Group justify="center">
          <Anchor href={browser.runtime.getURL('/onboarding.html')} target="_blank" size="xs">
            {browser.i18n.getMessage('popup_helpPageLink')}
          </Anchor>
        </Group>
      </Stack>
    </Center>
  </MantineProvider>);
}
