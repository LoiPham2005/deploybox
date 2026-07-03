import { Module } from '@nestjs/common';
import { DatabaseController } from './database.controller';
import { DatabaseService } from './database.service';
import { AuthModule } from '../auth/auth.module'; // JwtAuthGuard

@Module({
  imports: [AuthModule],
  controllers: [DatabaseController],
  providers: [DatabaseService],
})
export class DatabaseModule {}
