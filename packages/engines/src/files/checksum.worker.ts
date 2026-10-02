/**
 * U04's hashing worker. Two run side by side for each file; ./checksum-job.ts
 * has what each does.
 */
import { runChecksumJob, type ChecksumJob, type ChecksumMessage } from './checksum-job';

interface WorkerScope {
  postMessage(message: ChecksumMessage): void;
  onmessage: ((event: MessageEvent<ChecksumJob>) => void) | null;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  void runChecksumJob(event.data, (message) => {
    scope.postMessage(message);
  });
};
