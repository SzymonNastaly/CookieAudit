import {Anchor, Button, Center, Divider, Group, MantineProvider, Progress, Stack, Text} from '@mantine/core';
import {useEffect, useRef, useState} from 'react';
import './App.css';
import '@mantine/core/styles.css';
import {storage} from 'wxt/storage';
import {debug} from '../debug.js';
import {
  classIndexToString,
  DARK_PATTERN_STATUS,
  ieLabelToString,
  openNotification,
  IEPurpose,
  STAGE,
  urlToUniformDomain,
  urlWoQueryOrFragment,
} from '../modules/globals.js';

function createJsonDataUrl(jsonObject) {
  debug.log("Creating JSON data URL");
  const jsonString = JSON.stringify(jsonObject, null, 2);

  const utf8Encoder = new TextEncoder();
  const utf8Encoded = utf8Encoder.encode(jsonString);

  const base64Encoded = window.btoa(String.fromCharCode.apply(null, utf8Encoded));

  return `data:application/json;charset=utf-8;base64,${base64Encoded}`;
}

/**
 * Retrieve a clean (without query parameters or a #fragement) url of the active tab.
 * @returns {Promise<String|null>} Url.
 */
async function getURL() {
  debug.log("Getting active tab URL");
  let queryOptions = {active: true};
  // `tab` will either be a `tabs.Tab` instance or `undefined`.
  let [tab] = await browser.tabs.query(queryOptions);
  debug.log("Active tab query result:", tab);
  if (!tab || !tab.url) {
    debug.log("No valid tab or URL found");
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

  const [ackCookieDelete, setAckCookieDelete] = useState(false);

  function setScan(s) {
    _setScan(s);
    scanRef.current = s;
  }

  const modelsAreDownloading = (purposeProgress.value + ieProgress.value > 0) &&
      (purposeProgress.value + ieProgress.value < 200);
  // user should not be able to start a scan if e.g., a chrome:// page is open, the BERT models are downloading, or a previous scan is currently being stopped
  const startDisabled = !resetBeforeScan || illegalUrl || isLoading || stoppingScan;

  useEffect(() => {
    debug.log("Initializing App component");
    storage.getItem('local:scan').then((localScan) => {
      debug.log("Retrieved local:scan from storage:", localScan);
      if (localScan != null) {
        setScan(localScan);
      }
    }).catch(err => {
      debug.log("Error retrieving local:scan:", err);
    });
    storage.getItem('local:progress').then((progress) => {
      debug.log("Retrieved local:progress from storage:", progress);
      if (progress != null) {
        setIeProgress({
          isDownloading: progress.ieDownloading, value: progress.ie,
        });
        setPurposeProgress({
          isDownloading: progress.purposeDownloading, value: progress.purpose,
        });
      }
    }).catch(err => {
      debug.log("Error retrieving local:progress:", err);
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
    storage.getItem('local:settings').then((settings) => {
      if (settings == null) {
        settings = {
          ackCookieDelete: false,
        };
        storage.setItem('local:settings', settings);
        setAckCookieDelete(false);
      } else if (settings.ackCookieDelete == null) {
        settings.ackCookieDelete = false;
        storage.setItem('local:settings', settings);
        setAckCookieDelete(false);
      } else {
        setAckCookieDelete(settings.ackCookieDelete);
      }
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
    debug.log("Setting up storage watchers");
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
      debug.log("Cleaning up storage watchers");
      unwatchScan();
      unwatchProgress();
      unwatchReset();
      unwatchReport();
      unwatchStopping();
    };
  }, []);

  function isStage(scanState, stage) {
    if (stage === STAGE.NOT_STARTED) {
      return scanState == null || scanState.stage === stage;
    } else {
      return scanState && scanState.stage === stage;
    }
  }

  /**
   * The next functions are handlers for when the user clicks one of the buttons on the popup.
   * This function is called when a user clicks the start button. It creates a new empty scan object and stores it in the chrome storage.
   */
  async function startScan() {
    debug.log("Starting scan...");
    const tabs = await browser.tabs.query({});
    debug.log("Found tabs:", tabs);
    let windows = new Set(tabs.map(tab => tab.windowId));

    if (windows.size > 1) {
      debug.log("Error: Multiple windows detected");
      await openNotification(tabs[0].id, browser.i18n.getMessage('popup_errorTitle'),
          browser.i18n.getMessage('popup_tooManyWindowsText'), 'red');
      return;
    } else if (tabs.length > 1) {
      await openNotification(tabs[0].id, browser.i18n.getMessage('popup_errorTitle'),
          browser.i18n.getMessage('popup_tooManyTabsText'), 'red');
      return;
    }

    try {
      debug.log("Sending start_scan message to background");
      const {msg} = await browser.runtime.sendMessage({msg: 'start_scan'});
      if (msg !== 'ok') throw new Error('start_scan was not confirmed by background.js');
    } catch (err) {
      debug.log("Error during start_scan:", err);
      throw err;
    }


    // close popup
    window.close();
  }

  async function noNotice() {
    debug.log("Sending no_notice message to background");
    try {
      const {msg} = await browser.runtime.sendMessage({msg: 'no_notice'});
      debug.log("Received response from background:", msg);
      if (msg !== 'ok') throw new Error('no_notice was not confirmed by background.js');
    } catch (err) {
      debug.log("Error during no_notice:", err);
      throw err;
    }
  }

  async function cancelScan() {
    debug.log("Canceling scan...");
    setIsLoading(true);
    try {
      const response = await browser.runtime.sendMessage({msg: 'cancel_scan'});
      debug.log("Received response after cancel_scan:", response);
      if (response.msg !== 'ok') throw new Error('cancel_scan was not confirmed by background.js');
    } catch (err) {
      debug.log("Error during cancel_scan:", err);
      throw err;
    }
    setIsLoading(false);
    window.close();
  }

  function createJsonReport(scan) {
    return {
      url: scan.url,
      startTime: scan.scanStart,
      interactiveElements: {
        accept: scan.interactiveElements[IEPurpose.Accept],
        close: scan.interactiveElements[IEPurpose.Close],
        settings: scan.interactiveElements[IEPurpose.Settings],
        other: scan.interactiveElements[IEPurpose.Other],
        reject: scan.interactiveElements[IEPurpose.Reject],
        saveSettings: scan.interactiveElements[IEPurpose.SaveSettings],
      },
      purposeDeclared: scan.purposeDeclared,
      noticeDetected: scan.noticeDetected,
      rejectDetected: scan.rejectDetected,
      closeSaveDetected: scan.closeSaveDetected,
      aaCookiesAfterReject: scan.aaCookiesAfterReject.map(entry => {
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
      colorDistances: scan.colorDistances.map(cd => {
        cd.button1.textLabel = ieLabelToString(cd.button1.label);
        cd.button2.textLabel = ieLabelToString(cd.button2.label);
        return cd;
      }),
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
    if (stoppingScan) {
      return (<Text>{browser.i18n.getMessage('popup_stoppingScan')}</Text>);
    } else if (isLoading) {
      return (<Text>{browser.i18n.getMessage('popup_waitForLoad')}</Text>);
    } else if (scan != null) {
      if (isStage(scan, STAGE.NOT_STARTED)) {
        if (!resetBeforeScan) {
          return (<Text>{browser.i18n.getMessage('popup_pleaseResetScan')}</Text>);
        } else if (illegalUrl) {
          return (<Text>{browser.i18n.getMessage('popup_invalidWebsite')}</Text>);
        } else {
          return (<Text>{browser.i18n.getMessage('popup_initialInstruction')}</Text>);
        }
      } else if (isStage(scan, STAGE.NOTICE_SELECTION)) {
        return (<Text>{browser.i18n.getMessage('popup_skipSelection')}</Text>);
      } else if (isStage(scan, STAGE.SECOND_SELECTION)) {
        return (<Text>{browser.i18n.getMessage('popup_secondSelection')}</Text>);
      } else if (isStage(scan, STAGE.NOTICE_ANALYSIS)) {
        if (modelsAreDownloading) {
          return (<Text>{browser.i18n.getMessage('popup_waitForModels')}</Text>);
        }
        return (<Text>{browser.i18n.getMessage('popup_waitForAnalysis')}</Text>);
      } else if (isStage(scan, STAGE.NOTICE_INTERACTION)) {
        return (<Text>{browser.i18n.getMessage('popup_noticeInteraction')}</Text>);
      } else if (isStage(scan, STAGE.PAGE_INTERACTION)) {
        return (<Text>{browser.i18n.getMessage('popup_pageInteraction')}</Text>);
      } else if (isStage(scan, STAGE.FINISHED)) {
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
    if (isStage(scan, STAGE.NOT_STARTED)) {
      return (<Button variant="light" color="green"
                      onClick={startScan}
                      disabled={startDisabled}>{browser.i18n.getMessage('popup_startScanBtn')}</Button>);
    } else if (isStage(scan, STAGE.NOTICE_SELECTION)) {
      return (<Button variant="light" color="orange"
                      onClick={noNotice}>{browser.i18n.getMessage('popup_noNoticeBtn')}</Button>);
    } else if (isStage(scan, STAGE.FINISHED)) {
      const dataUrl = report;
      let today = new Date();
      let uniformDomain = urlToUniformDomain(scan.url);
      let jsonReport = createJsonReport(scan);
      let jsonDataUrl = createJsonDataUrl(jsonReport);
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

  function confirmCookieDeleteInfo() {
    // set settingsvalue to true
    storage.getItem('local:settings').then((settings) => {
      settings.ackCookieDelete = true;
      storage.setItem('local:settings', settings);
      setAckCookieDelete(true);
    });
  }

  function CookieDeleteInfo() {
    return (<Stack justify="flex-start" align="stretch">
      <Text>{browser.i18n.getMessage('popup_cookieDeleteInfo')}</Text>
      <Button variant="light" color="green"
              onClick={confirmCookieDeleteInfo}>{browser.i18n.getMessage('popup_okBtn')}</Button>
    </Stack>);
  }

  if (!ackCookieDelete) {
    return (<MantineProvider>
          <Center maw={800} p={20}>
            <Stack align="stretch"
                   justify="space-around"
                   gap="xs">
              <Text fw={700} ta="center">CookieAudit</Text>
              <CookieDeleteInfo/>
            </Stack>
          </Center>
        </MantineProvider>);
  } else {
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
}
