import { runScan } from './runScan';
import type { ScanMessage, ScanRequest } from './scanProtocol';

// Thin shell: everything testable is in runScan.
self.onmessage = (event: MessageEvent<ScanRequest>) => {
  void runScan(event.data, (message: ScanMessage) => {
    self.postMessage(message);
  });
};
