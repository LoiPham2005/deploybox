import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { BuildRunnerService } from './build.runner.service';
import { BUILD_QUEUE, type BuildJobData } from './queue.constants';

@Processor(BUILD_QUEUE)
export class BuildProcessor extends WorkerHost {
  constructor(private readonly runner: BuildRunnerService) {
    super();
  }

  async process(job: Job<BuildJobData>): Promise<void> {
    await this.runner.run(job.data);
  }
}
