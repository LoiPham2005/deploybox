import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

@Injectable()
export class LogBroadcastService {
  private readonly ee = new EventEmitter();

  constructor() {
    this.ee.setMaxListeners(0); // unlimited — many concurrent builds/viewers
  }

  emit(deploymentId: string, line: string): void {
    this.ee.emit(deploymentId, line);
  }

  end(deploymentId: string): void {
    this.ee.emit(`end:${deploymentId}`);
    // Remove listeners after a delay to avoid memory leaks
    setTimeout(() => {
      this.ee.removeAllListeners(deploymentId);
      this.ee.removeAllListeners(`end:${deploymentId}`);
    }, 10_000);
  }

  onLine(deploymentId: string, cb: (line: string) => void): () => void {
    this.ee.on(deploymentId, cb);
    return () => this.ee.off(deploymentId, cb);
  }

  onEnd(deploymentId: string, cb: () => void): () => void {
    this.ee.once(`end:${deploymentId}`, cb);
    return () => this.ee.off(`end:${deploymentId}`, cb);
  }
}
